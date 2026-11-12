import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pollTranscript, realSleep, POLL_MAX_MS } from '../../utils/watch.poll';
import { LwError } from '../../services/watch.api';
import { TranscriptRequest, Outbound, Snapshot } from '../../types/watch.types';
import { MockBackend } from '../../services/watch.mock';
import { renderMoney, renderSummary, renderTenantList, renderTrend, selectTenants, TENANT_PAGE_SIZE } from '../../utils/watch.render';
import { buildCloudPayload, expandOutbound, sendOutbound, toNumberedText, META_WINDOW_CLOSED } from '../../services/wa.sender';
import { WATCH_ERRORS, WATCH_LABELS, WATCH_MESSAGES, lwErrorMessage, waitText } from '../../constants/watch.messages';
import { LW_ERROR_CODES } from '../../types/watch.types';
import { FakeClock } from './harness';

const req = (state: TranscriptRequest['state']): TranscriptRequest => ({
  requestId: 'r', ownerId: 'PYP-0001', month: '2026-10', state, priceKes: 99, createdAt: '2026-10-24T06:00:00Z',
});

describe('polling and timeouts (fake clock)', () => {
  test('polls every 3 s and returns ready', async () => {
    const c = new FakeClock();
    const states: TranscriptRequest['state'][] = ['payment_pending', 'payment_pending', 'generating', 'ready'];
    let i = 0;
    const times: number[] = [];
    const out = await pollTranscript({ fetch: async () => (times.push(c.now()), req(states[i++])), sleep: c.sleep, now: c.now });
    assert.equal(out.kind, 'ready');
    assert.deepEqual(times.map((t) => t - times[0]), [0, 3000, 6000, 9000]);
  });

  test('gives up after 90 s with exactly 30 requests, then reports timeout', async () => {
    const c = new FakeClock();
    let n = 0;
    const out = await pollTranscript({ fetch: async () => (n++, req('payment_pending')), sleep: c.sleep, now: c.now });
    assert.equal(out.kind, 'timeout');
    assert.equal(n, 30);
    assert.equal(c.now() - 0 >= 0, true);
    assert.equal(POLL_MAX_MS, 90_000);
  });

  test('sends the "still waiting" nudge once, around 45 s', async () => {
    const c = new FakeClock();
    const start = c.now();
    const nudges: number[] = [];
    await pollTranscript({ fetch: async () => req('payment_pending'), sleep: c.sleep, now: c.now, onSlow: () => void nudges.push(c.now() - start) });
    assert.equal(nudges.length, 1);
    assert.ok(nudges[0] >= 45_000 && nudges[0] < 49_000);
  });

  test('keeps polling through paid and generating', async () => {
    const c = new FakeClock();
    const seq: TranscriptRequest['state'][] = ['payment_pending', 'paid', 'generating', 'generating', 'ready'];
    let i = 0;
    const out = await pollTranscript({ fetch: async () => req(seq[i++]), sleep: c.sleep, now: c.now });
    assert.equal(out.kind, 'ready');
    assert.equal(i, 5);
  });

  test('terminal states', async () => {
    for (const [state, kind] of [['failed', 'failed'], ['expired', 'expired'], ['payment_required', 'payment_required']] as const) {
      const c = new FakeClock();
      const out = await pollTranscript({ fetch: async () => req(state), sleep: c.sleep, now: c.now });
      assert.equal(out.kind, kind);
    }
  });

  test('cancel stops quietly before the next request', async () => {
    const c = new FakeClock();
    let calls = 0;
    let checks = 0;
    const out = await pollTranscript({
      fetch: async () => (calls++, req('payment_pending')), sleep: c.sleep, now: c.now,
      shouldContinue: () => ++checks < 3,
    });
    assert.equal(out.kind, 'cancelled');
    assert.equal(calls, 2);
  });

  test('tolerates transient errors, gives up after 3 in a row, treats LW_PAYMENT_FAILED as failure', async () => {
    let c = new FakeClock();
    let n = 0;
    let out = await pollTranscript({ fetch: async () => { if (n++ < 2) throw new LwError('LW_UNAVAILABLE'); return req('ready'); }, sleep: c.sleep, now: c.now });
    assert.equal(out.kind, 'ready');
    c = new FakeClock();
    out = await pollTranscript({ fetch: async () => { throw new LwError('LW_UNAVAILABLE'); }, sleep: c.sleep, now: c.now });
    assert.equal(out.kind, 'error');
    c = new FakeClock();
    out = await pollTranscript({ fetch: async () => { throw new LwError('LW_PAYMENT_FAILED'); }, sleep: c.sleep, now: c.now });
    assert.equal(out.kind, 'failed');
  });

  test('real sleep works with node fake timers', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let done = false;
    const p = realSleep(3000).then(() => (done = true));
    t.mock.timers.tick(2999);
    await Promise.resolve();
    assert.equal(done, false);
    t.mock.timers.tick(1);
    await p;
    assert.equal(done, true);
    mock.reset();
  });
});

