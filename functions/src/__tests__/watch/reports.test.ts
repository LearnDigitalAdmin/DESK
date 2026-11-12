import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, connectFirst, Rig } from './harness';
import { STATE } from '../../constants/states';
import { Outbound } from '../../types/watch.types';

const OWNER = '+254712345678'; // PYP-0001 owner phone in the mock: unlocked automatically
const docs = (r: Rig) => r.sent.filter((o): o is Extract<Outbound, { kind: 'document' }> => o.kind === 'document');
const rowsOf = (o: Outbound) => (o.kind === 'list' ? o.rows : []);
const buttonsOf = (o: Outbound) => (o.kind === 'buttons' ? o.buttons.map((b) => b.title) : []);

async function toKind(r: Rig) {
  await connectFirst(r);
  await r.tap('rp');
}
async function order(r: Rig, kind: 'mri_monthly' | 'annual_summary' = 'mri_monthly', month = '2026-10') {
  await toKind(r);
  await r.tap(`rpk:${kind}`);
  await r.tap(`m:${month}`);
}

describe('compliance reports on WhatsApp', () => {
  test('the menu offers Tax report only when the details are unlocked, and stays within 10 rows', async () => {
    const open = makeRig({ actor: OWNER });
    await connectFirst(open);
    assert.ok(rowsOf(open.last()).some((x) => x.id === 'lw:rp'));
    assert.ok(rowsOf(open.last()).length <= 10);
    const hidden = makeRig();
    await connectFirst(hidden);
    assert.ok(!rowsOf(hidden.last()).some((x) => x.id === 'lw:rp'));
    assert.ok(rowsOf(hidden.last()).length <= 10);
  });

  test('free report: choose the report and month, confirm, and the PDF arrives as a document; nothing is sent before the confirmation', async () => {
    const r = makeRig({ actor: OWNER });
    await toKind(r);
    assert.deepEqual(buttonsOf(r.last()), ['MRI working paper', 'Annual summary', 'Cancel']);
    await r.tap('rpk:mri_monthly');
    assert.match(r.lastText(), /Pick the month the rent was received/);
    await r.tap('m:2026-10');
    assert.match(r.lastText(), /MRI working paper\* · October 2026/);
    assert.match(r.lastText(), /free/);
    assert.deepEqual(buttonsOf(r.last()), ['Get free report', 'Cancel']);
    assert.equal(docs(r).length, 0, 'no PDF before checkout');
    await r.tap('rpgo');
    assert.equal(docs(r).length, 1);
    const d = docs(r)[0];
    assert.equal(d.url, 'https://example.com/transcript.pdf');
    assert.match(d.filename, /^mri-working-paper-2026-10-.*\.pdf$/);
    assert.match(d.caption!, /MRI working paper · October 2026 · PYP-0001/);
    assert.match(r.lastText(), /Your report is above/);
    assert.match(r.lastText(), /does not file with KRA/);
    assert.equal(r.state(), STATE.WATCH_MENU);
    assert.equal(r.ctx().rpId, undefined, 'order cleared after delivery');
    assert.ok(!r.sent.filter((o) => o.kind !== 'document').some((o) => JSON.stringify(o).includes('example.com')), 'the link is never shown as text');
    assert.ok(!JSON.stringify(r.ctx()).includes('example.com'), 'the link is never stored');
  });

  test('the second report of the month costs KES 200: M-Pesa to the owner\'s own number, then the PDF after the payment confirms', async () => {
    const r = makeRig({ actor: OWNER });
    await order(r, 'mri_monthly', '2026-10');
    await r.tap('rpgo');
    assert.equal(docs(r).length, 1);
    await order(r, 'annual_summary', '2026-10');
    assert.equal(r.state(), STATE.WATCH_RP_PHONE);
    assert.match(r.lastText(), /KES 200/);
    assert.match(r.lastText(), /0712345678/);
    assert.deepEqual(buttonsOf(r.last()), ['My number', 'Another number', 'Cancel']);
    assert.equal(docs(r).length, 1, 'no second PDF before payment');
    const before = r.clock.now();
    await r.tap('mine');
    assert.match(r.allText(), /Check your phone \(0712345678\)/);
    assert.ok(r.clock.now() - before >= 6000, 'polled until the payment confirmed');
    assert.equal(docs(r).length, 2);
    assert.match(docs(r)[1].caption!, /Annual summary/);
    assert.equal(r.state(), STATE.WATCH_MENU);
  });

  test('a typed number works; a failed payment offers a retry and sends nothing', async () => {
    const r = makeRig({ actor: OWNER });
    await order(r); await r.tap('rpgo');
    await order(r, 'annual_summary');
    await r.tap('other');
    await r.say('12345');
    assert.match(r.lastText(), /valid Safaricom number|Safaricom/i);
    await r.say('0700000000');                                 // the mock's "customer cancelled" number
    assert.equal(r.state(), STATE.WATCH_RP_PHONE);
    assert.match(r.lastText(), /payment did not go through/);
    assert.deepEqual(buttonsOf(r.last()), ['Try again', 'Cancel']);
    assert.equal(docs(r).length, 1);
    await r.tap('retry');
    assert.equal(r.state(), STATE.WATCH_RP_PHONE);
    await r.say('0722555666');
    assert.equal(docs(r).length, 2);
  });

  test('asking again for a report that already exists re-sends it for free, with no new order', async () => {
    const r = makeRig({ actor: OWNER });
    await order(r); await r.tap('rpgo');
    const first = docs(r).length;
    await r.tap('rp');
    await r.tap('rpk:mri_monthly');
    await r.tap('m:2026-10');
    assert.match(r.lastText(), /already have the MRI working paper for October 2026/);
    assert.deepEqual(buttonsOf(r.last()), ['Send again', 'Make a new one', 'Cancel']);
    await r.tap('rpagain');
    assert.equal(docs(r).length, first + 1);
    assert.equal(r.state(), STATE.WATCH_MENU);
  });

  test('"Make a new one" for an existing report is a new order at the paid price', async () => {
    const r = makeRig({ actor: OWNER });
    await order(r); await r.tap('rpgo');
    await r.tap('rp'); await r.tap('rpk:mri_monthly'); await r.tap('m:2026-10');
    await r.tap('rpnew');
    assert.equal(r.state(), STATE.WATCH_RP_PHONE);
    assert.match(r.lastText(), /KES 200/);
  });

  test('if the free report is used meanwhile, "Get free report" shows the new price instead of failing', async () => {
    const r = makeRig({ actor: OWNER });
    await order(r, 'mri_monthly', '2026-10');
    assert.deepEqual(buttonsOf(r.last()), ['Get free report', 'Cancel']);
    // the same owner uses the free report in another chat meanwhile
    const other = (r.backend as any);
    other.reportUsed.set(other.reportKey('PYP-0001'), 1);
    await r.tap('rpgo');
    assert.match(r.allText(), /free report has been used/);
    assert.equal(r.state(), STATE.WATCH_RP_PHONE);
    assert.equal(docs(r).length, 0);
  });

  test('cancel at any step goes back to the menu and clears the order', async () => {
    const r = makeRig({ actor: OWNER });
    await toKind(r);
    await r.tap('cancel');
    assert.equal(r.state(), STATE.WATCH_MENU);
    await order(r); await r.tap('rpgo'); await order(r, 'annual_summary');
    assert.equal(r.state(), STATE.WATCH_RP_PHONE);
    await r.tap('cancel');
    assert.equal(r.state(), STATE.WATCH_MENU);
    assert.equal(r.ctx().rpId, undefined);
    assert.equal(docs(r).length, 1);
  });

  test('a document that cannot be sent offers "Send again" and does not lose the report', async () => {
    const r = makeRig({ actor: OWNER });
    r.setSendResult((o) => (o.kind === 'document' ? { ok: false } as never : { ok: true } as never));
    await order(r); await r.tap('rpgo');
    assert.match(r.lastText(), /could not be sent/);
    assert.deepEqual(buttonsOf(r.last()), ['Send again', 'Watch menu']);
    assert.ok(r.ctx().rpId);
    r.setSendResult(() => ({ ok: true } as never));
    await r.tap('rpagain');
    assert.equal(docs(r).length, 2);
  });

  test('Kiswahili: menu row, prompts, price and the sent message', async () => {
    const r = makeRig({ actor: OWNER, lang: 'sw' });
    await connectFirst(r);
    assert.ok(rowsOf(r.last()).some((x) => x.id === 'lw:rp' && x.title === 'Ripoti ya kodi (MRI)'));
    await r.tap('rp');
    assert.deepEqual(buttonsOf(r.last()), ['Karatasi ya MRI', 'Muhtasari wa mwaka', 'Ghairi']);
    await r.tap('rpk:annual_summary'); await r.tap('m:2026-10');
    assert.match(r.lastText(), /Hii ni \*bure\*/);
    await r.tap('rpgo');
    assert.match(docs(r)[0].caption!, /Muhtasari wa mwaka · Oktoba 2026/);
    assert.match(r.lastText(), /haiwasilishi kwa KRA/);
  });

  test('a locked property is refused with the unlock offer, and no order is made', async () => {
    const r = makeRig();                                         // not the owner phone: details hidden
    await connectFirst(r);
    await r.tap('rp');                                           // a stale button: the server refuses, the bot offers the unlock
    await r.tap('rpk:mri_monthly');
    await r.tap('m:2026-10');
    assert.match(r.allText(), /Unlock|unlock|code/);
    assert.equal(docs(r).length, 0);
  });
});
