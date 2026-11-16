/** Pure helpers for the Lipa Mdogo Mdogo desk screens: validation, OTP text, the waiting state machine, lists, dates. No React, no network. */
import {
  LMMX, cycleProjection, earningsTable, eatDate, normalizeKePhone, otpText, parseLmmxCode, validIdNumber,
} from "../../api/lmmxContract.ts";
import type {
  Channel, DeskPreviewOut, DeskSetupStatusOut, Frequency, IdType, PendingChangeView, RecipientInput, TenantProfileInput, TenantStatus,
} from "../../api/lmmxContract.ts";
import { phoneProblem } from "../../access/phone.ts";
import { S } from "./strings.ts";

// ------------------------------------------------------------------------------------------------ wizard forms
export interface TenantForm { fullName: string; phone: string; idType: IdType; idNumber: string; email: string; unitNumber: string; propertyName: string }
export interface RecipientForm { channel: Channel; bankCode: string; accountNumber: string; accountName: string; contactName: string; contactPhone: string }
export interface RentForm { rentKes: string; dueDay: string; frequency: Frequency }
export type Errors<T> = Partial<Record<keyof T, string>>;

export const emptyTenantForm = (): TenantForm => ({ fullName: "", phone: "", idType: "national_id", idNumber: "", email: "", unitNumber: "", propertyName: "" });
export const emptyRecipientForm = (): RecipientForm => ({ channel: "till", bankCode: "", accountNumber: "", accountName: "", contactName: "", contactPhone: "" });
export const emptyRentForm = (): RentForm => ({ rentKes: "", dueDay: String(LMMX.DUE_DAY_DEFAULT), frequency: "weekly" });

const squash = (s: string) => s.trim().replace(/\s+/g, " ");
export const validName = (s: string): boolean => /^[\p{L}][\p{L} .'-]{1,59}$/u.test(squash(s)) && squash(s).length >= 3;
const validEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim()) && s.length <= 120;

export function validateTenant(f: TenantForm): Errors<TenantForm> {
  const e: Errors<TenantForm> = {};
  if (!validName(f.fullName)) e.fullName = "Type the tenant's full name, as on their ID.";
  if (!normalizeKePhone(f.phone)) e.phone = "Type a Kenyan mobile number, for example 0712 345 678.";
  if (!validIdNumber(f.idType, f.idNumber)) e.idNumber = f.idType === "passport" ? "A passport number has 6 to 9 letters or numbers." : "An ID number has 6 to 9 digits.";
  if (f.email.trim() && !validEmail(f.email)) e.email = "That email does not look right. Leave it empty if there is none.";
  if (f.unitNumber.length > 30) e.unitNumber = "Too long.";
  if (f.propertyName.length > 80) e.propertyName = "Too long.";
  return e;
}

/** What a good account number looks like per channel. The server checks again. */
export function accountProblem(channel: Channel, raw: string): string | null {
  const a = raw.replace(/\s+/g, "");
  if (channel === "phone") return phoneProblem(raw);
  if (channel === "till") return /^\d{5,7}$/.test(a) ? null : "A till number has 5 to 7 digits.";
  return /^[A-Za-z0-9-]{5,24}$/.test(a) ? null : "Type the bank account number (5 to 24 numbers or letters).";
}
/** The account number as it is sent: phones become +254..., others lose spaces. */
export const accountForSend = (channel: Channel, raw: string): string => (channel === "phone" ? (normalizeKePhone(raw) ?? raw.trim()) : raw.replace(/\s+/g, ""));

export function validateRecipient(f: RecipientForm): Errors<RecipientForm> {
  const e: Errors<RecipientForm> = {};
  if (f.channel === "bank" && !f.bankCode) e.bankCode = S.wizard.bankPick;
  const ap = accountProblem(f.channel, f.accountNumber);
  if (ap) e.accountNumber = ap;
  if (!validName(f.accountName)) e.accountName = "Type the name the account is registered under.";
  if (!validName(f.contactName)) e.contactName = "Type the landlord or agent's name.";
  if (!normalizeKePhone(f.contactPhone)) e.contactPhone = "Type a Kenyan mobile number for the landlord or agent.";
  return e;
}

