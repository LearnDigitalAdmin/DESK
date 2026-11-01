import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rig, TENANT_ID, contributions } from './rig';
import { STATE } from '../../constants/states';

const fresh = (lang: 'en' | 'sw' = 'en', state: string = STATE.MAIN_MENU) => new Rig({ lang, state });
const ids = (r: Rig) => {
  const o = r.lastInteractive();
  return o.kind === 'buttons' ? o.buttons.map((b) => b.id) : o.rows.map((x) => x.id);
};

describe('language and main menu', () => {
  test('first message shows language buttons; picking one shows the main menu list in that language', async () => {
    const r = fresh('en', STATE.LANGUAGE_SELECTION);
    await r.say('hi');
    assert.deepEqual(r.titles(), ['English', 'Kiswahili']);
    await r.tap('Kiswahili');
    assert.equal(r.language, 'sw');
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.equal(r.lastInteractive().kind, 'list');
    assert.ok(r.titles().includes('Lipa Kodi'));
    assert.equal(r.titles().length, 8);
  });

  test('typed numbers still work: 6 opens Help, then Main menu returns', async () => {
    const r = fresh();
    await r.say('6');
    assert.equal(r.state, STATE.HELP_MENU);
    assert.match(r.body(), /Help & Support/);
    assert.deepEqual(r.titles(), ['Main menu']);
    await r.tap('Main menu');
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.equal(r.titles().length, 8);
  });

  test('Help: any message returns to the main menu (it used to fall into "Unknown state")', async () => {
    const r = fresh('en', STATE.HELP_MENU);
    await r.say('0');
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.equal(r.lastInteractive().kind, 'list');
    assert.doesNotMatch(r.allText(), /error occurred/i);
  });

  test('Manage My Plot shows the links with a Main menu button; Exit says goodbye; the next message brings the menu back', async () => {
    const r = fresh();
    await r.say('hi');
    await r.tap('Manage My Plot');
    assert.match(r.body(), /plot\.samuhia\.co\.ke/);
    await r.tap('Main menu');
    await r.say('5');
    assert.equal(r.state, STATE.IDLE);
    assert.match(r.allText(), /Thank you for using SAMUHIA/);
    await r.say('hello again');
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.equal(r.lastInteractive().kind, 'list');
  });

  test('tapping a list row is the same as typing its number', async () => {
    const r = fresh();
    await r.say('hi');
    await r.tap('Help');
    assert.equal(r.state, STATE.HELP_MENU);
  });
});

describe('stale taps', () => {
  test('a tap on an old screen is answered with a notice and does nothing', async () => {
    const r = fresh();
    await r.say('1'); // Pay Rent: now waiting for the tenant ID
    assert.equal(r.state, STATE.PAY_RENT_WAITING_ID);
    await r.tapId('ui:MAIN_MENU:6'); // "Help" from the main menu shown earlier
    assert.equal(r.state, STATE.PAY_RENT_WAITING_ID, 'state is untouched');
    assert.match(r.body(), /no longer active/);
    assert.deepEqual(r.titles(), ['Main menu']);
  });

  test('an expired session answers an old tap with the language chooser', async () => {
    const r = fresh('en', STATE.LANGUAGE_SELECTION);
    await r.tapId('ui:MAIN_MENU:1');
    assert.deepEqual(r.titles(), ['English', 'Kiswahili']);
  });

  test('a double tap on Confirm cannot pay twice: the second tap is stale once the first has run', async () => {
    const r = fresh();
    await r.say('1');
    await r.say(TENANT_ID);
    await r.tap('Pay in full');
    await r.say('0712345678');
    await r.tap('Pay full amount');
    const confirmId = ids(r)[0];
    await r.tapId(confirmId, 'button_reply');
    assert.equal(r.payments.length, 1);
    await r.tapId(confirmId, 'button_reply');
    assert.equal(r.payments.length, 1);
  });
});

