/** Pure (no Firebase): the LMMX error type and the plain-words message for every LMMX_E_* code. */
import type { LmmxErrorCode } from "./lmmxContract.ts";

/** Plain words for low-literacy desk agents. Keep every line short, say what happened and what to do next. */
export const LMMX_ERROR_MESSAGES: Record<LmmxErrorCode, string> = {
  LMMX_E_AUTH: "Please sign in again.",
  LMMX_E_FORBIDDEN: "You are not allowed to do that.",
  LMMX_E_SIG: "This request could not be checked. Refresh the page and try again.",
  LMMX_E_RATE: "You have done this too many times. Please wait a while and try again later.",
  LMMX_E_VALIDATION: "Some details are missing or wrong. Check each box and try again.",
  LMMX_E_DUPLICATE: "This tenant, phone or ID number is already in Lipa Mdogo Mdogo.",
  LMMX_E_NOT_FOUND: "We could not find that.",
  LMMX_E_OTP_INVALID: "That code is not correct. Check it with the tenant and try again.",
  LMMX_E_OTP_LOCKED: "Too many wrong codes. This code is locked. Wait one hour, or ask the top desk for help.",
  LMMX_E_OTP_EXPIRED: "That code has run out of time. Ask for a new code.",
  LMMX_E_REVIEW_REQUIRED: "The top desk must check the landlord payment details first. The tenant cannot confirm until then.",
  LMMX_E_FROZEN: "This tenant is on hold. Please contact the top desk.",
  LMMX_E_DISABLED: "Lipa Mdogo Mdogo is not switched on yet. Please try again later.",
  LMMX_E_AMOUNT: "That amount is not allowed. Use whole shillings within the limits.",
  LMMX_E_QUOTE: "The price has changed. Please start again.",
  LMMX_E_STATE: "That cannot be done at this stage. Refresh the page to see where things stand.",
  LMMX_E_TAMPER: "Something does not look right with this tenant. It has been put on hold. Tell the top desk.",
  LMMX_E_RECIPIENT_BLOCKED: "These landlord payment details cannot be used. Check them, or use different details.",
  LMMX_E_NEEDS_REAUTH: "For safety, please enter your password again.",
  LMMX_E_DESK_NOT_READY: "Your desk payout account is not set up yet. Set it up in Account, then try again.",
  LMMX_E_INTERNAL: "Something went wrong on our side. Please try again in a moment.",
};

/** Every code, derived from the message table so a missing entry is a compile error. */
export const LMMX_ERROR_CODES = Object.keys(LMMX_ERROR_MESSAGES) as LmmxErrorCode[];

export const isLmmxErrorCode = (v: unknown): v is LmmxErrorCode => typeof v === "string" && Object.prototype.hasOwnProperty.call(LMMX_ERROR_MESSAGES, v);

const FIREBASE_FALLBACK: Record<string, string> = {
  "functions/unauthenticated": "Please sign in again.",
  "functions/permission-denied": "You are not allowed to do that.",
  "functions/not-found": "We could not find that.",
  "functions/invalid-argument": "Some details are missing or wrong.",
  "functions/failed-precondition": "That cannot be done right now.",
  "functions/unavailable": "Network problem. Please try again.",
  "functions/deadline-exceeded": "That took too long. Please try again.",
  "functions/resource-exhausted": "Too many tries. Please wait and try again later.",
};

export class LmmxApiError extends Error {
  /** The LMMX code from `error.details.lmmx`, when the server sent one. */
  lmmx: LmmxErrorCode | undefined;
  /** The Firebase code, e.g. "functions/failed-precondition". */
  code: string;
  constructor(code: string, message: string, lmmx?: LmmxErrorCode) {
    super(message);
    this.name = "LmmxApiError";
    this.code = code;
    this.lmmx = lmmx;
  }
}

/** Turns whatever a callable threw into an LmmxApiError. Our own table always wins over server text, so wording stays plain. */
export function toLmmxError(e: unknown): LmmxApiError {
  if (e instanceof LmmxApiError) return e;
  const err = (e ?? {}) as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof err.code === "string" ? err.code : "unknown";
  const d = err.details as { lmmx?: unknown } | null | undefined;
  const lmmx = isLmmxErrorCode(d?.lmmx) ? d.lmmx : undefined;
  if (lmmx) return new LmmxApiError(code, LMMX_ERROR_MESSAGES[lmmx], lmmx);
  return new LmmxApiError(code, FIREBASE_FALLBACK[code] ?? "Something went wrong. Please try again.");
}

export const lmmxCodeOf = (e: unknown): LmmxErrorCode | undefined => (e instanceof LmmxApiError ? e.lmmx : toLmmxError(e).lmmx);
export const errorText = (e: unknown): string => toLmmxError(e).message;