// ── rendering ─────────────────────────────────────────────────────────────

const snapAt = (level: 'open' | 'tenant', month = '2026-10', actor = '+254712345678'): Snapshot => {
  const b = new MockBackend({ now: () => Date.parse('2026-10-24T06:00:00Z') });
  b.connect(actor, 'PYP-0001');
  const s = (b.getSnapshot(actor, 'PYP-0001', month) as { snapshot: Snapshot }).snapshot;
  assert.equal(s.mask.level, level);
  return s;
};

describe('rendering renders the server strings and recomputes nothing', () => {
  test('summary (English) contains the worked-example figures verbatim', () => {
    const t = renderSummary(snapAt('open'), 'en');
    for (const v of ['KES 56,500', 'KES 29,000', 'KES 27,500', '51%', 'KES 3,400', 'KES 25,600', 'KES 25,700', 'KES 17,450', 'KES 8,150', '83%'])
      assert.ok(t.includes(v), v);
    assert.ok(t.includes('15 October 2026'));
    assert.ok(t.includes('Estimate: the agent has not issued this statement yet'));
    assert.ok(!t.includes('Tap *Unlock details*'), 'open level has no hidden note');
    assert.ok(t.length < 1000, `short enough (${t.length})`);
  });

  test('summary (Kiswahili) uses glossary terms and the Swahili estimate text', () => {
    const t = renderSummary(snapAt('tenant', '2026-10', '+254799000000'), 'sw');
    for (const w of ['Wapangaji', 'Imedaiwa', 'Iliyokusanywa', 'Inayosubiriwa', 'Kamisheni', 'Kiasi chako baada ya kamisheni', 'Bado utapokea', 'Oktoba 2026', '15 Oktoba 2026'])
      assert.ok(t.includes(w), w);
    assert.ok(t.includes('Makadirio: wakala bado hajatoa taarifa ya mwezi huu'));
    assert.ok(t.includes('Fungua maelezo'), 'hidden note points at Unlock');
  });

  test('server strings are rendered as-is, even odd ones', () => {
    const s = snapAt('open');
    s.summary.billed = { v: 1, d: 'KES 777,777' };
    s.summary.net.payable = { v: 2, d: 'KES 1 (server says so)' };
    const t = renderSummary(s, 'en');
    assert.ok(t.includes('KES 777,777') && t.includes('KES 1 (server says so)'));
    assert.ok(!t.includes('56,500'));
  });

  test('money breakdown: commission on base rent only, statement lines, estimate vs agent', () => {
    const est = renderMoney(snapAt('open'), 'en');
    assert.ok(est.includes('on base rent only'));
    assert.ok(est.includes('KES 34,000') && est.includes('KES 52,000') && est.includes('KES 51,300'));
    assert.ok(est.includes('Collected (rent and bills): KES 29,000'));
    assert.ok(est.includes('Net payable to you') && est.includes('KES 25,600'));
    assert.ok(est.includes('Estimate'));
    const agent = renderMoney(snapAt('open', '2026-09'), 'sw');
    assert.ok(agent.includes('Garbage collection fee') && agent.includes('KES 450') && agent.includes('KES 50,850'));
    assert.ok(!agent.includes('Makadirio'));
    assert.ok(agent.includes('Hali: imekamilika'));
    assert.ok(agent.includes('kodi ya msingi tu'));
  });

  test('trend lists the months oldest first', () => {
    const t = renderTrend(snapAt('open'), 'en');
    assert.ok(t.indexOf('August 2026') < t.indexOf('September 2026') && t.indexOf('September 2026') < t.indexOf('October 2026'));
  });

  test('who paid / who has not paid (partial included), late hint, masked data as returned', () => {
    const open = snapAt('open');
    const now = Date.parse('2026-10-24T06:00:00Z');
    const paid = renderTenantList(open, 'paid', 'en', 0, now).text;
    assert.ok(paid.includes('Amina Wanjiru (A1)') && paid.includes('+254711333444') && paid.includes('paid 4 Oct') && paid.includes('on time'));
    assert.ok(paid.includes('Cynthia Achieng') && paid.includes('late'), 'paid after the due date is flagged late');
    const unpaid = renderTenantList(open, 'unpaid', 'sw', 0, now).text;
    assert.ok(unpaid.includes('Daniel Otieno') && unpaid.includes('anadaiwa KES 20,000') && unpaid.includes('amechelewa'));
    assert.ok(unpaid.includes('Brian Kiprop') && unpaid.includes('amelipa KES 5,000 kati ya KES 12,500') && unpaid.includes('salio KES 7,500'));
    assert.ok(unpaid.includes('Hawana ankara bado: 1'));
    const masked = renderTenantList(snapAt('tenant', '2026-10', '+254799000000'), 'unpaid', 'en', 0, now).text;
    assert.ok(masked.includes('D••• O•••') && masked.includes('07•• ••• 222'));
    assert.ok(!masked.includes('Daniel') && !masked.includes('0722111222'));
  });

  test('pagination of long lists, 8 per page, numbering continues, every row appears once', () => {
    const s = snapAt('open');
    const base = s.tenants.find((t) => t.status === 'paid')!;
    s.tenants = Array.from({ length: 21 }, (_, i) => ({ ...base, ref: 'r' + i, name: `Tenant ${i + 1}` }));
    const now = Date.parse('2026-10-24T06:00:00Z');
    const p0 = renderTenantList(s, 'paid', 'en', 0, now);
    const p2 = renderTenantList(s, 'paid', 'en', 2, now);
    assert.equal(p0.page.pages, 3);
    assert.equal(TENANT_PAGE_SIZE, 8);
    assert.ok(p0.text.includes('1. Tenant 1') && p0.text.includes('8. Tenant 8') && !p0.text.includes('9. Tenant 9'));
    assert.ok(p2.text.includes('17. Tenant 17') && p2.text.includes('21. Tenant 21') && p2.page.hasNext === false);
    assert.ok(p0.text.includes('Page 1 of 3'));
    assert.ok(p0.text.length < 1400);
    assert.equal(selectTenants(s, 'paid').length, 21);
  });

  test('formatting characters in server text cannot format the message', () => {
    const s = snapAt('open');
    s.tenants[0].name = '*EVIL* _name_ ~x~';
    const t = renderTenantList(s, 'unpaid', 'en', 0, Date.now()).text;
    assert.ok(t.includes('EVIL name x') && !t.includes('*EVIL*'));
  });
});

