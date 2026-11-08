/**
 * Compliance reports (MRI working paper, annual summary) are a PAID desk service, never free, Plot Yangu only. Before anyone is asked
 * to pay, the product itself checks there are synced records to report on (compliance_report with dryRun: true makes and charges nothing).
 */
import type { DeskConfig } from "../config.js";
import type { Product } from "../contract.js";
import { DeskError } from "../errors.js";
import { parseEntityKey } from "../entity.js";
import { callDelegate, type DelegateOptions } from "../kernel/delegate.js";

export interface PreviewArgs {
  cfg: DeskConfig; product: Product; entityKey: string; agentCode: string;
  reportType: string; propertyId: string; month: string; delegate?: DelegateOptions;
}
export interface ReportPreview { ready: boolean; property?: string; tenants?: number }

export async function previewComplianceReport(a: PreviewArgs): Promise<ReportPreview> {
  if (a.product !== "pms") throw new DeskError("failed_precondition", "Compliance reports are available for Plot Yangu customers only");
  const out = await callDelegate<ReportPreview>(a.cfg, a.product, {
    entityCode: parseEntityKey(a.entityKey).code, agentCode: a.agentCode, action: "compliance_report",
    payload: { dryRun: true, reportType: a.reportType, propertyId: a.propertyId, month: a.month },
  }, a.delegate);
  if (!out || out.ready !== true) throw new DeskError("failed_precondition", "There is nothing to report on for this property and month. Ask the landlord to turn on cloud sync first.");
  return out;
}

/** The properties the customer has on Plot Yangu, for the agent to choose from (a dry run: nothing is made or charged). */
export async function listReportProperties(a: Omit<PreviewArgs, "reportType" | "propertyId" | "month">): Promise<{ properties: { id: string; name: string }[] }> {
  if (a.product !== "pms") throw new DeskError("failed_precondition", "Compliance reports are available for Plot Yangu customers only");
  const out = await callDelegate<{ properties?: { id: string; name: string }[] }>(a.cfg, a.product, {
    entityCode: parseEntityKey(a.entityKey).code, agentCode: a.agentCode, action: "compliance_report", payload: { dryRun: true },
  }, a.delegate);
  return { properties: Array.isArray(out?.properties) ? out.properties.map((p) => ({ id: String(p.id), name: String(p.name) })) : [] };
}
