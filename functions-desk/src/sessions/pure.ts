import type { Scope } from "../contract.js";
import { DeskError } from "../errors.js";

/** Record keyed by Scope so adding a scope to the contract fails the build here until it is handled. */
const SCOPE_SET: Record<Scope, true> = {
  read: true, import: true, manual_entry: true, schedule: true, bulk_sms: true, report: true, export: true, rent_stk: true,
};
export const ALL_SCOPES = Object.keys(SCOPE_SET) as Scope[];

/** A non-empty subset of Scope, deduplicated, in contract order. Pure. */
import { DESK_TOP_CODE, type OtpAction, type EntityKey, type Scope as ScopeT } from "../contract.js";
import { SESSION_TTL_MS } from "../otp/core.js";
import type { ActionOtpDoc, SessionDoc } from "../types.js";

/** The top desk (COG-0000) is the Samuhia internal support desk: it needs no customer OTP to open an account or confirm an action. Everyone else always does. */
export function isTopDeskAgent(a: { agentCode?: string; status?: string } | undefined): boolean {
  return !!a && a.agentCode === DESK_TOP_CODE && a.status === "active";
}
/** A session that is open from the start (no code was sent, so there is nothing to verify). */
export function topSessionDoc(p: { sessionId: string; agentId: string; entityKey: EntityKey; scopes: ScopeT[]; now: number }): SessionDoc {
  return { sessionId: p.sessionId, agentId: p.agentId, entityKey: p.entityKey, scopes: p.scopes, status: "active", otpAttempts: 0, otpExpiresAt: p.now, otpVerifiedAt: p.now, expiresAt: p.now + SESSION_TTL_MS, createdAt: p.now };
}
/** An action confirmation that is already verified (single use, fresh for ACTION_OTP_FRESH_MS like any other). */
export function topActionOtpDoc(p: { actionId: string; sessionId: string; agentId: string; action: OtpAction; summary: string; now: number }): ActionOtpDoc {
  return { actionId: p.actionId, sessionId: p.sessionId, agentId: p.agentId, action: p.action, summary: p.summary, otpHash: "", otpAttempts: 0, otpExpiresAt: p.now, verifiedAt: p.now, createdAt: p.now };
}

export function validateScopes(v: unknown): Scope[] {
  if (!Array.isArray(v) || v.length === 0) throw new DeskError("invalid_argument", "Choose at least one thing you need access to");
  const wanted = new Set<string>();
  for (const s of v) {
    if (typeof s !== "string" || !(s in SCOPE_SET)) throw new DeskError("invalid_argument", "Unknown access type requested");
    wanted.add(s);
  }
  return ALL_SCOPES.filter((s) => wanted.has(s));
}

/** Tenant ids for a rent batch: 1–200, trimmed, unique. Duplicates are refused (never silently dropped) so the count the customer approved stays true. */
export function validateTenantIds(v: unknown, max: number): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new DeskError("invalid_argument", "Select at least one tenant");
  if (v.length > max) throw new DeskError("invalid_argument", `You can send rent requests to at most ${max} tenants at a time`);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of v) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || id.length > 128 || id.includes("/")) throw new DeskError("invalid_argument", "A tenant id is not valid");
    if (seen.has(id)) throw new DeskError("invalid_argument", "The same tenant was selected more than once");
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
