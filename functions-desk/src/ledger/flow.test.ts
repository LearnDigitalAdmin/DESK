/**
 * End-to-end scenarios for the money backend: every callable, trigger and schedule against Firestore with Paystack behind the
 * injectable port. Backend: the real Firestore emulator when FIRESTORE_EMULATOR_HOST is set (npm run desk:test:emu), otherwise
 * the in-memory double in fakefs.test.ts. The Paystack port, the product (deskdelegate) and the clock are doubles, test-only.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearConfigCache } from "../config.js";
import { db } from "../db.js";
import { DeskError } from "../errors.js";
import { clearFirestore, emulatorEnabled } from "../testing/emulator.js";
import type { MpesaChargeInput, MpesaChargeResult, VerifiedTransaction } from "../paystack/client.js";
import type { PaystackPort, DeskDeps } from "../charge/port.js";
import { chargeTicket } from "../charge/chargeTicket.js";
import { quoteService } from "../tickets/quoteService.js";
import { saveDraft } from "../tickets/saveDraft.js";
import { joinDraft } from "../tickets/draft.js";
import { handleCyberTransactionChange } from "./trigger.js";
import { reconcileTickets } from "./reconcile.js";
import { getEarnings } from "./earnings.js";
import { handleDeskEvent } from "../commissions/onDeskEvent.js";
import { evaluateMilestones } from "../bonus/evaluate.js";
import { FakeFirestore, installFakeFirestore } from "./fakefs.test.js";

const fake = new FakeFirestore();
if (!emulatorEnabled) installFakeFirestore(fake);
else process.env.GCLOUD_PROJECT ??= "demo-desk";

const clock = { t: Date.now() };
const MIN = 60_000;

interface PortKit { port: PaystackPort; charges: MpesaChargeInput[]; verifies: string[]; splits: unknown[]; verify: Map<string, VerifiedTransaction | Error>; opts: { chargeError?: Error; chargeStatus: string } }
function makePort(): PortKit {
  const kit: PortKit = { charges: [], verifies: [], splits: [], verify: new Map(), opts: { chargeStatus: "pay_offline" }, port: undefined as never };
  kit.port = {
    async chargeMpesa(i: MpesaChargeInput): Promise<MpesaChargeResult> {
      kit.charges.push(i);
      if (kit.opts.chargeError) throw kit.opts.chargeError;
      return { reference: i.reference, status: kit.opts.chargeStatus, displayText: "Check your phone" };
    },
    async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
      kit.verifies.push(reference);
      const v = kit.verify.get(reference);
      if (v instanceof Error) throw v;
      return v ?? { status: "pending", amountMinor: 0, feesMinor: 0, reference, raw: {} };
    },
    async getOrCreateSplitCode(subs) { kit.splits.push(subs); return "SPL_test"; },
  };
  return kit;
}
const success = (reference: string, amountMinor: number, feesMinor: number): VerifiedTransaction =>
  ({ status: "success", amountMinor, feesMinor, reference, raw: { currency: "KES" } });
const notFound = () => new DeskError("payment_failed", "Transaction reference not found.");

interface ProductKit { calls: { action: string; payload: Record<string, unknown> }[]; recipients: number; credits: number; balance: number; authorised: boolean }
function makeProduct(): { kit: ProductKit; delegate: NonNullable<DeskDeps["delegate"]> } {
  const kit: ProductKit = { calls: [], recipients: 12, credits: 12, balance: 50, authorised: true };
  const delegate = {
    getIdToken: async () => "token",
    fetchImpl: (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { action: string; payload: Record<string, unknown> };
      kit.calls.push({ action: body.action, payload: body.payload });
      const result = body.action === "send_sms_now"
        ? { queued: kit.recipients, creditsUsed: kit.credits, creditsRemaining: kit.balance }
        : { displayName: "Test Chama", adminName: "A", adminPhone: "+254700000000", agentAuthorised: kit.authorised, plan: "x", creditsBalance: kit.balance, audiences: [], reportTypes: [], exportKinds: [] };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }) as unknown as typeof fetch,
  };
  return { kit, delegate };
}

async function put(path: string, data: Record<string, unknown>): Promise<void> { await db().doc(path).set(data); }
const get = async (path: string) => (await db().doc(path).get()).data() as Record<string, any> | undefined;
const all = async (col: string): Promise<Record<string, any>[]> => (await db().collection(col).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));
const auditActions = async () => (await all("desk_audit")).map((a) => a.action as string);

async function setup(opts: { scopes?: string[] } = {}) {
  clearConfigCache();
  const p = makePort(); const prod = makeProduct();
  clock.t = Date.now();
  await put("desk_config/global", { delegate: { chama: "https://deskdelegate-x.a.run.app/", school: "", pms: "" } });
  await put("desk_agents/u1", { agentId: "u1", agentCode: "COG-0001", name: "Amina", status: "active", rank: "clerk", createdAt: 1 });
  await put("agents/u1", { email: "amina@example.com", pId: "P-1", id: "AG-1", paymentInfo: { accountId: "ACCT_main" } });
  await put("desk_sessions/s1", {
    sessionId: "s1", agentId: "u1", entityKey: "chama:SMC-0001", scopes: opts.scopes ?? ["import", "manual_entry", "schedule"], status: "active",
    otpAttempts: 0, otpExpiresAt: Date.now() + 600_000, otpVerifiedAt: Date.now(), expiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
  const deps: DeskDeps = { port: p.port, delegate: prod.delegate, now: () => clock.t };
  return { p, prod, deps };
}
const quoteImport = (deps: DeskDeps, rowCount = 50) =>
  quoteService("u1", { sessionId: "s1", serviceType: "import_excel", params: { rowCount } }, deps);
const charge = (deps: DeskDeps, ticketId: string, uid = "u1") => chargeTicket(uid, { ticketId, phone: "0712345678" }, deps);
const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => { assert.match(e.message, re); return true; });

beforeEach(async () => { if (emulatorEnabled) await clearFirestore(); else fake.clear(); clearConfigCache(); });

test(`[${emulatorEnabled ? "emulator" : "in-memory double"}] backend in use`, () => { assert.ok(true); });

test("ACCEPTANCE: quote → chunked draft → STK → success → paid + exactly one ledger row; replay changes nothing", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps, 50_000);
  assert.equal(q.amountMinor, 20000);
  assert.equal((await get(`desk_tickets/${q.ticketId}`))!.status, "draft");

  const rows = Array.from({ length: 40_000 }, (_, i) => ({ name: `Member ${i}`, phone: `0712${String(i).padStart(6, "0")}`, note: "x".repeat(20) }));
  await saveDraft("u1", { ticketId: q.ticketId, payload: { rows, source: "excel" } }, deps);
  let chunks = (await db().collection(`desk_tickets/${q.ticketId}/draft`).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  assert.ok(chunks.length > 1 && chunks.length <= 20);
  assert.deepEqual(chunks.map((c) => c.id), chunks.map((_, i) => String(i).padStart(4, "0")));
  assert.deepEqual((joinDraft(chunks) as any).rows.length, 40_000);
  await saveDraft("u1", { ticketId: q.ticketId, payload: { rows: [{ a: 1 }], source: "excel" } }, deps); // replaces atomically
  chunks = (await db().collection(`desk_tickets/${q.ticketId}/draft`).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  assert.equal(chunks.length, 1);

  const c = await charge(deps, q.ticketId);
  const ref = `CYBER_DSK_${q.ticketId}_1`;
  assert.deepEqual(c, { reference: ref, status: "awaiting_payment" });
  assert.deepEqual(p.splits[0], [{ subaccount: "ACCT_main", sharePct: 97.5 }]);
  assert.equal(p.charges.length, 1);
  assert.equal(p.charges[0].amountMinor, 20000);
  assert.equal(p.charges[0].phoneE164, "+254712345678");
  assert.equal(p.charges[0].splitCode, "SPL_test");
  assert.equal((p.charges[0].metadata as any).chargeType, "cyber_service");
  const tx = (await get(`cyber-transactions/${ref}`))!;
  assert.equal(tx.amount, 200); assert.equal(tx.currency, "KES"); assert.equal(tx.deskTicketId, q.ticketId); assert.equal(tx.uid, "u1");
  assert.equal(tx.status, "pay_offline");
  const t1 = (await get(`desk_tickets/${q.ticketId}`))!;
  assert.equal(t1.status, "awaiting_payment"); assert.equal(t1.paystackRef, ref); assert.equal(t1.attempts, 1);

  // PAY's webhook marks the document success; Paystack confirms with real figures
  p.verify.set(ref, success(ref, 20000, 300));
  await db().doc(`cyber-transactions/${ref}`).update({ status: "success" });
  const change = [ref, { status: "pay_offline", deskTicketId: q.ticketId }, { status: "success", deskTicketId: q.ticketId }] as const;
  assert.equal(await handleCyberTransactionChange(...change, deps), "paid");
  const t2 = (await get(`desk_tickets/${q.ticketId}`))!;
  assert.equal(t2.status, "paid");
  assert.deepEqual([t2.grossMinor, t2.feeMinor, t2.agentMinor, t2.platformMinor], [20000, 300, 19207, 493]);
  const ledger = await all("desk_ledger");
  assert.equal(ledger.length, 1);
  assert.deepEqual(
    { kind: ledger[0].kind, status: ledger[0].status, amountMinor: ledger[0].amountMinor, sharePct: ledger[0].sharePct, rule: ledger[0].rule, paystackRef: ledger[0].paystackRef, agentId: ledger[0].agentId, sourceId: ledger[0].sourceId },
    { kind: "service", status: "settled", amountMinor: 19207, sharePct: 97.5, rule: "service", paystackRef: ref, agentId: "u1", sourceId: q.ticketId });

  assert.equal(await handleCyberTransactionChange(...change, deps), "paid"); // replay
  assert.equal(await handleCyberTransactionChange(...change, deps), "paid");
  assert.equal((await all("desk_ledger")).length, 1);
  assert.deepEqual(await get(`desk_tickets/${q.ticketId}`), t2);
  assert.equal((await auditActions()).filter((a) => a === "ticket_paid").length, 1);
});

test("the reconciler recovers a missed webhook, once", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps);
  await charge(deps, q.ticketId);
  const ref = `CYBER_DSK_${q.ticketId}_1`;
  p.verify.set(ref, success(ref, 20000, 300));
  clock.t += 2 * MIN;
  assert.equal((await reconcileTickets(deps)).checked, 0); // younger than 3 minutes
  clock.t += 2 * MIN;
  const s = await reconcileTickets(deps);
  assert.equal(s.paid, 1);
  assert.equal((await get(`desk_tickets/${q.ticketId}`))!.status, "paid");
  assert.equal((await all("desk_ledger")).length, 1);
  assert.equal((await reconcileTickets(deps)).checked, 0);
  assert.equal((await all("desk_ledger")).length, 1);
});

test("amount mismatch fails the ticket, audits it and writes no ledger row", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps); await charge(deps, q.ticketId);
  const ref = `CYBER_DSK_${q.ticketId}_1`;
  p.verify.set(ref, success(ref, 19000, 200));
  assert.equal(await handleCyberTransactionChange(ref, { status: "pending", deskTicketId: q.ticketId }, { status: "success", deskTicketId: q.ticketId }, deps), "mismatch");
  const t = (await get(`desk_tickets/${q.ticketId}`))!;
  assert.equal(t.status, "failed"); assert.equal(t.failureReason, "amount mismatch");
  assert.equal((await all("desk_ledger")).length, 0);
  assert.ok((await auditActions()).includes("ticket_amount_mismatch"));
});

test("a doc that says success but Paystack says otherwise is never trusted; a failed attempt fails the live ticket only", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps); await charge(deps, q.ticketId);
  const ref = `CYBER_DSK_${q.ticketId}_1`;
  assert.equal(await handleCyberTransactionChange(ref, undefined, { status: "success", deskTicketId: q.ticketId }, deps), "pending");
  assert.equal((await get(`desk_tickets/${q.ticketId}`))!.status, "awaiting_payment");
  assert.equal((await all("desk_ledger")).length, 0);
  p.verify.set(ref, { status: "failed", amountMinor: 20000, feesMinor: 0, reference: ref, raw: { gateway_response: "Request cancelled by user" } });
  assert.equal(await handleCyberTransactionChange(ref, { status: "pending", deskTicketId: q.ticketId }, { status: "failed", deskTicketId: q.ticketId }, deps), "failed");
  const t = (await get(`desk_tickets/${q.ticketId}`))!;
  assert.equal(t.status, "failed"); assert.equal(t.failureReason, "Request cancelled by user");
  assert.equal(await handleCyberTransactionChange("CYBER_DSK_" + q.ticketId + "_9", undefined, { status: "success", deskTicketId: q.ticketId }, deps), "pending");
});

test("never two live STKs: concurrent charges send one; re-prompt only after 120 s and only if no attempt succeeded", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps);
  const results = await Promise.allSettled([charge(deps, q.ticketId), charge(deps, q.ticketId)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(p.charges.length, 1);
  const ref1 = `CYBER_DSK_${q.ticketId}_1`;

  clock.t += 60_000;
  await rejects(charge(deps, q.ticketId), /Wait \d+ more seconds/);
  assert.equal(p.charges.length, 1);

  clock.t += 61_000; // 121 s, previous attempt still pending
  p.verify.set(ref1, { status: "pending", amountMinor: 20000, feesMinor: 0, reference: ref1, raw: {} });
  const again = await charge(deps, q.ticketId);
  assert.equal(again.reference, `CYBER_DSK_${q.ticketId}_2`);
  assert.equal(p.charges.length, 2);
  assert.equal((await get(`cyber-transactions/${ref1}`))!.supersededBy, again.reference);
  assert.equal((await get(`cyber-transactions/${ref1}`))!.status, "pay_offline");

  // the FIRST attempt succeeds late: a third request is refused and the ticket is settled instead
  clock.t += 121_000;
  p.verify.set(ref1, success(ref1, 20000, 300));
  await rejects(charge(deps, q.ticketId), /already received/);
  assert.equal(p.charges.length, 2);
  const t = (await get(`desk_tickets/${q.ticketId}`))!;
  assert.equal(t.status, "paid"); assert.equal(t.paystackRef, ref1);
  assert.equal((await all("desk_ledger")).length, 1);
});

test("a second payment on an already paid ticket is flagged for refund and never double counted", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps); await charge(deps, q.ticketId);
  const ref1 = `CYBER_DSK_${q.ticketId}_1`, ref2 = `CYBER_DSK_${q.ticketId}_2`;
  p.verify.set(ref1, success(ref1, 20000, 300));
  await handleCyberTransactionChange(ref1, undefined, { status: "success", deskTicketId: q.ticketId }, deps);
  p.verify.set(ref2, success(ref2, 20000, 300));
  assert.equal(await handleCyberTransactionChange(ref2, undefined, { status: "success", deskTicketId: q.ticketId }, deps), "duplicate");
  assert.equal(await handleCyberTransactionChange(ref2, undefined, { status: "success", deskTicketId: q.ticketId }, deps), "duplicate");
  assert.equal((await all("desk_ledger")).length, 1);
  assert.deepEqual((await get(`desk_tickets/${q.ticketId}`))!.duplicateRefs, [ref2]);
  assert.equal((await auditActions()).filter((a) => a === "ticket_duplicate_payment").length, 1);
});

test("Paystack refusal returns the ticket to draft with the reason; an unconfirmed outcome keeps it awaiting", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps);
  p.opts.chargeError = new DeskError("payment_failed", "Invalid phone number");
  p.verify.set(`CYBER_DSK_${q.ticketId}_1`, notFound());
  await rejects(charge(deps, q.ticketId), /Invalid phone number/);
  let t = (await get(`desk_tickets/${q.ticketId}`))!;
  assert.equal(t.status, "draft"); assert.equal(t.failureReason, "Invalid phone number"); assert.equal(t.paystackRef, undefined);
  assert.equal((await get(`cyber-transactions/CYBER_DSK_${q.ticketId}_1`))!.status, "failed");

  p.opts.chargeError = new DeskError("payment_failed", "socket hang up");
  p.verify.set(`CYBER_DSK_${q.ticketId}_2`, new DeskError("payment_failed", "Paystack request failed"));
  await rejects(charge(deps, q.ticketId), /could not confirm whether/);
  t = (await get(`desk_tickets/${q.ticketId}`))!;
  assert.equal(t.status, "awaiting_payment"); assert.equal(t.attempts, 2);

  const q2 = await quoteImport(deps);
  p.opts.chargeError = undefined; p.opts.chargeStatus = "failed";
  await rejects(charge(deps, q2.ticketId), /M-Pesa request failed|Check your phone/);
  assert.equal((await get(`desk_tickets/${q2.ticketId}`))!.status, "draft");
});

test("authorisation: other agent's ticket, expired session, inactive agent, bad input, edits after charging", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps);
  await put("desk_agents/u2", { agentId: "u2", agentCode: "COG-0002", status: "active", rank: "clerk", createdAt: 1 });
  await rejects(charge(deps, q.ticketId, "u2"), /another agent/);
  await rejects(saveDraft("u2", { ticketId: q.ticketId, payload: {} }, deps), /another agent/);
  await rejects(charge(deps, "nope"), /Ticket not found/);
  await rejects(chargeTicket("u1", { ticketId: q.ticketId, phone: "123" }, deps), /Kenyan phone/);
  await rejects(quoteService("u1", { sessionId: "s1", serviceType: "import_excel", params: { rowCount: 0 } }, deps), /Row count/);
  await rejects(quoteService("u1", { sessionId: "nope", serviceType: "import_excel", params: { rowCount: 1 } }, deps), /Session not found/);
  await charge(deps, q.ticketId);
  await rejects(saveDraft("u1", { ticketId: q.ticketId, payload: { a: 1 } }, deps), /can no longer be edited/);
  await db().doc("desk_sessions/s1").update({ expiresAt: Date.now() - 1 });
  await rejects(saveDraft("u1", { ticketId: q.ticketId, payload: { a: 1 } }, deps), /expired/);
  await db().doc("desk_agents/u1").update({ status: "suspended" });
  await rejects(quoteImport(deps), /suspended/);
  assert.equal(p.charges.length, 1);
});

test("a draft with more rows than the quote covers is refused", async () => {
  const { deps } = await setup();
  const q = await quoteImport(deps, 1);
  await rejects(saveDraft("u1", { ticketId: q.ticketId, payload: { rows: [{ a: 1 }, { a: 2 }] } }, deps), /quote covers 1/);
});

test("bulk reminder: real recipient count and credits, insufficient credits refused, one-time OTP whose summary matches", async () => {
  const { p, prod, deps } = await setup();
  const params = { audience: "all", message: "Meeting on Saturday" };
  prod.kit.credits = 80;
  await rejects(quoteService("u1", { sessionId: "s1", serviceType: "bulk_reminder", params }, deps), /Not enough SMS credits/);
  prod.kit.credits = 12;
  const q = await quoteService("u1", { sessionId: "s1", serviceType: "bulk_reminder", params }, deps);
  assert.equal(q.amountMinor, 10000);
  assert.match(q.breakdown[0].label, /12 recipients/);
  const dry = prod.kit.calls.find((c) => c.action === "send_sms_now")!;
  assert.equal(dry.payload.dryRun, true);
  const t0 = (await get(`desk_tickets/${q.ticketId}`))!;
  assert.equal(t0.recipients, 12); assert.equal(t0.credits, 12);

  await rejects(charge(deps, q.ticketId), /OTP first/);
  const otp = (id: string, summary: string, extra: Record<string, unknown> = {}) => put(`desk_actionOtps/${id}`, {
    actionId: id, sessionId: "s1", agentId: "u1", action: "bulk_sms", summary, otpHash: "h", otpAttempts: 0,
    otpExpiresAt: clock.t + 600_000, verifiedAt: clock.t, createdAt: clock.t, ...extra });
  await otp("a1", "SMS to 99 recipients");
  await rejects(charge(deps, q.ticketId), /different number of people/);
  assert.equal(p.charges.length, 0);
  assert.equal((await get(`desk_tickets/${q.ticketId}`))!.status, "draft");
  await otp("a2", "SMS to 12 recipients", { consumedAt: clock.t });
  await rejects(charge(deps, q.ticketId), /different number of people|OTP/);
  await otp("a3", "SMS to 12 recipients");
  const c = await charge(deps, q.ticketId);
  assert.equal(c.status, "awaiting_payment");
  assert.ok((await get("desk_actionOtps/a3"))!.consumedAt);
  assert.ok((await auditActions()).includes("ticket_charge_started"));

  // the used OTP cannot authorise a second reminder
  const q2 = await quoteService("u1", { sessionId: "s1", serviceType: "bulk_reminder", params }, deps);
  await rejects(charge(deps, q2.ticketId), /different number of people|OTP/);
  // recipients changed since the OTP: the recomputed summary no longer matches
  await otp("a4", "SMS to 12 recipients"); prod.kit.recipients = 13;
  await rejects(charge(deps, q2.ticketId), /different number of people/);
  assert.equal(p.charges.length, 1);
});

test("the reconciler expires pending tickets after 15 min and drafts after 24 h (deleting their chunks)", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps); await charge(deps, q.ticketId);
  const d = await quoteImport(deps);
  await saveDraft("u1", { ticketId: d.ticketId, payload: { rows: [{ a: 1 }] } }, deps);
  const fresh = await quoteImport(deps);
  clock.t += 10 * MIN;
  let s = await reconcileTickets(deps);
  assert.equal(s.waiting, 1); assert.equal(s.expired, 0);
  clock.t += 6 * MIN;
  s = await reconcileTickets(deps);
  assert.equal(s.expired, 1);
  assert.equal((await get(`desk_tickets/${q.ticketId}`))!.status, "expired");
  clock.t += 24 * 60 * MIN;
  await db().doc(`desk_tickets/${fresh.ticketId}`).update({ updatedAt: clock.t }); // active draft survives
  s = await reconcileTickets(deps);
  assert.equal(s.draftsExpired, 1);
  assert.equal((await get(`desk_tickets/${d.ticketId}`))!.status, "expired");
  assert.equal((await db().collection(`desk_tickets/${d.ticketId}/draft`).get()).size, 0);
  assert.equal((await get(`desk_tickets/${fresh.ticketId}`))!.status, "draft");
  void p;
});

test("the reconciler fails dead attempts and never expires on a transient Paystack error", async () => {
  const { p, deps } = await setup();
  const a = await quoteImport(deps); await charge(deps, a.ticketId);
  const b = await quoteImport(deps); await charge(deps, b.ticketId);
  const refA = `CYBER_DSK_${a.ticketId}_1`, refB = `CYBER_DSK_${b.ticketId}_1`;
  p.verify.set(refA, { status: "abandoned", amountMinor: 20000, feesMinor: 0, reference: refA, raw: {} });
  p.verify.set(refB, new DeskError("payment_failed", "Paystack request failed"));
  clock.t += 30 * MIN;
  const s = await reconcileTickets(deps);
  assert.equal(s.failed, 1); assert.equal(s.errors, 1);
  assert.equal((await get(`desk_tickets/${a.ticketId}`))!.status, "failed");
  assert.equal((await get(`desk_tickets/${b.ticketId}`))!.status, "awaiting_payment");
});

const event = (o: Record<string, unknown> = {}) => ({
  eventId: "x", type: "subscription_payment", product: "chama", entityKey: "chama:SMC-0001", agentId: "u1", paystackRef: "MC_1",
  grossMinor: 100000, feeMinor: 1500, agentSharePct: 25, paidAt: Date.UTC(2026, 8, 15), periodMonth: "2026-09", ...o });
const customer = (o: Record<string, unknown> = {}) => ({ entityKey: "chama:SMC-0001", product: "chama", ownerAgentId: "u1", attributedAt: 1, firstPurchaseUsed: false, paidPeriods: [], ...o });

test("desk events become commission rows exactly once; customers are updated; ownership untouched", async () => {
  await setup();
  await put("desk_customers/chama:SMC-0001", customer());
  assert.equal(await handleDeskEvent("subscription_payment:MC_1", event()), "recorded");
  assert.equal(await handleDeskEvent("subscription_payment:MC_1", event()), "replay");
  const rows = await all("desk_ledger");
  assert.equal(rows.length, 1);
  assert.deepEqual({ kind: rows[0].kind, status: rows[0].status, amountMinor: rows[0].amountMinor, rule: rows[0].rule, product: rows[0].product, sharePct: rows[0].sharePct },
    { kind: "commission", status: "settled", amountMinor: Math.floor(98500 * 2500 / 10000), rule: "subscription", product: "chama", sharePct: 25 });
  const c = (await get("desk_customers/chama:SMC-0001"))!;
  assert.deepEqual(c.paidPeriods, ["2026-09"]);
  assert.equal(c.ownerAgentId, "u1"); assert.equal(c.attributedAt, 1);
  await handleDeskEvent("subscription_payment:MC_0", event({ paystackRef: "MC_0", periodMonth: "2026-08" }));
  assert.deepEqual((await get("desk_customers/chama:SMC-0001"))!.paidPeriods, ["2026-08", "2026-09"]);
  assert.equal(await handleDeskEvent("bad", { type: "nope" }), "rejected");
});

test("SMS purchase: first-purchase rule recorded, firstPurchaseUsed/lastPaidAt set, reservation cleared", async () => {
  await setup();
  await put("desk_customers/school:K1", customer({ entityKey: "school:K1", product: "school", firstPurchaseReservedRef: "SMS_1", firstPurchaseReservedAt: 5 }));
  await handleDeskEvent("sms_purchase:SMS_1", event({ type: "sms_purchase", product: "school", entityKey: "school:K1", paystackRef: "SMS_1", agentSharePct: 40, periodMonth: undefined }));
  const c = (await get("desk_customers/school:K1"))!;
  assert.equal(c.firstPurchaseUsed, true); assert.equal(c.lastPaidAt, Date.UTC(2026, 8, 15));
  assert.equal("firstPurchaseReservedRef" in c, false); assert.equal("firstPurchaseReservedAt" in c, false);
  assert.equal((await all("desk_ledger"))[0].rule, "sms_first_purchase");
});

test("refund appends one negative reversal per ledger row, marks the customer, and works in either event order", async () => {
  await setup();
  await put("desk_customers/chama:SMC-0001", customer());
  await handleDeskEvent("subscription_payment:MC_1", event());
  const refund = event({ type: "refund", paystackRef: "RF_1", originalRef: "MC_1" });
  assert.equal(await handleDeskEvent("refund:RF_1", refund), "refund");
  assert.equal(await handleDeskEvent("refund:RF_1", refund), "refund");
  await handleDeskEvent("refund:RF_2", { ...refund, paystackRef: "RF_2" }); // a second refund event cannot reverse twice
  const rows = await all("desk_ledger");
  assert.equal(rows.length, 2);
  const rev = rows.find((r) => r.kind === "reversal")!;
  assert.equal(rev.amountMinor, -rows.find((r) => r.kind === "commission")!.amountMinor);
  assert.equal(rev.status, "settled");
  assert.equal((await get("desk_customers/chama:SMC-0001"))!.refunded, true);

  // refund processed BEFORE the payment's own event
  await put("desk_customers/chama:SMC-0002", customer({ entityKey: "chama:SMC-0002" }));
  await put("desk_events/refund:RF_9", event({ type: "refund", entityKey: "chama:SMC-0002", paystackRef: "RF_9", originalRef: "MC_9" }));
  await handleDeskEvent("refund:RF_9", event({ type: "refund", entityKey: "chama:SMC-0002", paystackRef: "RF_9", originalRef: "MC_9" }));
  await handleDeskEvent("subscription_payment:MC_9", event({ entityKey: "chama:SMC-0002", paystackRef: "MC_9" }));
  const late = (await all("desk_ledger")).filter((r) => r.entityKey === "chama:SMC-0002");
  assert.deepEqual(late.map((r) => r.kind).sort(), ["commission", "reversal"]);
  assert.equal(late.reduce((s, r) => s + r.amountMinor, 0), 0);
});

test("milestones: 10th retained account creates one payable KES 2,000 bonus; reruns add nothing; 6th block never appears", async () => {
  await setup();
  await put("desk_agents/u3", { agentId: "u3", agentCode: "COG-0003", status: "suspended", rank: "clerk", createdAt: 1 });
  const own = (id: string, o: Record<string, unknown> = {}) => put(`desk_customers/chama:SMC-${id}`, customer({ entityKey: `chama:SMC-${id}`, paidPeriods: ["2026-08", "2026-09"], ...o }));
  for (let i = 0; i < 10; i++) await own(`1${String(i).padStart(3, "0")}`);
  await own("2000", { selfOwned: true }); await own("2001", { refunded: true }); await own("2002", { paidPeriods: ["2026-09"] });
  await put("desk_customers/school:K9", customer({ entityKey: "school:K9", product: "school", paidPeriods: ["2026-08", "2026-09"] }));
  for (let i = 0; i < 10; i++) await put(`desk_customers/chama:SMC-3${i}`, customer({ entityKey: `chama:SMC-3${i}`, ownerAgentId: "u3", paidPeriods: ["2026-08", "2026-09"] }));
  let s = await evaluateMilestones();
  assert.equal(s.bonusesCreated, 1);
  let bonus = (await all("desk_ledger")).filter((r) => r.kind === "bonus");
  assert.equal(bonus.length, 1);
  assert.deepEqual({ agentId: bonus[0].agentId, status: bonus[0].status, amountMinor: bonus[0].amountMinor, note: bonus[0].note }, { agentId: "u1", status: "payable", amountMinor: 200000, note: "Milestone block 1" });
  assert.equal((await evaluateMilestones()).bonusesCreated, 0);
  for (let i = 0; i < 70; i++) await own(`4${String(i).padStart(3, "0")}`); // 80 qualifying -> 8 blocks, capped at 5
  s = await evaluateMilestones();
  bonus = (await all("desk_ledger")).filter((r) => r.kind === "bonus");
  assert.equal(bonus.length, 5);
  assert.deepEqual(bonus.map((b) => b.note).sort(), [1, 2, 3, 4, 5].map((n) => `Milestone block ${n}`));
  assert.equal((await evaluateMilestones()).bonusesCreated, 0);
  // a voided block frees a cap slot but never reuses its number
  const first = bonus.find((b) => b.note === "Milestone block 2")!;
  await db().doc(`desk_ledger/${first.id}`).update({ status: "void" });
  await evaluateMilestones();
  const after = (await all("desk_ledger")).filter((r) => r.kind === "bonus" && r.status !== "void");
  assert.deepEqual(after.map((b) => b.note).sort(), [1, 3, 4, 5, 6].map((n) => `Milestone block ${n}`));
});

test("earnings: sums by status and stream for the range, plus bonus progress; only the caller's rows", async () => {
  const { p, deps } = await setup();
  const q = await quoteImport(deps); await charge(deps, q.ticketId);
  const ref = `CYBER_DSK_${q.ticketId}_1`; p.verify.set(ref, success(ref, 20000, 300));
  await handleCyberTransactionChange(ref, undefined, { status: "success", deskTicketId: q.ticketId }, deps);
  await put("desk_customers/chama:SMC-0001", customer());
  await handleDeskEvent("subscription_payment:MC_1", event());
  await put("desk_ledger/other", { entryId: "other", agentId: "u2", kind: "commission", amountMinor: 999, status: "settled", createdAt: Date.now() });
  await put("desk_ledger/bonus1", { entryId: "bonus1", agentId: "u1", kind: "bonus", amountMinor: 200000, status: "payable", sourceId: "bonus-block-1", createdAt: Date.now() });
  const e = await getEarnings("u1", { from: Date.now() - 30 * 86_400_000, to: Date.now() + 1000 }, deps);
  assert.equal(e.settledMinor, 19207 + 24625);
  assert.equal(e.payableMinor, 200000); assert.equal(e.paidMinor, 0);
  assert.deepEqual(e.byProduct, [{ product: "service", amountMinor: 19207 }, { product: "chama", amountMinor: 24625 }, { product: "bonus", amountMinor: 200000 }]);
  assert.deepEqual(e.bonusProgress, { qualifyingAccounts: 0, blocksPaid: 1, bankedMinor: 200000, capMinor: 1_000_000 });
  assert.equal((await getEarnings("u1", { from: Date.now() + 10_000, to: Date.now() + 20_000 }, deps)).settledMinor, 0);
  await rejects(getEarnings("u1", { from: 5, to: 1 }, deps), /valid date range/);
  await rejects(getEarnings("u1", { from: 0, to: 500 * 86_400_000 }, deps), /13 months/);
});

test("compliance report: records that went stale after the quote are refused at the payment step; no M-Pesa prompt, ticket stays a draft", async () => {
  const { p, deps } = await setup();
  await put("desk_config/global", { delegate: { chama: "https://deskdelegate-x.a.run.app/", school: "", pms: "https://deskdelegate-pms.a.run.app/" } });
  clearConfigCache();
  await put("desk_sessions/s2", {
    sessionId: "s2", agentId: "u1", entityKey: "pms:PYL-0001", scopes: ["report"], status: "active",
    otpAttempts: 0, otpExpiresAt: Date.now() + 600_000, otpVerifiedAt: Date.now(), expiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
  let refuse = false;
  const calls: string[] = [];
  const delegate = {
    getIdToken: async () => "token",
    fetchImpl: (async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body).action);
      return new Response(JSON.stringify(refuse
        ? { ok: false, error: { code: "failed_precondition", message: "This landlord's records were last synced on 2026-11-05 (9 days ago), which is too old for a report. Open Plot Yangu online so it syncs, then try again." } }
        : { ok: true, result: { ready: true, property: "Sunrise", tenants: 12 } }), { status: 200 });
    }) as unknown as typeof fetch,
  };
  const cdeps: DeskDeps = { ...deps, delegate };

  const q = await quoteService("u1", { sessionId: "s2", serviceType: "compliance_report", params: { reportType: "mri_monthly", propertyId: "3", month: "2026-10" } }, cdeps);
  assert.equal(q.amountMinor, 20000);

  refuse = true;                                              // the landlord's records are now over 7 days old
  await rejects(charge(cdeps, q.ticketId), /too old for a report/);
  assert.equal(p.charges.length, 0);                          // nobody was asked to pay
  assert.equal((await get(`desk_tickets/${q.ticketId}`))!.status, "draft");

  refuse = false;                                             // the landlord syncs; the same ticket can now be paid for
  await charge(cdeps, q.ticketId);
  assert.equal(p.charges.length, 1);
  assert.ok(calls.length >= 3);                               // quote preview, refused charge, accepted charge
});
