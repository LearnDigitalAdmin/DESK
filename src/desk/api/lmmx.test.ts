/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { LMMX } from "./lmmxContract.ts";
import type { LmmxErrorCode } from "./lmmxContract.ts";
import { LMMX_ERROR_CODES, LMMX_ERROR_MESSAGES, LmmxApiError, toLmmxError } from "./lmmxErrors.ts";
import { MOCK_CODE, mockCall, mockControl } from "./lmmxMock.ts";

// The full list from the contract (Appendix A). If CORE adds a code, the table type fails to compile AND this list must grow.
const CONTRACT_CODES: LmmxErrorCode[] = ["LMMX_E_AUTH", "LMMX_E_FORBIDDEN", "LMMX_E_SIG", "LMMX_E_RATE", "LMMX_E_VALIDATION", "LMMX_E_DUPLICATE", "LMMX_E_NOT_FOUND", "LMMX_E_OTP_INVALID",
  "LMMX_E_OTP_LOCKED", "LMMX_E_OTP_EXPIRED", "LMMX_E_REVIEW_REQUIRED", "LMMX_E_FROZEN", "LMMX_E_DISABLED", "LMMX_E_AMOUNT", "LMMX_E_QUOTE", "LMMX_E_STATE",
  "LMMX_E_TAMPER", "LMMX_E_RECIPIENT_BLOCKED", "LMMX_E_NEEDS_REAUTH", "LMMX_E_DESK_NOT_READY", "LMMX_E_INTERNAL"];

