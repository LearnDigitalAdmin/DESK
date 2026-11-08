/**
 * Executes a PAID desk ticket through the product's delegate. The product runs its own rules; desk records the outcome.
 * Idempotent: the delegate call carries requestId = ticketId (a repeat never repeats the effect) and the final status
 * is written only while the ticket is still `paid`.
 */
import type {
  DelegateAction, DelegateCommitPayload, DelegateSchedulePayload, DelegateSendPayload, ImportRow, ServiceType,
} from "../contract.js";
import { col, db } from "../db.js";
import { DeskError } from "../errors.js";
import { parseEntityKey } from "../entity.js";
import { audit } from "../kernel/audit.js";
import type { AgentDoc, TicketDoc } from "../types.js";
import type { Deps } from "./deps.js";

export const MAX_EXECUTION_ATTEMPTS = 5;
const MAX_STORED_ERRORS = 200;

/**
 * Drafts live inline on the ticket and, when large, in `desk_tickets/{id}/draft/{0000..}`. Chunks are read in id order and
 * every chunk's `rows` are appended to the inline `rows`. Pure.
 */
export function assembleDraft(inline: Record<string, unknown> | undefined, chunks: readonly Record<string, unknown>[]): Record<string, unknown> {
  const draft: Record<string, unknown> = { ...(inline ?? {}) };
  const rows: unknown[] = Array.isArray(draft.rows) ? [...(draft.rows as unknown[])] : [];
  for (const c of chunks) if (Array.isArray(c.rows)) rows.push(...(c.rows as unknown[]));
  if (rows.length > 0 || "rows" in draft) draft.rows = rows;
  return draft;
}

export interface DelegateCall { action: DelegateAction; payload: Record<string, unknown> }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const incomplete = () => new DeskError("invalid_argument", "The saved request is incomplete, so it could not be run. Please contact support.");

/** service type -> delegate action + payload. import/manual -> commit_records, schedule -> schedule_sms, reminder -> send_sms_now. Pure. */
export function buildDelegateCall(serviceType: ServiceType, draft: Record<string, unknown>, ticket?: { ticketId: string; params: Record<string, number | string> }): DelegateCall {
  switch (serviceType) {
    case "import_excel":
    case "manual_entry": {
      const rows = draft.rows;
      if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isObj)) throw incomplete();
      const payload: DelegateCommitPayload = { rows: rows as ImportRow[], source: serviceType === "import_excel" ? "excel" : "manual" };
      return { action: "commit_records", payload: { ...payload } };
    }
    case "schedule_setup": {
      const s = draft.schedule;
      const kinds = ["once", "daily", "weekly", "monthly"];
      if (!str(draft.name) || !str(draft.message) || !str(draft.audience) || !isObj(s) || !kinds.includes(s.kind as string) || !str(s.at)) throw incomplete();
      const days = Array.isArray(s.days) && s.days.every((n) => typeof n === "number") ? (s.days as number[]) : undefined;
      const memberIds = Array.isArray(draft.memberIds) && draft.memberIds.every(str) ? (draft.memberIds as string[]) : undefined;
      const payload: DelegateSchedulePayload = {
        name: draft.name as string, message: draft.message as string, audience: draft.audience as string,
        ...(memberIds ? { memberIds } : {}),
        schedule: { kind: s.kind as "once" | "daily" | "weekly" | "monthly", at: s.at as string, ...(days ? { days } : {}) },
      };
      return { action: "schedule_sms", payload: { ...payload } };
    }
    case "bulk_reminder": {
      if (!str(draft.message) || !str(draft.audience)) throw incomplete();
      const memberIds = Array.isArray(draft.memberIds) && draft.memberIds.every(str) ? (draft.memberIds as string[]) : undefined;
      // dryRun is forced off: the customer already approved the send with their per-action OTP at charge time.
      const payload: DelegateSendPayload = { message: draft.message as string, audience: draft.audience as string, ...(memberIds ? { memberIds } : {}), dryRun: false };
      return { action: "send_sms_now", payload: { ...payload } };
    }
    case "compliance_report": {
      // Everything needed was validated at quote time and lives on the ticket (params), not in a draft. Only reached for a PAID ticket.
      const p = ticket?.params;
      if (!p || !str(p.reportType) || !str(p.propertyId) || !str(p.month) || !ticket?.ticketId) throw incomplete();
      return { action: "compliance_report", payload: { reportType: p.reportType, propertyId: p.propertyId, month: p.month, ticketId: ticket.ticketId, dryRun: false } };
    }
    default:
      throw incomplete();
  }
}

