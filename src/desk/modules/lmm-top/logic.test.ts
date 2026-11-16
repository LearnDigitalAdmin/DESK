/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { LmmxApiError } from "../../api/lmmxErrors.ts";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, LEAD_TABS, auditQuery, deskCodeProblem, emptyAuditFilters, followUpToMs, needsReauth, runWithReauth, validateTopReason, verifyMessage } from "./logic.ts";

const reauthErr = () => new LmmxApiError("functions/unauthenticated", "x", "LMMX_E_NEEDS_REAUTH");

test("top reason: at least 10 characters after cleaning", () => {
  assert.equal(validateTopReason("too short").ok, false);
  assert.equal(validateTopReason("          x         ").ok, false);
  assert.deepEqual(validateTopReason("  Landlord  asked by phone "), { ok: true, value: "Landlord asked by phone" });
  assert.equal(validateTopReason("x".repeat(501)).ok, false);
  assert.equal(validateTopReason("1234567890").ok, true);
});
test("re-auth: one retry after a successful sign-in", async () => {
  let calls = 0, asked = 0;
  const out = await runWithReauth(async () => { calls++; if (calls === 1) throw reauthErr(); return "done"; }, async () => { asked++; });
  assert.deepEqual([out, calls, asked], ["done", 2, 1]);
});
test("re-auth: cancelled sign-in throws the original error and never retries", async () => {
  let calls = 0;
  await assert.rejects(() => runWithReauth(async () => { calls++; throw reauthErr(); }, async () => { throw new Error("cancelled"); }), (e: unknown) => needsReauth(e));
  assert.equal(calls, 1);
});
test("re-auth: retries only ONCE, and other errors pass straight through", async () => {
  let calls = 0, asked = 0;
  await assert.rejects(() => runWithReauth(async () => { calls++; throw reauthErr(); }, async () => { asked++; }), (e: unknown) => needsReauth(e));
  assert.deepEqual([calls, asked], [2, 1]);
  calls = 0; asked = 0;
  await assert.rejects(() => runWithReauth(async () => { calls++; throw new LmmxApiError("c", "m", "LMMX_E_RATE"); }, async () => { asked++; }), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_RATE");
  assert.deepEqual([calls, asked], [1, 0]);
});
test("audit filters become a clean query; back-to-front dates are refused", () => {
  assert.deepEqual(auditQuery(emptyAuditFilters()), { limit: 15 });
  const q = auditQuery({ tenantId: " t1 ", action: "freeze", deskCode: "cog-0007", from: "2026-11-01", to: "2026-11-02" }, 40);
  assert.deepEqual([q?.tenantId, q?.action, q?.deskCode, q?.cursor], ["t1", "freeze", "COG-0007", 40]);
  assert.equal((q?.to ?? 0) - (q?.from ?? 0), 2 * 86_400_000 - 1);
  assert.equal(auditQuery({ ...emptyAuditFilters(), from: "2026-11-05", to: "2026-11-01" }), null);
  assert.equal(AUDIT_ACTIONS.length, Object.keys(AUDIT_ACTION_LABELS).length);
});
test("verify chain says OK or the first broken sequence number", () => {
  assert.deepEqual(verifyMessage({ ok: true, checked: 60 }).tone, "ok");
  const bad = verifyMessage({ ok: false, checked: 17, brokenAtSeq: 17 });
  assert.equal(bad.tone, "error"); assert.match(bad.text, /17/);
});
test("leads: all eight stages plus All; follow-up dates; desk codes", () => {
  assert.equal(LEAD_TABS.length, 9);
  assert.equal(followUpToMs(""), null); assert.equal(followUpToMs("nope"), undefined); assert.equal(followUpToMs("2026-11-20"), Date.parse("2026-11-19T21:00:00Z"));
  assert.equal(deskCodeProblem("cog-0007"), null); assert.ok(deskCodeProblem("COG-7"));
});
