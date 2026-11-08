/**
 * Shared shapes for desk service tickets (W1-B). The kernel's `TicketDoc` is the base; the money backend adds the
 * fields it needs to quote, charge, reconcile and settle a ticket. Everything here is server-side only.
 */
import type { QuoteBreakdownLine, Scope, ServiceType } from "../contract.js";
import type { TicketDoc } from "../types.js";

export const SERVICE_TYPES: readonly ServiceType[] = ["import_excel", "manual_entry", "schedule_setup", "bulk_reminder", "compliance_report"];

/** The session scope each service needs (bulk_reminder uses the schedule scope; its per-action OTP is a separate gate). */
export const SERVICE_SCOPE: Readonly<Record<ServiceType, Scope>> = {
  import_excel: "import",
  manual_entry: "manual_entry",
  schedule_setup: "schedule",
  bulk_reminder: "schedule",
  compliance_report: "report",
};
export const COMPLIANCE_REPORT_TYPES = ["mri_monthly", "annual_summary"] as const;

/** Largest row / record count a quote accepts. */
export const MAX_QUOTE_COUNT = 100_000;
export const MAX_AUDIENCE_LENGTH = 100;
/** HostPinnacle's single-message limit, the same 385 the kernel SMS client enforces. */
export const BULK_MESSAGE_MAX = 385;

export interface DeskTicket extends TicketDoc {
  /** The validated quote parameters. For bulk_reminder these (audience, message) are what is sent after payment. */
  params: Record<string, number | string>;
  breakdown: QuoteBreakdownLine[];
  /** bulk_reminder only: what the product's dry run reported at quote time. */
  recipients?: number;
  credits?: number;
  /** The agent share (%) that went into the Paystack split for this ticket; settlement uses it, not today's config. */
  sharePct?: number;
  /** Payment attempts so far; every attempt has its own reference CYBER_DSK_<ticketId>_<attempt>. */
  attempts?: number;
  attemptRefs?: string[];
  chargeStartedAt?: number;
  paidAt?: number;
  /** References that paid a ticket which was already paid (a second STK that also succeeded): needs a manual refund. */
  duplicateRefs?: string[];
  /** Number of chunks / bytes of the saved draft (the chunks live in desk_tickets/{id}/draft). */
  draftChunks?: number;
  draftBytes?: number;
}

export const isSettled = (s: TicketDoc["status"]): boolean => s === "paid" || s === "committed";
