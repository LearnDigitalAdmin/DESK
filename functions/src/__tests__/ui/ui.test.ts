import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Outbound } from '../../types/watch.types';
import { STATE } from '../../constants/states';
import { MAIN_MENU_ROWS, UI_LABELS, UI_MESSAGES, ulabel } from '../../constants/ui.messages';
import { MC_ROWS } from '../../constants/mychama.messages';
import {
  btn,
  describeReply,
  helpReply,
  mainMenuReply,
  needsState,
  pickerRows,
  resolveTap,
  row,
  stampReply,
  toOutbounds,
  typedKey,
  uiButtons,
  uiList,
  welcomeReply,
  withNotice,
} from '../../utils/ui';
import { buildCloudPayload, expandOutbound, toNumberedText } from '../../services/wa.sender';

const LANGS = ['en', 'sw'] as const;
const rowsOf = (o: Outbound) => (o.kind === 'list' ? o.rows : []);
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Item ${i + 1}` }));

describe('labels respect WhatsApp limits', () => {
  test('buttons and list-button labels are at most 20 characters, in both languages', () => {
    for (const [key, v] of Object.entries(UI_LABELS)) for (const l of LANGS) assert.ok(v[l].length <= 20, `${key}.${l} = "${v[l]}"`);
  });
  test('main menu and My Chama rows: title <= 24, description <= 72', () => {
    const all = [...MAIN_MENU_ROWS, ...MC_ROWS.MYCHAMA_MENU, ...MC_ROWS.STATEMENT_TYPE, ...MC_ROWS.STATEMENT_PERIOD];
    for (const r of all)
      for (const l of LANGS) {
        assert.ok(r.title[l].length <= 24, `${r.title[l]}`);
        assert.ok(!r.desc || r.desc[l].length <= 72, `${r.desc?.[l]}`);
      }
  });
  test('every static message exists in both languages', () => {
    for (const [k, v] of Object.entries(UI_MESSAGES)) assert.ok(v.en && v.sw, k);
    assert.equal(ulabel('USE_NUMBER', 'sw', { phone: '0712345678' }), 'Tumia 0712345678');
  });
});

describe('ids, stamping and taps', () => {
  test('builders use the placeholder state; stampReply fills it and leaves stamped / foreign ids alone', () => {
    const msg = uiButtons('Pick', [btn('1', 'One'), { id: 'lw:other', title: 'Watch' }, btn('2', 'Two', STATE.MAIN_MENU)]);
    assert.ok(needsState(msg));
    const [stamped] = stampReply(msg, STATE.MYCHAMA_MENU);
    assert.deepEqual(
      stamped.kind === 'buttons' ? stamped.buttons.map((b) => b.id) : [],
      ['ui:MYCHAMA_MENU:1', 'lw:other', 'ui:MAIN_MENU:2']
    );
    assert.ok(!needsState(stamped));
  });

  test('resolveTap: same state = typed value; other state = stale; foreign or missing ids are not ours', () => {
    assert.deepEqual(resolveTap('ui:MYCHAMA_MENU:3', STATE.MYCHAMA_MENU), { kind: 'input', value: '3' });
    assert.deepEqual(resolveTap('ui:MYCHAMA_MENU:pg:2', STATE.MYCHAMA_MENU), { kind: 'input', value: 'pg:2' });
    assert.deepEqual(resolveTap('ui:MYCHAMA_MENU:#', STATE.MAIN_MENU), { kind: 'stale' });
    assert.deepEqual(resolveTap('ui:*:1', STATE.MAIN_MENU), { kind: 'stale' }, 'an unstamped id can never act');
    assert.equal(resolveTap('lw:menu', STATE.MAIN_MENU), null);
    assert.equal(resolveTap(undefined, STATE.MAIN_MENU), null);
    assert.equal(resolveTap('', STATE.MAIN_MENU), null);
  });

  test('toOutbounds / describeReply / withNotice', () => {
    assert.deepEqual(toOutbounds(''), []);
    assert.deepEqual(toOutbounds('hi'), [{ kind: 'text', text: 'hi' }]);
    assert.equal(describeReply([{ kind: 'text', text: 'a' }, helpReply('en')]), 'text,buttons');
    assert.equal(describeReply(''), '');
    const n = withNotice(uiButtons('Body', [btn('0', 'Back')]), 'Careful');
    assert.equal(n.kind === 'buttons' && n.body, 'Careful\n\nBody');
    assert.equal(describeReply(n), 'buttons');
  });
});

describe('pickers', () => {
  test('12 items: page 1 has 7 + More + Back; page 2 has 5 + Previous + Back; values are positions in the whole list', () => {
    const p0 = pickerRows(items(12), 0, 'en', { back: true }).rows;
    assert.deepEqual(p0.map((r) => r.id), [1, 2, 3, 4, 5, 6, 7].map((n) => `ui:*:${n}`).concat(['ui:*:pg:1', 'ui:*:0']));
    const p1 = pickerRows(items(12), 1, 'en', { back: true }).rows;
    assert.deepEqual(p1.map((r) => r.id), [8, 9, 10, 11, 12].map((n) => `ui:*:${n}`).concat(['ui:*:pg:0', 'ui:*:0']));
  });
  test('never more than 10 rows, whatever the size or page', () => {
    for (const n of [0, 1, 7, 8, 14, 15, 30]) for (let p = 0; p < 6; p++) assert.ok(pickerRows(items(n), p, 'sw', { back: true }).rows.length <= 10, `${n}/${p}`);
  });
  test('an out-of-range page is clamped', () => {
    assert.equal(pickerRows(items(3), 9, 'en').page.page, 0);
  });
});

describe('main menu and welcome', () => {
  test('main menu: all 10 options, Exit last, values are the legacy option numbers, ids pre-stamped', () => {
    for (const lang of LANGS) {
      const menu = mainMenuReply(lang);
      const rows = rowsOf(menu);
      assert.equal(rows.length, 10);
      assert.deepEqual(rows.map((r) => r.id.replace('ui:MAIN_MENU:', '')).sort(), ['1', '10', '2', '3', '4', '5', '6', '7', '8', '9']);
      assert.equal(rows[rows.length - 1].id, 'ui:MAIN_MENU:5');
      assert.ok(rows.every((r) => !!r.description));
      assert.ok(!needsState(menu));
    }
  });
  test('welcome offers both languages as buttons', () => {
    const w = welcomeReply();
    assert.equal(w.kind, 'buttons');
    assert.deepEqual(w.kind === 'buttons' ? w.buttons.map((b) => b.id) : [], ['ui:LANGUAGE_SELECTION:1', 'ui:LANGUAGE_SELECTION:2']);
  });
});

describe('sender integration', () => {
  test('the full main menu survives expansion and becomes a valid Cloud API list payload', () => {
    const [m] = expandOutbound(stampReply(mainMenuReply('en'), STATE.MAIN_MENU)[0]);
    const payload = buildCloudPayload('254712345678', m) as { interactive: { type: string; action: { sections: Array<{ rows: unknown[] }> } } };
    assert.equal(payload.interactive.type, 'list');
    assert.equal(payload.interactive.action.sections[0].rows.length, 10);
  });
  test('typed fallback leads each line with what the user would type', () => {
    const text = toNumberedText(stampReply(mainMenuReply('en'), STATE.MAIN_MENU)[0]);
    assert.match(text, /\n7\. Landlord Watch\n/);
    assert.match(text, /\n8\. House to Rent\n/);
    assert.match(text, /\n5\. Exit$/);
    const amount = toNumberedText(stampReply(uiButtons('How much?', [btn('FULL', 'Pay full amount'), btn('0', 'Back'), btn('#', 'Main menu')]), STATE.PAY_RENT_PROCESSING)[0]);
    assert.match(amount, /FULL\. Pay full amount\n0\. Back\n#\. Main menu$/);
  });
  test('paging rows have no typed equivalent and are left out of the fallback', () => {
    const list = uiList('Pick', 'Choose', [row('1', 'A'), row('pg:1', 'More ›'), row('0', 'Back')]);
    assert.doesNotMatch(toNumberedText(stampReply(list, STATE.MYCHAMA_MENU)[0]), /More/);
    assert.equal(typedKey('ui:MYCHAMA_MENU:pg:1', 1), null);
    assert.equal(typedKey('lw:menu', 2), '3', 'Landlord Watch ids keep positional numbering');
  });
});
