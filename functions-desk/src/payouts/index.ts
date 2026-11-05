import { onSchedule } from "firebase-functions/v2/scheduler";
import type { TopListPayablesIn, TopListPayablesOut, TopPayoutIn, TopPayoutOut } from "../contract.js";
import { DESK_REGION } from "../contract.js";
import { getConfig } from "../db.js";

import { topCallable } from "../topdesk/callable.js";
import { paystackTransfers } from "./paystack.js";
import { topListPayables, topPayout, type PayoutDeps } from "./payout.js";
import { reconcilePayouts } from "./reconcile.js";
import { prepareSupportPayables } from "./support.js";
import { BUNDLE_SECRETS } from "../kernel/secretsBundle.js";

const deps = (): PayoutDeps => ({ now: () => Date.now(), getConfig, transfers: paystackTransfers });

export const desk_top_listPayables = topCallable<TopListPayablesIn, TopListPayablesOut>({}, (auth) => topListPayables(deps(), auth));

// Up to 50 sequential transfers, each with 2-3 Paystack calls.
export const desk_top_payout = topCallable<TopPayoutIn, TopPayoutOut>(
  { secrets: BUNDLE_SECRETS, timeoutSeconds: 300 }, (auth, data) => topPayout(deps(), auth, data));

/** Every 10 minutes: settles `processing` payouts against Paystack Transfers verification. */
export const desk_reconcilePayouts = onSchedule(
  { schedule: "every 10 minutes", region: DESK_REGION, secrets: BUNDLE_SECRETS, timeoutSeconds: 300, memory: "256MiB" },
  async () => { await reconcilePayouts(deps()); },
);

/** 1st of the month 06:00 Nairobi: one payable support row per desk for the previous month. Moves no money. */
export const desk_prepareSupportPayables = onSchedule(
  { schedule: "0 6 1 * *", timeZone: "Africa/Nairobi", region: DESK_REGION, timeoutSeconds: 540, memory: "512MiB" },
  async () => { await prepareSupportPayables({ now: () => Date.now(), getConfig }); },
);
