/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPLIANCE_REPORT_TYPES, defaultReportMonth, monthsBack, recentMonths, reportMonthLabel } from "./complianceLogic.ts";

test("the default month is the Nairobi month before today (the return due on the 20th)", () => {
  assert.equal(defaultReportMonth(new Date("2026-11-05T10:00:00Z")), "2026-10");
  assert.equal(defaultReportMonth(new Date("2026-01-15T10:00:00Z")), "2025-12");
  assert.equal(defaultReportMonth(new Date("2026-10-31T21:30:00Z")), "2026-10");      // already 1 November in Nairobi
});
test("recent months run newest first across a year end", () => {
  assert.deepEqual(recentMonths(3, new Date("2026-01-10T00:00:00Z")), ["2026-01", "2025-12", "2025-11"]);
  assert.equal(monthsBack(13, new Date("2026-02-10T00:00:00Z")), "2025-01");
});
test("labels and the two report types", () => {
  assert.equal(reportMonthLabel("2026-10"), "October 2026");
  assert.deepEqual(COMPLIANCE_REPORT_TYPES.map((t) => t.id), ["mri_monthly", "annual_summary"]);
});
