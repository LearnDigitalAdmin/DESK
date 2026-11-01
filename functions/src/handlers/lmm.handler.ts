/**
 * Lipa Mos Mos on WhatsApp: pay rent a little at a time. Reached from the tenant-found screen of Pay Rent.
 * All money logic (the 2.5% / 5% fee, the plan, settling the landlord) lives in PAY; this file only asks PAY and shows the answers.
 * The bot never sends a destination or a credited amount it decided itself: PAY recomputes and verifies everything.
 */
import { Session } from '../types/session.types';
import { updateSessionState, updateSessionContext, clearSessionContext } from '../services/session.service';
import { validatePhoneNumber, checkNavigationCommand } from '../utils/validator';
import { getMessage } from '../constants/messages';
import { ulabel } from '../constants/ui.messages';
import { STATE } from '../constants/states';
import { logger } from '../utils/logger';
import { callCloudFunction } from '../services/payment.service';
import { btn, mainButton, mainMenuReply, Reply, row, uiButtons, uiList, welcomeReply, withNotice } from '../utils/ui';
import { Outbound } from '../types/watch.types';
import { tenantFoundScreen } from './rent.handler';

type Lang = Session['language'];
type Frequency = 'daily' | 'weekly' | 'biweekly';

const BASE = process.env.PAY_FUNCTIONS_BASE || 'https://africa-south1-plot-9fd6e.cloudfunctions.net';
const MAX_KES = 150000;
const MIN_KES = 10;

interface PlanView { frequency: Frequency; targetMinor: number; creditedMinor: number; remainingMinor: number; pct: number; settlesOn: string; suggestedMinor: number }
interface PlanRes { available: boolean; reason?: string; plan?: PlanView | null; targetMinor?: number; settlesOn?: string; suggestedMinor?: number }

