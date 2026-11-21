/**
 * Lipa Mdogo Mdogo (standalone) client for the WhatsApp bot. Every call goes to a PAY callable
 * (`https://africa-south1-plot-9fd6e.cloudfunctions.net/<lmmx_bot_*>`) through `callCloudFunction`, signed as the LMMX
 * contract section S4 says: `sig` = lowercase hex HMAC-SHA256 of `botSigMessage(op, ts, nonce, payload)` with
 * `LMMX_BOT_KEY` from the shared secret bundle. All money and identity decisions stay in PAY; the bot only asks.
 *
 * `LMMX_MOCK=1` answers every op from fixtures (no network, no secret), so the flows can be tried before PAY ships.
 */
import { createHmac, randomBytes } from 'crypto';
import { callCloudFunction } from './payment.service';
import { bundleSecret } from '../config/secretsBundle';
import {
  BotAuth,
  BotConfirmCodeOut,
  BotJoinInfoOut,
  BotLookupOut,
  BotPayOut,
  BotQuoteOut,
  LmmxCallableMap,
  LmmxErrorCode,
  PayoutRequestOut,
  WithdrawStartOut,
  botSigMessage,
  normalizeKePhone,
  parseLmmxCode,
  quoteInstalment,
} from '../types/lmmx.contract';

const BASE = process.env.PAY_FUNCTIONS_BASE || 'https://africa-south1-plot-9fd6e.cloudfunctions.net';
/** A signed call is valid for 5 minutes, so a call that has not answered in 25 seconds is treated as unknown, not as failed. */
const TIMEOUT_MS = 25_000;

export type BotOp = 'lmmx_bot_lookup' | 'lmmx_bot_quote' | 'lmmx_bot_pay' | 'lmmx_bot_confirmCode' | 'lmmx_bot_payLandlord' | 'lmmx_bot_withdrawStart' | 'lmmx_bot_joinInfo';
type Payload<K extends BotOp> = Omit<LmmxCallableMap[K]['in'], keyof BotAuth>;

/** `code` is PAY's `details.lmmx` when it sent one; `timeout` means we do not know whether PAY did the work. */
export class LmmxBotError extends Error {
  constructor(message: string, readonly code?: LmmxErrorCode, readonly timeout = false) {
    super(message);
    this.name = 'LmmxBotError';
  }
}

/** The three fields PAY checks. Pure, so the contract's test vector can pin it. */
export function signBotCall(op: string, payload: Record<string, unknown>, key: string, ts: number, nonce: string): BotAuth {
  const sig = createHmac('sha256', key).update(botSigMessage(op, ts, nonce, payload)).digest('hex');
  return { ts, nonce, sig };
}

export const isMock = (): boolean => process.env.LMMX_MOCK === '1';

async function call<K extends BotOp>(op: K, payload: Payload<K>): Promise<LmmxCallableMap[K]['out']> {
  if (isMock()) return mockCall(op, payload as Record<string, unknown>) as LmmxCallableMap[K]['out'];
  const key = bundleSecret('LMMX_BOT_KEY').value();
  if (!key) throw new LmmxBotError('LMMX_BOT_KEY is not set');
  const auth = signBotCall(op, payload as Record<string, unknown>, key, Date.now(), randomBytes(16).toString('hex'));
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LmmxBotError('PAY did not answer in time', undefined, true)), TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([callCloudFunction(`${BASE}/${op}`, { ...payload, ...auth }), timeout]);
    if (res?.error) throw new LmmxBotError(String(res.error.message || 'request failed'), res.error.details?.lmmx as LmmxErrorCode | undefined);
    if (!res || res.rawResponse !== undefined) throw new LmmxBotError('unreadable answer from PAY');
    return res as LmmxCallableMap[K]['out'];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The sender number is the WhatsApp sender (contract S4), always E.164.
export const lookup = (phone: string, idNumber: string): Promise<BotLookupOut> => call('lmmx_bot_lookup', { phone, idNumber });
export const quote = (phone: string, idNumber: string, creditMinor: number): Promise<BotQuoteOut> => call('lmmx_bot_quote', { phone, idNumber, creditMinor });
export const pay = (phone: string, idNumber: string, quoteId: string, payerPhone: string): Promise<BotPayOut> =>
  call('lmmx_bot_pay', { phone, idNumber, quoteId, payerPhone });
export const confirmCode = (phone: string, text: string): Promise<BotConfirmCodeOut> => call('lmmx_bot_confirmCode', { phone, text });
/** Pay the landlord everything available now (no amount typed; PAY decides). */
export const payLandlord = (phone: string, idNumber: string): Promise<PayoutRequestOut> => call('lmmx_bot_payLandlord', { phone, idNumber });
/** Starts a withdrawal: PAY texts a code (LMW1234) to the phone on record, which IS this WhatsApp number. The code comes back here as a normal message. */
export const withdrawStart = (phone: string, idNumber: string): Promise<WithdrawStartOut> => call('lmmx_bot_withdrawStart', { phone, idNumber });
export const joinInfo = (): Promise<BotJoinInfoOut> => call('lmmx_bot_joinInfo', {});

// ── Mock mode ────────────────────────────────────────────────────────────
/**
 * Fixtures by ID number (any phone): 11111111 active standalone tenant, 22222222 legacy (landlord on Plot Yangu),
 * 33333333 frozen, 44444444 awaiting setup, anything else none (also what a phone/ID mismatch looks like).
 * Codes: LMM4683 setup confirmed, LMM5555 change confirmed, LMC4683 change cancelled, LMM0000 expired, LMM9999 locked,
 * LMM2222 not found, any other LMM/LMC code invalid. Paying from 0700000000 is refused (LMMX_E_STATE); from 0711111111 it times out.
 */
