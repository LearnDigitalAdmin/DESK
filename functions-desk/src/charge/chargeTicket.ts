/**
 * desk_chargeTicket — start (or, after 120 s, repeat) the M-Pesa STK push for a desk service ticket.
 *
 * Order of work (nothing before step 5 changes ticket state, so a refusal never leaves a half-reserved ticket):
 *  1. caller owns the ticket; it is a draft (or an awaiting_payment ticket being re-prompted); the session is still valid
 *  2. re-prompt only: >= 120 s since the last request, attempts left, and Paystack says NO attempt succeeded
 *  3. bulk_reminder only: recount recipients with the product (dry run) and find the customer's fresh, verified bulk_sms OTP
 *     whose stored summary equals summaryBulkSms(recount)
 *  4. the agent's main-account subaccount and the 97.5% split code
 *  5. transaction: draft -> awaiting_payment (attempt++, new reference). Never two live STKs on one ticket.
 *  6. bulk_reminder only: consume that OTP (one use); if it fails the reservation is undone
 *  7. write cyber-transactions/{reference} (PAY's exact shape), THEN call Paystack. A refusal returns the ticket to draft.
 */
import { FieldValue } from "firebase-admin/firestore";
import type { ChargeTicketIn, ChargeTicketOut } from "../contract.js";
import { summaryBulkSms } from "../contract.js";
import { col, db } from "../db.js";
import { parseEntityKey } from "../entity.js";
import { DeskError } from "../errors.js";
import { getAgentPayment, requireActiveAgent } from "../kernel/agents.js";
import { audit } from "../kernel/audit.js";
import { ACTION_OTP_FRESH_MS, requireSession } from "../kernel/session.js";
import { planForService } from "../money.js";
import { maskPhone, normalizeKenyaPhone } from "../paystack/phone.js";
import { settleTicketReference } from "../ledger/settle.js";
import { measureBulkReminder } from "../tickets/bulk.js";
import { SERVICE_SCOPE, type DeskTicket } from "../tickets/model.js";
import type { ActionOtpDoc } from "../types.js";
import { buildChargeMetadata, buildCyberTransaction, CYBER_TRANSACTIONS } from "./cyberTransaction.js";
import { DEAD_PAYSTACK_STATUSES, isReferenceNotFound, resolveDeps, type DeskDeps, type ResolvedDeps } from "./port.js";
import { buildDeskReference } from "./reference.js";

/** A second STK on the same ticket is allowed only this long after the previous one was sent. */
export const REPROMPT_AFTER_MS = 120_000;
export const MAX_CHARGE_ATTEMPTS = 5;

const refuse = (m: string) => new DeskError("failed_precondition", m);

export function parseChargeInput(data: unknown): { ticketId: string; phone: string } {
  if (typeof data !== "object" || data === null) throw new DeskError("invalid_argument", "Invalid request");
  const { ticketId, phone } = data as Partial<ChargeTicketIn>;
  if (typeof ticketId !== "string" || !/^[A-Za-z0-9]{1,128}$/.test(ticketId)) throw new DeskError("invalid_argument", "Invalid ticket");
  if (typeof phone !== "string" || phone.length < 9 || phone.length > 20) throw new DeskError("invalid_argument", "Enter a valid Kenyan phone number");
  return { ticketId, phone };
}

const ticketBlockMessage = (s: DeskTicket["status"]): string => {
  switch (s) {
    case "paid": case "committed": return "This ticket is already paid";
    case "failed": return "This payment did not go through. Create a new quote to try again";
    case "expired": return "This ticket expired. Create a new quote to try again";
    default: return "This ticket cannot be charged";
  }
};

