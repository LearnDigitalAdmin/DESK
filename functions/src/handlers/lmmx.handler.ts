/**
 * Lipa Mdogo Mdogo on WhatsApp for STANDALONE tenants (registered by a Samuhia desk, landlord not on Plot Yangu).
 *
 *   menu 9  -> ask the ID number -> `lmmx_bot_lookup` with the sender's number
 *                standalone -> status, amount, quote (rent / fees / you pay), M-Pesa number, confirm, STK
 *                legacy     -> the EXISTING Lipa Mdogo Mdogo flow of lmm.handler.ts, unchanged (landlord on Plot Yangu)
 *                none       -> "we could not find you" (also what a phone/ID mismatch looks like: no enumeration)
 *   menu 10 -> `lmmx_bot_joinInfo`, then how to join
 *   LMM#### / LMC#### -> answered from ANY state by `lmmxCodeReply` (called by the webhook before the state dispatch)
 *
 * All money, identity and fee decisions are PAY's. The bot shows the numbers a quote returns and never computes its own.
 * `0` goes back, `#` is the main menu, `00` restarts, `000` leaves (as in the other handlers).
 */
import { Session } from '../types/session.types';
import { clearSessionContext, updateSessionContext, updateSessionState } from '../services/session.service';
import { checkNavigationCommand, validatePhoneNumber } from '../utils/validator';
import { ulabel } from '../constants/ui.messages';
import { LMMX_SUPPORT_PHONE, LmmxMsgKey, lmxl, lmxm } from '../constants/lmmx.messages';
import { STATE } from '../constants/states';
import { logger } from '../utils/logger';
import { Outbound } from '../types/watch.types';
import { btn, mainButton, mainMenuReply, Reply, uiButtons, uiText, welcomeReply, withNotice } from '../utils/ui';
import * as lmmx from '../services/lmmx.client';
import { LmmxBotError } from '../services/lmmx.client';
import { LMMX, kes, normalizeKePhone, shortDate, validIdNumber } from '../types/lmmx.contract';
import type { BotConfirmCodeOut, BotLookupOut, BotQuoteOut } from '../types/lmmx.contract';
import { findTenantAndInvoice } from './rent.handler';
import { startLmm } from './lmm.handler';

type Lang = Session['language'];

const MIN_KES = LMMX.MIN_CREDIT_MINOR / 100;
const MAX_KES = LMMX.MAX_CREDIT_MINOR / 100;
const kesWhole = (n: number): string => `KES ${n.toLocaleString('en-KE')}`;
const back = (lang: Lang) => btn('0', ulabel('BACK', lang));
const isId = (v: string): boolean => validIdNumber('national_id', v) || validIdNumber('alien_id', v) || validIdNumber('passport', v);
/** "+254712345678" -> "0712345678", for buttons and summaries a Kenyan user reads easily. */
const localPhone = (e164: string): string => (e164.startsWith('+254') ? `0${e164.slice(4)}` : e164);
const ctxId = (s: Session): string => String(s.context?.lmxId ?? '');

interface SavedQuote { quoteId: string; expiresAt: number; creditMinor: number; feesMinor: number; chargeMinor: number; payByDate: string }
function savedQuote(s: Session): SavedQuote | null {
  try {
    const q = s.context?.lmxQuote ? (JSON.parse(String(s.context.lmxQuote)) as SavedQuote) : null;
    return q && q.quoteId && Number.isInteger(q.creditMinor) ? q : null;
  } catch {
    return null;
  }
}
const toSaved = (q: BotQuoteOut): SavedQuote => ({ quoteId: q.quoteId, expiresAt: q.expiresAt, creditMinor: q.creditMinor, feesMinor: q.feesMinor, chargeMinor: q.chargeMinor, payByDate: q.payByDate });

// ── Screens ──────────────────────────────────────────────────────────────

const askIdScreen = (lang: Lang): Outbound => uiButtons(lmxm('ASK_ID', lang), [mainButton(lang)]);

const notFoundScreen = (lang: Lang): Outbound =>
  uiButtons(lmxm('NOT_FOUND', lang), [btn('RETRY', lmxl('TRY_AGAIN', lang)), btn('JOIN', lmxl('JOIN', lang)), mainButton(lang)]);

