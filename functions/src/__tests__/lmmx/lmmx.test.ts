/**
 * Lipa Mdogo Mdogo (standalone) on the bot: signing vector, code routing from every state, menu routing, lookup results,
 * the standalone happy path and each failure path, Join, and the English/Swahili copy. Runs the REAL webhook through the
 * shared Rig with LMMX_MOCK=1 (fixtures in services/lmmx.client.ts); failure paths stub single client functions.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Rig, PHONE, TENANT_ID } from '../ui/rig';
import { STATE } from '../../constants/states';
import { LMMX_LABELS, LMMX_MESSAGES, lmxl, lmxm } from '../../constants/lmmx.messages';
import { MESSAGES } from '../../constants/messages';
import { UI_LABELS, UI_MESSAGES } from '../../constants/ui.messages';
import { LmmxBotError, signBotCall } from '../../services/lmmx.client';
import { LMMX, kes, parseLmmxCode, quoteInstalment } from '../../types/lmmx.contract';
import * as client from '../../services/lmmx.client';
import * as rentPay from '../../services/payment.service';

process.env.LMMX_MOCK = '1';
const ORIG = { lookup: client.lookup, quote: client.quote, pay: client.pay, confirmCode: client.confirmCode, joinInfo: client.joinInfo, ccf: rentPay.callCloudFunction };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub = (name: keyof typeof ORIG | 'callCloudFunction', fn: any) => { ((name === 'callCloudFunction' ? rentPay : client) as any)[name] = fn; };
const LANGS = ['en', 'sw'] as const;
const MENU = (lang: 'en' | 'sw' = 'en') => new Rig({ lang, state: STATE.MAIN_MENU });
const quoteFor = (credit: number) => quoteInstalment({ creditMinor: credit, rentMinor: 1_000_000, channel: 'till', remainingRentMinor: 750_000 });

beforeEach(() => { process.env.LMMX_MOCK = '1'; });
afterEach(() => { stub('lookup', ORIG.lookup); stub('quote', ORIG.quote); stub('pay', ORIG.pay); stub('confirmCode', ORIG.confirmCode); stub('joinInfo', ORIG.joinInfo); stub('callCloudFunction', ORIG.ccf); });

describe('signing (contract S4)', () => {
  test('the exact test vector from the contract', () => {
    const payload = { phone: '+254712345678', idNumber: '12345678' };
    const a = signBotCall('lmmx_bot_lookup', payload, 'test-bot-key', 1700000000000, 'n0nce-abc123');
    assert.equal(a.sig, 'da588a8808fbc5628fc90532e2fb078e1d10b7307ae6ed15b9b252cb121851f7');
    assert.equal(a.ts, 1700000000000);
    assert.equal(a.nonce, 'n0nce-abc123');
  });
  test('ts, nonce and sig in the payload never change the signature', () => {
    const base = { phone: '+254712345678', idNumber: '12345678' };
    const a = signBotCall('lmmx_bot_lookup', base, 'k', 1, 'n');
    const b = signBotCall('lmmx_bot_lookup', { ...base, ts: 9, nonce: 'x', sig: 'y' }, 'k', 1, 'n');
    assert.equal(a.sig, b.sig);
  });
  test('without LMMX_BOT_KEY a live call fails closed and sends nothing', async () => {
    process.env.LMMX_MOCK = '0';
    let sent = false;
    stub('callCloudFunction', async () => { sent = true; return {}; });
    delete process.env.LMMX_BOT_KEY;
    await assert.rejects(client.lookup('+254712345678', '12345678'), /LMMX_BOT_KEY/);
    assert.equal(sent, false);
  });
  test('a live call carries ts, nonce and a valid sig, and PAY errors keep their lmmx code', async () => {
    process.env.LMMX_MOCK = '0';
    process.env.LMMX_BOT_KEY = 'test-bot-key';
    let seen: any; let url = '';
    stub('callCloudFunction', async (u: string, d: any) => { url = u; seen = d; return { error: { message: 'slow down', details: { lmmx: 'LMMX_E_RATE' } } }; });
    await assert.rejects(client.lookup('+254712345678', '12345678'), (e: any) => e instanceof LmmxBotError && e.code === 'LMMX_E_RATE');
    assert.match(url, /africa-south1-plot-9fd6e\.cloudfunctions\.net\/lmmx_bot_lookup$/);
    assert.deepEqual(signBotCall('lmmx_bot_lookup', { phone: '+254712345678', idNumber: '12345678' }, 'test-bot-key', seen.ts, seen.nonce).sig, seen.sig);
    delete process.env.LMMX_BOT_KEY;
  });
});

describe('codes are understood from every state without moving the user', () => {
  test('LMM4683 from every state: setup confirmed, state and context untouched', async () => {
    for (const state of Object.values(STATE)) {
      const r = new Rig({ state });
      r.context = { keep: 'me' };
      await r.say('LMM4683');
      assert.equal(r.state, state, `state ${state}`);
      assert.deepEqual(r.context, { keep: 'me' }, `context ${state}`);
      assert.match(r.allText(), /Lipa Mdogo Mdogo is on/, `reply ${state}`);
    }
  });
  test('forgiving spelling and every result, in English and Swahili', async () => {
    const cases: [string, RegExp, RegExp][] = [
      ['lmm 4683', /is on/, /imewashwa/], ['LMM-4683', /is on/, /imewashwa/], ['  LMM4683  ', /is on/, /imewashwa/],
      ['LMM5555', /Change confirmed/, /Mabadiliko yamethibitishwa/], ['LMC4683', /cancelled/, /yamefutwa/],
      ['LMM1111', /not right/, /si sahihi/], ['LMM0000', /expired/, /umeisha muda/], ['LMM9999', /locked/, /umesimamishwa/], ['LMM2222', /could not match/, /Hatukuweza kuhusisha/],
    ];
    for (const [text, en, sw] of cases) {
      const a = MENU('en'); await a.say(text); assert.match(a.allText(), en, text);
      const b = MENU('sw'); await b.say(text); assert.match(b.allText(), sw, text);
    }
  });
  test('the server summary is shown, and a code is not mistaken for other input', async () => {
    const r = MENU(); await r.say('LMM4683');
    assert.match(r.allText(), /Rent KES 10,000 due on the 5th/);
    assert.equal(parseLmmxCode('4683'), null); // a bare number is an amount or menu choice, never a code
    assert.equal(parseLmmxCode('LMM 46830'), null);
    const n = MENU(); await n.say('4683'); assert.equal(n.state, STATE.MAIN_MENU); assert.doesNotMatch(n.allText(), /Lipa Mdogo Mdogo is on/);
  });
  test('works mid-payment and the payment screen is not disturbed', async () => {
    const r = MENU(); await r.say('9'); await r.say('11111111'); await r.tap('Pay now'); await r.say('LMM4683');
    assert.equal(r.state, STATE.LMMX_AMOUNT);
    assert.match(r.allText(), /is on/);
  });
  test('PAY being down gives a calm retry message, still without moving the user', async () => {
    stub('confirmCode', async () => { throw new LmmxBotError('down'); });
    const r = MENU('sw'); await r.say('LMM4683');
    assert.equal(r.state, STATE.MAIN_MENU); assert.match(r.allText(), /Hatukuweza kuhakiki/);
  });
});

describe('main menu routing', () => {
  test('9 opens Lipa Mdogo Mdogo, 10 opens Join, and the old numbers still work', async () => {
    const a = MENU(); await a.say('9'); assert.equal(a.state, STATE.LMMX_ID); assert.match(a.allText(), /ID number/);
    const b = MENU(); await b.say('10'); assert.equal(b.state, STATE.LMMX_JOIN); assert.match(b.allText(), /0791286165/);
    const c = MENU(); await c.say('1'); assert.equal(c.state, STATE.PAY_RENT_WAITING_ID);
    const d = MENU(); await d.say('2'); assert.equal(d.state, STATE.GET_INVOICE_WAITING_ID);
    const e = MENU(); await e.say('6'); assert.equal(e.state, STATE.HELP_MENU);
    const f = MENU(); await f.say('5'); assert.equal(f.state, STATE.IDLE);
    const g = MENU(); await g.say('11'); assert.equal(g.state, STATE.MAIN_MENU); // out of range: the menu again
  });
  test('tapping the new rows works too, and Pay Rent and Lipa Mdogo Mdogo read differently', async () => {
    const r = MENU(); await r.say('#'); await r.tap('Lipa Mdogo Mdogo'); assert.equal(r.state, STATE.LMMX_ID);
    const j = MENU('sw'); await j.say('#'); await j.tap('Jiunge Lipa Mdogo Mdogo'); assert.equal(j.state, STATE.LMMX_JOIN);
    const m = MENU(); await m.say('#');
    const rows = m.lastInteractive().kind === 'list' ? (m.lastInteractive() as any).rows : [];
    const desc = (t: string) => rows.find((x: any) => x.title === t).description;
    assert.match(desc('Pay Rent'), /invoice now/); assert.match(desc('Lipa Mdogo Mdogo'), /small amounts/);
  });
  test('Join shows PAY\'s text and numbers, and still tells them how to join if PAY is down', async () => {
    const ok = MENU(); await ok.say('10'); assert.match(ok.allText(), /Your landlord does not need to join/); assert.match(ok.allText(), /0101716473/); assert.deepEqual(ok.titles(), ['Main menu']);
    stub('joinInfo', async () => { throw new LmmxBotError('down'); });
    const down = MENU('sw'); await down.say('10'); assert.match(down.allText(), /wakala wa Samuhia/); assert.match(down.allText(), /0791286165/);
    await down.tap('Menyu kuu'); assert.equal(down.state, STATE.MAIN_MENU);
  });
});

describe('my money: pay landlord now and withdraw (no amount typed, no account settings)', () => {
  const enter = async (id: string, lang: 'en' | 'sw' = 'en') => { const r = MENU(lang); await r.say('9'); await r.say(id); return r; };
  test('the home screen has My money; it shows everything available and what a withdrawal nets after the fee', async () => {
    const r = await enter('11111111'); await r.tap('My money');
    assert.equal(r.state, STATE.LMMX_MONEY); assert.match(r.body(), /KES 4,000/); assert.match(r.body(), /KES 3,971/); assert.match(r.body(), /KES 29/); assert.match(r.body(), /within 24 hours/);
    assert.deepEqual(r.titles(), ['Pay landlord now', 'Withdraw', 'Back']); assert.doesNotMatch(r.body(), /enter an amount|how much/i);
  });
  test('Pay landlord now: confirm, then it is requested (the server decides the amount and the timing)', async () => {
    const r = await enter('11111111'); await r.tap('My money'); await r.tap('Pay landlord now');
    assert.equal(r.state, STATE.LMMX_LCONFIRM); assert.match(r.body(), /KES 4,000/);
    await r.tap('Confirm'); assert.equal(r.state, STATE.LMMX_DONE); assert.match(r.body(), /within 24 hours/);
  });
  test('Withdraw: confirm shows the fee and net and that it goes only to this number; a code is texted; the LMW code works from anywhere', async () => {
    const r = await enter('11111111'); await r.tap('My money'); await r.tap('Withdraw');
    assert.equal(r.state, STATE.LMMX_WCONFIRM); assert.match(r.body(), /0712345678/); assert.match(r.body(), /KES 29/); assert.match(r.body(), /KES 3,971/); assert.match(r.body(), /only to this number/);
    await r.tap('Send me a code'); assert.equal(r.state, STATE.LMMX_DONE); assert.match(r.body(), /LMW1234/); assert.match(r.body(), /0712345678/);
    const before = r.state; await r.say('LMW4683');
    assert.match(r.allText(), /Withdrawal requested/); assert.match(r.allText(), /KES 3,971/); assert.equal(r.state, before, 'the session is not moved by the code');
    await r.say('lmw 0000'); assert.match(r.allText(), /not right|expired|match|locked|check that code/i);
  });
  test('below KES 50 there is nothing to move and no buttons to do it', async () => {
    const r = await enter('55555555'); await r.tap('My money');
    assert.equal(r.state, STATE.LMMX_MONEY); assert.match(r.body(), /at least KES 50/); assert.deepEqual(r.titles(), ['Back', 'Main menu']);
  });
  test('Back from the confirm screens returns to My money, and from My money to the home screen', async () => {
    const r = await enter('11111111'); await r.tap('My money'); await r.tap('Withdraw'); await r.tap('Back');
    assert.equal(r.state, STATE.LMMX_MONEY); await r.tap('Back'); assert.equal(r.state, STATE.LMMX_HOME);
  });
  test('Swahili works end to end', async () => {
    const r = await enter('11111111', 'sw'); await r.tap('Pesa zangu'); assert.equal(r.state, STATE.LMMX_MONEY); assert.deepEqual(r.titles().slice(0, 2), ['Lipa mwenye nyumba', 'Toa pesa']); assert.equal(r.titles().length, 3);
    await r.tap('Toa pesa'); await r.tap('Nitumie msimbo'); assert.match(r.body(), /LMW1234/); await r.say('LMW4683'); assert.match(r.allText(), /Ombi la kutoa pesa limepokelewa/);
  });
  test('a payout error from PAY is explained, never a crash; the bot has no account-settings states', async () => {
    const orig = client.payLandlord; (client as any).payLandlord = async () => { throw new LmmxBotError('too little', 'LMMX_E_AMOUNT'); };
    try { const r = await enter('11111111'); await r.tap('My money'); await r.tap('Pay landlord now'); await r.tap('Confirm'); assert.equal(r.state, STATE.LMMX_DONE); assert.ok(r.body().length > 10); }
    finally { (client as any).payLandlord = orig; }
    assert.deepEqual(Object.values(STATE).filter((s) => /SETTING|PROFILE|NAME|CHANGE|DUE_?DAY|PLAN/i.test(String(s)) && /LMMX/.test(String(s))), []);
  });
});

describe('lookup results', () => {
  const enter = async (id: string, lang: 'en' | 'sw' = 'en') => { const r = MENU(lang); await r.say('9'); await r.say(id); return r; };
  test('standalone: status with rent, balance, due and pay-by dates', async () => {
    const r = await enter('11111111');
    assert.equal(r.state, STATE.LMMX_HOME);
    assert.match(r.body(), /Hello Mary/); assert.match(r.body(), /KES 10,000/); assert.match(r.body(), /KES 7,500/); assert.match(r.body(), /5 Dec/); assert.match(r.body(), /2 Dec/);
    assert.match(r.body(), /Pay by 2 Dec so your landlord gets all of it on 5 Dec/);
    assert.deepEqual(r.titles(), ['Pay now', 'My money', 'Main menu']);
  });
  test('none (also a phone and ID mismatch): friendly not-found with three ways forward', async () => {
    const r = await enter('99999999');
    assert.equal(r.state, STATE.LMMX_NOTFOUND); assert.match(r.body(), /could not find an account/);
    assert.deepEqual(r.titles(), ['Try again', 'Join Lipa Mdogo', 'Main menu']);
    await r.tap('Try again'); assert.equal(r.state, STATE.LMMX_ID);
    const j = await enter('99999999'); await j.tap('Join Lipa Mdogo'); assert.equal(j.state, STATE.LMMX_JOIN);
    const sw = await enter('99999999', 'sw'); assert.deepEqual(sw.titles(), ['Jaribu tena', 'Jiunge Lipa Mdogo', 'Menyu kuu']);
  });
  test('the answer is the same for "not found" and "wrong phone": the bot adds nothing that tells them apart', async () => {
    const a = await enter('99999999'); const b = await enter('88888888');
    assert.equal(a.body(), b.body());
  });
  test('frozen: on hold, contact support', async () => {
    const r = await enter('33333333'); assert.match(r.body(), /on hold/); assert.match(r.body(), /0791286165/); assert.deepEqual(r.titles(), ['Main menu']);
    const sw = await enter('33333333', 'sw'); assert.match(sw.body(), /imesitishwa/);
  });
  test('awaiting setup: send the code from the SMS, and sending it works from that very screen', async () => {
    const r = await enter('44444444'); assert.match(r.body(), /send the code from your SMS/); assert.match(r.body(), /LMM1234/);
    await r.say('LMM4683'); assert.match(r.allText(), /is on/); assert.equal(r.state, STATE.LMMX_DONE);
  });
  test('legacy: the existing plan flow starts, using the same lookup as Pay Rent', async () => {
    stub('lookup', async () => ({ kind: 'legacy' }));
    stub('callCloudFunction', async (url: string) => url.endsWith('lmm_getPlan')
      ? { available: true, plan: { frequency: 'weekly', status: 'active', targetMinor: 1_550_000, creditedMinor: 300_000, remainingMinor: 1_250_000, pct: 19, settlesOn: '2026-11-05', suggestedMinor: 300_000 } } : {});
    const r = await enter(TENANT_ID);
    assert.equal(r.state, STATE.LMM_MENU); assert.match(r.body(), /Lipa Mdogo Mdogo/); assert.match(r.body(), /KES 15,500/);
    assert.equal(r.context.assetId, 'asset1');
  });
  test('legacy lookup says legacy but the tenant is not in PMS: not found, not a crash', async () => {
    stub('lookup', async () => ({ kind: 'legacy' }));
    const r = await enter('77777777'); assert.equal(r.state, STATE.LMMX_NOTFOUND);
  });
  test('a bad ID is refused before PAY is asked; PAY errors and PAY being down are explained', async () => {
    let calls = 0; stub('lookup', async () => { calls++; return { kind: 'none' }; });
    const r = MENU(); await r.say('9'); await r.say('12'); assert.equal(r.state, STATE.LMMX_ID); assert.match(r.body(), /not look like a valid ID/); assert.equal(calls, 0);
    stub('lookup', async () => { throw new LmmxBotError('x', 'LMMX_E_RATE'); });
    await r.say('11111111'); assert.equal(r.state, STATE.LMMX_NOTFOUND); assert.match(r.body(), /Too many tries/); assert.deepEqual(r.titles(), ['Try again', 'Main menu']);
    stub('lookup', async () => { throw new LmmxBotError('x', 'LMMX_E_DISABLED'); });
    const d = await enter('11111111'); assert.match(d.body(), /not available right now/);
    stub('lookup', async () => { throw new LmmxBotError('x'); });
    const e = await enter('11111111', 'sw'); assert.match(e.body(), /Kuna tatizo upande wetu/);
  });
});

describe('standalone flow', () => {
  const toAmount = async (lang: 'en' | 'sw' = 'en') => { const r = MENU(lang); await r.say('9'); await r.say('11111111'); await r.tap(lang === 'en' ? 'Pay now' : 'Lipa sasa'); return r; };
  test('happy path with the suggested amount: quote shows rent, fees and total from PAY, then STK', async () => {
    const q = quoteFor(250_000);
    const r = await toAmount();
    assert.equal(r.state, STATE.LMMX_AMOUNT); assert.match(r.body(), /Suggested: KES 2,500/); assert.deepEqual(r.titles(), ['Pay KES 2,500', 'Back', 'Main menu']);
    await r.tap('Pay KES 2,500');
    assert.equal(r.state, STATE.LMMX_PHONE);
    assert.match(r.body(), /Goes to your rent: KES 2,500/); assert.match(r.body(), new RegExp(`Fees: ${kes(q.feesMinor)}`)); assert.match(r.body(), new RegExp(`You pay: ${kes(q.chargeMinor)}`));
    assert.deepEqual(r.titles(), ['Use 0712345678', 'Back', 'Main menu']);
    await r.tap('Use 0712345678');
    assert.equal(r.state, STATE.LMMX_CONFIRM); assert.match(r.body(), /M-Pesa number: 0712345678/);
    await r.tap('Confirm');
    assert.equal(r.state, STATE.LMMX_DONE); assert.match(r.body(), /M-Pesa prompt sent to 0712345678/); assert.match(r.body(), new RegExp(kes(q.chargeMinor)));
    assert.doesNotMatch(r.body(), /received|successful|paid in full/i); // the bot never claims success: PAY's SMS does
    assert.deepEqual(r.titles(), ['Check balance', 'Pay more', 'Main menu']);
  });
  test('typed amount and another payer number; the pay call gets the quote id, the ID and the payer in E.164', async () => {
    let seen: any; stub('pay', async (...a: any[]) => { seen = a; return ORIG.pay(a[0], a[1], a[2], a[3]); });
    const r = await toAmount(); await r.say('KES 1,000'); assert.equal(r.state, STATE.LMMX_PHONE);
    await r.say('0733445566'); await r.say('YES');
    assert.deepEqual(seen, ['+254712345678', '11111111', 'mock-quote-100000', '+254733445566']);
    assert.equal(r.state, STATE.LMMX_DONE);
  });
  test('Check balance and Pay more after paying', async () => {
    const r = await toAmount(); await r.say('500'); await r.tap('Use 0712345678'); await r.tap('Confirm');
    await r.tap('Check balance'); assert.equal(r.state, STATE.LMMX_HOME);
    await r.tap('Pay now'); await r.say('500'); await r.say('ME'); await r.say('YES');
    await r.tap('Pay more'); assert.equal(r.state, STATE.LMMX_AMOUNT);
  });
  test('amount rules: whole shillings, at least KES 10, at most KES 150,000; PAY decides the rest', async () => {
    const r = await toAmount();
    for (const bad of ['abc', '9', '12.5', '150001', '-50']) { await r.say(bad); assert.equal(r.state, STATE.LMMX_AMOUNT, bad); assert.match(r.body(), /whole number of shillings between KES 10 and KES 150,000/, bad); }
    await r.say('8000'); // more than the KES 7,500 balance: PAY refuses
    assert.equal(r.state, STATE.LMMX_AMOUNT); assert.match(r.body(), /cannot be paid right now/);
    await r.say('10'); assert.equal(r.state, STATE.LMMX_PHONE); // the minimum is accepted
  });
  test('invalid M-Pesa number and a typed word at the confirm step are explained', async () => {
    const r = await toAmount(); await r.say('500');
    for (const bad of ['12345', '0812345678', '+254712345678x']) { await r.say(bad); assert.equal(r.state, STATE.LMMX_PHONE, bad); assert.match(r.body(), /not valid/); }
    await r.say('0712345678'); await r.say('maybe'); assert.equal(r.state, STATE.LMMX_CONFIRM); assert.match(r.body(), /Confirm/);
  });
  test('PAY refuses the payment: explained, nothing claimed, retry offered', async () => {
    const r = await toAmount(); await r.say('500'); await r.say('0700000000'); await r.say('YES');
    assert.equal(r.state, STATE.LMMX_DONE); assert.match(r.body(), /cannot take a payment right now/); assert.match(r.body(), /0791286165/);
    assert.deepEqual(r.titles(), ['Check balance', 'Pay more', 'Main menu']);
  });
  test('PAY does not answer in time: the user is told it is unknown and to check before paying again', async () => {
    const r = await toAmount(); await r.say('500'); await r.say('0711111111'); await r.say('YES');
    assert.equal(r.state, STATE.LMMX_DONE); assert.match(r.body(), /could not confirm if the M-Pesa prompt was sent/); assert.match(r.body(), /do not pay twice/);
  });
  test('any other failure says nothing was taken', async () => {
    stub('pay', async () => { throw new LmmxBotError('boom'); });
    const r = await toAmount(); await r.say('500'); await r.say('ME'); await r.say('YES');
    assert.match(r.body(), /Nothing is taken from your M-Pesa until you enter your PIN/);
  });
  test('an expired quote is refreshed and shown again before anything is charged', async () => {
    let paid = 0; let n = 0;
    stub('quote', async (p: string, id: string, c: number) => { const q = await ORIG.quote(p, id, c); return n++ === 0 ? { ...q, expiresAt: Date.now() - 1000 } : q; });
    stub('pay', async (...a: any[]) => { paid++; return ORIG.pay(a[0], a[1], a[2], a[3]); });
    const r = await toAmount(); await r.say('500'); await r.say('ME'); await r.say('YES');
    assert.equal(paid, 0); assert.equal(r.state, STATE.LMMX_CONFIRM); assert.match(r.body(), /price was refreshed/);
    await r.say('YES'); assert.equal(paid, 1); assert.equal(r.state, STATE.LMMX_DONE);
  });
  test('0 goes back one step at a time, # is the main menu, 00 restarts, 000 leaves', async () => {
    const r = await toAmount(); await r.say('500'); await r.say('ME');
    assert.equal(r.state, STATE.LMMX_CONFIRM); await r.say('0'); assert.equal(r.state, STATE.LMMX_PHONE);
    await r.say('0'); assert.equal(r.state, STATE.LMMX_AMOUNT); await r.say('0'); assert.equal(r.state, STATE.LMMX_HOME);
    await r.say('0'); assert.equal(r.state, STATE.LMMX_ID); await r.say('0'); assert.equal(r.state, STATE.MAIN_MENU);
    const a = await toAmount(); await a.say('#'); assert.equal(a.state, STATE.MAIN_MENU); assert.deepEqual(a.context, {});
    const b = await toAmount(); await b.say('00'); assert.equal(b.state, STATE.MAIN_MENU);
    const c = await toAmount(); await c.say('000'); assert.equal(c.state, STATE.LANGUAGE_SELECTION);
  });
  test('Swahili happy path', async () => {
    const r = await toAmount('sw'); assert.match(r.body(), /Ilipendekezwa: KES 2,500/);
    await r.tap('Lipa KES 2,500'); assert.match(r.body(), /Inaenda kwenye kodi yako/); await r.tap('Tumia 0712345678'); assert.match(r.body(), /Namba ya M-Pesa/);
    await r.tap('Thibitisha'); assert.match(r.body(), /Ombi la M-Pesa limetumwa/); assert.deepEqual(r.titles(), ['Angalia salio', 'Lipa zaidi', 'Menyu kuu']);
  });
  test('the session keeps no ID or quote after leaving', async () => {
    const r = await toAmount(); await r.say('500'); await r.say('#'); assert.deepEqual(r.context, {});
  });
});

describe('copy', () => {
  const holes = (t: string) => (t.match(/\{(\w+)\}/g) ?? []).sort().join(',');
  test('every message and label exists in English and Swahili, with the same placeholders', () => {
    for (const [k, v] of Object.entries({ ...LMMX_MESSAGES, ...LMMX_LABELS })) {
      assert.ok(v.en.trim() && v.sw.trim(), k);
      assert.equal(holes(v.en), holes(v.sw), k);
    }
  });
  test('every new key resolves through lmxm and lmxl in both languages, with no unfilled placeholder but the documented ones', () => {
    for (const lang of LANGS) {
      for (const k of Object.keys(LMMX_MESSAGES)) assert.doesNotMatch(lmxm(k as any, lang, { text: 't', phones: 'p', name: 'n', rent: 'r', balance: 'b', due: 'd', payby: 'p', min: '1', max: '2', suggested: 's', credit: 'c', fees: 'f', charge: 'g', phone: '0', summary: '', avail: 'a', net: 'n', fee: 'f', message: 'm' }), /\{\w+\}/, k);
      for (const k of Object.keys(LMMX_LABELS)) assert.ok(lmxl(k as any, lang, { amount: 'KES 1,250,000,000' }).length <= 20, k);
    }
  });
  test('the brand is Lipa Mdogo Mdogo everywhere a tenant reads it; "Lipa Mos Mos" is gone', () => {
    const all = JSON.stringify([LMMX_MESSAGES, LMMX_LABELS, MESSAGES, UI_LABELS, UI_MESSAGES]);
    assert.doesNotMatch(all, /Mos Mos/);
    assert.equal(LMMX.OTP_PREFIX, 'LMM');
  });
  test('menu labels fit WhatsApp limits (button 20, row title 24, description 72)', async () => {
    const r = MENU(); await r.say('#');
    for (const row of (r.lastInteractive() as any).rows) { assert.ok(row.title.length <= 24, row.title); assert.ok(row.description.length <= 72, row.description); }
    void PHONE;
  });
});