describe('Pay Rent', () => {
  test('happy path with buttons, Back at every step, and the payment is initiated once', async () => {
    const r = fresh();
    await r.say('1');
    assert.deepEqual(r.titles(), ['Main menu']);

    await r.say('abc');
    assert.match(r.body(), /Invalid National ID/);
    await r.say('35792468');
    assert.match(r.body(), /Tenant not found/);

    await r.say(TENANT_ID);
    assert.equal(r.state, STATE.PAY_RENT_MPESA);
    assert.match(r.body(), /Jane Wanjiru/);
    assert.match(r.body(), /15,500/);
    assert.deepEqual(r.titles(), ['Pay in full', 'Lipa Mos Mos', 'Search again', 'Main menu']);

    await r.tap('Pay in full');
    assert.equal(r.state, STATE.PAY_RENT_AMOUNT);
    assert.deepEqual(r.titles(), ['Back', 'Main menu']);

    await r.tap('Back'); // used to land on the tenant-ID prompt in the wrong state
    assert.equal(r.state, STATE.PAY_RENT_MPESA);
    assert.match(r.body(), /Jane Wanjiru/);
    await r.tap('Pay in full');

    await r.say('12345');
    assert.match(r.body(), /Invalid phone number/);
    await r.say('0712345678');
    assert.equal(r.state, STATE.PAY_RENT_PROCESSING);
    assert.deepEqual(r.titles(), ['Pay full amount', 'Back', 'Main menu']);

    await r.say('99999');
    assert.match(r.body(), /cannot exceed/);
    await r.tap('Pay full amount');
    assert.equal(r.state, STATE.PAY_RENT_CONFIRM_AMOUNT);
    assert.match(r.body(), /15,500/);
    assert.match(r.body(), /0712345678/);
    assert.deepEqual(r.titles(), ['Confirm', 'Back', 'Main menu']);

    await r.tap('Back');
    assert.equal(r.state, STATE.PAY_RENT_PROCESSING);
    await r.say('5000');
    assert.match(r.body(), /5,000/);

    await r.tap('Confirm');
    assert.equal(r.payments.length, 1);
    assert.equal(r.payments[0].amount, 5000);
    assert.equal(r.payments[0].phone, '0712345678');
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.equal(r.kinds(), 'text,list', 'result, then the main menu');
    assert.match(r.allText(), /Payment initiated/);
    assert.match(r.allText(), /RENT-REF-1/);
    assert.doesNotMatch(r.allText(), /Returning to Main Menu/);
  });

  test('Search again restarts; Back from the first step and # leave to the main menu', async () => {
    const r = fresh();
    await r.say('1');
    await r.say(TENANT_ID);
    await r.tap('Search again');
    assert.equal(r.state, STATE.PAY_RENT_WAITING_ID);
    assert.equal(r.context.foundTenant, undefined);
    await r.say('0');
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.equal(r.lastInteractive().kind, 'list');

    await r.say('1');
    await r.say(TENANT_ID);
    await r.tap('Main menu');
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.deepEqual(r.context, {});
  });

  test('Swahili copy uses the correct word for tenant', async () => {
    const r = fresh('sw');
    await r.say('1');
    await r.say(TENANT_ID);
    assert.match(r.body(), /Mpangaji amepatikana/);
    assert.doesNotMatch(r.body(), /[Mm]kokoteni/);
    assert.deepEqual(r.titles(), ['Lipa kikamilifu', 'Lipa Mos Mos', 'Tafuta tena', 'Menyu kuu']);
  });
});

describe('Get Invoice', () => {
  test('shows the invoice with its link; Another invoice and a typed ID both start a fresh lookup', async () => {
    const r = fresh();
    await r.say('2');
    await r.say(TENANT_ID);
    assert.match(r.body(), /Invoice/);
    assert.match(r.body(), /Outstanding: .*15,500/);
    assert.match(r.body(), /files\.example\/inv1\.pdf/);
    assert.deepEqual(r.titles(), ['Another invoice', 'Main menu']);

    await r.tap('Another invoice');
    assert.deepEqual(r.titles(), ['Main menu']);
    await r.say(TENANT_ID); // the second lookup used to be impossible
    assert.match(r.body(), /Invoice/);

    await r.say(TENANT_ID); // typing an ID straight away also works
    assert.match(r.body(), /Invoice/);

    await r.tap('Main menu');
    assert.equal(r.state, STATE.MAIN_MENU);
  });
});