const homeScreen = (lang: Lang, s: NonNullable<BotLookupOut['standalone']>): Outbound =>
  uiButtons(
    lmxm('HOME', lang, {
      name: s.firstName,
      rent: kes(s.rentMinor),
      balance: s.remainingMinor > 0 ? kes(s.remainingMinor) : 'KES 0 ✅',
      due: shortDate(s.dueDate),
      payby: shortDate(s.payByDate),
    }),
    [btn('PAYNOW', ulabel('PAY_NOW', lang)), btn('MONEY', lmxl('MONEY', lang)), mainButton(lang)]
  );

const amountScreen = (lang: Lang, suggestedMinor: number): Outbound =>
  uiButtons(
    lmxm('ASK_AMOUNT', lang, { min: kesWhole(MIN_KES), max: kesWhole(MAX_KES), suggested: kes(suggestedMinor) }),
    suggestedMinor >= LMMX.MIN_CREDIT_MINOR
      ? [btn('SUG', lmxl('PAY_AMOUNT', lang, { amount: kes(suggestedMinor) })), back(lang), mainButton(lang)]
      : [back(lang), mainButton(lang)]
  );

const quoteLines = (lang: Lang, q: SavedQuote, key: 'QUOTE' | 'CONFIRM', phone?: string): string =>
  lmxm(key, lang, { credit: kes(q.creditMinor), fees: kes(q.feesMinor), charge: kes(q.chargeMinor), payby: shortDate(q.payByDate), phone: phone ? localPhone(phone) : '' });

const phoneScreen = (lang: Lang, q: SavedQuote, sender: string | null): Outbound => {
  const text = `${quoteLines(lang, q, 'QUOTE')}\n\n${lmxm('ASK_PHONE', lang)}`;
  const own = sender ? [btn('ME', ulabel('USE_NUMBER', lang, { phone: localPhone(sender) }))] : [];
  return uiButtons(text, [...own, back(lang), mainButton(lang)]);
};

const confirmScreen = (lang: Lang, q: SavedQuote, payer: string): Outbound =>
  uiButtons(quoteLines(lang, q, 'CONFIRM', payer), [btn('YES', ulabel('CONFIRM', lang)), back(lang), mainButton(lang)]);

// ── My money: pay the landlord now / withdraw (no amount typed; PAY takes everything available, at least KES 50) ──

const MIN_PAYOUT = LMMX.MIN_PAYOUT_MINOR;
async function moneyScreen(phone: string, session: Session, notice?: string): Promise<Reply> {
  const lang = session.language;
  const id = ctxId(session);
  const sender = normalizeKePhone(phone);
  if (!id || !sender) return beginLmmx(phone, session);
  try {
    const out = await lmmx.lookup(sender, id);
    const s = out.kind === 'standalone' ? out.standalone : undefined;
    if (!s) return afterLookup(phone, session, id, out);
    if (s.frozen || s.awaitingSetup) return afterLookup(phone, session, id, out);
    const avail = s.availableMinor ?? 0;
    const fee = s.withdrawFeeMinor ?? 0;
    await updateSessionState(phone, STATE.LMMX_MONEY, {});
    const text = avail >= MIN_PAYOUT ? lmxm('MONEY', lang, { avail: kes(avail), fee: kes(fee), net: kes(avail - fee) }) : lmxm('MONEY_NONE', lang, { avail: kes(avail), min: kes(MIN_PAYOUT) });
    const buttons = avail >= MIN_PAYOUT ? [btn('PAYLORD', lmxl('PAY_LANDLORD', lang)), btn('WITHDRAW', lmxl('WITHDRAW', lang)), back(lang)] : [back(lang), mainButton(lang)];
    return uiButtons(notice ? `${notice}\n\n${text}` : text, buttons);
  } catch (err) {
    return lookupFailed(phone, session, err);
  }
}

const afterPayButtons = (lang: Lang) => [btn('CHECK', lmxl('CHECK', lang)), btn('PAYNOW', lmxl('PAY_MORE', lang)), mainButton(lang)];

// ── Errors ───────────────────────────────────────────────────────────────

function errorKey(err: unknown): LmmxMsgKey {
  switch (err instanceof LmmxBotError ? err.code : undefined) {
    case 'LMMX_E_RATE': return 'E_RATE';
    case 'LMMX_E_AMOUNT': return 'E_AMOUNT';
    case 'LMMX_E_QUOTE': return 'E_QUOTE';
    case 'LMMX_E_STATE': return 'E_STATE';
    case 'LMMX_E_DISABLED': return 'E_DISABLED';
    case 'LMMX_E_FROZEN': return 'FROZEN';
    default: return 'TRY_LATER';
  }
}
const logFail = (where: string, err: unknown): void =>
  // Never the payload: it carries an ID number and phones.
  logger.error('Lipa Mdogo Mdogo (standalone) call failed', { where, code: err instanceof LmmxBotError ? err.code : undefined, timeout: err instanceof LmmxBotError ? err.timeout : undefined });