/** Re-prompt gate: waited 120 s, attempts left, and Paystack confirms none of the earlier attempts succeeded. */
async function assertCanReprompt(t: DeskTicket, d: ResolvedDeps): Promise<void> {
  const waited = d.now() - (t.chargeStartedAt ?? t.updatedAt);
  if (waited < REPROMPT_AFTER_MS) {
    throw refuse(`A payment request was just sent. Wait ${Math.ceil((REPROMPT_AFTER_MS - waited) / 1000)} more seconds before sending another.`);
  }
  if ((t.attempts ?? 0) >= MAX_CHARGE_ATTEMPTS) throw refuse("Too many payment requests for this ticket. Create a new quote to try again");
  const refs = [...(t.attemptRefs ?? (t.paystackRef ? [t.paystackRef] : []))].slice(-MAX_CHARGE_ATTEMPTS).reverse();
  for (const ref of refs) {
    let status: string;
    let verified;
    try {
      verified = await d.port.verifyTransaction(ref);
      status = verified.status;
    } catch (err) {
      if (isReferenceNotFound(err)) continue; // Paystack never saw it: nothing live
      throw refuse("We could not confirm the previous payment request yet. Please try again in a moment.");
    }
    if (status === "success") {
      await settleTicketReference({ ticketId: t.ticketId, reference: ref, source: "reprompt", verified }, d);
      throw refuse("The customer's payment was already received, so no new request was sent. Check the ticket status.");
    }
  }
}

/** bulk_reminder: the verified, unused, fresh bulk_sms OTP for this session whose stored summary matches the recount. */
async function findBulkOtp(t: DeskTicket, uid: string, expectedSummary: string, now: number): Promise<string> {
  const snap = await col("actionOtps").where("sessionId", "==", t.sessionId).where("agentId", "==", uid).where("action", "==", "bulk_sms").get();
  const usable = snap.docs.map((s) => s.data() as ActionOtpDoc)
    .filter((o) => o.verifiedAt && !o.consumedAt && now - o.verifiedAt <= ACTION_OTP_FRESH_MS)
    .sort((a, b) => (b.verifiedAt ?? 0) - (a.verifiedAt ?? 0));
  if (usable.length === 0) throw new DeskError("otp_required", "Confirm this bulk SMS with the customer's OTP first");
  const match = usable.find((o) => o.summary === expectedSummary);
  if (!match) {
    throw new DeskError("otp_required",
      `The customer confirmed "${usable[0].summary}", but this reminder now reaches a different number of people (${expectedSummary}). Request a new quote and confirm again.`);
  }
  return match.actionId;
}

interface Reservation { reference: string; attempt: number; prev: Pick<DeskTicket, "status" | "attempts" | "attemptRefs" | "paystackRef" | "chargeStartedAt" | "updatedAt" | "failureReason" | "sharePct" | "splitCode"> }

async function reserve(ticketId: string, expected: DeskTicket, plan: { sharePct: number; splitCode: string }, d: ResolvedDeps): Promise<Reservation> {
  const ref = col("tickets").doc(ticketId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.data() as DeskTicket | undefined;
    if (!snap.exists || !cur) throw new DeskError("not_found", "Ticket not found");
    if (cur.status !== expected.status || (cur.attempts ?? 0) !== (expected.attempts ?? 0) || cur.paystackRef !== expected.paystackRef)
      throw refuse("This ticket was just updated by another request. Refresh and try again.");
    const attempt = (cur.attempts ?? 0) + 1;
    if (attempt > MAX_CHARGE_ATTEMPTS) throw refuse("Too many payment requests for this ticket. Create a new quote to try again");
    const reference = buildDeskReference(ticketId, attempt);
    const now = d.now();
    tx.update(ref, {
      status: "awaiting_payment", attempts: attempt, paystackRef: reference,
      attemptRefs: [...(cur.attemptRefs ?? []), reference], chargeStartedAt: now, updatedAt: now,
      splitCode: plan.splitCode, sharePct: plan.sharePct, failureReason: FieldValue.delete(),
    });
    return {
      reference, attempt,
      prev: {
        status: cur.status, attempts: cur.attempts, attemptRefs: cur.attemptRefs, paystackRef: cur.paystackRef,
        chargeStartedAt: cur.chargeStartedAt, updatedAt: cur.updatedAt, failureReason: cur.failureReason,
        sharePct: cur.sharePct, splitCode: cur.splitCode,
      },
    };
  });
}

const orDelete = <T>(v: T | undefined) => (v === undefined ? FieldValue.delete() : v);

