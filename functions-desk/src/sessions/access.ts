import {
  DESK_TOP_CODE, type EndSessionOut, type EntityKey, type RequestAccessOut, type VerifyAccessOut,
} from "../contract.js";
import { FieldValue } from "firebase-admin/firestore";
import { col, db } from "../db.js";
import { DeskError } from "../errors.js";
import { audit } from "../kernel/audit.js";
import { requireActiveAgent } from "../kernel/agents.js";
import { maskPhone } from "../paystack/phone.js";
import type { AgentDoc, CustomerDoc, SessionDoc } from "../types.js";
import type { Deps } from "../connectors/deps.js";
import { writeDeskOwner } from "../connectors/deskOwner.js";
import {
  adminPhoneE164, assertEntityKey, customerDocId, isSameNumber, lookupEntity, NOT_AUTHORISED_MESSAGE,
} from "../connectors/entities.js";
import { record } from "../connectors/input.js";
import {
  accessHourRule, entityDailyRule, evaluateOtpAttempt, hashOtp, isOtpShape, OTP_TTL_MS, SESSION_TTL_MS, takeRates, wrongCodeMessage,
} from "../otp/core.js";
import { accessSmsText } from "../otp/messages.js";
import { isTopDeskAgent, topSessionDoc, validateScopes } from "./pure.js";

export async function requestAccess(deps: Deps, uid: string, raw: unknown): Promise<RequestAccessOut> {
  const d = record(raw);
  const agent = await requireActiveAgent(uid);
  const entity = assertEntityKey(typeof d.entityKey === "string" ? d.entityKey : "");
  const scopes = validateScopes(d.scopes);

  const cfg = await deps.getConfig();
  const lookup = await lookupEntity(deps, cfg, agent, entity.product, entity.code);
  if (!lookup.authorised) throw new DeskError("permission_denied", NOT_AUTHORISED_MESSAGE);
  const adminPhone = adminPhoneE164(lookup.info);
  if (isSameNumber(agent.phone, adminPhone)) {
    throw new DeskError("permission_denied", "You cannot open a session on an account you administer yourself");
  }

  const top = isTopDeskAgent(agent);   // COG-0000 needs no customer code: no SMS is sent, so no rate allowance is used either
  const taken = top ? undefined : await takeRates([accessHourRule(uid, entity.entityKey), entityDailyRule(entity.entityKey)], deps.now());

  // Older unverified codes for this desk and customer stop being usable.
  const stale = await col("sessions").where("agentId", "==", uid).where("entityKey", "==", entity.entityKey).where("status", "==", "pending").get();
  if (!stale.empty) {
    const batch = db().batch();
    for (const s of stale.docs) batch.update(s.ref, { status: "ended" });
    await batch.commit();
  }

  if (top) {
    const tref = col("sessions").doc();
    const tdoc = topSessionDoc({ sessionId: tref.id, agentId: uid, entityKey: entity.entityKey, scopes, now: deps.now() });
    await tref.create(tdoc);
    await audit({ action: "access_requested", agentId: uid, entityKey: entity.entityKey, sessionId: tref.id, meta: { scopes, topNoOtp: true } });
    await audit({ action: "access_verified", agentId: uid, entityKey: entity.entityKey, sessionId: tref.id, meta: { claimed: false, topNoOtp: true } });
    return { sessionId: tref.id, otpSentTo: "", verified: true, expiresAt: tdoc.expiresAt };
  }
  const ref = col("sessions").doc();
  const otp = deps.randomOtp();
  const now = deps.now();
  const doc: SessionDoc = {
    sessionId: ref.id, agentId: uid, entityKey: entity.entityKey, scopes, status: "pending",
    otpHash: hashOtp(otp, ref.id), otpAttempts: 0, otpExpiresAt: now + OTP_TTL_MS, expiresAt: now + OTP_TTL_MS, createdAt: now,
  };
  await ref.create(doc);
  try {
    await deps.sendSms(adminPhone, accessSmsText(agent.name, agent.agentCode, lookup.info.displayName, otp));
  } catch {
    await ref.delete().catch(() => undefined);
    await taken?.release();
    throw new DeskError("internal", "We could not send the access code to the customer. Please try again.");
  }
  await audit({ action: "access_requested", agentId: uid, entityKey: entity.entityKey, sessionId: ref.id, meta: { scopes } });
  return { sessionId: ref.id, otpSentTo: maskPhone(adminPhone) };
}

type VerifyOutcome =
  | { kind: "ok"; expiresAt: number; claimed: boolean; already: boolean; entityKey: EntityKey }
  | { kind: "missing" } | { kind: "foreign" } | { kind: "agent" } | { kind: "inactive" }
  | { kind: "expired" } | { kind: "locked" } | { kind: "wrong"; attempts: number; locked: boolean };