describe('My Chama', () => {
  const signIn = async (r: Rig) => {
    await r.say('3');
    assert.equal(r.state, STATE.MYCHAMA_AUTH_ID);
    assert.deepEqual(r.titles(), ['Cancel']);
    await r.say('1234');
  };

  test('ID check, then the My Chama menu as a list (Switch Chama hidden for a single chama)', async () => {
    const r = fresh();
    await r.say('3');
    await r.say('12'); // not 4 digits
    assert.match(r.body(), /exactly 4 digits/);
    await signIn(r);
    assert.equal(r.state, STATE.MYCHAMA_MENU);
    assert.deepEqual(r.titles(), ['Pay Contribution', 'Apply for a Loan', 'Repay a Loan', 'Loan Balance', 'Merry-Go-Round', 'Get Statement', 'Main Menu']);
    assert.match(r.body(), /Umoja Chama/);
    assert.match(r.body(), /Wanjiru Kamau/);
  });

  test('Cancel on the ID prompt returns to the main menu', async () => {
    const r = fresh();
    await r.say('3');
    await r.tap('Cancel');
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.equal(r.titles().length, 8);
  });

  test('contribution: paged picker (12 periods), pick the 9th on page 2, pay in full through phone, network and confirm', async () => {
    const r = fresh();
    await signIn(r);
    await r.tap('Pay Contribution');
    assert.equal(r.state, STATE.MYCHAMA_CONTRIB_SELECT);
    assert.deepEqual(r.titles(), [...contributions.slice(0, 7).map((c) => c.period), 'More ›', 'Back']);
    assert.equal(r.titles().length <= 10, true);

    await r.tap('More ›');
    assert.deepEqual(r.titles(), [...contributions.slice(7).map((c) => c.period), '‹ Previous', 'Back']);
    await r.tap('Period 9');
    assert.equal(r.state, STATE.MYCHAMA_CONTRIB_AMOUNT);
    assert.match(r.body(), /Period 9/);
    assert.deepEqual(r.titles(), ['Pay full amount', 'Back', 'My Chama menu']);

    await r.say('5');
    assert.match(r.body(), /valid amount/);
    await r.tap('Pay full amount');
    assert.equal(r.state, STATE.MYCHAMA_PAY_PHONE);
    assert.deepEqual(r.titles(), ['Use 0712345678', 'Back', 'My Chama menu']);

    await r.tap('Use 0712345678');
    assert.equal(r.state, STATE.MYCHAMA_PAY_PROVIDER);
    assert.deepEqual(r.titles(), ['M-Pesa', 'Airtel Money', 'Back']);

    await r.tap('M-Pesa');
    assert.equal(r.state, STATE.MYCHAMA_PAY_CONFIRM);
    assert.deepEqual(r.titles(), ['Pay now', 'Back', 'Cancel']);
    assert.match(r.body(), /Umoja Chama/);

    await r.tap('Pay now');
    assert.equal(r.chamaPayments.length, 1);
    assert.equal(r.chamaPayments[0].target.contributionId, 'ctr9');
    assert.equal(r.chamaPayments[0].fees.net, 1000);
    assert.equal(r.state, STATE.MYCHAMA_MENU);
    assert.equal(r.kinds(), 'text,list');
    assert.match(r.allText(), /Payment prompt sent/);
  });

  test('typing the number of a row is the same as tapping it, on any page', async () => {
    const r = fresh();
    await signIn(r);
    await r.say('1');
    await r.say('11'); // 11th period, not visible on page 1
    assert.equal(r.state, STATE.MYCHAMA_CONTRIB_AMOUNT);
    assert.match(r.body(), /Period 11/);
  });

  test('Back steps through the payment sub-flow; My Chama menu and Main menu jump out', async () => {
    const r = fresh();
    await signIn(r);
    await r.tap('Pay Contribution');
    await r.tap('Period 2');
    await r.tap('Pay full amount');
    await r.tap('Back');
    assert.equal(r.state, STATE.MYCHAMA_CONTRIB_AMOUNT);
    await r.tap('My Chama menu');
    assert.equal(r.state, STATE.MYCHAMA_MENU);
    await r.tap('Pay Contribution');
    await r.tapId('ui:MYCHAMA_CONTRIB_SELECT:#'); // "#" is accepted on every screen, even where no button shows it
    assert.equal(r.state, STATE.MAIN_MENU);
    assert.deepEqual(r.context, {});
  });

  test('statement: type list, period list, then the statement with next-step buttons', async () => {
    const r = fresh();
    await signIn(r);
    await r.tap('Get Statement');
    assert.deepEqual(r.titles(), ['Contributions', 'Loans', 'Merry-Go-Round', 'Everything', 'Back']);
    await r.tap('Contributions');
    assert.deepEqual(r.titles(), ['This month', 'Last 3 months', 'This year', 'All time', 'Back']);
    await r.tap('All time');
    assert.equal(r.state, STATE.MYCHAMA_STATEMENT_VIEW);
    assert.equal(r.kinds(), 'text,buttons');
    assert.deepEqual(r.titles(), ['My Chama menu', 'Main menu']);
    await r.tap('My Chama menu');
    assert.equal(r.state, STATE.MYCHAMA_MENU);
  });

  test('loan products list shows rate and limits', async () => {
    const r = fresh();
    await signIn(r);
    await r.tap('Apply for a Loan');
    assert.deepEqual(r.titles(), ['Emergency Loan', 'Back']);
    const o = r.lastInteractive();
    assert.match(o.kind === 'list' ? o.rows[0].description ?? '' : '', /5% per month/);
    await r.tap('Emergency Loan');
    assert.equal(r.state, STATE.MYCHAMA_LOAN_AMOUNT);
    await r.say('10000');
    await r.say('6');
    assert.equal(r.state, STATE.MYCHAMA_LOAN_PURPOSE);
    assert.deepEqual(r.titles(), ['Skip', 'Back', 'My Chama menu']);
    await r.tap('Skip');
    assert.equal(r.state, STATE.MYCHAMA_LOAN_CONFIRM);
    assert.deepEqual(r.titles(), ['Submit', 'Back', 'Cancel']);
    assert.match(r.body(), /10,000/);
  });

  test('Swahili My Chama menu', async () => {
    const r = fresh('sw');
    await r.say('3');
    await r.say('1234');
    assert.ok(r.titles().includes('Lipa Mchango'));
    assert.ok(r.titles().includes('Pata Taarifa'));
  });
});