const kes = (minor: number): string => `KES ${(minor / 100).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const kesWhole = (n: number): string => `KES ${n.toLocaleString('en-KE')}`;
/** Same rule PAY applies (it recomputes and verifies it): 5% under KES 100, otherwise 2.5%, rounded up to a whole shilling. Preview only. */
export const previewCharge = (credit: number): { total: number; fee: number; pct: string } => {
  const bps = credit < 100 ? 500 : 250;
  const total = Math.ceil((credit * (10_000 + bps)) / 10_000);
  return { total, fee: total - credit, pct: bps === 500 ? '5' : '2.5' };
};

async function pay<T>(name: string, data: unknown): Promise<T> {
  const res = await callCloudFunction(`${BASE}/${name}`, data);
  if (res?.error) throw new Error(String(res.error.message || 'request failed'));
  return res as T;
}

function ids(session: Session): { agentId: string; tenantId: string; tenantPhone?: string } | null {
  const ctx = session.context || {};
  try {
    const invoice = ctx.foundInvoice ? JSON.parse(ctx.foundInvoice as string) : null;
    const tenant = ctx.foundTenant ? JSON.parse(ctx.foundTenant as string) : null;
    if (!invoice || !ctx.assetId) return null;
    return { agentId: String(ctx.assetId), tenantId: String(invoice.tenantId), tenantPhone: tenant?.phone };
  } catch { return null; }
}

const back = (lang: Lang) => btn('0', ulabel('BACK', lang));
const freqLabel = (f: Frequency, lang: Lang) => ulabel(f === 'daily' ? 'DAILY' : f === 'weekly' ? 'WEEKLY' : 'BIWEEKLY', lang);

const freqScreen = (lang: Lang, res: PlanRes): Outbound =>
  uiList(
    getMessage('LMM_INTRO', lang, { due: kes(res.plan?.targetMinor ?? res.targetMinor ?? 0), settles: res.settlesOn ?? res.plan?.settlesOn ?? '' }),
    ulabel('LIST_BUTTON', lang),
    [row('daily', ulabel('DAILY', lang)), row('weekly', ulabel('WEEKLY', lang)), row('biweekly', ulabel('BIWEEKLY', lang)), row('0', ulabel('BACK', lang)), row('#', ulabel('MAIN', lang))],
  );

const statusScreen = (lang: Lang, plan: PlanView): Outbound =>
  uiButtons(
    getMessage('LMM_STATUS', lang, { paid: kes(plan.creditedMinor), due: kes(plan.targetMinor), pct: String(plan.pct), balance: kes(plan.remainingMinor), settles: plan.settlesOn, freq: freqLabel(plan.frequency, lang) }),
    [btn('PAYNOW', ulabel('PAY_NOW', lang)), btn('FREQ', ulabel('CHANGE_PLAN', lang)), back(lang)],
  );

const askAmount = (lang: Lang, suggestedMinor: number): Outbound =>
  uiButtons(getMessage('LMM_ASK_AMOUNT', lang, { max: kesWhole(MAX_KES), suggested: kes(suggestedMinor) }), [back(lang), mainButton(lang)]);

const askPhone = (lang: Lang): Outbound => uiButtons(getMessage('ENTER_MPESA_PHONE', lang), [back(lang), mainButton(lang)]);

const summary = (lang: Lang, credit: number, phone: string): Outbound => {
  const c = previewCharge(credit);
  return uiButtons(getMessage('LMM_SUMMARY', lang, { credit: kesWhole(credit), pct: c.pct, fee: kesWhole(c.fee), total: kesWhole(c.total), phone }), [btn('YES', ulabel('CONFIRM', lang)), back(lang), mainButton(lang)]);
};

/** Typed navigation inside Lipa Mos Mos: 0 goes back one step, 00 restarts Pay Rent, 000 leaves, # is the main menu (a button). */
async function navigate(phone: string, input: string, session: Session): Promise<Reply | null> {
  const lang = session.language;
  const nav = checkNavigationCommand(input);
  if (nav.type === 'exit') { await clearSessionContext(phone); await updateSessionState(phone, STATE.LANGUAGE_SELECTION, {}); return welcomeReply(); }
  if (nav.type === 'restart') { await clearSessionContext(phone); await updateSessionState(phone, STATE.MAIN_MENU, {}); return mainMenuReply(lang); }
  if (nav.type !== 'back') return null;
  const prev: Partial<Record<string, STATE>> = { [STATE.LMM_MENU]: STATE.PAY_RENT_MPESA, [STATE.LMM_FREQ]: STATE.LMM_MENU, [STATE.LMM_AMOUNT]: STATE.LMM_MENU, [STATE.LMM_PHONE]: STATE.LMM_AMOUNT, [STATE.LMM_CONFIRM]: STATE.LMM_PHONE };
  const target = prev[session.currentState];
  if (target === STATE.PAY_RENT_MPESA) {
    const screen = tenantFoundScreen(session);
    if (screen) { await updateSessionState(phone, STATE.PAY_RENT_MPESA, {}); return screen; }
  } else if (target === STATE.LMM_MENU) return startLmm(phone, session);
  else if (target === STATE.LMM_AMOUNT) { await updateSessionState(phone, STATE.LMM_AMOUNT, {}); return askAmount(lang, Number(session.context?.lmmSuggested ?? 0)); }
  else if (target === STATE.LMM_PHONE) { await updateSessionState(phone, STATE.LMM_PHONE, {}); return askPhone(lang); }
  await clearSessionContext(phone); await updateSessionState(phone, STATE.MAIN_MENU, {});
  return mainMenuReply(lang);
}

const fail = async (phone: string, session: Session, err: unknown): Promise<Reply> => {
  logger.error('Lipa Mos Mos error', err);
  const reason = err instanceof Error ? err.message : 'please try again';
  await updateSessionState(phone, STATE.LMM_MENU, {});
  return withNotice(uiButtons(getMessage('LMM_ERROR', session.language, { reason }), [btn('RETRY', ulabel('LMM', session.language)), mainButton(session.language)]), '');
};

/** Entry point, from the tenant-found screen. Shows the plan (or asks how often to pay if there is none yet). */
export async function startLmm(phone: string, session: Session): Promise<Reply> {
  const lang = session.language;
  const who = ids(session);
  if (!who) { await clearSessionContext(phone); await updateSessionState(phone, STATE.MAIN_MENU, {}); return mainMenuReply(lang); }
  try {
    const res = await pay<PlanRes>('lmm_getPlan', { agentId: who.agentId, tenantId: who.tenantId });
    if (!res.available) {
      await updateSessionState(phone, STATE.PAY_RENT_MPESA, {});
      const base = tenantFoundScreen(session);
      return base ? withNotice(base, getMessage('LMM_UNAVAILABLE', lang, { reason: res.reason ?? '' })) : mainMenuReply(lang);
    }
    await updateSessionContext(phone, { lmmSuggested: res.plan?.suggestedMinor ?? res.suggestedMinor ?? 0 });
    await updateSessionState(phone, STATE.LMM_MENU, {});
    return res.plan ? statusScreen(lang, res.plan) : freqScreen(lang, res);
  } catch (err) { return fail(phone, session, err); }
}

export async function handleLmmMenu(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session); if (nav) return nav;
  const lang = session.language; const v = input.trim().toUpperCase();
  const who = ids(session);
  if (!who) return startLmm(phone, session);
  if (v === 'RETRY') return startLmm(phone, session);
  if (v === 'FREQ') { await updateSessionState(phone, STATE.LMM_FREQ, {}); return freqScreen(lang, { available: true }); }
  if (v === 'PAYNOW' || v === 'DAILY' || v === 'WEEKLY' || v === 'BIWEEKLY') {
    if (v !== 'PAYNOW') return handleLmmFreq(phone, input, { ...session, currentState: STATE.LMM_FREQ });
    await updateSessionState(phone, STATE.LMM_AMOUNT, {});
    return askAmount(lang, Number(session.context?.lmmSuggested ?? 0));
  }
  return startLmm(phone, session);
}

/** Choosing how often starts (or changes) the plan, then goes straight to "how much now?". */
export async function handleLmmFreq(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session); if (nav) return nav;
  const lang = session.language; const v = input.trim().toLowerCase();
  const who = ids(session);
  if (!who) return startLmm(phone, session);
  if (v !== 'daily' && v !== 'weekly' && v !== 'biweekly') return withNotice(freqScreen(lang, { available: true }), getMessage('INVALID_INPUT', lang));
  try {
    const res = await pay<{ plan: PlanView }>('lmm_start', { agentId: who.agentId, tenantId: who.tenantId, frequency: v });
    await updateSessionContext(phone, { lmmSuggested: res.plan.suggestedMinor });
    await updateSessionState(phone, STATE.LMM_AMOUNT, {});
    return askAmount(lang, res.plan.suggestedMinor);
  } catch (err) { return fail(phone, session, err); }
}

export async function handleLmmAmount(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session); if (nav) return nav;
  const lang = session.language;
  const cleaned = input.replace(/[,\s]/g, '').replace(/^KES/i, '');
  const n = Number(cleaned);
  if (!/^\d+$/.test(cleaned) || !Number.isInteger(n) || n < MIN_KES || n > MAX_KES) {
    return withNotice(askAmount(lang, Number(session.context?.lmmSuggested ?? 0)), getMessage('LMM_INVALID_AMOUNT', lang, { max: kesWhole(MAX_KES) }));
  }
  await updateSessionContext(phone, { lmmAmount: n });
  await updateSessionState(phone, STATE.LMM_PHONE, {});
  return askPhone(lang);
}

export async function handleLmmPhone(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session); if (nav) return nav;
  const lang = session.language;
  const mpesaPhone = input.trim();
  const v = validatePhoneNumber(mpesaPhone);
  if (!v.valid) return withNotice(askPhone(lang), getMessage('INVALID_PHONE', lang));
  const amount = Number(session.context?.lmmAmount);
  if (!Number.isInteger(amount)) return startLmm(phone, session);
  await updateSessionContext(phone, { lmmPhone: mpesaPhone });
  await updateSessionState(phone, STATE.LMM_CONFIRM, {});
  return summary(lang, amount, mpesaPhone);
}

export async function handleLmmConfirm(phone: string, input: string, session: Session): Promise<Reply> {
  const nav = await navigate(phone, input, session); if (nav) return nav;
  const lang = session.language; const ctx = session.context || {};
  const who = ids(session); const amount = Number(ctx.lmmAmount); const mpesaPhone = String(ctx.lmmPhone ?? '');
  if (!who || !Number.isInteger(amount) || !mpesaPhone) return startLmm(phone, session);
  if (!['YES', 'NDIO', 'CONFIRM', 'THIBITISHA'].includes(input.trim().toUpperCase())) return withNotice(summary(lang, amount, mpesaPhone), getMessage('INVALID_INPUT', lang));
  try {
    await pay('lmm_pay', { agentId: who.agentId, tenantId: who.tenantId, amount, phone: mpesaPhone });
    await updateSessionState(phone, STATE.MAIN_MENU, {});
    await clearSessionContext(phone);
    return [{ kind: 'text', text: getMessage('LMM_SENT', lang) } as Outbound, mainMenuReply(lang)];
  } catch (err) { return fail(phone, session, err); }
}
