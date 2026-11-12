/**
 * Landlord Watch: conversation engine.
 *
 * Dependency-injected on purpose (API client, sender, session store, clock): it imports nothing from Firebase, so it
 * can be driven end to end in unit tests against the mock backend. The production wiring lives in watch.entry.ts.
 *
 * What is persisted in the session (contract section 12): owner id, language (via the session service), current
 * state/page/month, pending request id, the last rendered option ids and the resend time. Nothing else: no OTP codes,
 * no signed URLs, no tenant names or phones, no snapshots. Snapshots are fetched on demand and never stored.
 */

import {
  Connection,
  Lang,
  LwApi,
  Outbound,
  PickPurpose,
  ReportKind,
  SendResult,
  Snapshot,
  TranscriptRequest,
  WaButton,
  WaRow,
  WatchCtx,
} from '../types/watch.types';
import { STATE } from '../constants/states';
import {
  errorNext,
  lwErrorMessage,
  waitText,
  WatchLabelKey,
  WatchMsgKey,
  wlabel,
  wmsg,
} from '../constants/watch.messages';
import {
  dateTimeNairobi,
  isSafaricomE164,
  kes,
  monthLabel,
  normalizeKenyanPhone,
  normalizeOwnerId,
  paginate,
  parseNavCommand,
  parseOtp,
  parseYesNo,
  plain,
} from '../utils/watch.format';
import { renderMoney, renderSummary, renderTenantList, renderTrend, TenantListKind } from '../utils/watch.render';
import { pollTranscript } from '../utils/watch.poll';
import { LwError, isLwError } from '../services/watch.api';
import { META_WINDOW_CLOSED } from '../services/wa.sender';
import { logger } from '../utils/logger';

export const isWatchState = (state: string | undefined): boolean => !!state && state.startsWith('WATCH_');

/** Prefix for every interactive id the bot sends, so stale taps can be recognised anywhere. */
export const ACTION_PREFIX = 'lw:';

export interface WatchStore {
  /** Re-read the persisted state and Landlord Watch slice (used to notice a cancel during polling). */
  read(): Promise<{ state: string; ctx: WatchCtx }>;
  write(state: string, ctx: WatchCtx): Promise<void>;
  setLanguage(lang: Lang): Promise<void>;
  /** Leave Landlord Watch: state becomes MAIN_MENU and the slice is cleared. */
  leave(): Promise<void>;
}

export interface WatchDeps {
  api: LwApi;
  send: (o: Outbound) => Promise<SendResult>;
  store: WatchStore;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The WhatsApp sender in E.164 (`+2547...`). */
  actorPhone: string;
  /** The SAMUHIA main menu, shown whenever the user leaves Landlord Watch. */
  mainMenu: (lang: Lang) => Outbound;
}

export interface Incoming {
  text: string;
  /** Reply-button / list-row id, when the user tapped one. */
  interactiveId?: string;
}

const PROP_PAGE = 6;
const PROP_DISC_PAGE = 7;
const MONTH_PAGE_VIEW = 7;
const MONTH_PAGE_TR = 8;

const asLwError = (err: unknown): LwError => (isLwError(err) ? err : new LwError('LW_UNAVAILABLE'));

export class WatchFlow {
  private lang: Lang;
  private state: string;
  private ctx: WatchCtx;
  private left = false;
  private windowClosed = false;

  constructor(private readonly d: WatchDeps, init: { lang: Lang; state: string; ctx: WatchCtx }) {
    this.lang = init.lang;
    this.state = init.state;
    this.ctx = { ...init.ctx };
  }

  // ── tiny helpers ───────────────────────────────────────────────────────

  private L(k: WatchLabelKey): string {
    return wlabel(k, this.lang);
  }
  private M(k: WatchMsgKey, p?: Record<string, string | number | undefined>): string {
    return wmsg(k, this.lang, p);
  }
  private nowSec(): number {
    return Math.floor(this.d.now() / 1000);
  }

  private btn(action: string, label: WatchLabelKey): WaButton {
    return { id: ACTION_PREFIX + action, title: this.L(label) };
  }

  private async emit(o: Outbound): Promise<SendResult> {
    if (this.windowClosed) return { ok: false, errorCode: META_WINDOW_CLOSED };
    const r = await this.d.send(o);
    if (!r.ok && r.errorCode === META_WINDOW_CLOSED) {
      this.windowClosed = true;
      logger.warn('Watch: 24 h service window closed, stopping replies');
    }
    const strip = (id: string) => (id.startsWith(ACTION_PREFIX) ? id.slice(ACTION_PREFIX.length) : id);
    if (o.kind === 'buttons') this.ctx.opts = o.buttons.map((b) => strip(b.id));
    else if (o.kind === 'list') this.ctx.opts = o.rows.map((x) => strip(x.id));
    return r;
  }

  private text(text: string): Promise<SendResult> {
    return this.emit({ kind: 'text', text });
  }

  private buttons(body: string, bs: WaButton[]): Promise<SendResult> {
    return this.emit({ kind: 'buttons', body, buttons: bs.slice(0, 3) });
  }

  private navButtons(): WaButton[] {
    return [this.btn('menu', 'WATCH_MENU'), this.btn('main', 'MAIN')];
  }

  /** Move to a state and merge a ctx patch. Option ids are reset: the next interactive message sets them. */
  private go(state: string, patch: Partial<WatchCtx> = {}): void {
    this.state = state;
    this.ctx = { ...this.ctx, ...patch, opts: [] };
  }

