import { onCall } from "firebase-functions/v2/https";
import type { QuoteServiceIn, QuoteServiceOut, ReportPropertiesIn, ReportPropertiesOut, SaveDraftIn, SaveDraftOut } from "../contract.js";
import { DESK_REGION } from "../contract.js";
import { deskCallable } from "../charge/callable.js";
import { quoteService } from "./quoteService.js";
import { reportProperties } from "./reportProperties.js";
import { saveDraft } from "./saveDraft.js";

/** Quote a desk service (prices only from config; bulk reminders use the product's real recipient count). */
export const desk_quoteService = onCall<QuoteServiceIn, Promise<QuoteServiceOut>>(
  { region: DESK_REGION, cors: true, timeoutSeconds: 90 },
  deskCallable((uid, data) => quoteService(uid, data)),
);

/** Save the ticket's draft as chunks (≤ 500 KB each, ≤ 20 chunks), replacing any earlier draft atomically. */
export const desk_saveDraft = onCall<SaveDraftIn, Promise<SaveDraftOut>>(
  { region: DESK_REGION, cors: true, timeoutSeconds: 120, memory: "512MiB" },
  deskCallable((uid, data) => saveDraft(uid, data)),
);

/** The customer's Plot Yangu properties, for choosing a compliance report (scope "report"). */
export const desk_reportProperties = onCall<ReportPropertiesIn, Promise<ReportPropertiesOut>>(
  { region: DESK_REGION, cors: true, timeoutSeconds: 60 },
  deskCallable((uid, data) => reportProperties(uid, data)),
);
