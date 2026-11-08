/**
 * Pure money logic. No Firebase imports. Integer minor units only (KES x 100).
 *
 * HOW MONEY MOVES (nothing here pays anyone): every desk charge is a Paystack PERCENTAGE split with
 * bearer_type "all-proportional" (the same model PAY's chargeCustomer already uses). Paystack therefore
 *   1. deducts its real fee, shared across the parties in proportion to their shares, and
 *   2. settles each party's share automatically.
 * An agent with share S% receives exactly S% of (gross - real fee). These functions only (a) choose the
 * share % to put in the split and (b) compute what each party netted so the ledger can record it.
 */
import type { DeskConfig } from "./config.js";
import type { Rank } from "./contract.js";

export function assertMinor(n: number, label = "amount"): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${label} must be a non-negative integer minor unit, got ${n}`);
}
/** 97.5 -> 9750 basis points. Shares are kept to 0.01%. */
export const toBps = (pct: number): number => Math.round(pct * 100);
/** Never overpay an agent: round DOWN to 0.01%. The epsilon guards binary-float artefacts (71.03 * 100). */
export const floorPct2 = (pct: number): number => Math.floor(pct * 100 + 1e-9) / 100;
export const roundPct2 = (pct: number): number => Math.round(pct * 100) / 100;

export function pctHalfUp(amount: number, pct: number): number {
  return Math.floor((amount * toBps(pct) + 5000) / 10000);
}
export function formatKes(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}KES ${whole}.${String(abs % 100).padStart(2, "0")}`;
}

export type SplitRule =
  | "service" | "subscription" | "report" | "sms_standard" | "sms_first_purchase" | "rent" | "no_margin";
export interface SplitPlan { agentSharePct: number; rule: SplitRule }

// -------------------------------------------------- A. desk services (CYBER_ charge)
/** Agent keeps everything except the platform cut, which is taken AFTER Paystack's fee. */
export function servicePlan(cfg: DeskConfig): SplitPlan {
  return { agentSharePct: floorPct2(100 - cfg.platformCutPct), rule: "service" };
}

/**
 * Compliance report (MRI working paper / annual summary): the agent keeps the price less Paystack (1.5%) less the platform cut (15%) =
 * 83.5% of the price (KES 167.00 of KES 200). Charges use a Paystack percentage split with the fee shared proportionally, so the
 * agent's share of what Paystack settles is (price - fee - platform) / (price - fee), rounded DOWN (an agent is never overpaid).
 */
export function complianceReportPlan(grossMinor: number, cfg: DeskConfig): SplitPlan {
  assertMinor(grossMinor, "gross");
  const fee = Math.round((grossMinor * cfg.expectedPaystackFeePct) / 100);
  const platform = pctHalfUp(grossMinor, cfg.prices.reportPlatformPct);
  const base = grossMinor - fee;
  if (base <= platform) return { agentSharePct: 0, rule: "service" };
  return { agentSharePct: floorPct2(((base - platform) / base) * 100), rule: "service" };
}
/** The split for any desk service ticket. Compliance reports have their own; everything else keeps the flat platform cut. */
export function planForService(serviceType: string, grossMinor: number, cfg: DeskConfig): SplitPlan {
  return serviceType === "compliance_report" ? complianceReportPlan(grossMinor, cfg) : servicePlan(cfg);
}

// -------------------------------------------------- C. subscriptions and reports
export function sharePlan(rank: Rank, kind: "subscription" | "report", cfg: DeskConfig): SplitPlan {
  const pct = (kind === "subscription" ? cfg.subShareByRank : cfg.reportShareByRank)[rank];
  return { agentSharePct: floorPct2(pct), rule: kind };
}

// -------------------------------------------------- B. SMS credit purchases
export const creditsFor = (grossMinor: number, ratePerCreditMinor: number): number => {
  if (ratePerCreditMinor <= 0) throw new RangeError("rate must be positive");
  return Math.floor(grossMinor / ratePerCreditMinor);
};
/**
 * Agent target net = s * (gross - fee - creditCost), s = 40% (standard) or 100% (first school/PMS purchase under
 * the threshold). With proportional fee bearing the agent nets a * (gross - fee), so a = s * (1 - cost / (gross - fee)).
 * The fee is only needed here, to turn a margin share into a share of the gross; it uses the configured expected
 * Paystack fee. If the real fee differs the error is second-order (fee delta x (a - s)), a few cents at most.
 */
