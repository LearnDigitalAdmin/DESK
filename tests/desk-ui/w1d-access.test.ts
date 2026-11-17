import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKenyaPhone } from "../../src/desk/access/phone";
import { formatClock } from "../../src/desk/access/time";
import { PRODUCT_LABEL, scopesForProduct, splitEntityKey } from "../../src/desk/access/scopes";
import { buildDraft, payloadBytes, payloadProblem, MAX_PAYLOAD_BYTES } from "../../src/desk/access/service/payload";
import { cleanApplication, validateApplication, type ApplicationFields } from "../../src/desk/onboarding/validation";
import { JOURNEY, journeyIndex, nextSteps } from "../../src/desk/onboarding/steps";
import { AGENT_TERMS } from "../../src/desk/onboarding/terms";

test("phone: same cases as the server's normalizeKenyaPhone", () => {
  assert.equal(normalizeKenyaPhone("0712 345 678"), "+254712345678");
  assert.equal(normalizeKenyaPhone("+254 712-345-678"), "+254712345678");
  assert.equal(normalizeKenyaPhone("254112345678"), "+254112345678");
  assert.equal(normalizeKenyaPhone("712345678"), "+254712345678");
  assert.equal(normalizeKenyaPhone("(0722) 345678"), "+254722345678");
  assert.equal(normalizeKenyaPhone("0812345678"), null);
  assert.equal(normalizeKenyaPhone("07123"), null);
  assert.equal(normalizeKenyaPhone(""), null);
  assert.equal(normalizeKenyaPhone("abc"), null);
});

test("formatClock", () => {
  assert.equal(formatClock(125_000), "2:05");
  assert.equal(formatClock(3_725_000), "1:02:05");
  assert.equal(formatClock(-5), "0:00");
  assert.equal(formatClock(59_001), "1:00");
});

test("scopes: rent prompts only for Plot Yangu; entity keys parse", () => {
  assert.ok(scopesForProduct("pms").includes("rent_stk"));
  assert.ok(!scopesForProduct("chama").includes("rent_stk"));
  assert.ok(!scopesForProduct("school").includes("rent_stk"));
  assert.deepEqual(splitEntityKey("chama:SMC-0042"), { product: "chama", code: "SMC-0042" });
  assert.equal(splitEntityKey("bogus:1"), null);
  assert.equal(splitEntityKey("nocolon"), null);
  assert.equal(PRODUCT_LABEL.pms, "Plot Yangu");
});

test("payload: draft shape and size guard", () => {
  assert.deepEqual(buildDraft([{ a: "1" }], "excel"), { rows: [{ a: "1" }], source: "excel" });
  assert.equal(payloadProblem(buildDraft([{ a: "1" }], "manual")), null);
  const big = buildDraft([{ blob: "x".repeat(MAX_PAYLOAD_BYTES) }], "excel");
  assert.ok(payloadBytes(big) > MAX_PAYLOAD_BYTES);
  assert.match(payloadProblem(big) ?? "", /too much data/);
  assert.equal(payloadBytes({ n: "é" }), JSON.stringify({ n: "é" }).length + 1); // multi-byte characters count as bytes
});

test("application: the server's limits are enforced client-side too", () => {
  // A complete, valid application. Each assertion overrides only the field it checks.
  const ok: ApplicationFields = {
    name: "Mary Wanjiku", phone: "0712 345 678", idNumber: "12345678",
    county: "Nairobi", constituency: "Lang'ata", ward: "Karen",
    uplineCode: "", inviteCode: "", role: "",
  };
  assert.deepEqual(validateApplication(ok), {});

  // name: 2 to 80 characters
  assert.ok(validateApplication({ ...ok, name: "A" }).name);
  assert.ok(validateApplication({ ...ok, name: "x".repeat(81) }).name);

  // phone
  assert.ok(validateApplication({ ...ok, phone: "12345" }).phone);

  // ID: 6 to 12 digits, numbers only
  assert.ok(validateApplication({ ...ok, idNumber: "12345" }).idNumber);
  assert.ok(validateApplication({ ...ok, idNumber: "1234567890123" }).idNumber);
  assert.ok(validateApplication({ ...ok, idNumber: "12345a78" }).idNumber);

  // county / constituency / ward must be chosen (blank or whitespace is refused)
  assert.ok(validateApplication({ ...ok, county: "" }).county);
  assert.ok(validateApplication({ ...ok, constituency: "" }).constituency);
  assert.ok(validateApplication({ ...ok, ward: "" }).ward);
  assert.ok(validateApplication({ ...ok, ward: "  " }).ward);

  // upline code: COG- followed by 4+ digits
  assert.deepEqual(validateApplication({ ...ok, uplineCode: "cog-0123" }), {});
  assert.ok(validateApplication({ ...ok, uplineCode: "BAD" }).uplineCode);

  // invite code: 8 characters, no look-alikes (I, L, O, 0, 1)
  assert.deepEqual(validateApplication({ ...ok, inviteCode: "abcdefgh" }), {});
  assert.ok(validateApplication({ ...ok, inviteCode: "ABCDEFG1" }).inviteCode);
  assert.ok(validateApplication({ ...ok, inviteCode: "ABC" }).inviteCode);

  // upline and invite together are refused
  assert.ok(validateApplication({ ...ok, uplineCode: "COG-0123", inviteCode: "ABCDEFGH" }).inviteCode);

  // optional fields may be missing altogether without throwing
  const { uplineCode: _u, inviteCode: _i, role: _r, ...bare } = ok;
  assert.deepEqual(validateApplication(bare), {});

  // cleaning: trims, collapses spaces, normalises the phone, keeps wardId for older servers
  assert.deepEqual(
    cleanApplication({ ...ok, name: "  Mary   Wanjiku ", ward: " Karen " }),
    {
      name: "Mary Wanjiku", phone: "+254712345678", idNumber: "12345678",
      wardId: "Karen", county: "Nairobi", constituency: "Lang'ata", ward: "Karen",
    },
  );

  // codes are upper-cased; the role is only sent when no code is used
  assert.equal(cleanApplication({ ...ok, uplineCode: " cog-0123 " }).uplineCode, "COG-0123");
  assert.equal(cleanApplication({ ...ok, inviteCode: "abcdefgh" }).inviteCode, "ABCDEFGH");
  assert.equal(cleanApplication({ ...ok, role: "senior" }).role, "senior");
  assert.equal("role" in cleanApplication({ ...ok, role: "senior", uplineCode: "COG-0123" }), false);
});

test("journey: every status has next steps; suspended/closed sit outside the path", () => {
  assert.equal(JOURNEY.length, 4);
  assert.equal(journeyIndex("applied"), 0);
  assert.equal(journeyIndex("active"), 3);
  assert.equal(journeyIndex("suspended"), -1);
  for (const s of ["applied", "training", "certified", "active", "suspended", "closed"] as const) {
    const n = nextSteps(s);
    assert.ok(n.headline && n.lines.length > 0, s);
  }
  assert.equal(nextSteps("active").tone, "green");
  assert.ok(AGENT_TERMS.length > 0);
});