/** Undo a reservation that never reached Paystack (the OTP step failed). The ticket goes back exactly as it was. */
async function undoReservation(ticketId: string, r: Reservation, d: ResolvedDeps): Promise<void> {
  const ref = col("tickets").doc(ticketId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.data() as DeskTicket | undefined;
    if (!cur || cur.paystackRef !== r.reference || cur.status !== "awaiting_payment") return;
    const p = r.prev;
    tx.update(ref, {
      status: p.status, attempts: orDelete(p.attempts), attemptRefs: orDelete(p.attemptRefs), paystackRef: orDelete(p.paystackRef),
      chargeStartedAt: orDelete(p.chargeStartedAt), sharePct: orDelete(p.sharePct), splitCode: orDelete(p.splitCode),
      failureReason: orDelete(p.failureReason), updatedAt: d.now(),
    });
  });
}

/** Paystack refused the charge (or reported it failed): the ticket returns to draft with the reason and the attempt is closed. */
async function returnToDraft(ticketId: string, reference: string, reason: string, d: ResolvedDeps): Promise<boolean> {
  const ref = col("tickets").doc(ticketId);
  const reverted = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.data() as DeskTicket | undefined;
    if (!cur || cur.paystackRef !== reference || cur.status !== "awaiting_payment") return false;
    tx.update(ref, { status: "draft", failureReason: reason, paystackRef: FieldValue.delete(), updatedAt: d.now() });
    return true;
  });
  await db().collection(CYBER_TRANSACTIONS).doc(reference).update({ status: "failed", failureReason: reason, failedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  return reverted;
}

export async function chargeTicket(uid: string, data: unknown, deps: DeskDeps = {}): Promise<ChargeTicketOut> {
  const d = resolveDeps(deps);
  const input = parseChargeInput(data);
  const agent = await requireActiveAgent(uid);
  const phoneE164 = normalizeKenyaPhone(input.phone);

  // 1. ownership, state, session
  const ticketRef = col("tickets").doc(input.ticketId);
  const snap = await ticketRef.get();
  if (!snap.exists) throw new DeskError("not_found", "Ticket not found");
  const t = snap.data() as DeskTicket;
  if (t.agentId !== uid) throw new DeskError("permission_denied", "This ticket belongs to another agent");
  if (t.status !== "draft" && t.status !== "awaiting_payment") throw refuse(ticketBlockMessage(t.status));
  if (!Number.isSafeInteger(t.amountMinor) || t.amountMinor <= 0) throw new DeskError("internal", "This ticket has no valid amount");
  const scope = SERVICE_SCOPE[t.serviceType];
  const ctx = await requireSession({ sessionId: t.sessionId, uid, scope });
  const cfg = await d.config();

  // 2. re-prompt gate
  const reprompt = t.status === "awaiting_payment";
  if (reprompt) await assertCanReprompt(t, d);

  // 3. bulk reminder: recompute recipients server-side and find the OTP that describes exactly this send
  let bulkOtpId: string | undefined;
  if (t.serviceType === "bulk_reminder" && !reprompt) {
    const m = await measureBulkReminder({
      cfg, product: ctx.product, entityKey: ctx.entityKey, agentCode: agent.agentCode,
      audience: String(t.params.audience), message: String(t.params.message), delegate: d.delegate,
    });
    bulkOtpId = await findBulkOtp(t, uid, summaryBulkSms(m.recipients), d.now());
  }

  // 4. payout subaccount (desk services always charge in the MAIN Paystack account) and the split
  const pay = await getAgentPayment(uid, "main", cfg);
  const plan = planForService(t.serviceType, t.amountMinor, cfg);
  const splitCode = await d.port.getOrCreateSplitCode([{ subaccount: pay.subaccountCode, sharePct: plan.agentSharePct }], "service");

  // 5. reserve
  const reservation = await reserve(input.ticketId, t, { sharePct: plan.agentSharePct, splitCode }, d);
  const { reference } = reservation;

  // 6. consume the bulk OTP
  if (bulkOtpId) {
    try {
      await requireSession({ sessionId: t.sessionId, uid, scope, action: "bulk_sms", actionId: bulkOtpId });
    } catch (err) {
      await undoReservation(input.ticketId, reservation, d);
      throw err;
    }
  }

  // 7. the transaction record first (PAY's webhook needs it to exist), then Paystack
  const facts = { pay, ticket: { ...t, sharePct: plan.agentSharePct }, reference, phoneE164, splitCode, commissionRate: t.serviceType === "compliance_report" ? cfg.prices.reportPlatformPct : cfg.platformCutPct };
  const txRef = db().collection(CYBER_TRANSACTIONS).doc(reference);
  try {
    await txRef.create(buildCyberTransaction(facts));
  } catch (err) {
    await returnToDraft(input.ticketId, reference, "Could not record the payment request. Please try again.", d);
    throw err;
  }

  let started;
  try {
    started = await d.port.chargeMpesa({
      amountMinor: t.amountMinor, phoneE164, reference, email: pay.email, splitCode, metadata: buildChargeMetadata(facts),
    });
  } catch (err) {
    const reason = err instanceof DeskError ? err.message : "Paystack declined the request";
    // The call failed, but the request may still have reached Paystack. Only a reference Paystack confirms is dead
    // (or has never seen) can be released; otherwise an STK may be live and the ticket must stay awaiting_payment.
    let dead = false;
    try {
      const v = await d.port.verifyTransaction(reference);
      dead = DEAD_PAYSTACK_STATUSES.has(v.status);
    } catch (verifyErr) {
      dead = isReferenceNotFound(verifyErr);
    }
    if (dead) {
      await returnToDraft(input.ticketId, reference, reason, d);
      await audit({ action: "ticket_charge_refused", agentId: uid, entityKey: t.entityKey, sessionId: t.sessionId, meta: { ticketId: t.ticketId, reference, reason } });
      throw err;
    }
    await audit({ action: "ticket_charge_unconfirmed", agentId: uid, entityKey: t.entityKey, sessionId: t.sessionId, meta: { ticketId: t.ticketId, reference, reason } });
    throw refuse("We could not confirm whether the M-Pesa request was sent. Wait two minutes, then check the ticket or send it again.");
  }

  if (started.status === "failed") {
    const reason = started.displayText?.trim() || "The M-Pesa request failed";
    await returnToDraft(input.ticketId, reference, reason, d);
    await audit({ action: "ticket_charge_refused", agentId: uid, entityKey: t.entityKey, sessionId: t.sessionId, meta: { ticketId: t.ticketId, reference, reason } });
    throw new DeskError("payment_failed", reason);
  }

  // record Paystack's answer, but never overwrite a status the webhook may already have moved past "pending"
  await db().runTransaction(async (tx) => {
    const s = await tx.get(txRef);
    if (!s.exists) return;
    const cur = s.data() as { status?: string };
    const patch: Record<string, unknown> = {};
    if (started.displayText !== undefined) patch.displayText = started.displayText;
    if (started.accountReference !== undefined) patch.accountReference = started.accountReference;
    if (cur.status === "pending") patch.status = started.status || "pending";
    if (Object.keys(patch).length) tx.update(txRef, patch);
  });
  // a re-prompt supersedes the previous attempt's record (status untouched: only the live attempt may fail the ticket)
  if (reprompt && t.paystackRef) {
    await db().collection(CYBER_TRANSACTIONS).doc(t.paystackRef).update({ supersededBy: reference }).catch(() => undefined);
  }
  await audit({
    action: reprompt ? "ticket_charge_reprompted" : "ticket_charge_started", agentId: uid, entityKey: t.entityKey, sessionId: t.sessionId,
    meta: {
      ticketId: t.ticketId, reference, attempt: reservation.attempt, amountMinor: t.amountMinor, phone: maskPhone(phoneE164),
      sharePct: plan.agentSharePct, ...(bulkOtpId ? { otpActionId: bulkOtpId } : {}),
      product: parseEntityKey(t.entityKey).product,
    },
  });
  return { reference, status: "awaiting_payment" };
}