/** Keeps the stored copy of a product result well under Firestore's document limit. Pure. */
export function compactResult(result: unknown): unknown {
  if (!isObj(result) || !Array.isArray(result.errors) || result.errors.length <= MAX_STORED_ERRORS) return result;
  return { ...result, errors: result.errors.slice(0, MAX_STORED_ERRORS), errorsTotal: result.errors.length };
}

export type ExecuteOutcome = "skipped" | "committed" | "failed";

async function finalize(ticketId: string, patch: Record<string, unknown>, now: number): Promise<boolean> {
  const ref = col("tickets").doc(ticketId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || (snap.data() as TicketDoc).status !== "paid") return false;
    tx.update(ref, { ...patch, updatedAt: now });
    return true;
  });
}

async function bumpAttempts(ticketId: string): Promise<number> {
  const ref = col("tickets").doc(ticketId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = ((snap.data()?.executionAttempts as number | undefined) ?? 0) + 1;
    tx.update(ref, { executionAttempts: n });
    return n;
  });
}

export async function executePaidTicket(deps: Deps, ticketId: string): Promise<ExecuteOutcome> {
  const snap = await col("tickets").doc(ticketId).get();
  if (!snap.exists) return "skipped";
  const ticket = snap.data() as TicketDoc;
  if (ticket.status !== "paid") return "skipped";

  const fail = async (message: string): Promise<ExecuteOutcome> => {
    const done = await finalize(ticketId, { status: "failed", failureReason: message }, deps.now());
    if (!done) return "skipped";
    await audit({ action: "ticket_failed", agentId: ticket.agentId, entityKey: ticket.entityKey, meta: { ticketId, serviceType: ticket.serviceType, reason: message } });
    return "failed";
  };

  const agentSnap = await col("agents").doc(ticket.agentId).get();
  if (!agentSnap.exists) return fail("The desk that bought this service no longer exists. Please contact support.");
  const agent = agentSnap.data() as AgentDoc;

  let call: DelegateCall;
  let entity: { product: ReturnType<typeof parseEntityKey>["product"]; code: string };
  try {
    const chunkSnap = await col("tickets").doc(ticketId).collection("draft").get();
    const chunks = chunkSnap.docs.sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => d.data());
    call = buildDelegateCall(ticket.serviceType, assembleDraft(ticket.draft, chunks), { ticketId, params: (ticket as { params?: Record<string, number | string> }).params ?? {} });
    entity = parseEntityKey(ticket.entityKey);
  } catch (err) {
    return fail(err instanceof DeskError ? err.message : "The saved request could not be read. Please contact support.");
  }

  const cfg = await deps.getConfig();
  try {
    const result = await deps.delegate<unknown>(cfg, entity.product, {
      action: call.action, entityCode: entity.code, agentCode: agent.agentCode, requestId: ticketId, payload: call.payload,
    });
    const done = await finalize(ticketId, { status: "committed", productResult: compactResult(result), committedAt: deps.now() }, deps.now());
    if (!done) return "skipped";
    await audit({ action: "ticket_committed", agentId: ticket.agentId, entityKey: ticket.entityKey, meta: { ticketId, serviceType: ticket.serviceType, productAction: call.action } });
    return "committed";
  } catch (err) {
    if (!(err instanceof DeskError)) throw err;
    if (err.code !== "internal") return fail(err.message); // the product refused: its message is the reason
    // Could not reach the product: let the trigger retry, up to a limit.
    const attempts = await bumpAttempts(ticketId);
    if (attempts < MAX_EXECUTION_ATTEMPTS) throw err;
    return fail("The service could not be reached after several tries. Please contact support; your payment is on record.");
  }
}
