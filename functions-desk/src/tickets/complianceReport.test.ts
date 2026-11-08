import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DESK_CONFIG, mergeConfig } from "../config.js";
import { buildDelegateCall } from "../connectors/tickets.js";
import { DeskError } from "../errors.js";
import { complianceReportPlan, planForService, servicePlan, settledAmounts } from "../money.js";
import { listReportProperties, previewComplianceReport } from "./complianceReport.js";
import { SERVICE_SCOPE, SERVICE_TYPES } from "./model.js";
import { parseParams, parseQuoteEnvelope, priceService } from "./quote.js";

const cfg = DEFAULT_DESK_CONFIG;

test("compliance_report is a known service on the report scope", () => {
  assert.ok(SERVICE_TYPES.includes("compliance_report"));
  assert.equal(SERVICE_SCOPE.compliance_report, "report");
  assert.equal(parseQuoteEnvelope({ sessionId: "s", serviceType: "compliance_report", params: {} }).serviceType, "compliance_report");
});

test("parameters: report type, property and a real month; nothing else, and the customer cannot set a price", () => {
  const ok = { reportType: "mri_monthly", propertyId: "3", month: "2026-10" };
  assert.deepEqual(parseParams("compliance_report", ok), ok);
  assert.deepEqual(parseParams("compliance_report", { ...ok, reportType: "annual_summary" }).reportType, "annual_summary");
  for (const bad of [{ ...ok, reportType: "everything" }, { ...ok, reportType: undefined }, { ...ok, propertyId: "" }, { ...ok, propertyId: "x".repeat(61) },
    { ...ok, month: "2026-13" }, { ...ok, month: "10/2026" }, { ...ok, month: "2015-12" }, { ...ok, month: undefined }])
    assert.throws(() => parseParams("compliance_report", bad as never), DeskError);
  for (const extra of ["price", "amountMinor", "free", "paid"]) assert.throws(() => parseParams("compliance_report", { ...ok, [extra]: 0 }), new RegExp(`"${extra}"`));
});

test("price: KES 200 from config for either report, in one line, never free", () => {
  for (const reportType of ["mri_monthly", "annual_summary"]) {
    const p = priceService("compliance_report", { reportType, propertyId: "3", month: "2026-10" }, cfg);
    assert.equal(p.amountMinor, 20000); assert.equal(p.lines.length, 1); assert.match(p.lines[0].label, /2026-10/);
  }
  const zero = mergeConfig({ prices: { complianceReportMinor: 0 } } as never);
  assert.throws(() => priceService("compliance_report", { reportType: "mri_monthly", propertyId: "3", month: "2026-10" }, zero), /no valid price/);
});

test("split: KES 200 - 1.5% Paystack - 15% platform = KES 167.00 for the agent (83.5%), other services unchanged", () => {
  const plan = complianceReportPlan(20000, cfg);
  assert.equal(plan.agentSharePct, 84.77);                                  // share of what Paystack settles (200.00 - 3.00)
  const s = settledAmounts({ grossMinor: 20000, feeMinor: 300, agentSharePct: plan.agentSharePct });
  assert.equal(s.agentMinor, 16699);                                         // KES 166.99: the 0.01% rounding is always in the agent's disfavour
  assert.ok(16700 - s.agentMinor <= 1);
  assert.equal(s.agentMinor + s.platformMinor + 300, 20000);                 // every shilling is accounted for
  assert.equal(s.platformMinor, 3001);                                       // 15% of KES 200 = 30.00 (+0.01 of rounding)
  assert.deepEqual(planForService("compliance_report", 20000, cfg), plan);
  for (const t of ["import_excel", "manual_entry", "schedule_setup", "bulk_reminder"]) assert.deepEqual(planForService(t, 20000, cfg), servicePlan(cfg));
  assert.equal(servicePlan(cfg).agentSharePct, 97.5);
});

