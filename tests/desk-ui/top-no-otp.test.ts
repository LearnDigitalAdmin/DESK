import { test } from "node:test";
import assert from "node:assert/strict";
import { actionAlreadyConfirmed, openedSession } from "../../src/desk/access/topSession";
import { S } from "../../src/desk/modules/lmm/strings";
import { LMMX_CONTRACT_VERSION } from "../../src/desk/api/lmmxContract";
import { readFileSync } from "node:fs";

const entity = { entityKey: "chama:SMC-0001" as never, displayName: "Test Chama" };
test("a session the server already opened (top desk) goes straight in", () => {
  const s = openedSession({ sessionId: "s1", verified: true, expiresAt: 123 }, entity, ["read"]);
  assert.deepEqual(s, { sessionId: "s1", entityKey: "chama:SMC-0001", displayName: "Test Chama", scopes: ["read"], expiresAt: 123 });
});
test("everyone else still goes through the customer code step", () => {
  assert.equal(openedSession({ sessionId: "s1" }, entity, ["read"]), null);
  assert.equal(openedSession({ sessionId: "s1", verified: false, expiresAt: 123 }, entity, ["read"]), null);
  assert.equal(openedSession({ sessionId: "s1", verified: true }, entity, ["read"]), null, "no expiry, no session");
  assert.equal(actionAlreadyConfirmed({}), false); assert.equal(actionAlreadyConfirmed({ verified: false }), false); assert.equal(actionAlreadyConfirmed({ verified: true }), true);
});
test("the top-desk change copy says no code and no waiting; the regular copy still says code and 48 hours", () => {
  assert.match(S.change.topCopy.join(" "), /No tenant code and no waiting period/);
  assert.match(S.change.payoutCopy.join(" "), /code/); assert.match(S.change.payoutCopy.join(" "), /48 hours/);
});
test("the two DESK copies of the LMMX contract are identical and are version 3", () => {
  assert.equal(LMMX_CONTRACT_VERSION, 3);
  assert.equal(readFileSync("src/desk/api/lmmxContract.ts", "utf8"), readFileSync("functions/src/types/lmmx.contract.ts", "utf8"));
});
