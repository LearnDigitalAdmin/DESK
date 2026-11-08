import type { Product, Rank } from "./contract.js";

/** Runtime-editable in `desk_config/global` (admin dash only). Money in minor units, rates in percent. */
export interface DeskConfig {
  creditCostMinor: number;               // what Samuhia pays per SMS credit: KES 0.20 = 20
  platformCutPct: number;                // CYBER_ charge cut, taken after Paystack fees (PAY chargeCustomer uses 2.5)
  expectedPaystackFeePct: number;        // only used to derive SMS margin shares (1.5)
  smsShareOfMarginPct: number;           // 40
  firstPurchaseThresholdMinor: number;   // 20000 = KES 200
  subShareByRank: Record<Rank, number>;  // % of net after fees
  reportShareByRank: Record<Rank, number>;
  rentDeskSharePct: number;              // 30 (% of Plot Yangu's take)
  rentTakeCapMinor: number;              // 25000 = KES 250 per transaction
  milestone: { blockSize: number; bonusMinor: number; lifetimeCapMinor: number; minPaidMonths: number };
  /** Which Paystack account each product charges through. "separate" = its own account (agent needs a subaccount there too). */
  paystackAccounts: Record<Product, "main" | "separate">;
  /** Firebase project IDs of the Chama and Register projects (desk reads them; they never access desk). */
  projects: { chama: string; school: string };
  /** Top-desk controls. */
  topDesk: { dailyPayoutCapMinor: number };
  /** Base URL of each product's private `deskDelegate` function. Set by the owner after the product patch is deployed. */
  delegate: Record<Product, string>;
  /** Support payouts (automatic monthly Paystack transfer). A rate of 0 disables payouts. */
  support: { rateMinorPerConfirmed: number; maxConfirmedPerDay: number; monthlyCapMinor: number };
  prices: {
    importMinor: number;                 // 20000
    manualTiers: { upToRecords: number; priceMinor: number }[];
    manualCapMinor: number;              // 100000
    manualServiceFeeMinor: number;       // 20000
    commsMinor: number;                  // 10000
    complianceReportMinor: number;       // 20000 = KES 200 per compliance report (MRI / annual summary), never free on desk
    reportPlatformPct: number;           // 15: Samuhia's cut of a compliance report, on top of Paystack's 1.5%; the agent keeps the rest (83.5%)
  };
  network: NetworkConfig;
  incentives: IncentiveConfig;
  notify: { enabled: boolean; minGapMs: number };
}

/** Streams that pay team overrides. Overrides come out of Samuhia's retained share, never out of the owning agent's share. */
export type OverrideStream = "subscription" | "report" | "rent";
export interface NetworkConfig {
  seniorsPerWard: number;                // 4
  leadsPerConstituency: number;          // 3
  invitesPerDay: number;                 // per inviting agent
  inviteTtlDays: number;
  /** % of the event's commissionable net paid to the owner's senior / lead (rolled up to Samuhia when that level is missing). */
  overridePct: { senior: Record<OverrideStream, number>; lead: Record<OverrideStream, number> };
  /** Overrides stop this many months after the customer was attributed (recurring pay needs a live relationship). */
  overrideMonthsLimit: number;
  /** Hard per-event ceiling: owner share + overrides can never exceed this % of the commissionable net. */
  maxRecurringPct: number;               // 46
  /** Samuhia must keep at least this % of each month's commissionable net after ALL agent-network costs. */
  platformFloorPct: number;              // 54
  /** Extra safety margin held back from the incentive pool. */
  governorSafetyPct: number;             // 2
  transferFeeEstimateMinor: number;      // Paystack M-PESA transfer: KES 20-60; reserved per payout
  minPayoutMinor: number;                // smaller amounts carry forward to the next month
}
export interface IncentiveConfig {
  /** Customers attributed before this month never earn acquisition/activation/retention incentives ("YYYY-MM"). */
  startMonth: string;
  acquisitionMinor: number;              // first paid month of a customer
  activationMinor: number;               // second consecutive paid month
  retention6Minor: number;               // 6 consecutive paid months
  retention12Minor: number;              // 12 consecutive paid months
  loyaltyMonthlyMinor: number;           // every month a customer is in a streak of loyaltyMinStreak or more
  loyaltyMinStreak: number;
  loyaltyCapMinor: number;               // per agent per month
  activeBookTiers: { min: number; minor: number }[];   // customers that paid this month, highest tier reached
  qualityMinor: number;                  // monthly, for confirmed support with no refunds
  qualityMinConfirmed: number;
  smsReservePerEventMinor: number;       // cost reserve for payment SMS notifications
}