/** "12,500" or "12500" -> minor units; null for decimals, junk, zero. */
export function parseKes(raw: string): number | null {
  const t = raw.replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n * 100 : null;
}
export function rentProblem(raw: string): string | null {
  const m = parseKes(raw);
  if (m === null) return "Type the rent in whole shillings, for example 12000.";
  if (m < LMMX.RENT_MIN_MINOR) return `The rent must be at least KES ${LMMX.RENT_MIN_MINOR / 100}.`;
  if (m > LMMX.RENT_MAX_MINOR) return `The rent can be at most KES ${(LMMX.RENT_MAX_MINOR / 100).toLocaleString("en-KE")}.`;
  return null;
}
export const parseDueDay = (raw: string): number | null => { const n = Number(raw); return /^\d{1,2}$/.test(raw.trim()) && n >= LMMX.DUE_DAY_MIN && n <= LMMX.DUE_DAY_MAX ? n : null; };
export function validateRent(f: RentForm): Errors<RentForm> {
  const e: Errors<RentForm> = {};
  const r = rentProblem(f.rentKes); if (r) e.rentKes = r;
  if (parseDueDay(f.dueDay) === null) e.dueDay = `Pick a day from ${LMMX.DUE_DAY_MIN} to ${LMMX.DUE_DAY_MAX}.`;
  return e;
}
export const hasErrors = (e: object): boolean => Object.keys(e).length > 0;

export const toProfileInput = (f: TenantForm): TenantProfileInput => ({
  fullName: squash(f.fullName), phone: normalizeKePhone(f.phone) ?? f.phone.trim(), idType: f.idType, idNumber: f.idNumber.trim(),
  ...(f.email.trim() ? { email: f.email.trim() } : {}), ...(f.unitNumber.trim() ? { unitNumber: squash(f.unitNumber) } : {}), ...(f.propertyName.trim() ? { propertyName: squash(f.propertyName) } : {}),
});
export const toRecipientInput = (f: RecipientForm, reuseToken?: string): RecipientInput => ({
  channel: f.channel, ...(f.channel === "bank" ? { bankCode: f.bankCode } : {}), accountNumber: accountForSend(f.channel, f.accountNumber), accountName: squash(f.accountName),
  contactName: squash(f.contactName), contactPhone: normalizeKePhone(f.contactPhone) ?? f.contactPhone.trim(), ...(reuseToken ? { reuseToken } : {}),
});

/** The recipient step's account lines changed after a reuse choice: the token no longer applies. */
export const recipientFingerprint = (f: RecipientForm): string => `${f.channel}|${f.bankCode}|${accountForSend(f.channel, f.accountNumber)}|${squash(f.accountName).toLowerCase()}`;

// ------------------------------------------------------------------------------------------------ preview
/** A sensible instalment size per frequency for the estimate: the rent split into 30 / 4 / 2, whole shillings, never below the minimum. */
export const creditFor = (rentMinor: number, f: Frequency): number => {
  const n = f === "daily" ? 30 : f === "weekly" ? 4 : 2;
  return Math.min(rentMinor, Math.max(LMMX.MIN_CREDIT_MINOR, Math.round(rentMinor / n / 100) * 100));
};
export function fallbackPreview(rentMinor: number, channel: Channel): DeskPreviewOut {
  const row = (f: Frequency) => { const p = cycleProjection(rentMinor, channel, creditFor(rentMinor, f)); return { instalments: p.instalments, tenantPaysMinor: p.tenantPaysMinor, deskMinor: p.deskMinor, deskBonusMinor: p.deskBonusMinor }; };
  return { table: earningsTable(rentMinor, channel), projection: { daily: row("daily"), weekly: row("weekly"), biweekly: row("biweekly") } };
}

