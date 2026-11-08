import type { ReportPropertiesOut } from "../contract.js";
import { DeskError } from "../errors.js";
import { requireActiveAgent } from "../kernel/agents.js";
import { requireSession } from "../kernel/session.js";
import { resolveDeps, type DeskDeps } from "../charge/port.js";
import { listReportProperties } from "./complianceReport.js";

/** desk_reportProperties: agent -> session with scope "report" -> the product lists the customer's properties. Makes and charges nothing. */
export async function reportProperties(uid: string, data: unknown, deps: DeskDeps = {}): Promise<ReportPropertiesOut> {
  const d = resolveDeps(deps);
  const sessionId = (data as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length < 1 || sessionId.length > 128 || sessionId.includes("/")) throw new DeskError("invalid_argument", "A valid session is required");
  const agent = await requireActiveAgent(uid);
  const ctx = await requireSession({ sessionId, uid, scope: "report" });
  const cfg = await d.config();
  return listReportProperties({ cfg, product: ctx.product, entityKey: ctx.entityKey, agentCode: agent.agentCode, delegate: d.delegate });
}
