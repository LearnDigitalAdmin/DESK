import type {
  OtpAction, RequestActionOtpOut, VerifyActionOtpOut,
} from "../contract.js";
import { col, db } from "../db.js";
import { DeskError } from "../errors.js";
import { audit } from "../kernel/audit.js";
import { requireActiveAgent } from "../kernel/agents.js";
import { OTP_ACTIONS, requireSession } from "../kernel/session.js";
import type { ActionOtpDoc, SessionDoc } from "../types.js";
import { record } from "../connectors/input.js";
import type { Deps } from "../connectors/deps.js";
import {
  adminPhoneE164, assertEntityKey, lookupEntity, NOT_AUTHORISED_MESSAGE,
} from "../connectors/entities.js";
import {
  entityDailyRule, evaluateOtpAttempt, hashOtp, isOtpShape, OTP_TTL_MS, takeRates, wrongCodeMessage,
} from "./core.js";
import { ACTION_SCOPE, actionSmsText, checkActionSummary } from "./messages.js";
import { isTopDeskAgent, topActionOtpDoc } from "../sessions/pure.js";

function parseAction(v: unknown): OtpAction {
  if (typeof v !== "string" || !OTP_ACTIONS.has(v as OtpAction)) throw new DeskError("invalid_argument", "Unknown action");
  return v as OtpAction;
}

/** Active session whose scopes include the action -> a fresh OTP SMSed to the customer, repeating the summary. */
export async function requestActionOtp(deps: Deps, uid: string, raw: unknown): Promise<RequestActionOtpOut> {
  const d = record(raw);
  const sessionId = typeof d.sessionId === "string" ? d.sessionId : "";
  if (!sessionId) throw new DeskError("invalid_argument", "Session is required");
  const action = parseAction(d.action);
  const check = checkActionSummary(action, d.summary);
  if (!check.ok) throw new DeskError("invalid_argument", check.message);
  const summary = d.summary as string;

  const agent = await requireActiveAgent(uid);
  const ctx = await requireSession({ sessionId, uid, scope: ACTION_SCOPE[action] });
  if (action === "rent_stk" && ctx.product !== "pms") {
    throw new DeskError("failed_precondition", "Rent STK is only available for Plot Yangu accounts");
  }

  // COG-0000 needs no customer code: the confirmation is created already verified (nothing is sent to the customer).
  if (isTopDeskAgent(agent)) {
    const tref = col("actionOtps").doc();
    await tref.create(topActionOtpDoc({ actionId: tref.id, sessionId, agentId: uid, action, summary, now: deps.now() }));
    await audit({ action: "action_otp_verified", agentId: uid, entityKey: ctx.entityKey, sessionId, meta: { otpAction: action, actionId: tref.id, topNoOtp: true } });
    return { actionId: tref.id, verified: true };
  }

  // Re-check with the product now: the customer may have removed this desk since the session opened.
  const { code } = assertEntityKey(ctx.entityKey);
  const cfg = await deps.getConfig();
  const lookup = await lookupEntity(deps, cfg, agent, ctx.product, code);
  if (!lookup.authorised) throw new DeskError("permission_denied", NOT_AUTHORISED_MESSAGE);
  const adminPhone = adminPhoneE164(lookup.info);

  const taken = await takeRates([entityDailyRule(ctx.entityKey)], deps.now());
  const ref = col("actionOtps").doc();
  const otp = deps.randomOtp();
  const now = deps.now();
  const doc: ActionOtpDoc = {
    actionId: ref.id, sessionId, agentId: uid, action, summary,
    otpHash: hashOtp(otp, ref.id), otpAttempts: 0, otpExpiresAt: now + OTP_TTL_MS, createdAt: now,
  };
  await ref.create(doc);
  try {
    await deps.sendSms(adminPhone, actionSmsText(agent.name, agent.agentCode, summary, otp));
  } catch {
    await ref.delete().catch(() => undefined);
    await taken.release();
    throw new DeskError("internal", "We could not send the confirmation code to the customer. Please try again.");
  }
  await audit({ action: "action_otp_requested", agentId: uid, entityKey: ctx.entityKey, sessionId, meta: { otpAction: action, actionId: ref.id } });
  return { actionId: ref.id };
}

type VerifyOutcome =
  | { kind: "ok"; sessionId: string; entityKey: string; otpAction: OtpAction } | { kind: "missing" } | { kind: "foreign" } | { kind: "used" } | { kind: "expired" }
  | { kind: "locked" } | { kind: "session" } | { kind: "wrong"; attempts: number; locked: boolean };

/** At most 5 attempts, expiry, constant-time compare. A verified OTP stays single-use: requireSession consumes it. */
export async function verifyActionOtp(deps: Deps, uid: string, raw: unknown): Promise<VerifyActionOtpOut> {
  const d = record(raw);
  const actionId = typeof d.actionId === "string" ? d.actionId : "";
  if (!actionId) throw new DeskError("invalid_argument", "Action is required");
  if (!isOtpShape(d.otp)) throw new DeskError("invalid_argument", "Enter the 6-digit code");
  const otp = (d.otp as string).trim();
  const now = deps.now();
  const aRef = col("actionOtps").doc(actionId);

  const out = await db().runTransaction(async (tx): Promise<VerifyOutcome> => {
    const aSnap = await tx.get(aRef);
    if (!aSnap.exists) return { kind: "missing" };
    const a = aSnap.data() as ActionOtpDoc;
    if (a.agentId !== uid) return { kind: "foreign" };
    if (a.consumedAt) return { kind: "used" };
    const sSnap = await tx.get(col("sessions").doc(a.sessionId));
    const s = sSnap.exists ? (sSnap.data() as SessionDoc) : undefined;
    if (!s || s.agentId !== uid || s.status !== "active" || s.expiresAt <= now) return { kind: "session" };
    const ok: VerifyOutcome = { kind: "ok", sessionId: a.sessionId, entityKey: s.entityKey, otpAction: a.action };
    if (a.verifiedAt) return ok; // double submit: already verified, still unconsumed
    const r = evaluateOtpAttempt({ hash: a.otpHash, attempts: a.otpAttempts, expiresAt: a.otpExpiresAt }, otp, actionId, now);
    if (r.kind === "locked") return { kind: "locked" };
    if (r.kind === "expired") return { kind: "expired" };
    if (r.kind === "wrong") {
      // "ended": a code that has used its attempts can never verify, so also expire it.
      tx.update(aRef, r.locked ? { otpAttempts: r.attempts, otpExpiresAt: now } : { otpAttempts: r.attempts });
      return r;
    }
    tx.update(aRef, { otpAttempts: r.attempts, verifiedAt: now });
    return ok;
  });

  switch (out.kind) {
    case "ok": {
      await audit({ action: "action_otp_verified", agentId: uid, entityKey: out.entityKey, sessionId: out.sessionId, meta: { otpAction: out.otpAction, actionId } });
      return { ok: true };
    }
    case "missing": throw new DeskError("otp_required", "Confirm this action with the customer's OTP first");
    case "foreign": throw new DeskError("permission_denied", "This code was issued to another agent");
    case "used": throw new DeskError("otp_required", "This code was already used. Request a new one.");
    case "session": throw new DeskError("session_invalid", "The session has ended. Start a new session.");
    case "expired": throw new DeskError("otp_invalid", "This code has expired. Request a new one.");
    case "locked": throw new DeskError("otp_invalid", "Too many wrong codes. Request a new confirmation code.");
    case "wrong": throw new DeskError("otp_invalid", wrongCodeMessage(out, "confirmation code"));
  }
  throw new DeskError("internal", "Unexpected verification state");
}