export const DEFAULT_DESK_CONFIG: DeskConfig = {
  creditCostMinor: 20,
  platformCutPct: 2.5,
  expectedPaystackFeePct: 1.5,
  smsShareOfMarginPct: 45,
  firstPurchaseThresholdMinor: 20000,
  subShareByRank: { clerk: 25, senior: 30, lead: 30, admin: 30, internal: 0 },
  reportShareByRank: { clerk: 25, senior: 30, lead: 30, admin: 30, internal: 0 },
  rentDeskSharePct: 40,
  rentTakeCapMinor: 25000,
  milestone: { blockSize: 10, bonusMinor: 200000, lifetimeCapMinor: 1000000, minPaidMonths: 2 },
  paystackAccounts: { chama: "main", school: "main", pms: "main" },
  projects: { chama: "", school: "" },
  topDesk: { dailyPayoutCapMinor: 5_000_000 },
  delegate: { chama: "", school: "", pms: "" },
  support: { rateMinorPerConfirmed: 0, maxConfirmedPerDay: 5, monthlyCapMinor: 0 },
  prices: {
    importMinor: 20000,
    manualTiers: [
      { upToRecords: 10, priceMinor: 20000 },
      { upToRecords: 25, priceMinor: 40000 },
      { upToRecords: 50, priceMinor: 60000 },
      { upToRecords: 100, priceMinor: 80000 },
      { upToRecords: 1_000_000, priceMinor: 100000 },
    ],
    manualCapMinor: 100000,
    manualServiceFeeMinor: 20000,
    commsMinor: 10000,
    complianceReportMinor: 20000,
    reportPlatformPct: 15,
  },
  network: {
    seniorsPerWard: 4, leadsPerConstituency: 3, invitesPerDay: 20, inviteTtlDays: 7,
    overridePct: {
      senior: { subscription: 4, report: 4, rent: 3 },
      lead: { subscription: 3, report: 3, rent: 2 },
    },
    overrideMonthsLimit: 24, maxRecurringPct: 46, platformFloorPct: 54, governorSafetyPct: 2,
    transferFeeEstimateMinor: 4000, minPayoutMinor: 50000,
  },
  incentives: {
    startMonth: "2026-11",
    acquisitionMinor: 5000, activationMinor: 10000, retention6Minor: 15000, retention12Minor: 25000,
    loyaltyMonthlyMinor: 2000, loyaltyMinStreak: 3, loyaltyCapMinor: 150000,
    activeBookTiers: [{ min: 10, minor: 20000 }, { min: 25, minor: 60000 }, { min: 50, minor: 150000 }],
    qualityMinor: 30000, qualityMinConfirmed: 5, smsReservePerEventMinor: 50,
  },
  notify: { enabled: true, minGapMs: 10 * 60_000 },
};

/** Deep-merge stored overrides over defaults. Pure. */
export function mergeConfig(stored: Partial<DeskConfig> | undefined): DeskConfig {
  const s = stored ?? {};
  return {
    ...DEFAULT_DESK_CONFIG,
    ...s,
    subShareByRank: { ...DEFAULT_DESK_CONFIG.subShareByRank, ...s.subShareByRank },
    reportShareByRank: { ...DEFAULT_DESK_CONFIG.reportShareByRank, ...s.reportShareByRank },
    milestone: { ...DEFAULT_DESK_CONFIG.milestone, ...s.milestone },
    paystackAccounts: { ...DEFAULT_DESK_CONFIG.paystackAccounts, ...s.paystackAccounts },
    projects: { ...DEFAULT_DESK_CONFIG.projects, ...s.projects },
    topDesk: { ...DEFAULT_DESK_CONFIG.topDesk, ...s.topDesk },
    delegate: { ...DEFAULT_DESK_CONFIG.delegate, ...s.delegate },
    support: { ...DEFAULT_DESK_CONFIG.support, ...s.support },
    prices: { ...DEFAULT_DESK_CONFIG.prices, ...s.prices },
    network: {
      ...DEFAULT_DESK_CONFIG.network, ...s.network,
      overridePct: {
        senior: { ...DEFAULT_DESK_CONFIG.network.overridePct.senior, ...s.network?.overridePct?.senior },
        lead: { ...DEFAULT_DESK_CONFIG.network.overridePct.lead, ...s.network?.overridePct?.lead },
      },
    },
    incentives: { ...DEFAULT_DESK_CONFIG.incentives, ...s.incentives },
    notify: { ...DEFAULT_DESK_CONFIG.notify, ...s.notify },
  };
}

type ReadDoc = () => Promise<Partial<DeskConfig> | undefined>;
let cache: { at: number; cfg: DeskConfig } | null = null;

/** Cached 60 s. */
export async function loadDeskConfig(read: ReadDoc, now = Date.now()): Promise<DeskConfig> {
  if (cache && now - cache.at < 60_000) return cache.cfg;
  const cfg = mergeConfig(await read());
  cache = { at: now, cfg };
  return cfg;
}
export function clearConfigCache(): void { cache = null; }