// ── sender limits ─────────────────────────────────────────────────────────

describe('sender respects WhatsApp limits', () => {
  test('buttons: max 3, titles 20; list: max 10 rows, title 24, description 72', () => {
    const o = expandOutbound({
      kind: 'buttons', body: 'b',
      buttons: Array.from({ length: 5 }, (_, i) => ({ id: 'lw:' + i, title: 'x'.repeat(40) })),
    })[0] as Extract<Outbound, { kind: 'buttons' }>;
    assert.equal(o.buttons.length, 3);
    assert.ok(o.buttons.every((b) => b.title.length <= 20));
    const l = expandOutbound({
      kind: 'list', body: 'b', button: 'Choose something long here',
      rows: Array.from({ length: 14 }, (_, i) => ({ id: 'lw:' + i, title: 'r'.repeat(40), description: 'd'.repeat(200) })),
    })[0] as Extract<Outbound, { kind: 'list' }>;
    assert.equal(l.rows.length, 10);
    assert.ok(l.rows.every((r) => r.title.length <= 24 && (r.description?.length ?? 0) <= 72));
    assert.ok(l.button.length <= 20);
  });

  test('an interactive body over 1,024 characters is sent as text first', () => {
    const parts = expandOutbound({ kind: 'buttons', body: 'x'.repeat(2500), buttons: [{ id: 'lw:a', title: 'A' }] });
    assert.equal(parts[0].kind, 'text');
    assert.equal(parts[parts.length - 1].kind, 'buttons');
    assert.ok((parts[parts.length - 1] as { body: string }).body.length <= 1024);
  });

  test('text over the limit is chunked under 4,096', () => {
    const parts = expandOutbound({ kind: 'text', text: ('word '.repeat(2000)).split(' ').join('\n') });
    assert.ok(parts.length > 1 && parts.every((p) => p.kind === 'text' && p.text.length <= 3500));
  });

  test('payload shapes match the Cloud API', () => {
    const p = buildCloudPayload('254712345678', { kind: 'document', url: 'https://example.com/transcript.pdf', filename: 'a.pdf', caption: 'c' }) as any;
    assert.equal(p.type, 'document');
    assert.deepEqual(p.document, { link: 'https://example.com/transcript.pdf', filename: 'a.pdf', caption: 'c' });
    const b = buildCloudPayload('+254712345678', { kind: 'buttons', body: 'hi', buttons: [{ id: 'lw:yes', title: 'Yes' }] }) as any;
    assert.equal(b.to, '254712345678');
    assert.deepEqual(b.interactive.action.buttons[0], { type: 'reply', reply: { id: 'lw:yes', title: 'Yes' } });
    const l = buildCloudPayload('254', { kind: 'list', body: 'x', button: 'Go', rows: [{ id: 'lw:a', title: 'A' }] }) as any;
    assert.equal(l.interactive.type, 'list');
    assert.equal(l.interactive.action.sections[0].rows.length, 1);
  });

  test('numbered fallback text', () => {
    assert.equal(toNumberedText({ kind: 'buttons', body: 'Pick', buttons: [{ id: 'a', title: 'Yes' }, { id: 'b', title: 'No' }] }), 'Pick\n\n1. Yes\n2. No');
  });

  test('a rejected interactive message falls back to numbered text; a closed window does not', async () => {
    const posted: any[] = [];
    const rejectInteractive = async (_u: string, payload: any) => {
      posted.push(payload);
      return payload.type === 'interactive' ? { status: 400, data: { error: { code: 131009 } } } : { status: 200, data: {} };
    };
    const r = await sendOutbound('254712345678', { kind: 'buttons', body: 'Pick', buttons: [{ id: 'lw:a', title: 'A' }] }, { post: rejectInteractive });
    assert.equal(r.ok, true);
    assert.deepEqual(posted.map((p) => p.type), ['interactive', 'text']);

    posted.length = 0;
    const closed = async (_u: string, payload: any) => (posted.push(payload), { status: 400, data: { error: { code: META_WINDOW_CLOSED } } });
    const r2 = await sendOutbound('254712345678', { kind: 'buttons', body: 'Pick', buttons: [{ id: 'lw:a', title: 'A' }] }, { post: closed });
    assert.deepEqual([r2.ok, r2.errorCode, posted.length], [false, META_WINDOW_CLOSED, 1]);
  });
});

