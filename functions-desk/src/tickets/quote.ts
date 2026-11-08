/** Pure quote logic: input validation and pricing. Prices come only from config, through the shared money functions. */
import type { DeskConfig } from "../config.js";
import type { QuoteBreakdownLine, ServiceType } from "../contract.js";
import { DeskError } from "../errors.js";
import { commsPrice, complianceReportPrice, importPrice, manualEntryPrice } from "../money.js";
import { BULK_MESSAGE_MAX, COMPLIANCE_REPORT_TYPES, MAX_AUDIENCE_LENGTH, MAX_QUOTE_COUNT, SERVICE_TYPES } from "./model.js";

const bad = (message: string): DeskError => new DeskError("invalid_argument", message);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export interface QuoteEnvelope { sessionId: string; serviceType: ServiceType; rawParams: Record<string, unknown> }

/** Shape of the callable's input, before any database access (the service type decides which scope is required). */
export function parseQuoteEnvelope(data: unknown): QuoteEnvelope {
  if (!isPlainObject(data)) throw bad("Invalid request");
  const { sessionId, serviceType, params } = data;
  if (typeof sessionId !== "string" || sessionId.length < 1 || sessionId.length > 128 || sessionId.includes("/"))
    throw bad("A valid session is required");
  if (typeof serviceType !== "string" || !SERVICE_TYPES.includes(serviceType as ServiceType)) throw bad("Unknown service");
  if (params !== undefined && !isPlainObject(params)) throw bad("Invalid service details");
  return { sessionId, serviceType: serviceType as ServiceType, rawParams: (params as Record<string, unknown> | undefined) ?? {} };
}

function positiveCount(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > MAX_QUOTE_COUNT)
    throw bad(`${label} must be a whole number between 1 and ${MAX_QUOTE_COUNT.toLocaleString("en-US")}`);
  return v;
}
function rejectExtra(raw: Record<string, unknown>, allowed: readonly string[], service: string): void {
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) throw bad(`"${k}" is not a valid detail for ${service}`);
}

/** Validates and normalises the per-service parameters. The returned object is what the ticket stores. */
export function parseParams(serviceType: ServiceType, raw: Record<string, unknown>): Record<string, number | string> {
  switch (serviceType) {
    case "import_excel":
      rejectExtra(raw, ["rowCount"], "an Excel import");
      return { rowCount: positiveCount(raw.rowCount, "Row count") };
    case "manual_entry":
      rejectExtra(raw, ["recordCount"], "manual entry");
      return { recordCount: positiveCount(raw.recordCount, "Record count") };
    case "schedule_setup":
      rejectExtra(raw, [], "a schedule setup");
      return {};
    case "compliance_report": {
      rejectExtra(raw, ["reportType", "propertyId", "month"], "a compliance report");
      const reportType = typeof raw.reportType === "string" ? raw.reportType : "";
      if (!(COMPLIANCE_REPORT_TYPES as readonly string[]).includes(reportType)) throw bad("Choose a report type");
      const propertyId = typeof raw.propertyId === "string" ? raw.propertyId.trim() : "";
      if (propertyId.length < 1 || propertyId.length > 60) throw bad("Choose a property");
      const month = typeof raw.month === "string" ? raw.month.trim() : "";
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "2016-01") throw bad("Choose a valid month");
      return { reportType, propertyId, month };
    }
    case "bulk_reminder": {
      rejectExtra(raw, ["audience", "message"], "a bulk reminder");
      const audience = typeof raw.audience === "string" ? raw.audience.trim() : "";
      if (audience.length < 1 || audience.length > MAX_AUDIENCE_LENGTH) throw bad("Choose who should receive the reminder");
      const message = typeof raw.message === "string" ? raw.message.trim() : "";
      if (message.length < 1 || message.length > BULK_MESSAGE_MAX)
        throw bad(`The message must be between 1 and ${BULK_MESSAGE_MAX} characters`);
      return { audience, message };
    }
  }
}

export interface BulkMeasure { recipients: number; credits: number }
export interface Priced { lines: QuoteBreakdownLine[]; amountMinor: number }

/** Server-side price. Every amount is an integer minor unit read from config; the total is the sum of the lines. */
export function priceService(
  serviceType: ServiceType, params: Record<string, number | string>, cfg: DeskConfig, bulk?: BulkMeasure,
): Priced {
  let lines: QuoteBreakdownLine[];
  switch (serviceType) {
    case "import_excel":
      lines = [{ label: `Excel import (${params.rowCount} rows)`, amountMinor: importPrice(cfg) }];
      break;
    case "manual_entry": {
      const records = params.recordCount as number;
      const p = manualEntryPrice(records, cfg);
      lines = [
        { label: `Manual entry (${records} ${records === 1 ? "record" : "records"})`, amountMinor: p.tierMinor },
        { label: "Service fee", amountMinor: p.serviceFeeMinor },
      ];
      break;
    }
    case "schedule_setup":
      lines = [{ label: "Schedule setup", amountMinor: commsPrice(cfg) }];
      break;
    case "compliance_report":
      lines = [{ label: `${params.reportType === "annual_summary" ? "Annual rental income summary" : "MRI working paper"} (${params.month})`, amountMinor: complianceReportPrice(cfg) }];
      break;
    case "bulk_reminder": {
      if (!bulk) throw new DeskError("internal", "Recipient count is missing for a bulk reminder");
      lines = [{ label: `Bulk reminder (${bulk.recipients} recipients, ${bulk.credits} credits)`, amountMinor: commsPrice(cfg) }];
      break;
    }
  }
  const amountMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new DeskError("internal", "This service has no valid price. Please contact Samuhia.");
  return { lines, amountMinor };
}