/** A failed lookup: say what went wrong and let the user try again or leave. */
async function lookupFailed(phone: string, session: Session, err: unknown): Promise<Reply> {
  logFail('lookup', err);
  await updateSessionState(phone, STATE.LMMX_NOTFOUND, {});
  return uiButtons(lmxm(errorKey(err), session.language), [btn('RETRY', lmxl('TRY_AGAIN', session.language)), mainButton(session.language)]);
}

// ── Entry points ─────────────────────────────────────────────────────────

/** Main menu option 9. */
export async function beginLmmx(phone: string, session: Session): Promise<Reply> {
  await clearSessionContext(phone);
  await updateSessionState(phone, STATE.LMMX_ID, {});
  return askIdScreen(session.language);
}

/** Main menu option 10, and the Join button of the not-found screen. */
export async function beginLmmxJoin(phone: string, session: Session): Promise<Reply> {
  const lang = session.language;
  let text = lmxm('JOIN_DEFAULT_TEXT', lang);
  let phones = LMMX_SUPPORT_PHONE;
  try {
    const info = await lmmx.joinInfo();
    if (info.text?.trim()) text = info.text.trim().slice(0, 400);
    if (info.supportPhones?.length) phones = info.supportPhones.slice(0, 3).join(', ');
  } catch (err) {
    logFail('joinInfo', err); // the static text above still tells them how to join
  }
  await clearSessionContext(phone);
  await updateSessionState(phone, STATE.LMMX_JOIN, {});
  return uiButtons(lmxm('JOIN', lang, { text, phones }), [mainButton(lang)]);
}

/** Decide what a lookup answer means and show the right screen. */
async function afterLookup(phone: string, session: Session, id: string, out: BotLookupOut): Promise<Reply> {
  const lang = session.language;
  if (out.kind === 'legacy') return startLegacy(phone, session, id);
  const s = out.kind === 'standalone' ? out.standalone : undefined;
  if (!s) {
    await clearSessionContext(phone);
    await updateSessionState(phone, STATE.LMMX_NOTFOUND, {});
    return notFoundScreen(lang);
  }
  if (s.frozen) {
    await updateSessionState(phone, STATE.LMMX_DONE, {});
    return uiButtons(lmxm('FROZEN', lang), [mainButton(lang)]);
  }
  if (s.awaitingSetup) {
    await updateSessionState(phone, STATE.LMMX_DONE, {});
    return uiButtons(lmxm('AWAITING', lang), [mainButton(lang)]);
  }
  await updateSessionContext(phone, { lmxId: id, lmxSug: s.suggestedCreditMinor });
  await updateSessionState(phone, STATE.LMMX_HOME, {});
  return homeScreen(lang, s);
}

/** The landlord is on Plot Yangu: hand over to the existing flow, giving it the context it expects (as Pay Rent saves it). */
async function startLegacy(phone: string, session: Session, id: string): Promise<Reply> {
  const lang = session.language;
  const { tenant, invoice, assetId } = await findTenantAndInvoice(id);
  if (!tenant || !invoice || !assetId) {
    await clearSessionContext(phone);
    await updateSessionState(phone, STATE.LMMX_NOTFOUND, {});
    return notFoundScreen(lang);
  }
  await clearSessionContext(phone);
  const context = { tenantId: id, foundTenant: JSON.stringify(tenant), foundInvoice: JSON.stringify(invoice), assetId };
  await updateSessionContext(phone, context);
  return startLmm(phone, { ...session, context });
}

/** Look the tenant up again with the ID we already hold (after Back, Check balance, or an expired screen). */
async function refreshHome(phone: string, session: Session): Promise<Reply> {
  const id = ctxId(session);
  const sender = normalizeKePhone(phone);
  if (!id || !sender) return beginLmmx(phone, session);
  try {
    return await afterLookup(phone, session, id, await lmmx.lookup(sender, id));
  } catch (err) {
    return lookupFailed(phone, session, err);
  }
}

// ── Navigation ───────────────────────────────────────────────────────────