// ------------------------------------------------------------------------------------------------ OTP text
/** What the agent types: letters, digits, spaces and a dash only, upper case, at most 8 characters. */
export const sanitizeOtpInput = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 8);
export type OtpParse = { ok: true; otp: string; digits: string } | { ok: false };
/** "LMM4683", "lmm 4683", "LMM-4683" and "4683" all become "LMM4683". A cancel code (LMC) or anything else is refused. */
export function normaliseOtp(raw: unknown): OtpParse {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  const p = parseLmmxCode(t);
  if (p) return p.kind === "otp" ? { ok: true, otp: otpText(p.code), digits: p.code } : { ok: false };
  const m = /^(\d{4})$/.exec(t);
  return m ? { ok: true, otp: otpText(m[1]), digits: m[1] } : { ok: false };
}

// ------------------------------------------------------------------------------------------------ countdown
export const secondsLeft = (expiresAt: number | undefined, now: number): number => (expiresAt === undefined ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000)));
export const fmtCountdown = (secs: number): string => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

// ------------------------------------------------------------------------------------------------ waiting / OTP state machine
export type OtpPhase = "waiting" | "done" | "expired" | "locked" | "review" | "closed" | "blocked";
export interface OtpView {
  phase: OtpPhase; expiresAt?: number; attemptsLeft?: number; resendsLeft?: number; canSubmit: boolean; canResend: boolean;
  /** Only for change codes: the change's own status once the tenant has confirmed. */
  changeStatus?: PendingChangeView["status"];
}
const view = (v: Omit<OtpView, "canSubmit" | "canResend"> & { canSubmit?: boolean; canResend?: boolean }): OtpView => ({ canSubmit: false, canResend: false, ...v });

/** Setup: what to show for the latest `lmmx_desk_setupStatus` answer. */
export function deriveSetupView(s: DeskSetupStatusOut, now: number): OtpView {
  const t = s.status;
  if (t === "active") return view({ phase: "done" });
  if (t === "closed") return view({ phase: "closed" });
  if (t === "draft" || s.needsReview) return view({ phase: "review" });
  if (t !== "awaiting_confirmation") return view({ phase: "blocked" });
  const base = { ...(s.otpExpiresAt !== undefined ? { expiresAt: s.otpExpiresAt } : {}), ...(s.attemptsLeft !== undefined ? { attemptsLeft: s.attemptsLeft } : {}), ...(s.resendsLeft !== undefined ? { resendsLeft: s.resendsLeft } : {}) };
  const canResend = (s.resendsLeft ?? 0) > 0;
  if (s.locked || (s.attemptsLeft !== undefined && s.attemptsLeft <= 0)) return view({ phase: "locked", ...base });
  if (s.otpExpiresAt === undefined || s.otpExpiresAt <= now) return view({ phase: "expired", ...base, canResend });
  return view({ phase: "waiting", ...base, canSubmit: true, canResend });
}

/** Change: the same box, driven by the tenant's pending change (read with getTenant) and the code's expiry from requestChange. There is no resend for a change. */
export function deriveChangeView(pc: PendingChangeView | undefined, changeId: string, otpExpiresAt: number | undefined, now: number, wrongTries = 0): OtpView {
  if (!pc || pc.changeId !== changeId) return view({ phase: "closed" });
  const st = pc.status;
  if (st === "cooling_off" || st === "deferred" || st === "applied") return view({ phase: "done", changeStatus: st });
  if (st === "cancelled" || st === "expired" || st === "rejected") return view({ phase: "closed", changeStatus: st });
  // Attempts are only known to this screen (there is no status call for a change), so they are shown only after a wrong try.
  const attemptsLeft = Math.max(0, LMMX.OTP_MAX_ATTEMPTS - wrongTries);
  const base = { ...(otpExpiresAt !== undefined ? { expiresAt: otpExpiresAt } : {}), ...(wrongTries > 0 ? { attemptsLeft } : {}), changeStatus: st };
  if (attemptsLeft <= 0) return view({ phase: "locked", ...base });
  // When the screen was reopened the expiry is unknown: let the server decide (it answers LMMX_E_OTP_EXPIRED).
  if (otpExpiresAt !== undefined && otpExpiresAt <= now) return view({ phase: "expired", ...base });
  return view({ phase: "waiting", ...base, canSubmit: true });
}

