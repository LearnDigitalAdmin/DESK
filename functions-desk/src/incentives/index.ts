import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { DESK_REGION } from "../contract.js";
import { col, getConfig } from "../db.js";
import { paystackTransfers } from "../payouts/paystack.js";
import { AUTO_PAYOUT_KINDS, payEntry, type PayoutDeps } from "../payouts/payout.js";

import { monthOf, prevMonth } from "../network/pure.js";
import { closeMonth } from "./close.js";
import { BUNDLE_SECRETS } from "../kernel/secretsBundle.js";

const deps = (): PayoutDeps => ({ now: () => Date.now(), getConfig, transfers: paystackTransfers });

/** 04:00 Nairobi on the 2nd: closes last month (incentives, margin governor, one payable row per agent). Safe to re-run. */
export const desk_closeMonth = onSchedule(
  { schedule: "0 4 2 * *", timeZone: "Africa/Nairobi", region: DESK_REGION, timeoutSeconds: 540, memory: "512MiB" },
  async () => { const r = await closeMonth(prevMonth(monthOf(Date.now())), Date.now()); logger.info("close month result", r); },
);

/**
 * 09:00 Nairobi every day: pays payable `network` rows by Paystack transfer (M-PESA), oldest first, within the top desk's daily payout cap.
 * Rows the cap or a transient failure leaves behind are simply retried the next day. Bonus and support payouts stay manual.
 */
export const desk_autoPayout = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Africa/Nairobi", region: DESK_REGION, secrets: BUNDLE_SECRETS, timeoutSeconds: 540, memory: "256MiB" },
  async () => {
    const d = deps(); const cfg = await d.getConfig();
    const snap = await col("ledger").where("kind", "in", AUTO_PAYOUT_KINDS as string[]).where("status", "==", "payable").orderBy("createdAt").limit(100).get();
    let paid = 0, failed = 0;
    for (const row of snap.docs) {
      const r = await payEntry(d, row.id, cfg.topDesk.dailyPayoutCapMinor);
      if (r.status === "failed") { failed++; if (/payout limit/i.test(r.error ?? "")) break; } else paid++;
    }
    logger.info("auto payout run", { candidates: snap.size, paid, failed });
  },
);
