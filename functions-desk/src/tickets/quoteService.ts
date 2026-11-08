import type { QuoteServiceOut } from "../contract.js";
import { col } from "../db.js";
import { parseEntityKey } from "../entity.js";
import { requireActiveAgent } from "../kernel/agents.js";
import { audit } from "../kernel/audit.js";
import { requireSession } from "../kernel/session.js";
import { resolveDeps, type DeskDeps } from "../charge/port.js";
import { measureBulkReminder } from "./bulk.js";
import { previewComplianceReport } from "./complianceReport.js";
import { SERVICE_SCOPE, type DeskTicket } from "./model.js";
import { parseParams, parseQuoteEnvelope, priceService, type BulkMeasure } from "./quote.js";

/** desk_quoteService: Auth (done by the callable) -> active agent -> session -> validate -> price from config -> draft ticket. */
export async function quoteService(uid: string, data: unknown, deps: DeskDeps = {}): Promise<QuoteServiceOut> {
  const d = resolveDeps(deps);
  const env = parseQuoteEnvelope(data);
  const agent = await requireActiveAgent(uid);
  const ctx = await requireSession({ sessionId: env.sessionId, uid, scope: SERVICE_SCOPE[env.serviceType] });
  const params = parseParams(env.serviceType, env.rawParams);
  const cfg = await d.config();

  let bulk: BulkMeasure | undefined;
  if (env.serviceType === "bulk_reminder") {
    const m = await measureBulkReminder({
      cfg, product: ctx.product, entityKey: ctx.entityKey, agentCode: agent.agentCode,
      audience: params.audience as string, message: params.message as string, delegate: d.delegate,
    });
    bulk = { recipients: m.recipients, credits: m.credits };
  }
  if (env.serviceType === "compliance_report") {
    // Plot Yangu only, and only when the property has synced records: nobody should pay for a report that cannot be made.
    await previewComplianceReport({
      cfg, product: ctx.product, entityKey: ctx.entityKey, agentCode: agent.agentCode,
      reportType: String(params.reportType), propertyId: String(params.propertyId), month: String(params.month), delegate: d.delegate,
    });
  }
  const { lines, amountMinor } = priceService(env.serviceType, params, cfg, bulk);

  const ref = col("tickets").doc();
  const now = d.now();
  const ticket: DeskTicket = {
    ticketId: ref.id, agentId: uid, entityKey: ctx.entityKey, sessionId: ctx.sessionId,
    serviceType: env.serviceType, amountMinor, draft: {}, status: "draft",
    params, breakdown: lines, createdAt: now, updatedAt: now,
    ...(bulk ? { recipients: bulk.recipients, credits: bulk.credits } : {}),
  };
  await ref.create(ticket);
  await audit({
    action: "ticket_quoted", agentId: uid, entityKey: ctx.entityKey, sessionId: ctx.sessionId,
    meta: { ticketId: ref.id, serviceType: env.serviceType, amountMinor, product: parseEntityKey(ctx.entityKey).product, ...(bulk ?? {}) },
  });
  return { ticketId: ref.id, amountMinor, breakdown: lines };
}
