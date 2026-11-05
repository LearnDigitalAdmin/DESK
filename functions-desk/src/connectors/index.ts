import { onDocumentWritten } from "firebase-functions/v2/firestore";
import type {
  ResolveEntityIn, ResolveEntityOut, SyncPayoutAccountsIn, SyncPayoutAccountsOut, ValidateImportIn, ValidateImportOut,
} from "../contract.js";
import { DESK_COLLECTIONS } from "../contract.js";

import { deskCallable } from "./common.js";
import { defaultDeps } from "./deps.js";
import { resolveEntity, validateImport } from "./resolve.js";
import { syncPayoutAccounts } from "./payout.js";
import { executePaidTicket } from "./tickets.js";
import { BUNDLE_SECRETS } from "../kernel/secretsBundle.js";

export const desk_resolveEntity = deskCallable<ResolveEntityIn, ResolveEntityOut>(
  { timeoutSeconds: 90 },
  (uid, data) => resolveEntity(defaultDeps(), uid, data),
);

export const desk_validateImport = deskCallable<ValidateImportIn, ValidateImportOut>(
  { timeoutSeconds: 120 },
  (uid, data) => validateImport(defaultDeps(), uid, data),
);

export const desk_syncPayoutAccounts = deskCallable<SyncPayoutAccountsIn, SyncPayoutAccountsOut>(
  { secrets: BUNDLE_SECRETS, timeoutSeconds: 120 },
  (uid) => syncPayoutAccounts(defaultDeps(), uid),
);

/**
 * Fires when a desk ticket becomes `paid` and runs it through the product. `retry` re-delivers after a transient failure
 * (the product could not be reached); executePaidTicket caps the attempts and is idempotent.
 */
export const desk_onTicketPaid = onDocumentWritten(
  { document: `${DESK_COLLECTIONS.tickets}/{ticketId}`, retry: true, timeoutSeconds: 300 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || after.status !== "paid" || before?.status === "paid") return;
    await executePaidTicket(defaultDeps(), event.params.ticketId);
  },
);
