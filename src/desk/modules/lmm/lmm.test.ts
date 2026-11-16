/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { LMMX } from "../../api/lmmxContract.ts";
import {
  accountForSend, accountProblem, creditFor, defaultRange, deriveChangeView, deriveSetupView, displayMasked, emptyRecipientForm, emptyRentForm, emptyTenantForm,
  fallbackPreview, fmtCountdown, hasErrors, listKey, looksUnmasked, mergeRows, normaliseOtp, parseDueDay, parseKes, rangeToMs, searchTerm, sanitizeOtpInput,
  secondsLeft, toProfileInput, toRecipientInput, validateRecipient, validateRent, validateTenant, canEditTenant,
} from "./logic.ts";

const now = 1_700_000_000_000;

test("wizard: tenant step validates name, phone, ID, email", () => {
  const ok = { ...emptyTenantForm(), fullName: "Mary Wanjiku", phone: "0712 345 678", idNumber: "23456789" };
  assert.equal(hasErrors(validateTenant(ok)), false);
  const bad = validateTenant({ ...ok, fullName: "M", phone: "12345", idNumber: "12", email: "nope" });
  assert.deepEqual(Object.keys(bad).sort(), ["email", "fullName", "idNumber", "phone"]);
  assert.equal(hasErrors(validateTenant({ ...ok, idType: "passport", idNumber: "AB12CD34" })), false);
  assert.ok(validateTenant({ ...ok, idType: "national_id", idNumber: "AB12CD34" }).idNumber);
  assert.equal(toProfileInput(ok).phone, "+254712345678");
});
test("wizard: recipient step per channel", () => {
  const base = { ...emptyRecipientForm(), accountName: "John Doe", contactName: "John Doe", contactPhone: "0722111222" };
  assert.equal(hasErrors(validateRecipient({ ...base, channel: "till", accountNumber: "5123456" })), false);
  assert.ok(validateRecipient({ ...base, channel: "till", accountNumber: "12" }).accountNumber);
  assert.ok(validateRecipient({ ...base, channel: "bank", accountNumber: "0123456789" }).bankCode);
  assert.equal(hasErrors(validateRecipient({ ...base, channel: "bank", bankCode: "68", accountNumber: "0123456789" })), false);
  assert.equal(accountProblem("phone", "0711222333"), null);
  assert.ok(accountProblem("phone", "0600000000"));
  assert.equal(accountForSend("phone", "0711 222 333"), "+254711222333");
  assert.equal(accountForSend("till", "512 3456"), "5123456");
  const r = toRecipientInput({ ...base, channel: "bank", bankCode: "68", accountNumber: "0123 456789" }, "tok");
  assert.deepEqual([r.bankCode, r.accountNumber, r.reuseToken, r.contactPhone], ["68", "0123456789", "tok", "+254722111222"]);
  assert.equal("bankCode" in toRecipientInput({ ...base, accountNumber: "5123456" }), false);
});
test("wizard: rent in whole shillings within limits, due day 1 to 28", () => {
  assert.equal(parseKes("12,000"), 1_200_000);
  assert.equal(parseKes("12.5"), null); assert.equal(parseKes("0"), null); assert.equal(parseKes(""), null);
  assert.equal(hasErrors(validateRent({ ...emptyRentForm(), rentKes: "12000" })), false);
  assert.ok(validateRent({ ...emptyRentForm(), rentKes: "500" }).rentKes);
  assert.ok(validateRent({ ...emptyRentForm(), rentKes: "150001" }).rentKes);
  assert.equal(validateRent({ ...emptyRentForm(), rentKes: "150000" }).rentKes, undefined);
  assert.equal(parseDueDay("28"), 28); assert.equal(parseDueDay("29"), null); assert.equal(parseDueDay("0"), null);
  assert.equal(emptyRentForm().dueDay, "5");
});
test("preview fallback uses the contract helpers", () => {
  const p = fallbackPreview(1_000_000, "till");
  assert.equal(p.table.find((r) => r.creditMinor === 1_000_000)?.chargeMinor, 1_040_800);
  assert.equal(p.projection.weekly.deskBonusMinor, LMMX.COMPLETION_BONUS_MINOR);
  assert.equal(creditFor(1_000_000, "weekly"), 250_000);
  assert.ok(creditFor(100_000, "daily") >= LMMX.MIN_CREDIT_MINOR);
});

test("OTP input: LMM4683, 'lmm 4683', 4683 accepted; junk and cancel codes refused", () => {
  for (const t of ["LMM4683", "lmm 4683", " LMM-4683 ", "4683", "lmm  4683"]) assert.deepEqual(normaliseOtp(t), { ok: true, otp: "LMM4683", digits: "4683" }, t);
  for (const t of ["", "468", "46831", "LMC4683", "abcd", "LMM46x3", null, undefined]) assert.equal(normaliseOtp(t).ok, false, String(t));
  assert.equal(sanitizeOtpInput("lmm 46!83xyz9"), "LMM 4683");
});
test("countdown", () => {
  assert.equal(secondsLeft(now + 90_500, now), 91); assert.equal(secondsLeft(now - 1, now), 0); assert.equal(secondsLeft(undefined, now), 0);
  assert.equal(fmtCountdown(125), "2:05"); assert.equal(fmtCountdown(0), "0:00");
});