  private async save(): Promise<void> {
    if (this.left) return;
    try {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(this.ctx)) if (v !== undefined) clean[k] = v;
      await this.d.store.write(this.state, clean as WatchCtx);
    } catch (err) {
      logger.error('Watch: could not save session', { name: (err as Error)?.name });
    }
  }

  private async leave(): Promise<void> {
    this.left = true;
    await this.d.store.leave();
    this.state = STATE.MAIN_MENU;
    await this.emit(this.d.mainMenu(this.lang));
  }

  // ── entry points ───────────────────────────────────────────────────────

  /** Called from the main menu ("Landlord Watch" or a keyword). */
  async start(): Promise<void> {
    try {
      this.ctx = {};
      const { connections } = await this.d.api.listConnections();
      if (connections.length === 0) return await this.promptAddFirst();
      if (connections.length === 1) {
        this.ctx.ownerId = connections[0].ownerId;
        return await this.showMenu(connections);
      }
      return await this.showProperties(0, 'prop', connections);
    } catch (err) {
      const e = asLwError(err);
      logger.warn('Watch: could not start', { code: e.code });
      this.left = true;
      await this.d.store.leave();
      await this.text(lwErrorMessage(e.code, this.lang, e));
      await this.emit(this.d.mainMenu(this.lang));
    } finally {
      await this.save();
    }
  }

  async handle(inc: Incoming): Promise<void> {
    try {
      await this.route(inc);
    } catch (err) {
      await this.onError(err);
    } finally {
      await this.save();
    }
  }

  // ── routing ────────────────────────────────────────────────────────────

  private resolveAction(inc: Incoming): string | null {
    if (inc.interactiveId) {
      return inc.interactiveId.startsWith(ACTION_PREFIX) ? inc.interactiveId.slice(ACTION_PREFIX.length) : null;
    }
    const t = (inc.text || '').trim();
    const nav = parseNavCommand(t);
    if (nav) return nav === 'language' ? 'settings' : nav;
    if (/^\d{1,2}$/.test(t)) return this.ctx.opts?.[parseInt(t, 10) - 1] ?? null;
    return null;
  }

  private async route(inc: Incoming): Promise<void> {
    const action = this.resolveAction(inc);

    // Valid in every Landlord Watch state
    if (action === 'main') return this.leave();
    if (action === 'help') return this.showHelp();
    if (action === 'settings') return this.showSettings();
    if (action === 'lang:en' || action === 'lang:sw') return this.setLang(action === 'lang:en' ? 'en' : 'sw');
    if (action === 'menu') return this.ctx.ownerId ? this.showMenu() : this.start();

    switch (this.state) {
      case STATE.WATCH_ADD_ID:
        if (action === 'back') return this.ctx.ownerId ? this.showMenu() : this.leave();
        if (action) {
          await this.text(this.M('ASK_ID_AGAIN'));
          return;
        }
        return this.onOwnerIdText(inc.text);

      case STATE.WATCH_CONFIRM: {
        const yn = action === 'yes' ? 'yes' : action === 'no' ? 'no' : action === 'back' ? 'no' : action ? null : parseYesNo(inc.text);
        if (yn === 'yes') return this.confirmYes();
        if (yn === 'no') return this.confirmNo();
        return this.rePromptConfirm();
      }

      case STATE.WATCH_UNLOCK_CODE:
        if (action === 'cancel' || action === 'back') return this.showMenu();
        if (action === 'resend') return this.resend('unlock');
        if (action) return this.rePromptCode();
        return this.onUnlockCode(inc.text);

      case STATE.WATCH_TR_CODE:
        if (action === 'cancel' || action === 'back') return this.cancelTranscript();
        if (action === 'resend') return this.resend('transcript');
        if (action) return this.rePromptCode();
        return this.onTranscriptCode(inc.text);

      case STATE.WATCH_TR_PHONE:
        if (action === 'cancel' || action === 'back') return this.cancelTranscript();
        if (action === 'mine') return this.pay(this.d.actorPhone);
        if (action === 'other') {
          await this.text(this.M('TR_PHONE_ASK'));
          return;
        }
        if (action === 'retry') return this.retryPay();
        if (action) return this.askPay(undefined);
        return this.onPhoneText(inc.text);

      case STATE.WATCH_TR_PAYING:
        if (action === 'cancel' || action === 'back') return this.cancelTranscript();
        return this.checkStatusOnce();

      case STATE.WATCH_RP_PHONE:
        if (action === 'cancel' || action === 'back') return this.rpCancel();
        if (action === 'mine') return this.rpPay(this.d.actorPhone);
        if (action === 'other') {
          await this.text(this.M('TR_PHONE_ASK'));
          return;
        }
        if (action === 'retry') return this.rpRetry();
        if (action) return this.rpAskPay(undefined);
        return this.rpPhoneText(inc.text);

      case STATE.WATCH_RP_PAYING:
        if (action === 'cancel' || action === 'back') return this.rpCancel();
        return this.rpStatusOnce();

      case STATE.WATCH_MENU:
      default:
        return this.onMenuAction(action);
    }
  }

  private async onMenuAction(action: string | null): Promise<void> {
    const kindPick = action ? /^rpk:(mri_monthly|annual_summary)$/.exec(action) : null;
    if (kindPick) {
      this.ctx.rpKind = kindPick[1] as ReportKind;
      return this.showMonths('rp-month', 0);
    }
    if (!action) {
      await this.text(this.M('REPROMPT_USE_BUTTONS'));
      return this.ctx.ownerId ? this.showMenu() : this.start();
    }
    if (action === 'back') return this.ctx.screen === 'menu' ? this.leave() : this.ctx.ownerId ? this.showMenu() : this.start();
    if (action === 'cancel') return this.ctx.ownerId ? this.showMenu() : this.start();

    // Everything below needs a selected property
    const needsOwner = !['add', 'disc', 'props'].includes(action) && !/^(p|d|pgp|pgd):/.test(action);
    if (needsOwner && !this.ctx.ownerId) return this.start();

    const paged = /^pg:(paid|unpaid):(\d+)$/.exec(action);
    if (paged) return this.showTenants(paged[1] as TenantListKind, parseInt(paged[2], 10));
    const pgm = /^pgm:(\d+)$/.exec(action);
    if (pgm) return this.showMonths(this.ctx.pick === 'tr-month' || this.ctx.pick === 'rp-month' ? this.ctx.pick : 'view-month', parseInt(pgm[1], 10));
    const pgp = /^pgp:(\d+)$/.exec(action);
    if (pgp) return this.showProperties(parseInt(pgp[1], 10), 'prop');
    const pgd = /^pgd:(\d+)$/.exec(action);
    if (pgd) return this.showProperties(parseInt(pgd[1], 10), 'disc');
    const month = /^m:(\d{4}-\d{2})$/.exec(action);
    if (month) return this.onMonthPicked(month[1]);
    const prop = /^p:(PYP-\d{4,})$/.exec(action);
    if (prop) return this.selectProperty(prop[1]);
    const disc = /^d:(PYP-\d{4,})$/.exec(action);
    if (disc) return this.askDisconnect(disc[1]);

    switch (action) {
      case 'sum':
        return this.showSummary();
      case 'paid':
        return this.showTenants('paid', 0);
      case 'unpaid':
        return this.showTenants('unpaid', 0);
      case 'money':
        return this.showMoney();
      case 'months':
        return this.showMonths('view-month', 0);
      case 'trend':
        return this.showTrend();
      case 'tr':
        return this.showMonths('tr-month', 0);
      case 'rp':
        return this.rpChooseKind();
      case 'rpgo':
        return this.rpGo();
      case 'rpagain':
        return this.rpSendExisting();
      case 'rpnew':
        return this.rpOrder();
      case 'rpstatus':
        return this.rpStatusOnce();
      case 'props':
        return this.showProperties(0, 'prop');
      case 'add':
        return this.promptAdd();
      case 'disc':
        return this.showProperties(0, 'disc');
      case 'unlock':
        return this.askUnlock();
      case 'usend':
        return this.sendUnlockCode();
      case 'tsend':
        return this.startTranscript();
      case 'again':
        return this.sendExisting();
      case 'new':
        return this.showQuota();
      case 'status':
        return this.checkStatusOnce();
      default:
        await this.text(this.M('STALE_BUTTON'));
        return this.ctx.ownerId ? this.showMenu() : this.start();
    }
  }

  // ── errors ─────────────────────────────────────────────────────────────

  private async onError(err: unknown): Promise<void> {
    const e = asLwError(err);
    if (!isLwError(err)) logger.error('Watch: unexpected error', { name: (err as Error)?.name, state: this.state });
    else logger.warn('Watch: action failed', { code: e.code, state: this.state });

    let body = lwErrorMessage(e.code, this.lang, e);
    const next = errorNext(e.code);

    switch (this.state) {
      case STATE.WATCH_UNLOCK_CODE:
      case STATE.WATCH_TR_CODE:
        if (next === 'new-code') body += '\n' + this.M('OTP_NEW_NEEDED');
        await this.buttons(body, [this.btn('resend', 'RESEND'), this.btn('cancel', 'CANCEL')]);
        return;
      case STATE.WATCH_ADD_ID:
        await this.text(body + '\n\n' + this.M('ASK_ID_AGAIN'));
        return;
      case STATE.WATCH_TR_PHONE:
        await this.buttons(body, [this.btn('retry', 'TRY_AGAIN'), this.btn('cancel', 'CANCEL')]);
        return;
      case STATE.WATCH_TR_PAYING:
        await this.buttons(body, [this.btn('status', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
        return;
      case STATE.WATCH_RP_PHONE:
        await this.buttons(body, [this.btn('retry', 'TRY_AGAIN'), this.btn('cancel', 'CANCEL')]);
        return;
      case STATE.WATCH_RP_PAYING:
        await this.buttons(body, [this.btn('rpstatus', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
        return;
      default:
        if (next === 'unlock') await this.buttons(body, [this.btn('unlock', 'UNLOCK'), ...this.navButtons()]);
        else if (next === 'properties') await this.buttons(body, [this.btn('props', 'ADD_PROPERTY'), this.btn('menu', 'WATCH_MENU')]);
        else await this.buttons(body, this.navButtons());
    }
  }

  // ── connect a property ─────────────────────────────────────────────────

  private async promptAddFirst(): Promise<void> {
    this.go(STATE.WATCH_ADD_ID, { screen: 'other', ownerId: undefined });
    await this.text(this.M('INTRO_ADD'));
  }

  private async promptAdd(): Promise<void> {
    this.go(STATE.WATCH_ADD_ID, { screen: 'other' });
    await this.text(this.M('ASK_ID_AGAIN'));
  }

  private async onOwnerIdText(raw: string): Promise<void> {
    const id = normalizeOwnerId(raw);
    if (!id) {
      await this.text(this.M('BAD_ID'));
      return;
    }
    const res = await this.d.api.lookupProperty(id);
    if (!res.found || !res.property) {
      await this.text(lwErrorMessage('LW_NOT_FOUND', this.lang) + '\n\n' + this.M('ASK_ID_AGAIN'));
      return;
    }
    const p = res.property;
    this.go(STATE.WATCH_CONFIRM, { pendingOwnerId: id, confirm: 'connect', screen: 'other' });
    await this.buttons(
      this.M('CONFIRM_PROPERTY', {
        name: plain(p.name, 60),
        addressLine: p.address ? `\n📍 ${plain(p.address, 80)}` : '',
        ownerId: id,
      }),
      [this.btn('yes', 'YES'), this.btn('no', 'NO')]
    );
  }

  private async rePromptConfirm(): Promise<void> {
    await this.buttons(this.M('CONFIRM_REPROMPT', { ownerId: this.ctx.pendingOwnerId ?? '' }), [this.btn('yes', 'YES'), this.btn('no', 'NO')]);
  }

  private async confirmNo(): Promise<void> {
    if (this.ctx.confirm === 'disconnect') {
      this.ctx.pendingOwnerId = undefined;
      return this.showProperties(0, 'prop');
    }
    this.ctx.pendingOwnerId = undefined;
    this.go(STATE.WATCH_ADD_ID, { confirm: undefined });
    await this.text(this.M('NOT_CONNECTED'));
  }

  private async confirmYes(): Promise<void> {
    const id = this.ctx.pendingOwnerId;
    if (!id) return this.promptAdd();

    if (this.ctx.confirm === 'disconnect') {
      await this.d.api.disconnect(id);
      if (this.ctx.ownerId === id) this.ctx.ownerId = undefined;
      this.ctx.pendingOwnerId = undefined;
      this.ctx.confirm = undefined;
      await this.text(this.M('DISCONNECTED', { ownerId: id }));
      const { connections } = await this.d.api.listConnections();
      if (connections.length === 0) return this.promptAddFirst();
      if (connections.length === 1 && !this.ctx.ownerId) {
        this.ctx.ownerId = connections[0].ownerId;
        return this.showMenu(connections);
      }
      return this.showProperties(0, 'prop', connections);
    }

    let connection: Connection;
    try {
      connection = (await this.d.api.connect(id)).connection;
    } catch (err) {
      const e = asLwError(err);
      this.ctx.pendingOwnerId = undefined;
      this.ctx.confirm = undefined;
      if (e.code === 'LW_CONNECTION_LIMIT') {
        await this.text(lwErrorMessage(e.code, this.lang, e));
        return this.showProperties(0, 'prop');
      }
      this.go(STATE.WATCH_ADD_ID, { screen: 'other' });
      throw err;
    }
    this.ctx.ownerId = id;
    this.ctx.month = undefined;
    this.ctx.pendingOwnerId = undefined;
    this.ctx.confirm = undefined;
    await this.text(this.M('CONNECTED', { name: plain(connection.propertyName, 60) }));
    return this.showMenu([connection]);
  }

  // ── menus ──────────────────────────────────────────────────────────────

  private async showMenu(conns?: Connection[]): Promise<void> {
    const list = conns ?? (await this.d.api.listConnections()).connections;
    const cur = list.find((c) => c.ownerId === this.ctx.ownerId);
    if (!cur) {
      this.ctx.ownerId = undefined;
      return list.length ? this.showProperties(0, 'prop', list) : this.promptAddFirst();
    }

    const row = (id: string, t: WatchLabelKey, desc: WatchLabelKey): WaRow => ({
      id: ACTION_PREFIX + id,
      title: this.L(t),
      description: this.L(desc),
    });
    const rows: WaRow[] = [
      row('sum', 'ROW_SUMMARY', 'DESC_SUMMARY'),
      row('paid', 'ROW_PAID', 'DESC_PAID'),
      row('unpaid', 'ROW_UNPAID', 'DESC_UNPAID'),
      row('money', 'ROW_MONEY', 'DESC_MONEY'),
      row('months', 'ROW_MONTHS', 'DESC_MONTHS'),
      row('tr', 'ROW_TRANSCRIPT', 'DESC_TRANSCRIPT'),
    ];
    if (cur.unlocked) rows.push(row('rp', 'ROW_REPORT', 'DESC_REPORT'));
    rows.push(row('props', 'ROW_PROPS', 'DESC_PROPS'));
    if (!cur.unlocked) rows.push(row('unlock', 'ROW_UNLOCK', 'DESC_UNLOCK'));
    rows.push(row('settings', 'ROW_SETTINGS', 'DESC_SETTINGS'), row('main', 'ROW_MAIN', 'DESC_MAIN'));

    this.go(STATE.WATCH_MENU, { screen: 'menu', pick: undefined, page: 0 });
    await this.emit({
      kind: 'list',
      body: this.M('MENU_BODY', {
        name: plain(cur.propertyName, 60),
        addressLine: cur.address ? `\n📍 ${plain(cur.address, 80)}` : '',
        month: this.ctx.month ? monthLabel(this.ctx.month, this.lang) : this.M('MONTH_LATEST'),
        lock: this.M(cur.unlocked ? 'LOCK_OPEN' : 'LOCK_HIDDEN'),
      }),
      button: this.L('LIST_BUTTON'),
      rows,
    });
  }

  private async selectProperty(ownerId: string): Promise<void> {
    this.ctx.ownerId = ownerId;
    this.ctx.month = undefined;
    return this.showMenu();
  }

  private async showProperties(page: number, purpose: 'prop' | 'disc', conns?: Connection[]): Promise<void> {
    const list = conns ?? (await this.d.api.listConnections()).connections;
    if (list.length === 0) return this.promptAddFirst();

    const pg = paginate(list, page, purpose === 'prop' ? PROP_PAGE : PROP_DISC_PAGE);
    const tag = purpose === 'prop' ? 'p' : 'd';
    const rows: WaRow[] = pg.items.map((c) => ({
      id: `${ACTION_PREFIX}${tag}:${c.ownerId}`,
      title: (c.ownerId === this.ctx.ownerId && purpose === 'prop' ? '✓ ' : '') + plain(c.propertyName, 22),
      description: plain(c.ownerId + (c.address ? ` · ${c.address}` : ''), 72),
    }));
    const pgTag = purpose === 'prop' ? 'pgp' : 'pgd';
    if (pg.hasPrev) rows.push({ id: `${ACTION_PREFIX}${pgTag}:${pg.page - 1}`, title: this.L('PREV') });
    if (pg.hasNext) rows.push({ id: `${ACTION_PREFIX}${pgTag}:${pg.page + 1}`, title: this.L('MORE_PROPS') });
    if (purpose === 'prop') {
      rows.push({ id: ACTION_PREFIX + 'add', title: this.L('ADD_PROPERTY') });
      rows.push({ id: ACTION_PREFIX + 'disc', title: this.L('DISCONNECT') });
    }

    this.go(STATE.WATCH_MENU, { screen: 'other', pick: purpose, page: pg.page });
    await this.emit({
      kind: 'list',
      body: purpose === 'prop' ? this.M('PROPS_HEADER', { n: list.length }) : this.M('PICK_DISCONNECT'),
      button: this.L('LIST_BUTTON'),
      rows,
    });
  }

  private async askDisconnect(ownerId: string): Promise<void> {
    const { connections } = await this.d.api.listConnections();
    const c = connections.find((x) => x.ownerId === ownerId);
    this.go(STATE.WATCH_CONFIRM, { pendingOwnerId: ownerId, confirm: 'disconnect', screen: 'other' });
    await this.buttons(this.M('DISCONNECT_CONFIRM', { name: plain(c?.propertyName ?? ownerId, 60), ownerId }), [
      this.btn('yes', 'YES'),
      this.btn('no', 'NO'),
    ]);
  }

  // ── snapshot views ─────────────────────────────────────────────────────

  private async snap(): Promise<Snapshot> {
    const owner = this.ctx.ownerId;
    if (!owner) throw new LwError('LW_NOT_ALLOWED');
    let r;
    try {
      r = await this.d.api.getSnapshot(owner, this.ctx.month, this.lang);
    } catch (err) {
      if (asLwError(err).code === 'LW_BAD_MONTH' && this.ctx.month) {
        this.ctx.month = undefined; // that month has no data: fall back to the latest
        r = await this.d.api.getSnapshot(owner, undefined, this.lang);
      } else throw err;
    }
    if (!('snapshot' in r)) throw new LwError('LW_UNAVAILABLE');
    return r.snapshot;
  }

  private unlockButton(s: Snapshot): WaButton[] {
    return s.mask.level !== 'open' && s.mask.canUnlock ? [this.btn('unlock', 'UNLOCK')] : [];
  }

  private async showSummary(): Promise<void> {
    const s = await this.snap();
    this.go(STATE.WATCH_MENU, { screen: 'other', pick: undefined });
    await this.buttons(renderSummary(s, this.lang), [...this.unlockButton(s), ...this.navButtons()]);
  }

  private async showMoney(): Promise<void> {
    const s = await this.snap();
    this.go(STATE.WATCH_MENU, { screen: 'other', pick: undefined });
    await this.buttons(renderMoney(s, this.lang), this.navButtons());
  }

  private async showTrend(): Promise<void> {
    const s = await this.snap();
    this.go(STATE.WATCH_MENU, { screen: 'other', pick: undefined });
    await this.buttons(renderTrend(s, this.lang), this.navButtons());
  }

  private async showTenants(kind: TenantListKind, page: number): Promise<void> {
    const s = await this.snap();
    const r = renderTenantList(s, kind, this.lang, page, this.d.now());
    const nav: WaButton[] = [];
    if (r.page.hasNext) nav.push({ id: `${ACTION_PREFIX}pg:${kind}:${r.page.page + 1}`, title: this.L('NEXT') });
    if (r.page.hasPrev) nav.push({ id: `${ACTION_PREFIX}pg:${kind}:${r.page.page - 1}`, title: this.L('PREV') });
    nav.push(...this.unlockButton(s));
    this.go(STATE.WATCH_MENU, { screen: 'other', pick: undefined, page: r.page.page });
    await this.buttons(r.text, [...nav.slice(0, 2), this.btn('menu', 'WATCH_MENU')]);
  }

  private async showMonths(purpose: 'view-month' | 'tr-month' | 'rp-month', page: number): Promise<void> {
    const s = await this.snap();
    if (s.months.length === 0) {
      await this.buttons(this.M('NO_MONTHS'), this.navButtons());
      return;
    }
    const pg = paginate(s.months, page, purpose === 'view-month' ? MONTH_PAGE_VIEW : MONTH_PAGE_TR);
    const rows: WaRow[] = pg.items.map((m) => ({
      id: `${ACTION_PREFIX}m:${m}`,
      title: monthLabel(m, this.lang),
      ...(purpose === 'view-month' && m === this.ctx.month ? { description: '✓' } : {}),
    }));
    if (purpose === 'view-month') rows.push({ id: ACTION_PREFIX + 'trend', title: this.L('TREND') });
    if (pg.hasPrev) rows.push({ id: `${ACTION_PREFIX}pgm:${pg.page - 1}`, title: this.L('PREV') });
    if (pg.hasNext) rows.push({ id: `${ACTION_PREFIX}pgm:${pg.page + 1}`, title: this.L('MORE_MONTHS') });

    this.go(STATE.WATCH_MENU, { screen: 'other', pick: purpose as PickPurpose, page: pg.page });
    await this.emit({
      kind: 'list',
      body: this.M(purpose === 'view-month' ? 'PICK_MONTH' : purpose === 'rp-month' ? 'RP_MONTH' : 'PICK_MONTH_TR'),
      button: this.L('LIST_BUTTON'),
      rows,
    });
  }

  private async onMonthPicked(month: string): Promise<void> {
    if (this.ctx.pick === 'rp-month') {
      this.ctx.rpMonth = month;
      return this.rpStart();
    }
    if (this.ctx.pick === 'tr-month') {
      this.ctx.trMonth = month;
      return this.chooseTranscriptMonth();
    }
    this.ctx.month = month;
    return this.showSummary();
  }

  // ── language / help ────────────────────────────────────────────────────

  private async showSettings(): Promise<void> {
    this.go(STATE.WATCH_MENU, { screen: 'other', pick: undefined });
    await this.buttons(this.M('SETTINGS'), [
      { id: ACTION_PREFIX + 'lang:en', title: this.L('ENGLISH') },
      { id: ACTION_PREFIX + 'lang:sw', title: this.L('KISWAHILI') },
      this.btn('help', 'HELP'),
    ]);
  }

  private async setLang(lang: Lang): Promise<void> {
    this.lang = lang;
    await this.d.store.setLanguage(lang);
    await this.text(this.M('LANG_SET'));
    if (this.ctx.ownerId) return this.showMenu();
    return this.start();
  }

  private async showHelp(): Promise<void> {
    this.go(STATE.WATCH_MENU, { screen: 'other', pick: undefined });
    await this.buttons(this.M('HELP'), this.navButtons());
  }

  // ── unlock tenant details ──────────────────────────────────────────────

  private async askUnlock(): Promise<void> {
    const owner = this.ctx.ownerId!;
    const { connections } = await this.d.api.listConnections();
    if (connections.find((c) => c.ownerId === owner)?.unlocked) {
      await this.text(this.M('ALREADY_OPEN'));
      return this.showMenu(connections);
    }
    this.go(STATE.WATCH_MENU, { screen: 'other', pick: undefined });
    await this.buttons(this.M('UNLOCK_ASK'), [this.btn('usend', 'SEND_CODE'), this.btn('cancel', 'CANCEL')]);
  }

  private async sendUnlockCode(): Promise<void> {
    const res = await this.d.api.unlockSendOtp(this.ctx.ownerId!, this.lang);
    this.go(STATE.WATCH_UNLOCK_CODE, { resendAt: this.nowSec() + (res.resendInSec || 60), screen: 'other' });
    await this.buttons(this.M('OTP_SENT', { sentTo: plain(res.sentTo, 20), minutes: Math.max(1, Math.round((res.expiresInSec || 300) / 60)) }), [
      this.btn('resend', 'RESEND'),
      this.btn('cancel', 'CANCEL'),
    ]);
  }

  private async onUnlockCode(raw: string): Promise<void> {
    const code = parseOtp(raw);
    if (!code) return this.rePromptCode();
    const res = await this.d.api.unlockVerifyOtp(this.ctx.ownerId!, code);
    this.ctx.resendAt = undefined;
    await this.text(
      this.M('UNLOCK_OK', {
        until: res.unlockedUntil ? this.M('UNLOCK_UNTIL', { when: dateTimeNairobi(res.unlockedUntil, this.lang) }) : '',
      })
    );
    return this.showMenu();
  }

  private async rePromptCode(): Promise<void> {
    await this.buttons(this.M('OTP_REPROMPT'), [this.btn('resend', 'RESEND'), this.btn('cancel', 'CANCEL')]);
  }

  /** "Resend code" with the 60 s cool-down: never calls the backend before the server's window has passed. */
  private async resend(kind: 'unlock' | 'transcript'): Promise<void> {
    const left = (this.ctx.resendAt ?? 0) - this.nowSec();
    if (left > 0) {
      await this.buttons(this.M('OTP_WAIT', { wait: waitText(left, this.lang) }), [this.btn('resend', 'RESEND'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    const res =
      kind === 'unlock'
        ? await this.d.api.unlockSendOtp(this.ctx.ownerId!, this.lang)
        : await this.d.api.transcriptResendOtp(this.ctx.requestId!);
    this.ctx.resendAt = this.nowSec() + (res.resendInSec || 60);
    await this.buttons(this.M('OTP_SENT', { sentTo: plain(res.sentTo, 20), minutes: Math.max(1, Math.round((res.expiresInSec || 300) / 60)) }), [
      this.btn('resend', 'RESEND'),
      this.btn('cancel', 'CANCEL'),
    ]);
  }

  // ── transcript ─────────────────────────────────────────────────────────

  private async chooseTranscriptMonth(): Promise<void> {
    const owner = this.ctx.ownerId!;
    const month = this.ctx.trMonth!;
    const { items } = await this.d.api.transcriptList(owner);
    const mine = items.filter((i) => i.month === month).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const ready = mine.find((i) => i.state === 'ready' && !!i.expiresAt && Date.parse(i.expiresAt) > this.d.now());
    if (ready) {
      this.go(STATE.WATCH_MENU, { requestId: ready.requestId, screen: 'other', pick: undefined });
      await this.buttons(
        this.M('TR_EXISTING', {
          month: monthLabel(month, this.lang),
          until: this.M('TR_EXISTING_UNTIL', { when: dateTimeNairobi(ready.expiresAt, this.lang) }),
        }),
        [this.btn('again', 'SEND_AGAIN'), this.btn('new', 'NEW_ONE'), this.btn('cancel', 'CANCEL')]
      );
      return;
    }

    const inflight = mine.find((i) => i.state === 'payment_pending' || i.state === 'paid' || i.state === 'generating');
    if (inflight) {
      this.go(STATE.WATCH_TR_PAYING, { requestId: inflight.requestId, screen: 'other' });
      await this.buttons(this.M('TR_NOT_YET'), [this.btn('status', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    return this.showQuota();
  }

  private async showQuota(): Promise<void> {
    const q = await this.d.api.transcriptQuota(this.ctx.ownerId!);
    const month = monthLabel(this.ctx.trMonth ?? q.period, this.lang);
    const body =
      q.nextPriceKes === 0
        ? this.M('TR_QUOTA_FREE', { month, left: Math.max(0, q.freeLimit - q.freeUsed), limit: q.freeLimit })
        : this.M('TR_QUOTA_PAID', { month, price: kes(q.nextPriceKes) });
    this.go(STATE.WATCH_MENU, { screen: 'other', pick: undefined });
    await this.buttons(body, [this.btn('tsend', 'SEND_CODE'), this.btn('cancel', 'CANCEL')]);
  }

  private async startTranscript(): Promise<void> {
    if (!this.ctx.trMonth) return this.showMonths('tr-month', 0);
    const r = await this.d.api.transcriptStart(this.ctx.ownerId!, this.ctx.trMonth, this.lang);
    this.go(STATE.WATCH_TR_CODE, { requestId: r.requestId, resendAt: this.nowSec() + (r.resendInSec || 60), screen: 'other' });
    await this.buttons(this.M('OTP_SENT', { sentTo: plain(r.sentTo ?? '', 20), minutes: Math.max(1, Math.round((r.expiresInSec || 300) / 60)) }), [
      this.btn('resend', 'RESEND'),
      this.btn('cancel', 'CANCEL'),
    ]);
  }

  private async onTranscriptCode(raw: string): Promise<void> {
    const code = parseOtp(raw);
    if (!code) return this.rePromptCode();
    const id = this.ctx.requestId;
    if (!id) return this.showMonths('tr-month', 0);
    this.ctx.resendAt = undefined;
    const req = await this.d.api.transcriptVerifyOtp(id, code);
    return this.afterState(req);
  }

  /** React to whatever state the server reports for a transcript request. */
  private async afterState(req: TranscriptRequest): Promise<void> {
    switch (req.state) {
      case 'ready':
        return this.deliver(req);
      case 'payment_required':
        return this.askPay(req.priceKes);
      case 'payment_pending':
      case 'paid':
      case 'generating':
        if (req.state !== 'payment_pending') await this.text(this.M('TR_GENERATING'));
        this.go(STATE.WATCH_TR_PAYING, { requestId: req.requestId, screen: 'other' });
        await this.save(); // a concurrent "cancel" must see this state
        return this.pollAndHandle();
      case 'failed':
        this.clearRequest();
        await this.buttons(this.M('TR_FAILED'), this.navButtons());
        return;
      case 'expired':
        this.clearRequest();
        await this.buttons(this.M('TR_EXPIRED'), this.navButtons());
        return;
      default:
        return this.rePromptCode();
    }
  }

  private clearRequest(): void {
    this.go(STATE.WATCH_MENU, { requestId: undefined, trMonth: undefined, resendAt: undefined, screen: 'other', pick: undefined });
  }

  private async cancelTranscript(): Promise<void> {
    this.clearRequest();
    await this.text(this.M('TR_CANCELLED'));
    return this.showMenu();
  }

  private async askPay(priceKes: number | undefined): Promise<void> {
    this.go(STATE.WATCH_TR_PHONE, { screen: 'other' });
    const own = isSafaricomE164(this.d.actorPhone) ? '0' + this.d.actorPhone.slice(4) : null;
    if (!own) {
      await this.text(this.M('TR_PHONE_ASK'));
      return;
    }
    await this.buttons(this.M('TR_PAY_ASK', { price: priceKes === undefined ? '' : kes(priceKes), phone: own }), [
      this.btn('mine', 'MY_NUMBER'),
      this.btn('other', 'OTHER_NUMBER'),
      this.btn('cancel', 'CANCEL'),
    ]);
  }

  private async retryPay(): Promise<void> {
    const id = this.ctx.requestId;
    if (!id) return this.showMonths('tr-month', 0);
    const r = await this.d.api.transcriptStatus(id);
    if (r.state === 'payment_required' || r.state === 'failed') return this.askPay(r.priceKes);
    return this.afterState(r);
  }

  private async onPhoneText(raw: string): Promise<void> {
    const phone = normalizeKenyanPhone(raw);
    if (!phone) {
      await this.buttons(this.M('TR_PHONE_BAD'), [this.btn('mine', 'MY_NUMBER'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    return this.pay(phone);
  }

  private async pay(phone: string): Promise<void> {
    const id = this.ctx.requestId;
    if (!id) return this.showMonths('tr-month', 0);
    if (!isSafaricomE164(phone)) {
      await this.text(this.M('TR_PHONE_BAD'));
      return;
    }
    const r = await this.d.api.transcriptPay(id, phone);
    if (r.state === 'failed') {
      this.go(STATE.WATCH_TR_PHONE, {});
      await this.buttons(this.M('TR_PAY_FAILED'), [this.btn('retry', 'TRY_AGAIN'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    this.go(STATE.WATCH_TR_PAYING, { requestId: r.requestId, screen: 'other' });
    await this.text(this.M('TR_PAY_SENT', { phone: '0' + phone.slice(4) }));
    await this.save();
    return this.pollAndHandle();
  }

  /** Poll every 3 s for up to 90 s; see utils/watch.poll.ts. */
  private async pollAndHandle(): Promise<void> {
    const id = this.ctx.requestId!;
    const outcome = await pollTranscript({
      fetch: () => this.d.api.transcriptStatus(id),
      sleep: this.d.sleep,
      now: this.d.now,
      onSlow: async () => {
        await this.text(this.M('TR_STILL_WAITING'));
      },
      shouldContinue: async () => {
        const cur = await this.d.store.read();
        return cur.state === STATE.WATCH_TR_PAYING && cur.ctx.requestId === id;
      },
    });

    switch (outcome.kind) {
      case 'ready':
        return this.deliver(outcome.request);
      case 'failed':
      case 'payment_required':
        this.go(STATE.WATCH_TR_PHONE, {});
        await this.buttons(this.M('TR_PAY_FAILED'), [this.btn('retry', 'TRY_AGAIN'), this.btn('cancel', 'CANCEL')]);
        return;
      case 'expired':
        this.clearRequest();
        await this.buttons(this.M('TR_EXPIRED'), this.navButtons());
        return;
      case 'cancelled':
        this.left = true; // another message took over; do not overwrite its state
        return;
      case 'timeout':
        await this.buttons(this.M('TR_TIMEOUT'), [this.btn('status', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
        return;
      case 'error':
        await this.buttons(this.M('GENERIC_ERROR'), [this.btn('status', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
        return;
    }
  }

  /** One manual status check (the "Check status" button, or any message while a payment is pending). */
  private async checkStatusOnce(): Promise<void> {
    const id = this.ctx.requestId;
    if (!id) return this.showMenu();
    const r = await this.d.api.transcriptStatus(id);
    if (r.state === 'ready') return this.deliver(r);
    if (r.state === 'failed' || r.state === 'payment_required') {
      this.go(STATE.WATCH_TR_PHONE, {});
      await this.buttons(this.M('TR_PAY_FAILED'), [this.btn('retry', 'TRY_AGAIN'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    if (r.state === 'expired') return this.afterState(r);
    if (r.state === 'paid' || r.state === 'generating') return this.afterState(r); // payment confirmed: keep polling until the PDF is ready
    this.go(STATE.WATCH_TR_PAYING, {});
    await this.buttons(this.M('TR_NOT_YET'), [this.btn('status', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
  }

  /** "Send again": an already generated transcript is re-sent without a new code or charge. */
  private async sendExisting(): Promise<void> {
    const id = this.ctx.requestId;
    if (!id) return this.showMonths('tr-month', 0);
    const r = await this.d.api.transcriptStatus(id);
    if (r.state === 'ready') return this.deliver(r);
    if (r.state === 'expired') {
      this.ctx.requestId = undefined;
      await this.text(this.M('TR_EXPIRED'));
      return this.showQuota();
    }
    return this.afterState(r);
  }

  /** Send the PDF as a WhatsApp document. The signed URL is used once and never stored or logged. */
  private async deliver(req: TranscriptRequest): Promise<void> {
    let current = req;
    if (!current.url) current = await this.d.api.transcriptStatus(req.requestId);
    if (current.state !== 'ready' || !current.url) {
      this.clearRequest();
      await this.buttons(this.M('TR_FAILED'), this.navButtons());
      return;
    }

    const sent = await this.emit({
      kind: 'document',
      url: current.url,
      filename: `Landlord-Watch-${current.ownerId}-${current.month}.pdf`,
      caption: this.M('TR_CAPTION', { month: monthLabel(current.month, this.lang), ownerId: current.ownerId }),
    });

    if (!sent.ok) {
      this.go(STATE.WATCH_MENU, { requestId: current.requestId, screen: 'other', pick: undefined });
      await this.buttons(this.M('TR_DOC_FAILED'), [this.btn('again', 'SEND_AGAIN'), this.btn('menu', 'WATCH_MENU')]);
      return;
    }

    this.clearRequest();
    await this.buttons(
      this.M('TR_SENT', { until: current.expiresAt ? this.M('TR_SENT_UNTIL', { when: dateTimeNairobi(current.expiresAt, this.lang) }) : '' }),
      this.navButtons()
    );
  }

  // ── compliance reports (MRI working paper, annual summary) ──────────────
  // The server decides the price, the free allowance and the checkout gate; this flow only asks, shows and sends. The PDF is
  // requested only after checkout (free: one tap; paid: M-Pesa), and its link is used once to send a WhatsApp document.

  private rpTitle(kind: ReportKind | undefined): string {
    return this.L(kind === 'annual_summary' ? 'RP_ANNUAL' : 'RP_MRI');
  }

  private clearReport(): void {
    this.go(STATE.WATCH_MENU, { rpId: undefined, rpKind: undefined, rpMonth: undefined, screen: 'other', pick: undefined });
  }

  private async rpChooseKind(): Promise<void> {
    this.go(STATE.WATCH_MENU, { rpId: undefined, rpKind: undefined, rpMonth: undefined, screen: 'other', pick: undefined });
    await this.buttons(this.M('RP_KIND'), [this.btn('rpk:mri_monthly', 'RP_MRI'), this.btn('rpk:annual_summary', 'RP_ANNUAL'), this.btn('cancel', 'CANCEL')]);
  }

  private async rpCancel(): Promise<void> {
    this.clearReport();
    await this.text(this.M('TR_CANCELLED'));
    return this.showMenu();
  }

  /** Month chosen: offer a report that already exists (free to send again), pick up one in flight, or order a new one. */
  private async rpStart(): Promise<void> {
    const ownerId = this.ctx.ownerId!, month = this.ctx.rpMonth!, kind = this.ctx.rpKind!;
    const { items } = await this.d.api.reportList(ownerId);
    const mine = items.filter((i) => i.month === month && i.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const nowMs = this.d.now();
    const ready = mine.find((i) => i.state === 'ready' && (!i.expiresAt || Date.parse(i.expiresAt) > nowMs));
    if (ready) {
      this.go(STATE.WATCH_MENU, { rpId: ready.requestId, screen: 'other', pick: undefined });
      const until = ready.expiresAt ? ` (${dateTimeNairobi(ready.expiresAt, this.lang)})` : '';
      await this.buttons(this.M('RP_EXISTING', { title: this.rpTitle(kind), month: monthLabel(month, this.lang), until }), [
        this.btn('rpagain', 'SEND_AGAIN'),
        this.btn('rpnew', 'NEW_ONE'),
        this.btn('cancel', 'CANCEL'),
      ]);
      return;
    }
    const inflight = mine.find((i) => i.state === 'payment_pending' || i.state === 'paid' || i.state === 'generating');
    if (inflight) {
      this.go(STATE.WATCH_RP_PAYING, { rpId: inflight.requestId, screen: 'other', pick: undefined });
      await this.buttons(this.M('TR_NOT_YET'), [this.btn('rpstatus', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    return this.rpOrder();
  }

  private async rpOrder(): Promise<void> {
    const ownerId = this.ctx.ownerId!, month = this.ctx.rpMonth, kind = this.ctx.rpKind;
    if (!month || !kind) return this.rpChooseKind();
    const r = await this.d.api.reportOrder(ownerId, month, kind);
    this.ctx.rpId = r.requestId;
    return this.rpAfter(r);
  }

  private async rpAfter(r: TranscriptRequest): Promise<void> {
    switch (r.state) {
      case 'ready':
        return this.rpDeliver(r);
      case 'payment_required':
        if (r.priceKes === 0) {
          this.go(STATE.WATCH_MENU, { rpId: r.requestId, screen: 'other', pick: undefined });
          await this.buttons(this.M('RP_FREE', { title: this.rpTitle(this.ctx.rpKind), month: monthLabel(this.ctx.rpMonth ?? r.month, this.lang) }), [
            this.btn('rpgo', 'RP_GET_FREE'),
            this.btn('cancel', 'CANCEL'),
          ]);
          return;
        }
        return this.rpAskPay(r.priceKes);
      case 'expired':
        this.clearReport();
        await this.buttons(this.M('RP_EXPIRED'), this.navButtons());
        return;
      case 'failed':
        this.clearReport();
        await this.buttons(r.error?.code === 'CR_NO_DATA' ? lwErrorMessage('LW_REPORT_NO_DATA', this.lang) : this.M('RP_FAILED'), this.navButtons());
        return;
      default: // payment_pending, paid, generating: the server is working; wait for the PDF
        this.go(STATE.WATCH_RP_PAYING, { rpId: r.requestId, screen: 'other', pick: undefined });
        await this.save();
        return this.rpPoll();
    }
  }

  /** "Get free report": the zero-amount checkout. If the allowance was used meanwhile, the server says so and the price is shown. */
  private async rpGo(): Promise<void> {
    const id = this.ctx.rpId;
    if (!id) return this.rpChooseKind();
    const r = await this.d.api.reportCheckout(id);
    if (r.state === 'payment_required' && r.priceKes > 0) {
      await this.text(this.M('RP_PRICE_CHANGED', { price: kes(r.priceKes) }));
      return this.rpAskPay(r.priceKes);
    }
    return this.rpAfter(r);
  }

  private async rpAskPay(priceKes: number | undefined): Promise<void> {
    this.go(STATE.WATCH_RP_PHONE, { screen: 'other', pick: undefined });
    const own = isSafaricomE164(this.d.actorPhone) ? '0' + this.d.actorPhone.slice(4) : null;
    if (!own) {
      await this.text(this.M('TR_PHONE_ASK'));
      return;
    }
    await this.buttons(
      this.M('RP_PAY_ASK', { title: this.rpTitle(this.ctx.rpKind), month: this.ctx.rpMonth ? monthLabel(this.ctx.rpMonth, this.lang) : '', price: priceKes === undefined ? '' : kes(priceKes), phone: own }),
      [this.btn('mine', 'MY_NUMBER'), this.btn('other', 'OTHER_NUMBER'), this.btn('cancel', 'CANCEL')]
    );
  }

  private async rpRetry(): Promise<void> {
    const id = this.ctx.rpId;
    if (!id) return this.rpChooseKind();
    const r = await this.d.api.reportStatus(id);
    if (r.state === 'payment_required' || r.state === 'failed') return this.rpAskPay(r.priceKes);
    return this.rpAfter(r);
  }

  private async rpPhoneText(raw: string): Promise<void> {
    const phone = normalizeKenyanPhone(raw);
    if (!phone) {
      await this.buttons(this.M('TR_PHONE_BAD'), [this.btn('mine', 'MY_NUMBER'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    return this.rpPay(phone);
  }

  private async rpPay(phone: string): Promise<void> {
    const id = this.ctx.rpId;
    if (!id) return this.rpChooseKind();
    if (!isSafaricomE164(phone)) {
      await this.text(this.M('TR_PHONE_BAD'));
      return;
    }
    const r = await this.d.api.reportCheckout(id, phone);
    if (r.state === 'failed') {
      this.go(STATE.WATCH_RP_PHONE, {});
      await this.buttons(this.M('RP_PAY_FAILED'), [this.btn('retry', 'TRY_AGAIN'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    if (r.state === 'payment_required') return this.rpAskPay(r.priceKes);
    this.go(STATE.WATCH_RP_PAYING, { rpId: r.requestId, screen: 'other' });
    await this.text(this.M('RP_PAY_SENT', { phone: '0' + phone.slice(4) }));
    await this.save();
    return this.rpPoll();
  }

  /** Poll every 3 s for up to 90 s; see utils/watch.poll.ts. */
  private async rpPoll(): Promise<void> {
    const id = this.ctx.rpId!;
    const outcome = await pollTranscript({
      fetch: () => this.d.api.reportStatus(id),
      sleep: this.d.sleep,
      now: this.d.now,
      onSlow: async () => {
        await this.text(this.M('TR_STILL_WAITING'));
      },
      shouldContinue: async () => {
        const cur = await this.d.store.read();
        return cur.state === STATE.WATCH_RP_PAYING && cur.ctx.rpId === id;
      },
    });
    switch (outcome.kind) {
      case 'ready':
        return this.rpDeliver(outcome.request);
      case 'failed':
      case 'payment_required':
        this.go(STATE.WATCH_RP_PHONE, {});
        await this.buttons(this.M('RP_PAY_FAILED'), [this.btn('retry', 'TRY_AGAIN'), this.btn('cancel', 'CANCEL')]);
        return;
      case 'expired':
        this.clearReport();
        await this.buttons(this.M('RP_EXPIRED'), this.navButtons());
        return;
      case 'cancelled':
        this.left = true; // another message took over; do not overwrite its state
        return;
      case 'timeout':
        await this.buttons(this.M('TR_TIMEOUT'), [this.btn('rpstatus', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
        return;
      case 'error':
        await this.buttons(this.M('GENERIC_ERROR'), [this.btn('rpstatus', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
        return;
    }
  }

  private async rpStatusOnce(): Promise<void> {
    const id = this.ctx.rpId;
    if (!id) return this.showMenu();
    const r = await this.d.api.reportStatus(id);
    if (r.state === 'ready') return this.rpDeliver(r);
    if (r.state === 'failed' || r.state === 'payment_required') {
      this.go(STATE.WATCH_RP_PHONE, {});
      await this.buttons(this.M('RP_PAY_FAILED'), [this.btn('retry', 'TRY_AGAIN'), this.btn('cancel', 'CANCEL')]);
      return;
    }
    if (r.state === 'expired' || r.state === 'paid' || r.state === 'generating') return this.rpAfter(r);   // paid: keep polling until the PDF is ready
    this.go(STATE.WATCH_RP_PAYING, {});
    await this.buttons(this.M('TR_NOT_YET'), [this.btn('rpstatus', 'CHECK_STATUS'), this.btn('cancel', 'CANCEL')]);
  }

  /** "Send again": a report that already exists is re-sent without a new charge. */
  private async rpSendExisting(): Promise<void> {
    const id = this.ctx.rpId;
    if (!id) return this.rpChooseKind();
    const r = await this.d.api.reportStatus(id);
    if (r.state === 'ready') return this.rpDeliver(r);
    if (r.state === 'expired') {
      this.ctx.rpId = undefined;
      await this.text(this.M('RP_EXPIRED'));
      return this.rpChooseKind();
    }
    return this.rpAfter(r);
  }

  /** Send the PDF as a WhatsApp document. The signed URL is used once and never stored or logged. */
  private async rpDeliver(req: TranscriptRequest): Promise<void> {
    let current = req;
    if (!current.url) current = await this.d.api.reportStatus(req.requestId);
    if (current.state !== 'ready' || !current.url) {
      this.clearReport();
      await this.buttons(this.M('RP_FAILED'), this.navButtons());
      return;
    }
    const kind = current.kind ?? this.ctx.rpKind;
    const sent = await this.emit({
      kind: 'document',
      url: current.url,
      filename: current.fileName ?? `Plot-Yangu-${kind === 'annual_summary' ? 'annual-summary' : 'MRI'}-${current.ownerId}-${current.month}.pdf`,
      caption: this.M('RP_CAPTION', { title: this.rpTitle(kind), month: monthLabel(current.month, this.lang), ownerId: current.ownerId }),
    });
    if (!sent.ok) {
      this.go(STATE.WATCH_MENU, { rpId: current.requestId, screen: 'other', pick: undefined });
      await this.buttons(this.M('RP_DOC_FAILED'), [this.btn('rpagain', 'SEND_AGAIN'), this.btn('menu', 'WATCH_MENU')]);
      return;
    }
    this.clearReport();
    await this.buttons(
      this.M('RP_SENT', { until: current.expiresAt ? this.M('RP_SENT_UNTIL', { when: dateTimeNairobi(current.expiresAt, this.lang) }) : '' }),
      this.navButtons()
    );
  }
}
