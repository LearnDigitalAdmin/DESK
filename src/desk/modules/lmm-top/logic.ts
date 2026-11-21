/** Pure helpers for the top-desk Lipa Mdogo Mdogo screens. No React, no network. */
import type { AuditAction, LeadStage, TopAuditListIn, TopAuditVerifyOut } from "../../api/lmmxContract.ts";
import { LEAD_STAGES } from "../../api/lmmxContract.ts";
import { lmmxCodeOf } from "../../api/lmmxErrors.ts";
import { rangeToMs } from "../lmm/logic.ts";
import { S } from "../lmm/strings.ts";
import { T } from "./strings.ts";

export const TOP_REASON_MIN = 10;
export const TOP_REASON_MAX = 500;
export const AUDIT_LIMIT = 15;

export type ReasonCheck = { ok: true; value: string } | { ok: false; error: string };
/** Every top-desk change needs a written reason of at least 10 characters (spaces collapsed, so ten spaces do not count). */
export function validateTopReason(reason: string): ReasonCheck {
  const t = reason.trim().replace(/\s+/g, " ");
  if (t.length < TOP_REASON_MIN) return { ok: false, error: T.reason.tooShort };
  if (t.length > TOP_REASON_MAX) return { ok: false, error: T.reason.tooLong };
  return { ok: true, value: t };
}

export const needsReauth = (e: unknown): boolean => lmmxCodeOf(e) === "LMMX_E_NEEDS_REAUTH";

/**
 * Runs `call`. If the server says the sign-in is too old (LMMX_E_NEEDS_REAUTH) it asks the person to sign in again (`reauth`) and retries
 * ONCE. If they cancel, or it is still too old, the original error is thrown and nothing else is tried.
 */
export async function runWithReauth<T>(call: () => Promise<T>, reauth: () => Promise<void>): Promise<T> {
  try { return await call(); } catch (e) {
    if (!needsReauth(e)) throw e;
    try { await reauth(); } catch { throw e; }
    return await call();
  }
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  tenant_created: "Tenant created", setup_otp_sent: "Setup code sent", setup_otp_failed: "Wrong setup code", setup_confirmed: "Setup confirmed", setup_expired: "Setup ran out of time",
  recipient_checked: "Landlord account checked", recipient_created: "Landlord account created", recipient_reused: "Landlord account reused", recipient_review_decided: "Review decided",
  change_requested: "Change requested", change_otp_failed: "Wrong change code", change_confirmed: "Change confirmed", change_cancelled: "Change cancelled", change_applied: "Change applied",
  tenant_link: "Tenant linked", due_day_changed: "Due day changed", plan_changed: "Plan changed", payment_credited: "Payment credited", payment_rejected: "Payment rejected",
  settlement_started: "Payout started", settlement_paid: "Payout paid", settlement_failed: "Payout failed", refund: "Refund", freeze: "Put on hold", unfreeze: "Taken off hold",
  reassign: "Moved to another desk", reveal: "Full details shown", top_update: "Changed by top desk", landlord_matched: "Landlord matched", tamper_detected: "Tampering detected",
  rate_limited: "Too many tries", signature_failed: "Bad bot signature", audit_verified: "Audit checked", lead_updated: "Lead updated", bonus_accrued: "Bonus earned",
 payout_requested: "Tenant asked to pay landlord now",
 withdraw_started: "Withdrawal code sent",
 withdraw_requested: "Withdrawal requested",
 withdraw_paid: "Withdrawal sent",
};
export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS) as AuditAction[];

export interface AuditFilters { tenantId: string; action: AuditAction | ""; deskCode: string; from: string; to: string }
export const emptyAuditFilters = (): AuditFilters => ({ tenantId: "", action: "", deskCode: "", from: "", to: "" });
/** The filters as a server query. Empty boxes are left out; a date range that is back to front returns null. */
export function auditQuery(f: AuditFilters, cursor?: number): TopAuditListIn | null {
  let from: number | undefined, to: number | undefined;
  if (f.from || f.to) {
    const r = rangeToMs(f.from || f.to, f.to || f.from);
    if (!r) return null;
    from = f.from ? r.from : undefined; to = f.to ? r.to : undefined;
  }
  return {
    ...(f.tenantId.trim() ? { tenantId: f.tenantId.trim() } : {}), ...(f.action ? { action: f.action } : {}), ...(f.deskCode.trim() ? { deskCode: f.deskCode.trim().toUpperCase() } : {}),
    ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), ...(cursor !== undefined ? { cursor } : {}), limit: AUDIT_LIMIT,
  };
}
/** The Verify chain button's answer in words: clearly OK, or the first broken sequence number. */
export function verifyMessage(r: TopAuditVerifyOut): { tone: "ok" | "error"; text: string } {
  return r.ok ? { tone: "ok", text: T.audit.ok(r.checked) } : { tone: "error", text: T.audit.broken(r.brokenAtSeq ?? 0) };
}

export const LEAD_TABS: readonly { id: LeadStage | "all"; label: string }[] = [{ id: "all", label: T.leads.all }, ...LEAD_STAGES.map((s) => ({ id: s, label: S.stage[s] }))];

/** "YYYY-MM-DD" from the date box -> start of that day in Nairobi; "" clears it (null); junk is undefined (not sent). */
export function followUpToMs(iso: string): number | null | undefined {
  if (!iso) return null;
  const r = rangeToMs(iso, iso);
  return r ? r.from : undefined;
}

export const deskCodeProblem = (s: string): string | null => (/^COG-\d{4}$/.test(s.trim().toUpperCase()) ? null : T.tenants.badDesk);
