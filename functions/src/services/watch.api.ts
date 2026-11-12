/**
 * Landlord Watch API client (contract section 7, Transport B).
 *
 *   POST {LW_API_URL}   headers: x-lw-key   body: { action, actor: { phone }, ...params }
 *   -> { ok: true, data } | { ok: false, error: { code, message, retryAfterSec?, attemptsLeft? } }
 *
 * Rules enforced here:
 *  - the key is only ever placed in the request header; it is never logged and never appears in an error
 *  - no automatic retries (the contract forbids auto-retrying OTP sends; callers decide)
 *  - every transport failure (timeout, DNS, 401, 5xx, bad JSON) becomes LW_UNAVAILABLE
 *  - nothing is cached, and request/response bodies are never logged (they carry tenant data and signed URLs)
 */

import axios from 'axios';
import {
  Connection,
  Lang,
  LookupResult,
  LW_ERROR_CODES,
  LwApi,
  LwErrorCode,
  OtpSent,
  Quota,
  ReportKind,
  ReportQuote,
  SnapshotResult,
  TranscriptRequest,
  UnlockResult,
} from '../types/watch.types';
import { logger } from '../utils/logger';
import { getLwApiKey, getLwApiUrl, isLwMock } from '../config/watch.config';

export class LwError extends Error {
  readonly code: LwErrorCode;
  readonly retryAfterSec?: number;
  readonly attemptsLeft?: number;

  constructor(code: LwErrorCode, message?: string, extra: { retryAfterSec?: number; attemptsLeft?: number } = {}) {
    super(message || code);
    this.name = 'LwError';
    this.code = code;
    this.retryAfterSec = extra.retryAfterSec;
    this.attemptsLeft = extra.attemptsLeft;
  }
}

export function isLwError(e: unknown): e is LwError {
  return e instanceof LwError;
}

/** Map any value to a known contract code; anything else is LW_UNAVAILABLE. */
export function normalizeErrorCode(code: unknown): LwErrorCode {
  return typeof code === 'string' && (LW_ERROR_CODES as readonly string[]).includes(code)
    ? (code as LwErrorCode)
    : 'LW_UNAVAILABLE';
}

// ── Transport ────────────────────────────────────────────────────────────

export type HttpPost = (
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
) => Promise<{ status: number; data: unknown }>;

/** Default transport. `validateStatus` accepts every status so axios never throws an error that embeds request headers. */
export const axiosPost: HttpPost = async (url, body, headers, timeoutMs) => {
  const res = await axios.post(url, body, { headers, timeout: timeoutMs, validateStatus: () => true });
  return { status: res.status, data: res.data };
};

const SLOW_ACTIONS = new Set(['transcriptVerifyOtp', 'transcriptStatus', 'transcriptPay', 'reportOrder', 'reportCheckout', 'reportStatus']);
const DEFAULT_TIMEOUT_MS = 15_000;
const SLOW_TIMEOUT_MS = 40_000;

export interface HttpLwApiOptions {
  actorPhone: string;
  url?: string;
  getKey?: () => string;
  post?: HttpPost;
}

export class HttpLwApi implements LwApi {
  private readonly actorPhone: string;
  private readonly url: string;
  private readonly getKey: () => string;
  private readonly post: HttpPost;

  constructor(opts: HttpLwApiOptions) {
    this.actorPhone = opts.actorPhone;
    this.url = opts.url ?? getLwApiUrl();
    this.getKey = opts.getKey ?? getLwApiKey;
    this.post = opts.post ?? axiosPost;
  }

  private async call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const timeout = SLOW_ACTIONS.has(action) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    let res: { status: number; data: unknown };

    try {
      res = await this.post(
        this.url,
        { action, actor: { phone: this.actorPhone }, ...params },
        { 'Content-Type': 'application/json', 'x-lw-key': this.getKey() },
        timeout
      );
    } catch (err) {
      // Log only the low-level error code (e.g. ECONNABORTED). Never the error object: it can embed headers.
      const low = (err as { code?: unknown } | null)?.code;
      logger.warn('LW transport error', { action, cause: typeof low === 'string' ? low : 'unknown' });
      throw new LwError('LW_UNAVAILABLE', 'transport error');
    }

    if (res.status === 401 || res.status === 403) {
      logger.error('LW API key rejected', { action, status: res.status });
      throw new LwError('LW_UNAVAILABLE', 'api key rejected');
    }
    if (res.status < 200 || res.status >= 300) {
      logger.warn('LW unexpected HTTP status', { action, status: res.status });
      throw new LwError('LW_UNAVAILABLE', `http ${res.status}`);
    }