// ── strings ───────────────────────────────────────────────────────────────

describe('bilingual strings', () => {
  test('every LW_* code has a friendly en and sw message, and the contract list is covered', () => {
    for (const code of LW_ERROR_CODES) {
      const e = WATCH_ERRORS[code];
      assert.ok(e && e.en.length > 10 && e.sw.length > 10, code);
      assert.ok(!lwErrorMessage(code, 'en', { retryAfterSec: 90, attemptsLeft: 2 }).includes('{'), code);
      assert.ok(!lwErrorMessage(code, 'sw', { retryAfterSec: 90, attemptsLeft: 2 }).includes('{'), code);
    }
    assert.equal(Object.keys(WATCH_ERRORS).length, 16);   // 15 + LW_REPORT_NO_DATA (compliance reports)
  });
  test('rate limit and attempts are shown', () => {
    assert.match(lwErrorMessage('LW_RATE_LIMITED', 'en', { retryAfterSec: 600 }), /10 minutes/);
    assert.match(lwErrorMessage('LW_OTP_COOLDOWN', 'sw', { retryAfterSec: 40 }), /sekunde 40/);
    assert.match(lwErrorMessage('LW_OTP_WRONG', 'en', { attemptsLeft: 4 }), /4 tries left/);
    assert.match(lwErrorMessage('LW_OTP_WRONG', 'sw', { attemptsLeft: 1 }), /majaribio 1/);
    assert.equal(waitText(45, 'en'), '45 seconds');
    assert.match(lwErrorMessage('NOPE', 'en'), /Something went wrong/);
  });
  test('labels fit WhatsApp limits (rows 24, buttons 20, descriptions 72)', () => {
    for (const [k, v] of Object.entries(WATCH_LABELS)) {
      for (const l of ['en', 'sw'] as const) {
        const len = v[l].length;
        const limit = k.startsWith('DESC_') ? 72 : k.startsWith('ROW_') ? 24 : 24;
        assert.ok(len > 0 && len <= limit, `${k}.${l} (${len})`);
        if (!k.startsWith('ROW_') && !k.startsWith('DESC_') && k !== 'MORE_PROPS' && k !== 'MORE_MONTHS' && k !== 'TREND' && k !== 'PREV')
          assert.ok(len <= 20, `${k}.${l} button ≤ 20 (${len})`);
      }
    }
  });
  test('every message exists in en and sw with the same placeholders', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [k, v] of Object.entries(WATCH_MESSAGES)) {
      assert.ok(v.en && v.sw, k);
      assert.equal(ph(v.en), ph(v.sw), `placeholders differ in ${k}`);
    }
  });
});