const MOCK_RENT = 1_000_000;
const MOCK_REMAINING = 750_000;

function mockCall(op: BotOp, p: Record<string, unknown>): unknown {
  switch (op) {
    case 'lmmx_bot_lookup': {
      const id = String(p.idNumber);
      const standalone = { firstName: 'Mary', rentMinor: MOCK_RENT, remainingMinor: MOCK_REMAINING, dueDate: '2026-12-05', payByDate: '2026-12-02', suggestedCreditMinor: 250_000, availableMinor: 400_000, withdrawFeeMinor: 2_900 };
      if (id === '55555555') return { kind: 'standalone', standalone: { ...standalone, availableMinor: 3_000, withdrawFeeMinor: 0 } } satisfies BotLookupOut;
      if (id === '11111111') return { kind: 'standalone', standalone } satisfies BotLookupOut;
      if (id === '22222222') return { kind: 'legacy' } satisfies BotLookupOut;
      if (id === '33333333') return { kind: 'standalone', standalone: { ...standalone, frozen: true } } satisfies BotLookupOut;
      if (id === '44444444') return { kind: 'standalone', standalone: { ...standalone, awaitingSetup: true } } satisfies BotLookupOut;
      return { kind: 'none' } satisfies BotLookupOut;
    }
    case 'lmmx_bot_quote': {
      const credit = Number(p.creditMinor);
      if (!Number.isInteger(credit) || credit < 1_000 || credit > MOCK_REMAINING) throw new LmmxBotError('amount not allowed', 'LMMX_E_AMOUNT');
      const q = quoteInstalment({ creditMinor: credit, rentMinor: MOCK_RENT, channel: 'till', remainingRentMinor: MOCK_REMAINING });
      return {
        quoteId: `mock-quote-${credit}`,
        expiresAt: Date.now() + 10 * 60_000,
        creditMinor: q.creditMinor,
        transferReserveMinor: q.transferReserveMinor,
        serviceFeeMinor: q.serviceFeeMinor,
        collectionAllowanceMinor: q.collectionAllowanceMinor,
        chargeMinor: q.chargeMinor,
        feesMinor: q.feesMinor,
        payByDate: '2026-12-02',
        remainingAfterMinor: MOCK_REMAINING - credit,
      } satisfies BotQuoteOut;
    }
    case 'lmmx_bot_pay': {
      const payer = String(p.payerPhone);
      if (payer === '+254700000000') throw new LmmxBotError('cannot take a payment', 'LMMX_E_STATE');
      if (payer === '+254711111111') throw new LmmxBotError('PAY did not answer in time', undefined, true);
      const credit = Number(String(p.quoteId).replace('mock-quote-', ''));
      const q = quoteInstalment({ creditMinor: credit, rentMinor: MOCK_RENT, channel: 'till', remainingRentMinor: MOCK_REMAINING });
      return { reference: 'LMX_MOCK_1', displayText: 'Check your phone for the M-PESA prompt', chargeMinor: q.chargeMinor } satisfies BotPayOut;
    }
    case 'lmmx_bot_confirmCode': {
      const parsed = parseLmmxCode(p.text);
      const full = parsed ? `${parsed.kind === 'otp' ? 'LMM' : parsed.kind === 'cancel' ? 'LMC' : 'LMW'}${parsed.code}` : '';
      const phoneOk = normalizeKePhone(p.phone) !== null;
      if (!parsed || !phoneOk) return { result: 'invalid' } satisfies BotConfirmCodeOut;
      switch (full) {
        case 'LMM4683': return { result: 'setup_confirmed', summary: 'Rent KES 10,000 due on the 5th.' } satisfies BotConfirmCodeOut;
        case 'LMM5555': return { result: 'change_confirmed', summary: 'It starts on 8 Dec.' } satisfies BotConfirmCodeOut;
        case 'LMC4683': return { result: 'change_cancelled' } satisfies BotConfirmCodeOut;
        case 'LMM0000': return { result: 'expired' } satisfies BotConfirmCodeOut;
        case 'LMM9999': return { result: 'locked' } satisfies BotConfirmCodeOut;
        case 'LMW4683': return { result: 'withdraw_requested', summary: 'KES 3,971' } satisfies BotConfirmCodeOut;
        case 'LMM2222': return { result: 'not_found' } satisfies BotConfirmCodeOut;
        default: return { result: 'invalid' } satisfies BotConfirmCodeOut;
      }
    }
    case 'lmmx_bot_payLandlord': {
      if (String(p.idNumber) === '66666666') throw new LmmxBotError('too little', 'LMMX_E_AMOUNT');
      return { requestedMinor: 400_000, message: 'Request received. KES 4,000 will be sent to your landlord within 24 hours.' } satisfies PayoutRequestOut;
    }
    case 'lmmx_bot_withdrawStart': {
      if (String(p.idNumber) === '66666666') throw new LmmxBotError('too little', 'LMMX_E_AMOUNT');
      return { availableMinor: 400_000, feeMinor: 2_900, netMinor: 397_100, otpExpiresAt: Date.now() + 30 * 60_000 } satisfies WithdrawStartOut;
    }
    case 'lmmx_bot_joinInfo':
      return { supportPhones: ['0791286165', '0101716473'], text: 'Samuhia sets you up at a desk in a few minutes. Your landlord does not need to join.' } satisfies BotJoinInfoOut;
  }
}