// ------------------------------------------------------------------------------------------------ lists
export const SEARCH_DEBOUNCE_MS = 350;
export const LIST_LIMIT = 20;
export const POLL_MS = 5_000;
export const SHOW_REVEALED_MS = 20_000;

/** Appends a page and drops any row already seen (pages can overlap while the data moves). */
export function mergeRows<T>(existing: readonly T[], page: readonly T[], key: (r: T) => string): T[] {
  const seen = new Set(existing.map(key));
  const out = [...existing];
  for (const r of page) { const k = key(r); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}
/** Search text sent to the server: trimmed, spaces collapsed, at most 40 characters; under 2 characters means no search. */
export const searchTerm = (raw: string): string | undefined => { const t = raw.trim().replace(/\s+/g, " ").slice(0, 40); return t.length >= 2 ? t : undefined; };
/** Changing the search or the filter starts the list again from the top (no cursor). */
export const listKey = (q: string | undefined, status: TenantStatus | undefined): string => `${q ?? ""}|${status ?? ""}`;

export const STATUS_CHIPS: readonly { id: TenantStatus | "all"; label: string }[] = [
  { id: "all", label: S.list.all }, { id: "awaiting_confirmation", label: S.list.awaiting }, { id: "active", label: S.status.active },
  { id: "draft", label: S.status.draft }, { id: "frozen", label: S.status.frozen }, { id: "paused", label: S.status.paused }, { id: "closed", label: S.status.closed },
];
export const STATUS_TONE: Record<TenantStatus, "gray" | "blue" | "amber" | "green" | "red"> = {
  draft: "amber", awaiting_confirmation: "blue", active: "green", paused: "gray", frozen: "red", closed: "gray", migrated: "gray",
};

// ------------------------------------------------------------------------------------------------ masking guard
/**
 * Defence in depth: the server only returns masked values, and this makes sure the screens could never print a full phone or ID even if
 * it ever did. A string with a run of 7 or more digits, or a complete +254 number, is treated as unmasked. Only the top-desk reveal bypasses it.
 */
export const looksUnmasked = (v: string): boolean => /\d{7,}/.test(v.replace(/[\s-]/g, "")) || /\+?254[17]\d{8}/.test(v.replace(/[\s-]/g, ""));
export const displayMasked = (v: string | undefined): string => (!v ? "" : looksUnmasked(v) ? "••••" : v);

// ------------------------------------------------------------------------------------------------ dates
/** Midnight (Africa/Nairobi, UTC+3) at the start of "YYYY-MM-DD". */
export const eatDayStart = (iso: string): number => Date.parse(`${iso}T00:00:00+03:00`);
export const eatDayEnd = (iso: string): number => eatDayStart(iso) + 86_400_000 - 1;
export const monthStartIso = (todayIso: string): string => `${todayIso.slice(0, 7)}-01`;
export const defaultRange = (now: number): { from: string; to: string } => { const t = eatDate(now); return { from: monthStartIso(t), to: t }; };
export function rangeToMs(from: string, to: string): { from: number; to: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = eatDayStart(from), b = eatDayEnd(to);
  return Number.isFinite(a) && Number.isFinite(b) && a <= b ? { from: a, to: b } : null;
}
export const fmtWhen = (ms: number): string => new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(new Date(ms));

/** Only an active tenant with no change in progress can be edited. */
export const canEditTenant = (status: TenantStatus, pc: PendingChangeView | undefined): boolean =>
  status === "active" && !(pc && (pc.status === "awaiting_tenant_otp" || pc.status === "cooling_off" || pc.status === "deferred"));

export const LMM_BASE = "/desk/lipa-mdogo";
export const LMM_TOP_BASE = "/desk/lipa-mdogo-top";
export const PAYOUT_SETUP_PATH = "/desk/account";