test("setup state machine: awaiting, active, expired, locked, resend limits, review, closed", () => {
  const s = (o: object) => ({ tenantId: "t", status: "awaiting_confirmation" as const, ...o });
  assert.deepEqual(deriveSetupView(s({ otpExpiresAt: now + 60_000, attemptsLeft: 5, resendsLeft: 3 }), now), { phase: "waiting", expiresAt: now + 60_000, attemptsLeft: 5, resendsLeft: 3, canSubmit: true, canResend: true });
  const noResend = deriveSetupView(s({ otpExpiresAt: now + 60_000, attemptsLeft: 4, resendsLeft: 0 }), now);
  assert.equal(noResend.canResend, false); assert.equal(noResend.canSubmit, true);
  const exp = deriveSetupView(s({ otpExpiresAt: now - 1, attemptsLeft: 5, resendsLeft: 2 }), now);
  assert.deepEqual([exp.phase, exp.canSubmit, exp.canResend], ["expired", false, true]);
  assert.equal(deriveSetupView(s({ otpExpiresAt: now - 1, resendsLeft: 0 }), now).canResend, false);
  const locked = deriveSetupView(s({ otpExpiresAt: now + 1000, locked: true, resendsLeft: 3 }), now);
  assert.deepEqual([locked.phase, locked.canSubmit, locked.canResend], ["locked", false, false]);
  assert.equal(deriveSetupView(s({ otpExpiresAt: now + 1000, attemptsLeft: 0 }), now).phase, "locked");
  assert.equal(deriveSetupView({ tenantId: "t", status: "active" }, now).phase, "done");
  assert.equal(deriveSetupView({ tenantId: "t", status: "closed" }, now).phase, "closed");
  assert.equal(deriveSetupView({ tenantId: "t", status: "draft", needsReview: true }, now).phase, "review");
  assert.equal(deriveSetupView({ tenantId: "t", status: "frozen" }, now).phase, "blocked");
  assert.equal(deriveSetupView(s({}), now).phase, "expired");
});
test("change state machine", () => {
  const pc = (status: string) => ({ changeId: "c1", kind: "rent" as const, status: status as never, summary: "", initiatedBy: "desk" as const });
  assert.equal(deriveChangeView(pc("awaiting_tenant_otp"), "c1", now + 5000, now).phase, "waiting");
  assert.equal(deriveChangeView(pc("awaiting_tenant_otp"), "c1", now + 5000, now).attemptsLeft, undefined);
  assert.equal(deriveChangeView(pc("awaiting_tenant_otp"), "c1", now - 5, now).phase, "expired");
  assert.equal(deriveChangeView(pc("awaiting_tenant_otp"), "c1", undefined, now).phase, "waiting");
  assert.equal(deriveChangeView(pc("awaiting_tenant_otp"), "c1", now + 5000, now, 2).attemptsLeft, 3);
  assert.equal(deriveChangeView(pc("awaiting_tenant_otp"), "c1", now + 5000, now, 5).phase, "locked");
  for (const st of ["cooling_off", "deferred", "applied"]) assert.equal(deriveChangeView(pc(st), "c1", undefined, now).phase, "done");
  for (const st of ["cancelled", "expired", "rejected"]) assert.equal(deriveChangeView(pc(st), "c1", undefined, now).phase, "closed");
  assert.equal(deriveChangeView(pc("applied"), "other", undefined, now).phase, "closed");
  assert.equal(deriveChangeView(undefined, "c1", undefined, now).phase, "closed");
  assert.equal(deriveChangeView(pc("awaiting_tenant_otp"), "c1", now + 5000, now).canResend, false);
});
test("canEditTenant", () => {
  assert.equal(canEditTenant("active", undefined), true);
  assert.equal(canEditTenant("frozen", undefined), false);
  assert.equal(canEditTenant("active", { changeId: "c", kind: "rent", status: "cooling_off", summary: "", initiatedBy: "desk" }), false);
  assert.equal(canEditTenant("active", { changeId: "c", kind: "rent", status: "applied", summary: "", initiatedBy: "desk" }), true);
});

test("list: paging merge drops duplicates, keeps order; search term; reset key", () => {
  const k = (r: { id: string }) => r.id;
  assert.deepEqual(mergeRows([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }, { id: "c" }], k).map(k), ["a", "b", "c"]);
  assert.equal(searchTerm(" a "), undefined); assert.equal(searchTerm("  Mary   W "), "Mary W"); assert.equal(searchTerm("x".repeat(80))?.length, 40);
  assert.notEqual(listKey("m", undefined), listKey("m", "active")); assert.equal(listKey(undefined, undefined), listKey(undefined, undefined));
});
test("masking is never bypassed: unmasked phones and IDs are never displayed", () => {
  for (const bad of ["+254712345678", "0712345678", "254 712 345 678", "23456789", "1234567"]) { assert.equal(looksUnmasked(bad), true, bad); assert.equal(displayMasked(bad), "••••"); }
  for (const good of ["+254*****678", "23****89", "Mary W.", "****"]) { assert.equal(looksUnmasked(good), false, good); assert.equal(displayMasked(good), good); }
  assert.equal(displayMasked(undefined), "");
});
test("earnings range in Nairobi time", () => {
  assert.equal(rangeToMs("2026-11-01", "2026-11-30")?.from, Date.parse("2026-10-31T21:00:00Z"));
  assert.equal(rangeToMs("2026-11-30", "2026-11-01"), null); assert.equal(rangeToMs("x", "2026-11-01"), null);
  assert.equal(defaultRange(Date.parse("2026-11-15T10:00:00Z")).from, "2026-11-01");
});