export async function verifyAccess(deps: Deps, uid: string, raw: unknown): Promise<VerifyAccessOut> {
  const d = record(raw);
  const sessionId = typeof d.sessionId === "string" ? d.sessionId : "";
  if (!sessionId) throw new DeskError("invalid_argument", "Session is required");
  if (!isOtpShape(d.otp)) throw new DeskError("invalid_argument", "Enter the 6-digit code");
  const otp = (d.otp as string).trim();
  const now = deps.now();
  const sRef = col("sessions").doc(sessionId);

  const out = await db().runTransaction(async (tx): Promise<VerifyOutcome> => {
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists) return { kind: "missing" };
    const s = sSnap.data() as SessionDoc;
    if (s.agentId !== uid) return { kind: "foreign" };
    const aSnap = await tx.get(col("agents").doc(uid));
    const agent = aSnap.exists ? (aSnap.data() as AgentDoc) : undefined;
    if (!agent || agent.status !== "active") return { kind: "agent" };
    const cRef = col("customers").doc(customerDocId(s.entityKey));
    const cSnap = await tx.get(cRef); // every read happens before the first write
    if (s.status === "active" && s.otpVerifiedAt && s.expiresAt > now) {
      return { kind: "ok", expiresAt: s.expiresAt, claimed: false, already: true, entityKey: s.entityKey };
    }
    if (s.status !== "pending") return { kind: "inactive" };

    const r = evaluateOtpAttempt({ hash: s.otpHash, attempts: s.otpAttempts, expiresAt: s.otpExpiresAt }, otp, sessionId, now);
    if (r.kind === "locked") { tx.update(sRef, { status: "ended" }); return { kind: "locked" }; }
    if (r.kind === "expired") { tx.update(sRef, { status: "expired" }); return { kind: "expired" }; }
    if (r.kind === "wrong") {
      tx.update(sRef, r.locked ? { otpAttempts: r.attempts, status: "ended" } : { otpAttempts: r.attempts });
      return r;
    }

    const expiresAt = now + SESSION_TTL_MS;
    tx.update(sRef, { status: "active", otpVerifiedAt: now, expiresAt, otpAttempts: r.attempts, otpHash: FieldValue.delete() });

    // Ownership claim, same transaction: first verified desk wins, an existing owner is never replaced, COG-0000 never claims.
    let claimed = false;
    if (!cSnap.exists && agent.agentCode !== DESK_TOP_CODE) {
      const customer: CustomerDoc = {
        entityKey: s.entityKey, product: assertEntityKey(s.entityKey).product, ownerAgentId: uid, attributedAt: now,
        selfOwned: false, firstPurchaseUsed: false, paidPeriods: [],
      };
      tx.create(cRef, customer);
      claimed = true;
    }
    return { kind: "ok", expiresAt, claimed, already: false, entityKey: s.entityKey };
  });

  switch (out.kind) {
    case "ok": break;
    case "missing": throw new DeskError("session_invalid", "Session not found");
    case "foreign": throw new DeskError("permission_denied", "This session belongs to another agent");
    case "agent": throw new DeskError("permission_denied", "Your desk account is not active");
    case "inactive": throw new DeskError("session_invalid", "This session is no longer waiting for a code. Request access again.");
    case "expired": throw new DeskError("otp_invalid", "This code has expired. Request access again.");
    case "locked": throw new DeskError("otp_invalid", "Too many wrong codes. Request access again.");
    case "wrong": throw new DeskError("otp_invalid", wrongCodeMessage(out, "access code"));
  }

  if (!out.already) {
    await audit({ action: "access_verified", agentId: uid, entityKey: out.entityKey, sessionId, meta: { claimed: out.claimed } });
    if (out.claimed) {
      await audit({ action: "ownership_claimed", agentId: uid, entityKey: out.entityKey, sessionId });
      const { product, code } = assertEntityKey(out.entityKey);
      if (product === "chama") await pushDeskOwner(deps, uid, code, sessionId, out.entityKey);
    }
  }
  return { expiresAt: out.expiresAt };
}

/** Ownership is already committed; a failed write must not fail the verification. desk_syncPayoutAccounts retries it. */
async function pushDeskOwner(deps: Deps, uid: string, chamaCode: string, sessionId: string, entityKey: EntityKey): Promise<void> {
  let reason: string | undefined;
  try {
    const agent = (await col("agents").doc(uid).get()).data() as AgentDoc;
    const r = await writeDeskOwner(deps, await deps.getConfig(), agent, chamaCode);
    if (!r.written) reason = r.reason;
  } catch (err) {
    reason = err instanceof DeskError ? err.message : "The MyChama update failed";
  }
  if (reason) await audit({ action: "desk_owner_pending", agentId: uid, entityKey, sessionId, meta: { reason } });
}

export async function endSession(deps: Deps, uid: string, raw: unknown): Promise<EndSessionOut> {
  const d = record(raw);
  const sessionId = typeof d.sessionId === "string" ? d.sessionId : "";
  if (!sessionId) throw new DeskError("invalid_argument", "Session is required");
  const ref = col("sessions").doc(sessionId);
  const out = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "missing" as const };
    const s = snap.data() as SessionDoc;
    if (s.agentId !== uid) return { kind: "foreign" as const };
    if (s.status === "pending" || s.status === "active") { tx.update(ref, { status: "ended", endedAt: deps.now() }); return { kind: "ended" as const, entityKey: s.entityKey }; }
    return { kind: "already" as const };
  });
  if (out.kind === "missing") throw new DeskError("session_invalid", "Session not found");
  if (out.kind === "foreign") throw new DeskError("permission_denied", "This session belongs to another agent");
  if (out.kind === "ended") await audit({ action: "session_ended", agentId: uid, entityKey: out.entityKey, sessionId });
  return { ok: true };
}