test("the error table covers EVERY LMMX_E_* code with plain words", () => {
  assert.deepEqual([...LMMX_ERROR_CODES].sort(), [...CONTRACT_CODES].sort());
  for (const c of CONTRACT_CODES) { const m = LMMX_ERROR_MESSAGES[c]; assert.ok(m && m.length > 10 && m.length < 140, c); assert.doesNotMatch(m, /LMMX_|functions\//, c); }
});
test("toLmmxError reads details.lmmx and prefers our plain words over server text", () => {
  for (const c of CONTRACT_CODES) {
    const e = toLmmxError({ code: "functions/failed-precondition", message: "raw server text", details: { lmmx: c } });
    assert.equal(e.lmmx, c); assert.equal(e.message, LMMX_ERROR_MESSAGES[c]); assert.equal(e.code, "functions/failed-precondition");
  }
  const plain = toLmmxError({ code: "functions/unavailable", message: "x" });
  assert.equal(plain.lmmx, undefined); assert.match(plain.message, /Network/);
  assert.equal(toLmmxError({ code: "functions/internal", details: { lmmx: "BOGUS" } }).lmmx, undefined);
  const same = new LmmxApiError("c", "m", "LMMX_E_RATE"); assert.equal(toLmmxError(same), same);
});

mockControl.latencyMs = 0;
const tenantIn = (idNumber: string, name = "Grace Ouma") => ({
  profile: { fullName: name, phone: `+2547${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, idType: "national_id" as const, idNumber }, rentMinor: 600_000, dueDay: 5, frequency: "weekly" as const,
  recipient: { channel: "till" as const, accountNumber: "5123456", accountName: "Peter N", contactName: "Peter N", contactPhone: "+254711000111" }, idempotencyKey: `k${Math.random().toString(36).slice(2)}abcdef`,
});

test("mock: every error code can be forced on demand", async () => {
  for (const c of CONTRACT_CODES) {
    mockControl.failNext(c);
    await assert.rejects(() => mockCall("lmmx_desk_listTenants", {}), (e: unknown) => (e as LmmxApiError).lmmx === c);
  }
  mockControl.failNext("LMMX_E_RATE", "lmmx_desk_preview");
  await mockCall("lmmx_desk_listTenants", {});
  await assert.rejects(() => mockCall("lmmx_desk_preview", { rentMinor: 600_000, channel: "till" }));
});
test("mock: setup waits, a wrong code costs a try, the right code activates, replay-safe", async () => {
  mockControl.reset(); mockControl.latencyMs = 0;
  const out = await mockCall("lmmx_desk_createTenant", tenantIn("31000001"));
  assert.equal(out.status, "awaiting_confirmation");
  let st = await mockCall("lmmx_desk_setupStatus", { tenantId: out.tenantId });
  assert.deepEqual([st.status, st.attemptsLeft, st.locked], ["awaiting_confirmation", 5, false]);
  await assert.rejects(() => mockCall("lmmx_desk_confirmSetup", { tenantId: out.tenantId, otp: "LMM1111" }), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_OTP_INVALID");
  st = await mockCall("lmmx_desk_setupStatus", { tenantId: out.tenantId });
  assert.equal(st.attemptsLeft, 4);
  const done = await mockCall("lmmx_desk_confirmSetup", { tenantId: out.tenantId, otp: `lmm ${MOCK_CODE}`.replace(" ", "") });
  assert.equal(done.status, "active");
});
test("mock: becomes active by itself after a few polls", async () => {
  mockControl.reset(); mockControl.latencyMs = 0; mockControl.autoActivateAfterPolls = 3;
  const { tenantId } = await mockCall("lmmx_desk_createTenant", tenantIn("31000002"));
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) seen.push((await mockCall("lmmx_desk_setupStatus", { tenantId })).status);
  assert.deepEqual(seen, ["awaiting_confirmation", "awaiting_confirmation", "active", "active"]);
});
test("mock: locked, expired, resend limits, needs review, desk not ready", async () => {
  mockControl.reset(); mockControl.latencyMs = 0; mockControl.autoActivateAfterPolls = 999;
  const locked = await mockCall("lmmx_desk_createTenant", tenantIn("31000000"));
  assert.equal((await mockCall("lmmx_desk_setupStatus", { tenantId: locked.tenantId })).locked, true);
  await assert.rejects(() => mockCall("lmmx_desk_confirmSetup", { tenantId: locked.tenantId, otp: "4683" }), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_OTP_LOCKED");
  const exp = await mockCall("lmmx_desk_createTenant", tenantIn("31000111"));
  await assert.rejects(() => mockCall("lmmx_desk_confirmSetup", { tenantId: exp.tenantId, otp: "4683" }), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_OTP_EXPIRED");
  let left: number = LMMX.OTP_RESEND_MAX_PER_HOUR;
  for (let i = 0; i < LMMX.OTP_RESEND_MAX_PER_HOUR; i++) left = (await mockCall("lmmx_desk_resendOtp", { tenantId: exp.tenantId })).resendsLeft;
  assert.equal(left, 0);
  await assert.rejects(() => mockCall("lmmx_desk_resendOtp", { tenantId: exp.tenantId }), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_RATE");
  assert.equal((await mockCall("lmmx_desk_confirmSetup", { tenantId: exp.tenantId, otp: "4683" })).status, "active");
  const rv = tenantIn("31000333"); rv.recipient.accountName = "Mismatch Ltd";
  const r = await mockCall("lmmx_desk_createTenant", rv);
  assert.deepEqual([r.needsReview, r.status], [true, "draft"]);
  await assert.rejects(() => mockCall("lmmx_desk_createTenant", tenantIn("00000001")), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_DESK_NOT_READY");
});
test("mock: the same idempotency key never creates two tenants; duplicates are refused", async () => {
  mockControl.reset(); mockControl.latencyMs = 0;
  const a = tenantIn("31000555"); const x = await mockCall("lmmx_desk_createTenant", a); const y = await mockCall("lmmx_desk_createTenant", a);
  assert.equal(x.tenantId, y.tenantId);
  await assert.rejects(() => mockCall("lmmx_desk_createTenant", { ...tenantIn("31000555"), }), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_DUPLICATE");
});
test("mock: dedupe answers show only the account and a token", async () => {
  const hit = await mockCall("lmmx_desk_checkRecipient", { channel: "till", accountNumber: "5120001", enteredName: "x" });
  assert.deepEqual(Object.keys(hit).sort(), ["accountNumber", "exists", "nameMatchesEntered", "reusable", "reuseToken"]);
  assert.equal((await mockCall("lmmx_desk_checkRecipient", { channel: "till", accountNumber: "5129999", enteredName: "x" })).exists, false);
});
test("mock: list masks everything and pages", async () => {
  mockControl.reset(); mockControl.latencyMs = 0;
  const all: string[] = []; let cursor: string | undefined;
  do { const p = await mockCall("lmmx_desk_listTenants", { limit: 2, ...(cursor ? { cursor } : {}) }); for (const t of p.tenants) { all.push(t.tenantId); assert.doesNotMatch(t.phoneMasked, /\d{7}/); assert.match(t.phoneMasked, /\*/); } cursor = p.nextCursor; } while (cursor);
  assert.ok(all.length >= 3); assert.equal(new Set(all).size, all.length);
  const s = await mockCall("lmmx_desk_listTenants", { q: "mary" }); assert.equal(s.tenants.length, 1);
});
test("mock: top mutations need a recent sign-in, then a 10+ character reason", async () => {
  mockControl.reset(); mockControl.latencyMs = 0;
  const call = (reason: string) => mockCall("lmmx_top_freeze", { scope: "tenant", id: "t_active1", reason });
  await assert.rejects(() => call("long enough reason"), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_NEEDS_REAUTH");
  mockControl.reauthDone();
  await assert.rejects(() => call("short"), (e: unknown) => (e as LmmxApiError).lmmx === "LMMX_E_VALIDATION");
  assert.deepEqual(await call("long enough reason"), { ok: true });
});
test("mock: audit verify and change flow", async () => {
  mockControl.reset(); mockControl.latencyMs = 0;
  assert.equal((await mockCall("lmmx_top_auditVerify", {})).ok, true);
  mockControl.breakChainAt = 17;
  assert.deepEqual(await mockCall("lmmx_top_auditVerify", {}), { ok: false, checked: 17, brokenAtSeq: 17 });
  mockControl.reset(); mockControl.latencyMs = 0;
  const done = await mockCall("lmmx_desk_createTenant", tenantIn("31000777")); await mockCall("lmmx_desk_confirmSetup", { tenantId: done.tenantId, otp: "4683" });
  const ch = await mockCall("lmmx_desk_requestChange", { tenantId: done.tenantId, kind: "rent", rentMinor: 700_000, idempotencyKey: "kkkkkkkkkkkkkk" });
  assert.equal(ch.requiresTenantOtp, true);
  const conf = await mockCall("lmmx_desk_confirmChange", { changeId: ch.changeId, otp: "4683" });
  assert.ok(["applied", "deferred"].includes(conf.status));
});