export function smsPlan(
  p: { grossMinor: number; credits: number; firstPurchaseEligible: boolean }, cfg: DeskConfig,
): SplitPlan {
  assertMinor(p.grossMinor, "gross"); assertMinor(p.credits, "credits");
  const expectedFee = Math.round((p.grossMinor * cfg.expectedPaystackFeePct) / 100);
  const base = p.grossMinor - expectedFee;
  const cost = p.credits * cfg.creditCostMinor;
  if (base <= cost) return { agentSharePct: 0, rule: "no_margin" };
  const first = p.firstPurchaseEligible && p.grossMinor < cfg.firstPurchaseThresholdMinor;
  const s = first ? 1 : cfg.smsShareOfMarginPct / 100;
  return { agentSharePct: floorPct2(s * (1 - cost / base) * 100), rule: first ? "sms_first_purchase" : "sms_standard" };
}

// -------------------------------------------------- D. rent STK (Plot Yangu)
/** Plot Yangu's take on a rent payment: rate (0.7%-2% by tier) of rent, capped per transaction. */
export function rentTake(rentMinor: number, ratePct: number, cfg: DeskConfig): number {
  assertMinor(rentMinor, "rent");
  return Math.min(pctHalfUp(rentMinor, ratePct), cfg.rentTakeCapMinor);
}
export interface RentPlan { landlordSharePct: number; agentSharePct: number; platformSharePct: number; takeMinor: number }
/** Three-way split: landlord (100 - take%), desk agent (30% of take%), Samuhia (the rest). */
export function rentPlan(p: { rentMinor: number; takeMinor: number }, cfg: DeskConfig): RentPlan {
  if (!Number.isSafeInteger(p.rentMinor) || p.rentMinor <= 0) throw new RangeError("rent must be a positive integer");
  const takeMinor = Math.min(p.takeMinor, cfg.rentTakeCapMinor);
  const takePct = (takeMinor / p.rentMinor) * 100;
  const agentSharePct = floorPct2((takePct * cfg.rentDeskSharePct) / 100);
  const landlordSharePct = roundPct2(100 - takePct);
  const platformSharePct = roundPct2(100 - landlordSharePct - agentSharePct);
  if (platformSharePct < 0 || landlordSharePct <= 0) throw new RangeError("invalid rent split");
  return { landlordSharePct, agentSharePct, platformSharePct, takeMinor };
}

// -------------------------------------------------- recording what a CONFIRMED charge paid
export interface Settled { netMinor: number; agentMinor: number; platformMinor: number }
/** From the webhook's real gross and fee: the agent's automatic payout, rounded down; remainder is Samuhia's. */
export function settledAmounts(p: { grossMinor: number; feeMinor: number; agentSharePct: number }): Settled {
  assertMinor(p.grossMinor, "gross"); assertMinor(p.feeMinor, "fee");
  if (p.feeMinor > p.grossMinor) throw new RangeError("fee exceeds gross");
  const netMinor = p.grossMinor - p.feeMinor;
  const agentMinor = Math.floor((netMinor * toBps(p.agentSharePct)) / 10000);
  return { netMinor, agentMinor, platformMinor: netMinor - agentMinor };
}

// -------------------------------------------------- service prices (customer pays, agent keeps all but the cut)
export const importPrice = (cfg: DeskConfig): number => cfg.prices.importMinor;
export const commsPrice = (cfg: DeskConfig): number => cfg.prices.commsMinor;
export const complianceReportPrice = (cfg: DeskConfig): number => cfg.prices.complianceReportMinor;
export function manualEntryPrice(records: number, cfg: DeskConfig):
  { tierMinor: number; serviceFeeMinor: number; totalMinor: number } {
  if (!Number.isInteger(records) || records < 1) throw new RangeError("records must be a positive integer");
  const tier = cfg.prices.manualTiers.find((t) => records <= t.upToRecords)
    ?? cfg.prices.manualTiers[cfg.prices.manualTiers.length - 1];
  const tierMinor = Math.min(tier.priceMinor, cfg.prices.manualCapMinor);
  const serviceFeeMinor = cfg.prices.manualServiceFeeMinor;
  return { tierMinor, serviceFeeMinor, totalMinor: tierMinor + serviceFeeMinor };
}

// -------------------------------------------------- E. milestone bonus (the ONLY manual payout)
export function milestoneNewBlocks(qualifyingAccounts: number, blocksAlreadyPaid: number, cfg: DeskConfig):
  { newBlocks: number; bonusMinor: number; maxBlocks: number } {
  const m = cfg.milestone;
  const maxBlocks = Math.floor(m.lifetimeCapMinor / m.bonusMinor);
  const earned = Math.min(Math.floor(qualifyingAccounts / m.blockSize), maxBlocks);
  const newBlocks = Math.max(0, earned - blocksAlreadyPaid);
  return { newBlocks, bonusMinor: newBlocks * m.bonusMinor, maxBlocks };
}