async function navigate(phone: string, input: string, session: Session): Promise<Reply | null> {
  const lang = session.language;
  const nav = checkNavigationCommand(input);
  if (nav.type === 'exit') {
    await clearSessionContext(phone);
    await updateSessionState(phone, STATE.LANGUAGE_SELECTION, {});
    return welcomeReply();
  }
  if (nav.type === 'restart') {
    await clearSessionContext(phone);
    await updateSessionState(phone, STATE.MAIN_MENU, {});
    return mainMenuReply(lang);
  }
  if (nav.type !== 'back') return null;
  switch (session.currentState) {
    case STATE.LMMX_HOME:
    case STATE.LMMX_NOTFOUND:
      return beginLmmx(phone, session);
    case STATE.LMMX_AMOUNT:
    case STATE.LMMX_MONEY:
    case STATE.LMMX_DONE:
      return refreshHome(phone, session);
    case STATE.LMMX_LCONFIRM:
    case STATE.LMMX_WCONFIRM:
      return moneyScreen(phone, session);
    case STATE.LMMX_PHONE:
      await updateSessionState(phone, STATE.LMMX_AMOUNT, {});
      return amountScreen(lang, Number(session.context?.lmxSug ?? 0));
    case STATE.LMMX_CONFIRM: {
      const q = savedQuote(session);
      if (!q) break;
      await updateSessionState(phone, STATE.LMMX_PHONE, {});
      return phoneScreen(lang, q, normalizeKePhone(phone));
    }
    default:
      break; // LMMX_ID, LMMX_JOIN: out to the main menu
  }
  await clearSessionContext(phone);
  await updateSessionState(phone, STATE.MAIN_MENU, {});
  return mainMenuReply(lang);
}

// ── State handlers ───────────────────────────────────────────────────────

export async function handleLmmxId(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  const lang = session.language;
  const id = input.trim();
  if (!isId(id)) return withNotice(askIdScreen(lang), lmxm('BAD_ID', lang));
  const sender = normalizeKePhone(phone);
  try {
    // A sender we cannot normalise can never match a tenant: same answer as "not found", without calling PAY.
    return await afterLookup(phone, session, id, sender ? await lmmx.lookup(sender, id) : { kind: 'none' });
  } catch (err) {
    return lookupFailed(phone, session, err);
  }
}

export async function handleLmmxNotFound(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  const v = input.trim().toUpperCase();
  if (v === 'JOIN') return beginLmmxJoin(phone, session);
  return beginLmmx(phone, session); // RETRY, or anything else: ask for the ID again
}

export async function handleLmmxJoin(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  await clearSessionContext(phone);
  await updateSessionState(phone, STATE.MAIN_MENU, {});
  return mainMenuReply(session.language);
}

export async function handleLmmxHome(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  if (input.trim().toUpperCase() === 'PAYNOW') {
    await updateSessionState(phone, STATE.LMMX_AMOUNT, {});
    return amountScreen(session.language, Number(session.context?.lmxSug ?? 0));
  }
  if (input.trim().toUpperCase() === 'MONEY') return moneyScreen(phone, session);
  return refreshHome(phone, session);
}

/** My money: Pay landlord now, or Withdraw. */
export async function handleLmmxMoney(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  const lang = session.language;
  const choice = input.trim().toUpperCase();
  if (choice !== 'PAYLORD' && choice !== 'WITHDRAW') return moneyScreen(phone, session, lmxm('BAD_CHOICE', lang));
  const id = ctxId(session);
  const sender = normalizeKePhone(phone);
  if (!id || !sender) return beginLmmx(phone, session);
  try {
    const out = await lmmx.lookup(sender, id);
    const s = out.kind === 'standalone' ? out.standalone : undefined;
    if (!s || s.frozen || s.awaitingSetup || (s.availableMinor ?? 0) < MIN_PAYOUT) return moneyScreen(phone, session);
    const avail = s.availableMinor ?? 0;
    const fee = s.withdrawFeeMinor ?? 0;
    if (choice === 'PAYLORD') {
      await updateSessionState(phone, STATE.LMMX_LCONFIRM, {});
      return uiButtons(lmxm('LCONFIRM', lang, { avail: kes(avail) }), [btn('YES', ulabel('CONFIRM', lang)), back(lang), mainButton(lang)]);
    }
    await updateSessionState(phone, STATE.LMMX_WCONFIRM, {});
    return uiButtons(lmxm('WCONFIRM', lang, { avail: kes(avail), fee: kes(fee), net: kes(avail - fee), phone: localPhone(sender) }), [btn('YES', lmxl('SEND_CODE', lang)), back(lang), mainButton(lang)]);
  } catch (err) {
    return lookupFailed(phone, session, err);
  }
}

