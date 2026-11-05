import { onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { GetEarningsIn, GetEarningsOut } from "../contract.js";
import { DESK_REGION } from "../contract.js";
import { deskCallable } from "../charge/callable.js";
import { CYBER_TRANSACTIONS } from "../charge/cyberTransaction.js";

import { getEarnings } from "./earnings.js";
import { reconcileTickets } from "./reconcile.js";
import { handleCyberTransactionChange, type CyberTxData } from "./trigger.js";
import { BUNDLE_SECRETS } from "../kernel/secretsBundle.js";

/**
 * Fires on every write of a desk charge's cyber-transactions document (PAY's webhook moves its status). Re-verifies with Paystack,
 * then sets the ticket paid and writes exactly one service ledger row; failed/abandoned attempts fail the ticket.
 * Retried by the platform on transient errors; every step is idempotent.
 */
export const desk_onCyberTransaction = onDocumentWritten(
  { document: `${CYBER_TRANSACTIONS}/{reference}`, region: DESK_REGION, secrets: BUNDLE_SECRETS, retry: true, timeoutSeconds: 120 },
  async (event) => {
    const before = event.data?.before?.data() as CyberTxData | undefined;
    const after = event.data?.after?.data() as CyberTxData | undefined;
    await handleCyberTransactionChange(event.params.reference, before, after);
  },
);

/** Every 5 minutes: verifies awaiting tickets (recovers a missed webhook), expires dead ones and 24 h-old drafts. ≤ 100 per run. */
export const desk_reconcileTickets = onSchedule(
  { schedule: "every 5 minutes", region: DESK_REGION, secrets: BUNDLE_SECRETS, timeoutSeconds: 300, memory: "256MiB" },
  async () => { await reconcileTickets(); },
);

/** The caller's earnings for a range by status and stream, plus milestone-bonus progress. */
export const desk_getEarnings = onCall<GetEarningsIn, Promise<GetEarningsOut>>(
  { region: DESK_REGION, cors: true, timeoutSeconds: 60 },
  deskCallable((uid, data) => getEarnings(uid, data)),
);
