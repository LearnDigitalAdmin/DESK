/**
 * Landlord Watch types.
 * Wire types mirror LANDLORD_WATCH_CONTRACT.md section 7 exactly; do not extend them.
 */

export type Lang = 'en' | 'sw';
export type MaskLevel = 'full' | 'tenant' | 'open';

/** Every number is an object so a masked value can still be displayed. Always render `d`. */
export interface N {
  v: number | null;
  d: string;
}

export interface Connection {
  ownerId: string;
  propertyName: string;
  address: string | null;
  connectedAt: string;
  unlocked: boolean;
  unlockedUntil: string | null;
}

export interface LookupResult {
  found: boolean;
  property?: {
    ownerId: string;
    name: string;
    address: string | null;
    ownerPhoneMasked: string;
    managedByAgency: boolean;
  };
}

export interface StatementItem {
  label: string;
  kind: 'income' | 'deduction';
  amount: N;
}

export interface Statement {
  source: 'agent' | 'estimate';
  status: 'draft' | 'finalized' | 'sent' | 'acknowledged' | null;
  notes: string | null;
  items: StatementItem[];
  income: N;
  deductions: N;
  netPayable: N;
}

export type TenantStatus = 'paid' | 'partial' | 'unpaid' | 'no_invoice' | 'masked';

export interface TenantRow {
  ref: string;
  name: string;
  phone: string;
  unit: string | null;
  status: TenantStatus;
  rent: N;
  billed: N;
  paid: N;
  balance: N;
  dueDate: string | null;
  paidOn: string | null;
  paidOnTime: boolean | null;
}

export interface Snapshot {
  schema: 1;
  ownerId: string;
  month: string;
  generatedAt: string;
  mask: {
    level: MaskLevel;
    reason: 'locked' | 'otp' | 'auth_phone_match' | 'channel_policy';
    unlockedUntil: string | null;
    canUnlock: boolean;
  };
  property: {
    name: string;
    address: string | null;
    maxUnits: N;
    commissionRatePct: N;
    managedByAgency: boolean;
  };
  months: string[];
  summary: {
    tenants: { active: N; occupiedUnits: N; vacantUnits: N; occupancyPct: N };
    invoices: { total: N; paid: N; partial: N; unpaid: N; noInvoice: N };
    billed: N;
    collected: N;
    pending: N;
    collectionRatePct: N;
    baseRent: { billed: N; collected: N };
    commission: { ratePct: N; onCollected: N; onExpected: N };
    net: { expected: N; payable: N; stillToCollect: N };
    statement: Statement;
    remittance: {
      dueDate: string;
      collectedByDue: N;
      collectedAfterDue: N;
      netByDue: N;
      netAfterDue: N;
    };
  };
  tenants: TenantRow[];
  trend: { month: string; billed: N; collected: N; pending: N; netPayable: N }[];
}

export interface Quota {
  period: string;
  freeLimit: number;
  freeUsed: number;
  nextPriceKes: number;
}

export type TranscriptState =
  | 'otp_pending'
  | 'payment_required'
  | 'payment_pending'
  | 'paid'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'expired';

export interface TranscriptRequest {
  requestId: string;
  ownerId: string;
  month: string;
  state: TranscriptState;
  priceKes: number;
  sentTo?: string;
  expiresInSec?: number;
  resendInSec?: number;
  url?: string;
  expiresAt?: string;
  reference?: string;
  message?: string;
  error?: { code: string; message: string };
  createdAt: string;
  /** Compliance reports only: which report, its display name and a file name for the PDF. */
  kind?: ReportKind;
  title?: string;
  fileName?: string;
}

/** Compliance reports (PAY report engine): the MRI working paper and the annual rental income summary. */
export type ReportKind = 'mri_monthly' | 'annual_summary';
export interface ReportQuote {
  period: string;
  freeIncluded: boolean;
  freeUsedThisMonth: number;
  priceKes: number;
  listPriceKes: number;
}

export interface OtpSent {
  sentTo: string;
  expiresInSec: number;
  resendInSec: number;
}

export interface UnlockResult {
  unlocked: true;
  unlockedUntil: string;
  level: MaskLevel;
}

export type SnapshotResult = { notModified: true; etag: string } | { snapshot: Snapshot; etag: string };

// ── Errors ────────────────────────────────────────────────────────────────