const isYes = (input: string): boolean => ['YES', 'NDIO', 'CONFIRM', 'THIBITISHA'].includes(input.trim().toUpperCase());

/** Confirm: pay my landlord now. */
export async function handleLmmxLConfirm(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  const lang = session.language;
  const id = ctxId(session);
  const sender = normalizeKePhone(phone);
  if (!id || !sender) return beginLmmx(phone, session);
  if (!isYes(input)) return moneyScreen(phone, session, lmxm('BAD_CHOICE', lang));
  try {
    const r = await lmmx.payLandlord(sender, id);
    await updateSessionState(phone, STATE.LMMX_DONE, {});
    return uiButtons(lmxm('LDONE', lang, { message: r.message.slice(0, 300) }), [btn('CHECK', lmxl('CHECK', lang)), mainButton(lang)]);
  } catch (err) {
    logFail('payLandlord', err);
    await updateSessionState(phone, STATE.LMMX_DONE, {});
    return uiButtons(lmxm(errorKey(err), lang), [btn('CHECK', lmxl('CHECK', lang)), mainButton(lang)]);
  }
}

/** Confirm: withdraw. Sends the code to the phone on record; the tenant replies LMW#### here (any state) or taps the SMS link. */
export async function handleLmmxWConfirm(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  const lang = session.language;
  const id = ctxId(session);
  const sender = normalizeKePhone(phone);
  if (!id || !sender) return beginLmmx(phone, session);
  if (!isYes(input)) return moneyScreen(phone, session, lmxm('BAD_CHOICE', lang));
  try {
    await lmmx.withdrawStart(sender, id);
    await updateSessionState(phone, STATE.LMMX_DONE, {});
    return uiButtons(lmxm('WCODE_SENT', lang, { phone: localPhone(sender) }), [mainButton(lang)]);
  } catch (err) {
    logFail('withdrawStart', err);
    await updateSessionState(phone, STATE.LMMX_DONE, {});
    return uiButtons(lmxm(errorKey(err), lang), [btn('CHECK', lmxl('CHECK', lang)), mainButton(lang)]);
  }
}

/** After a payment attempt, or a frozen / awaiting-setup answer: Check balance, Pay more, or leave. */
export async function handleLmmxDone(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  if (input.trim().toUpperCase() === 'PAYNOW' && ctxId(session)) {
    await updateSessionState(phone, STATE.LMMX_AMOUNT, {});
    return amountScreen(session.language, Number(session.context?.lmxSug ?? 0));
  }
  return refreshHome(phone, session);
}

export async function handleLmmxAmount(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  const lang = session.language;
  const suggested = Number(session.context?.lmxSug ?? 0);
  const id = ctxId(session);
  const sender = normalizeKePhone(phone);
  if (!id || !sender) return beginLmmx(phone, session);

  const raw = input.trim().toUpperCase() === 'SUG' ? String(suggested / 100) : input.replace(/[,\s]/g, '').replace(/^KES/i, '');
  const n = Number(raw);
  if (!/^\d+(\.0+)?$/.test(raw) || !Number.isInteger(n) || n < MIN_KES || n > MAX_KES) {
    return withNotice(amountScreen(lang, suggested), lmxm('BAD_AMOUNT', lang, { min: kesWhole(MIN_KES), max: kesWhole(MAX_KES) }));
  }
  try {
    const q = await lmmx.quote(sender, id, n * 100);
    await updateSessionContext(phone, { lmxQuote: JSON.stringify(toSaved(q)) });
    await updateSessionState(phone, STATE.LMMX_PHONE, {});
    return phoneScreen(lang, toSaved(q), sender);
  } catch (err) {
    logFail('quote', err);
    return withNotice(amountScreen(lang, suggested), lmxm(errorKey(err), lang));
  }
}

export async function handleLmmxPhone(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  const lang = session.language;
  const q = savedQuote(session);
  const sender = normalizeKePhone(phone);
  if (!q || !sender) {
    await updateSessionState(phone, STATE.LMMX_AMOUNT, {});
    return amountScreen(lang, Number(session.context?.lmxSug ?? 0));
  }
  let payer: string | null = null;
  if (input.trim().toUpperCase() === 'ME') payer = sender;
  else {
    const v = validatePhoneNumber(input);
    payer = v.valid ? normalizeKePhone(input) : null;
  }
  if (!payer) return withNotice(phoneScreen(lang, q, sender), lmxm('BAD_PHONE', lang));
  await updateSessionContext(phone, { lmxPayer: payer });
  await updateSessionState(phone, STATE.LMMX_CONFIRM, {});
  return confirmScreen(lang, q, payer);
}