describe('Landlord Watch hand-off', () => {
  test('leaving Landlord Watch shows the interactive main menu', async () => {
    const r = fresh();
    await r.say('7');
    assert.ok(r.state.startsWith('WATCH_'), r.state);
    await r.say('#');
    assert.equal(r.state, STATE.MAIN_MENU);
    const last = r.sent[r.sent.length - 1];
    assert.equal(last.kind, 'list');
    assert.equal(last.kind === 'list' && last.rows.length, 8);
  });

  test('a stale main-menu tap while inside Landlord Watch is answered with the notice', async () => {
    const r = fresh();
    await r.say('7');
    const before = r.state;
    await r.tapId('ui:MAIN_MENU:1');
    assert.equal(r.state, before);
    assert.match(r.body(), /no longer active/);
  });
});


describe('Lipa Mos Mos (pay rent a little at a time)', () => {
  const rentPay = require('../../services/payment.service');
  const calls: { name: string; data: any }[] = [];
  const install = (impl: (name: string, data: any) => any) => {
    rentPay.callCloudFunction = async (url: string, data: any) => { const name = url.split('/').pop() as string; calls.push({ name, data }); return impl(name, data); };
  };
  const planView = (over: any = {}) => ({ frequency: 'weekly', status: 'active', targetMinor: 1_550_000, creditedMinor: 300_000, remainingMinor: 1_250_000, pct: 19, settlesOn: '2026-11-05', suggestedMinor: 300_000, ...over });
  const toTenant = async (lang: 'en' | 'sw' = 'en') => {
    const r = fresh(lang); await r.say('1'); await r.say(TENANT_ID); return r;
  };

  test('the tenant-found screen offers Lipa Mos Mos in English and Swahili', async () => {
    calls.length = 0;
    assert.ok((await toTenant('en')).titles().includes('Lipa Mos Mos'));
    assert.ok((await toTenant('sw')).titles().includes('Lipa Mos Mos'));
  });

  test('no plan yet: asks how often, starts the plan, then asks how much, previews the fee, and pays through PAY', async () => {
    calls.length = 0;
    install((name) => name === 'lmm_getPlan' ? { available: true, plan: null, targetMinor: 1_550_000, settlesOn: '2026-11-05', suggestedMinor: 300_000 }
      : name === 'lmm_start' ? { available: true, plan: planView({ creditedMinor: 0 }) } : { reference: 'LMM_x', displayText: 'Enter PIN' });
    const r = await toTenant(); await r.tap('Lipa Mos Mos');
    assert.equal(r.state, STATE.LMM_MENU); assert.match(r.body(), /Pay your rent a little at a time/); assert.match(r.body(), /KES 15,500/);
    assert.deepEqual(r.titles(), ['Daily', 'Weekly', 'Every 2 weeks', 'Back', 'Main menu']);
    await r.tap('Weekly'); assert.equal(r.state, STATE.LMM_AMOUNT); assert.match(r.body(), /whole-shilling/);
    await r.say('12.5'); assert.match(r.body(), /whole-shilling amount between KES 10/);
    await r.say('9'); assert.match(r.body(), /whole-shilling amount between KES 10/);
    await r.say('3000'); assert.equal(r.state, STATE.LMM_PHONE);
    await r.say('0712345678'); assert.equal(r.state, STATE.LMM_CONFIRM);
    assert.match(r.body(), /To your rent: KES 3,000/); assert.match(r.body(), /Fee \(2.5%\): KES 75/); assert.match(r.body(), /You pay: KES 3,075/);
    await r.tap('Confirm');
    const pay = calls.find((c) => c.name === 'lmm_pay')!;
    assert.deepEqual(pay.data, { agentId: pay.data.agentId, tenantId: pay.data.tenantId, amount: 3000, phone: '0712345678' });
    assert.match(r.allText(), /Check your phone for the M-Pesa prompt/); assert.equal(r.state, STATE.MAIN_MENU);
  });

  test('under KES 100 the preview shows the 5% fee', async () => {
    install((name) => name === 'lmm_getPlan' ? { available: true, plan: planView() } : { reference: 'LMM_x', displayText: 'ok' });
    const r = await toTenant(); await r.tap('Lipa Mos Mos');
    assert.match(r.body(), /Progress: 19%/); assert.match(r.body(), /Balance: KES 12,500/);
    await r.tap('Pay now'); await r.say('50'); await r.say('0712345678');
    assert.match(r.body(), /Fee \(5%\): KES 3/); assert.match(r.body(), /You pay: KES 53/);
  });

  test('an existing plan shows progress; Back steps back one screen at a time', async () => {
    install((name) => name === 'lmm_getPlan' ? { available: true, plan: planView() } : {});
    const r = await toTenant(); await r.tap('Lipa Mos Mos');
    await r.tap('Pay now'); assert.equal(r.state, STATE.LMM_AMOUNT);
    await r.say('3000'); assert.equal(r.state, STATE.LMM_PHONE);
    await r.tap('Back'); assert.equal(r.state, STATE.LMM_AMOUNT);
    await r.tap('Back'); assert.equal(r.state, STATE.LMM_MENU);
    await r.tap('Back'); assert.equal(r.state, STATE.PAY_RENT_MPESA); assert.ok(r.titles().includes('Lipa Mos Mos'));
  });

  test('not available for this landlord: says so and returns to the tenant screen', async () => {
    install(() => ({ available: false, reason: 'This landlord has not enabled Lipa Mos Mos yet.' }));
    const r = await toTenant(); await r.tap('Lipa Mos Mos');
    assert.equal(r.state, STATE.PAY_RENT_MPESA); assert.match(r.body(), /not available right now/); assert.match(r.body(), /has not enabled/);
  });

  test('a PAY error is shown to the tenant and nothing is paid', async () => {
    install((name) => name === 'lmm_getPlan' ? { available: true, plan: planView() } : { error: { message: 'That is more than you owe. The balance is KES 12,500.' } });
    const r = await toTenant(); await r.tap('Lipa Mos Mos'); await r.tap('Pay now'); await r.say('3000'); await r.say('0712345678'); await r.tap('Confirm');
    assert.match(r.allText(), /We could not complete that: That is more than you owe/);
  });

  test('Swahili screens', async () => {
    install((name) => name === 'lmm_getPlan' ? { available: true, plan: planView() } : {});
    const r = await toTenant('sw'); await r.tap('Lipa Mos Mos');
    assert.match(r.body(), /Umelipa: KES 3,000 kati ya KES 15,500/); assert.deepEqual(r.titles(), ['Lipa sasa', 'Badilisha mara', 'Nyuma']);
    await r.tap('Lipa sasa'); assert.match(r.body(), /shilingi kamili/);
  });
});