export const LW_ERROR_CODES = [
  'LW_BAD_OWNER_ID',
  'LW_NOT_FOUND',
  'LW_RATE_LIMITED',
  'LW_NO_PHONE_ON_FILE',
  'LW_OTP_COOLDOWN',
  'LW_OTP_WRONG',
  'LW_OTP_EXPIRED',
  'LW_OTP_LOCKED',
  'LW_SMS_FAILED',
  'LW_LOCKED',
  'LW_CONNECTION_LIMIT',
  'LW_BAD_MONTH',
  'LW_PAYMENT_FAILED',
  'LW_NOT_ALLOWED',
  'LW_UNAVAILABLE',
  'LW_REPORT_NO_DATA',
  'LW_REPORT_STALE',
] as const;

export type LwErrorCode = (typeof LW_ERROR_CODES)[number];

// ── API surface (contract section 7, Transport B action names) ───────────

export interface LwApi {
  lookupProperty(ownerId: string): Promise<LookupResult>;
  connect(ownerId: string): Promise<{ connection: Connection }>;
  disconnect(ownerId: string): Promise<{ ok: true }>;
  listConnections(): Promise<{ connections: Connection[] }>;
  unlockSendOtp(ownerId: string, lang: Lang): Promise<OtpSent>;
  unlockVerifyOtp(ownerId: string, code: string): Promise<UnlockResult>;
  getSnapshot(ownerId: string, month: string | undefined, lang: Lang): Promise<SnapshotResult>;
  transcriptQuota(ownerId: string): Promise<Quota>;
  transcriptStart(ownerId: string, month: string, lang: Lang): Promise<TranscriptRequest>;
  transcriptResendOtp(requestId: string): Promise<OtpSent>;
  transcriptVerifyOtp(requestId: string, code: string): Promise<TranscriptRequest>;
  transcriptPay(requestId: string, phone: string): Promise<TranscriptRequest>;
  transcriptStatus(requestId: string): Promise<TranscriptRequest>;
  transcriptList(ownerId: string): Promise<{ items: TranscriptRequest[] }>;
  // compliance reports (server decides price, allowance and the checkout gate; the link exists only after checkout is confirmed)
  reportQuote(ownerId: string): Promise<ReportQuote>;
  reportOrder(ownerId: string, month: string, kind: ReportKind): Promise<TranscriptRequest>;
  reportCheckout(requestId: string, phone?: string): Promise<TranscriptRequest>;
  reportStatus(requestId: string): Promise<TranscriptRequest>;
  reportList(ownerId: string): Promise<{ items: TranscriptRequest[] }>;
}

// ── Outbound WhatsApp messages (what the handler produces) ───────────────

export interface WaButton {
  id: string;
  title: string;
}

export interface WaRow {
  id: string;
  title: string;
  description?: string;
}

export type Outbound =
  | { kind: 'text'; text: string }
  | { kind: 'buttons'; body: string; buttons: WaButton[] }
  | { kind: 'list'; body: string; button: string; rows: WaRow[] }
  | { kind: 'document'; url: string; filename: string; caption?: string };

export interface SendResult {
  ok: boolean;
  /** Meta error code when known (e.g. 131047 = outside the 24 h window). */
  errorCode?: number;
}

// ── Session slice (the ONLY things the bot persists, contract section 12) ─

export type PickPurpose = 'prop' | 'disc' | 'view-month' | 'tr-month' | 'rp-month';

export interface WatchCtx {
  /** Currently selected property. */
  ownerId?: string;
  /** Month being viewed (YYYY-MM); undefined = latest. */
  month?: string;
  /** Page index of the list currently on screen. */
  page?: number;
  /** What the month / property picker is being used for. */
  pick?: PickPurpose;
  /** Owner ID typed by the user, waiting for Yes/No. */
  pendingOwnerId?: string;
  /** What the pending Yes/No is about. */
  confirm?: 'connect' | 'disconnect';
  /** Month chosen for a transcript. */
  trMonth?: string;
  /** Pending transcript request id. */
  requestId?: string;
  /** Compliance report being ordered: which one, for which month, and its order id. */
  rpKind?: ReportKind;
  rpMonth?: string;
  rpId?: string;
  /** Epoch seconds before which a new code must not be requested. */
  resendAt?: number;
  /** Which screen is showing, so "back" knows whether to go to the watch menu or the main menu. */
  screen?: 'menu' | 'other';
  /** Action ids of the last interactive message, so typed numbers map back. */
  opts?: string[];
}