export async function handleLmmxConfirm(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session);
  if (nav) return nav;
  const lang = session.language;
  const id = ctxId(session);
  const sender = normalizeKePhone(phone);
  const q = savedQuote(session);
  const payer = String(session.context?.lmxPayer ?? '');
  if (!id || !sender || !q || !payer) {
    await updateSessionState(phone, STATE.LMMX_AMOUNT, {});
    return amountScreen(lang, Number(session.context?.lmxSug ?? 0));
  }
  if (!['YES', 'NDIO', 'CONFIRM', 'THIBITISHA'].includes(input.trim().toUpperCase())) {
    return withNotice(confirmScreen(lang, q, payer), lmxm('BAD_CHOICE', lang));
  }
  try {
    let use = q;
    if (q.expiresAt <= Date.now()) {
      // The 10-minute quote has lapsed: get a fresh one and make the user look at the new numbers before anything is charged.
      use = toSaved(await lmmx.quote(sender, id, q.creditMinor));
      await updateSessionContext(phone, { lmxQuote: JSON.stringify(use) });
      return withNotice(confirmScreen(lang, use, payer), lmxm('QUOTE_REFRESHED', lang));
    }
    await lmmx.pay(sender, id, use.quoteId, payer);
    await updateSessionContext(phone, { lmxQuote: '', lmxPayer: '' });
    await updateSessionState(phone, STATE.LMMX_DONE, {});
    return uiButtons(lmxm('SENT', lang, { phone: localPhone(payer), charge: kes(use.chargeMinor) }), afterPayButtons(lang));
  } catch (err) {
    logFail('pay', err);
    await updateSessionState(phone, STATE.LMMX_DONE, {});
    const unsure = err instanceof LmmxBotError && err.timeout;
    const text = unsure ? lmxm('PAY_UNSURE', lang) : err instanceof LmmxBotError && err.code ? lmxm(errorKey(err), lang) : lmxm('PAY_FAILED', lang);
    // After a failure the quote is spent or unusable: "Pay more" starts again from the amount.
    return uiButtons(text, afterPayButtons(lang));
  }
}

// ── Codes (LMM#### / LMC####) from any state ─────────────────────────────

const summaryOf = (r: BotConfirmCodeOut): string => {
  const s = (r.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return s ? ` ${s}` : '';
};

/**
 * The reply to a message that is only an LMMX code. The webhook calls this BEFORE the state dispatch and never touches
 * the session, so a tenant can send the code from the language screen, the main menu or the middle of another flow.
 * PAY checks that the sender's number is the tenant's phone on file; the text goes to PAY as typed.
 */
export async function lmmxCodeReply(phone: string, text: string, lang: Lang): Promise<Reply> {
  const sender = normalizeKePhone(phone);
  if (!sender) return uiText(lmxm('CODE_NOT_FOUND', lang));
  try {
    const r = await lmmx.confirmCode(sender, text);
    switch (r.result) {
      case 'setup_confirmed': return uiText(lmxm('CODE_SETUP_OK', lang, { summary: summaryOf(r) }));
      case 'change_confirmed': return uiText(lmxm('CODE_CHANGE_OK', lang, { summary: summaryOf(r) }));
      case 'withdraw_requested': return uiText(lmxm('CODE_WD_OK', lang, { summary: (r.summary ?? 'Your money').replace(/\s+/g, ' ').trim().slice(0, 60), phone: LMMX_SUPPORT_PHONE }));
      case 'change_cancelled': return uiText(lmxm('CODE_CANCELLED', lang));
      case 'expired': return uiText(lmxm('CODE_EXPIRED', lang));
      case 'locked': return uiText(lmxm('CODE_LOCKED', lang));
      case 'not_found': return uiText(lmxm('CODE_NOT_FOUND', lang));
      default: return uiText(lmxm('CODE_INVALID', lang));
    }
  } catch (err) {
    logFail('confirmCode', err);
    return uiText(lmxm(err instanceof LmmxBotError && err.code === 'LMMX_E_RATE' ? 'E_RATE' : 'CODE_ERROR', lang));
  }
}
