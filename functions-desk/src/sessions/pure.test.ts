import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScopes, validateTenantIds } from "./pure.js";

test("scopes: non-empty subset, deduplicated", () => {
  assert.deepEqual(validateScopes(["import", "read", "read"]), ["read", "import"]);
  assert.throws(() => validateScopes([])); assert.throws(() => validateScopes(undefined)); assert.throws(() => validateScopes(["read", "root"]));
  assert.throws(() => validateScopes([1]));
});
test("tenant ids: 1–max, trimmed, unique", () => {
  assert.deepEqual(validateTenantIds([" t1 ", "t2"], 200), ["t1", "t2"]);
  assert.throws(() => validateTenantIds([], 200));
  assert.throws(() => validateTenantIds(["a", "a"], 200));
  assert.throws(() => validateTenantIds(["a", " a"], 200));
  assert.throws(() => validateTenantIds(["a/b"], 200));
  assert.throws(() => validateTenantIds([""], 200));
  assert.throws(() => validateTenantIds(Array.from({ length: 201 }, (_, i) => `t${i}`), 200));
  assert.equal(validateTenantIds(Array.from({ length: 200 }, (_, i) => `t${i}`), 200).length, 200);
});

// ---- COG-0000 needs no customer OTP (and nobody else gets that)
import { isTopDeskAgent, topActionOtpDoc, topSessionDoc } from "./pure.js";
import { evaluateActionOtp, evaluateSession } from "../kernel/session.js";

test("only the active COG-0000 agent is the top desk", () => {
  assert.equal(isTopDeskAgent({ agentCode: "COG-0000", status: "active" }), true);
  assert.equal(isTopDeskAgent({ agentCode: "COG-0000", status: "suspended" }), false);
  assert.equal(isTopDeskAgent({ agentCode: "COG-0012", status: "active" }), false);
  assert.equal(isTopDeskAgent({ agentCode: "cog-0000", status: "active" }), false);
  assert.equal(isTopDeskAgent(undefined), false);
});
test("a top-desk session is open from the start and passes the normal session checks", () => {
  const NOW = 1_700_000_000_000;
  const s = topSessionDoc({ sessionId: "s1", agentId: "u1", entityKey: "chama:SMC-0001", scopes: ["read", "bulk_sms"], now: NOW });
  assert.equal(s.status, "active"); assert.ok(s.otpVerifiedAt); assert.equal(s.otpHash, undefined);
  assert.equal(evaluateSession(s, { uid: "u1", scope: "bulk_sms" }, NOW + 1000).ok, true);
  assert.equal(evaluateSession(s, { uid: "u2", scope: "read" }, NOW + 1000).ok, false, "still bound to that agent");
  assert.equal(evaluateSession(s, { uid: "u1", scope: "export" }, NOW + 1000).ok, false, "still limited to the scopes asked for");
  assert.equal(evaluateSession(s, { uid: "u1", scope: "read" }, s.expiresAt).ok, false, "still expires");
});
test("a top-desk action confirmation is already verified, single-action and short-lived like any other", () => {
  const NOW = 1_700_000_000_000;
  const a = topActionOtpDoc({ actionId: "a1", sessionId: "s1", agentId: "u1", action: "export", summary: "x", now: NOW });
  assert.equal(evaluateActionOtp(a, { sessionId: "s1", uid: "u1", action: "export" }, NOW + 1000).ok, true);
  assert.equal(evaluateActionOtp(a, { sessionId: "s1", uid: "u1", action: "bulk_sms" }, NOW + 1000).ok, false, "not valid for another action");
  assert.equal(evaluateActionOtp(a, { sessionId: "s1", uid: "u1", action: "export" }, NOW + 6 * 60_000).ok, false, "not valid after 5 minutes");
  assert.equal(evaluateActionOtp({ ...a, consumedAt: NOW + 10 }, { sessionId: "s1", uid: "u1", action: "export" }, NOW + 1000).ok, false, "single use");
});