test("split: a higher fee costs the agent proportionally (the fee is shared), and the platform cut can be changed in config", () => {
  const s = settledAmounts({ grossMinor: 20000, feeMinor: 400, agentSharePct: complianceReportPlan(20000, cfg).agentSharePct });
  assert.equal(s.agentMinor + s.platformMinor + 400, 20000);
  const cheaper = mergeConfig({ prices: { reportPlatformPct: 10 } } as never);
  assert.ok(complianceReportPlan(20000, cheaper).agentSharePct > complianceReportPlan(20000, cfg).agentSharePct);
  const nothing = mergeConfig({ prices: { reportPlatformPct: 99 } } as never);
  assert.equal(complianceReportPlan(20000, nothing).agentSharePct, 0);
});

test("a paid ticket becomes a compliance_report call carrying the ticket id; an incomplete ticket is refused", () => {
  const params = { reportType: "mri_monthly", propertyId: "3", month: "2026-10" };
  const call = buildDelegateCall("compliance_report", {}, { ticketId: "T1", params });
  assert.equal(call.action, "compliance_report");
  assert.deepEqual(call.payload, { ...params, ticketId: "T1", dryRun: false });
  assert.throws(() => buildDelegateCall("compliance_report", {}), DeskError);
  assert.throws(() => buildDelegateCall("compliance_report", {}, { ticketId: "T1", params: { reportType: "mri_monthly" } }), DeskError);
  assert.throws(() => buildDelegateCall("compliance_report", {}, { ticketId: "", params }), DeskError);
});

// ---- the quote-time preview: nobody pays for a report that cannot be made
function product(result: unknown, status = 200) {
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  const c = { ...cfg, delegate: { ...cfg.delegate, pms: "https://pms.example/deskDelegate" } };
  const delegate = {
    getIdToken: async () => "t",
    fetchImpl: (async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body); calls.push({ action: b.action, payload: b.payload }); return new Response(JSON.stringify(status === 200 ? { ok: true, result } : { ok: false, error: result }), { status }); }) as unknown as typeof fetch,
  };
  return { calls, c, delegate };
}
const base = (c: typeof cfg, delegate: unknown) => ({ cfg: c, product: "pms" as const, entityKey: "pms:PYL-0001", agentCode: "COG-0001", delegate: delegate as never });

test("preview: a dry run on Plot Yangu with synced records passes; it never asks the product to make anything", async () => {
  const { calls, c, delegate } = product({ ready: true, property: "Sunrise", tenants: 12 });
  const out = await previewComplianceReport({ ...base(c, delegate), reportType: "mri_monthly", propertyId: "3", month: "2026-10" });
  assert.equal(out.ready, true);
  assert.deepEqual(calls, [{ action: "compliance_report", payload: { dryRun: true, reportType: "mri_monthly", propertyId: "3", month: "2026-10" } }]);
});
test("preview: nothing synced, a refusal, or another product stops the quote", async () => {
  const none = product({ ready: false });
  await assert.rejects(() => previewComplianceReport({ ...base(none.c, none.delegate), reportType: "mri_monthly", propertyId: "3", month: "2026-10" }), /nothing to report on/);
  const refused = product({ code: "failed_precondition", message: "There are no synced tenant or invoice records for this property." }, 400);
  await assert.rejects(() => previewComplianceReport({ ...base(refused.c, refused.delegate), reportType: "mri_monthly", propertyId: "3", month: "2026-10" }), DeskError);
  const chama = product({ ready: true });
  await assert.rejects(() => previewComplianceReport({ ...base(chama.c, chama.delegate), product: "chama", entityKey: "chama:SMC-0001", reportType: "mri_monthly", propertyId: "3", month: "2026-10" }), /Plot Yangu customers only/);
  assert.equal(chama.calls.length, 0);
});
test("the property list comes from the product and is cleaned", async () => {
  const { calls, c, delegate } = product({ properties: [{ id: 3, name: "Sunrise" }, { id: "4", name: "Palm" }], ready: false });
  const out = await listReportProperties(base(c, delegate));
  assert.deepEqual(out, { properties: [{ id: "3", name: "Sunrise" }, { id: "4", name: "Palm" }] });
  assert.deepEqual(calls[0].payload, { dryRun: true });
  const empty = product({});
  assert.deepEqual(await listReportProperties(base(empty.c, empty.delegate)), { properties: [] });
});