    const body = res.data as
      | { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown; retryAfterSec?: unknown; attemptsLeft?: unknown } }
      | null
      | undefined;

    if (!body || typeof body !== 'object') {
      logger.warn('LW malformed response', { action });
      throw new LwError('LW_UNAVAILABLE', 'malformed response');
    }

    if (body.ok === true) {
      if (body.data === undefined || body.data === null) {
        logger.warn('LW empty data', { action });
        throw new LwError('LW_UNAVAILABLE', 'empty data');
      }
      return body.data as T;
    }

    const e = body.error;
    const code = normalizeErrorCode(e?.code);
    if (code === 'LW_UNAVAILABLE' && e?.code !== 'LW_UNAVAILABLE') {
      logger.warn('LW unknown error code', { action, code: typeof e?.code === 'string' ? e.code.slice(0, 40) : typeof e?.code });
    }
    throw new LwError(code, typeof e?.message === 'string' ? e.message.slice(0, 200) : undefined, {
      retryAfterSec: typeof e?.retryAfterSec === 'number' ? e.retryAfterSec : undefined,
      attemptsLeft: typeof e?.attemptsLeft === 'number' ? e.attemptsLeft : undefined,
    });
  }

  lookupProperty(ownerId: string): Promise<LookupResult> {
    return this.call('lookupProperty', { ownerId });
  }
  connect(ownerId: string): Promise<{ connection: Connection }> {
    return this.call('connect', { ownerId });
  }
  disconnect(ownerId: string): Promise<{ ok: true }> {
    return this.call('disconnect', { ownerId });
  }
  listConnections(): Promise<{ connections: Connection[] }> {
    return this.call('listConnections');
  }
  unlockSendOtp(ownerId: string, lang: Lang): Promise<OtpSent> {
    return this.call('unlockSendOtp', { ownerId, lang });
  }
  unlockVerifyOtp(ownerId: string, code: string): Promise<UnlockResult> {
    return this.call('unlockVerifyOtp', { ownerId, code });
  }
  getSnapshot(ownerId: string, month: string | undefined, lang: Lang): Promise<SnapshotResult> {
    return this.call('getSnapshot', { ownerId, ...(month ? { month } : {}), lang });
  }
  transcriptQuota(ownerId: string): Promise<Quota> {
    return this.call('transcriptQuota', { ownerId });
  }
  transcriptStart(ownerId: string, month: string, lang: Lang): Promise<TranscriptRequest> {
    return this.call('transcriptStart', { ownerId, month, lang });
  }
  transcriptResendOtp(requestId: string): Promise<OtpSent> {
    return this.call('transcriptResendOtp', { requestId });
  }
  transcriptVerifyOtp(requestId: string, code: string): Promise<TranscriptRequest> {
    return this.call('transcriptVerifyOtp', { requestId, code });
  }
  transcriptPay(requestId: string, phone: string): Promise<TranscriptRequest> {
    return this.call('transcriptPay', { requestId, phone });
  }
  transcriptStatus(requestId: string): Promise<TranscriptRequest> {
    return this.call('transcriptStatus', { requestId });
  }
  transcriptList(ownerId: string): Promise<{ items: TranscriptRequest[] }> {
    return this.call('transcriptList', { ownerId });
  }
  reportQuote(ownerId: string): Promise<ReportQuote> {
    return this.call('reportQuote', { ownerId });
  }
  reportOrder(ownerId: string, month: string, kind: ReportKind): Promise<TranscriptRequest> {
    return this.call('reportOrder', { ownerId, month, kind });
  }
  reportCheckout(requestId: string, phone?: string): Promise<TranscriptRequest> {
    return this.call('reportCheckout', { orderId: requestId, ...(phone ? { phone } : {}) });
  }
  reportStatus(requestId: string): Promise<TranscriptRequest> {
    return this.call('reportStatus', { orderId: requestId });
  }
  reportList(ownerId: string): Promise<{ items: TranscriptRequest[] }> {
    return this.call('reportList', { ownerId });
  }
}

/**
 * Factory used by the bot. `LW_MOCK=1` swaps in the in-memory mock; turning it off is the only change needed to go live.
 * The mock is loaded lazily so production never pulls its fixtures into memory.
 */
export function createWatchApi(actorPhone: string): LwApi {
  if (isLwMock()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSharedMockApi } = require('./watch.mock') as typeof import('./watch.mock');
    return getSharedMockApi(actorPhone);
  }
  return new HttpLwApi({ actorPhone });
}
