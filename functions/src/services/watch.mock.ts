/**
 * Landlord Watch in-memory mock backend (contract section 15). Enabled with LW_MOCK=1.
 *
 * It plays the SERVER: it computes the numbers using the section 5 rules and applies the section 6 masking, so the
 * bot can be exercised end to end without the real backend. The bot itself never does any of this maths.
 *
 * Magic values:
 *   Owner IDs   PYP-0001 Sunrise Apartments (owner phone = LW_MOCK_OWNER_PHONE or +254712345678)
 *               PYP-0003 Baraka Flats        (same owner phone: one OTP unlocks both)
 *               PYP-0002 Mwangaza Court      (different owner phone)
 *               PYP-0004 has no phone on file (LW_NO_PHONE_ON_FILE)
 *               PYP-0100 .. PYP-0199 "Test Property NNN" (to try paging and the connection limit)
 *               PYP-9999 and anything else: not found
 *   OTP         123456 is always correct; other codes give LW_OTP_WRONG with attemptsLeft; 5 wrong tries lock the code
 *   Resend      60 s cool-down (LW_OTP_COOLDOWN with retryAfterSec)
 *   Unlock      30 minutes (the owner's own number is auto-unlocked: reason auth_phone_match)
 *   Pay         STK push "completes" ~6 s after transcriptPay; +254700000000 simulates a failed payment
 *   PDF         https://example.com/transcript.pdf
 * State lives in this process only (use the emulator, or a single instance).
 */

import {
  Connection,
  Lang,
  LookupResult,
  LwApi,
  MaskLevel,
  N,
  OtpSent,
  Quota,
  ReportKind,
  ReportQuote,
  Snapshot,
  SnapshotResult,
  Statement,
  TenantRow,
  TranscriptRequest,
  UnlockResult,
} from '../types/watch.types';
import { LwError } from './watch.api';

export interface MockOptions {
  now?: () => number;
  ownerPhone?: string;
  /** Force every snapshot to this mask level (to try the `full` fixture). */
  forceLevel?: MaskLevel;
  payDelayMs?: number;
  generateDelayMs?: number;
}

const OTP_CODE = '123456';
const OTP_TTL_MS = 5 * 60_000;
const OTP_COOLDOWN_MS = 60_000;
const UNLOCK_MS = 30 * 60_000;
const READY_TTL_MS = 24 * 60 * 60_000;
const FREE_LIMIT = 1;
const PRICE_KES = 99;
const MAX_CONNECTIONS = 25;
const PDF_URL = 'https://example.com/transcript.pdf';

interface MockProperty {
  ownerId: string;
  name: string;
  address: string;
  ownerPhone: string | null;
  maxUnits: number;
  commissionPct: number;
}

interface RawTenant {
  ref: string;
  name: string;
  phone: string;
  unit: string;
  rent: number;
  bills: number;
  paid: number;
  firstPay: string | null;
  hasInvoice: boolean;
}

interface OtpState {
  expiresAt: number;
  attemptsLeft: number;
  lastSendAt: number;
  sends: number[];
}

interface ReqRecord extends TranscriptRequest {
  actor: string;
  otpKey: string;
  payStartedAt?: number;
  generatingSince?: number;
  payPhone?: string;
}

// ── formatting helpers (server side, mock only) ──────────────────────────

const groupDigits = (n: number): string => {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  const [i, d] = s.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '');
};

interface Fmt {
  money: (v: number) => N;
  count: (v: number) => N;
  pct: (v: number) => N;
}

const OPEN_FMT: Fmt = {
  money: (v) => ({ v, d: `KES ${groupDigits(v)}` }),
  count: (v) => ({ v, d: String(v) }),
  pct: (v) => ({ v: Math.round(v * 10) / 10, d: `${Math.round(v)}%` }),
};

const MASKED_FMT: Fmt = {
  money: () => ({ v: null, d: 'KES ••,•••' }),
  count: () => ({ v: null, d: '••' }),
  pct: () => ({ v: null, d: '••%' }),
};

export const maskName = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] + '•••')
    .join(' ');

export const maskPhone = (e164: string): string => {
  const local = '0' + e164.replace(/^\+?254/, '');
  return `${local.slice(0, 2)}•• ••• ${local.slice(-3)}`;
};

const nairobiMonth = (ms: number): string => new Date(ms + 3 * 3600_000).toISOString().slice(0, 7);

// ── fixtures ─────────────────────────────────────────────────────────────

const TENANTS_OCT: RawTenant[] = [
  { ref: 't_9f3a1c', name: 'Daniel Otieno', phone: '+254722111222', unit: 'D4', rent: 18000, bills: 2000, paid: 0, firstPay: null, hasInvoice: true },
  { ref: 't_2c77b0', name: 'Brian Kiprop', phone: '+254733444555', unit: 'B2', rent: 11500, bills: 1000, paid: 5000, firstPay: '2026-10-08', hasInvoice: true },
  { ref: 't_4be07d', name: 'Amina Wanjiru', phone: '+254711333444', unit: 'A1', rent: 14000, bills: 1000, paid: 15000, firstPay: '2026-10-04', hasInvoice: true },
  { ref: 't_71d5e2', name: 'Cynthia Achieng', phone: '+254745666777', unit: 'C3', rent: 8500, bills: 500, paid: 9000, firstPay: '2026-10-17', hasInvoice: true },
  { ref: 't_a0c19f', name: 'Esther Mwangi', phone: '+254720888999', unit: 'E5', rent: 0, bills: 0, paid: 0, firstPay: null, hasInvoice: false },
];

const paidIn = (month: string, day: string): RawTenant[] =>
  TENANTS_OCT.map((t) =>
    t.hasInvoice ? { ...t, paid: t.rent + t.bills, firstPay: `${month}-${day}` } : t
  );

const MONTH_DATA: Record<string, { tenants: RawTenant[]; agentExtra?: { label: string; amount: number } | null; agent: boolean }> = {
  '2026-10': { tenants: TENANTS_OCT, agent: false },
  '2026-09': { tenants: paidIn('2026-09', '03'), agent: true, agentExtra: { label: 'Garbage collection fee', amount: 450 } },
  '2026-08': { tenants: paidIn('2026-08', '02'), agent: true, agentExtra: null },
};
const MONTHS_NEWEST_FIRST = Object.keys(MONTH_DATA).sort().reverse();

// ── backend ──────────────────────────────────────────────────────────────

export class MockBackend {
  readonly now: () => number;
  private readonly ownerPhone: string;
  private readonly forceLevel?: MaskLevel;
  private readonly payDelayMs: number;
  private readonly generateDelayMs: number;

  private readonly properties = new Map<string, MockProperty>();
  private readonly connections = new Map<string, Map<string, string>>(); // actor -> ownerId -> connectedAt ISO
  private readonly unlocks = new Map<string, number>(); // `${actor}|${ownerPhone}` -> until ms
  private readonly otps = new Map<string, OtpState>();
  private readonly lookups = new Map<string, number[]>();
  private readonly quotaUsed = new Map<string, number>(); // `${ownerId}|${period}` -> count
  private readonly requests = new Map<string, ReqRecord>();
  private seq = 0;

  constructor(opts: MockOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.ownerPhone = opts.ownerPhone ?? '+254712345678';
    this.forceLevel = opts.forceLevel;
    this.payDelayMs = opts.payDelayMs ?? 6000;
    this.generateDelayMs = opts.generateDelayMs ?? 1500;

    const add = (p: MockProperty) => this.properties.set(p.ownerId, p);
    add({ ownerId: 'PYP-0001', name: 'Sunrise Apartments', address: 'Naivasha, Nakuru', ownerPhone: this.ownerPhone, maxUnits: 6, commissionPct: 10 });
    add({ ownerId: 'PYP-0002', name: 'Mwangaza Court', address: 'Thika, Kiambu', ownerPhone: '+254733000111', maxUnits: 6, commissionPct: 10 });
    add({ ownerId: 'PYP-0003', name: 'Baraka Flats', address: 'Nyeri Town, Nyeri', ownerPhone: this.ownerPhone, maxUnits: 6, commissionPct: 10 });
    add({ ownerId: 'PYP-0004', name: 'No Phone Plaza', address: 'Kisumu', ownerPhone: null, maxUnits: 6, commissionPct: 10 });
    for (let i = 100; i <= 199; i++) {
      add({ ownerId: `PYP-0${i}`, name: `Test Property ${i}`, address: 'Testville', ownerPhone: '+254799000111', maxUnits: 6, commissionPct: 10 });
    }
  }

  // helpers
  private err(code: ConstructorParameters<typeof LwError>[0], extra?: { retryAfterSec?: number; attemptsLeft?: number }): never {
    throw new LwError(code, code, extra);
  }
  private prop(ownerId: string): MockProperty {
    if (!/^PYP-\d{4,}$/.test(ownerId)) this.err('LW_BAD_OWNER_ID');
    const p = this.properties.get(ownerId);
    if (!p) this.err('LW_NOT_FOUND');
    return p;
  }
  private connected(actor: string, ownerId: string): MockProperty {
    const p = this.prop(ownerId);
    if (!this.connections.get(actor)?.has(ownerId)) this.err('LW_NOT_ALLOWED');
    return p;
  }
  private unlockUntil(actor: string, p: MockProperty): number | 'auto' | null {
    if (!p.ownerPhone) return null;
    if (p.ownerPhone === actor) return 'auto';
    const until = this.unlocks.get(`${actor}|${p.ownerPhone}`);
    return until && until > this.now() ? until : null;
  }

  // OTP engine (shared by unlock and transcripts)
  private sendOtp(key: string, ownerPhone: string): OtpSent {
    const now = this.now();
    const st = this.otps.get(key);
    if (st && now - st.lastSendAt < OTP_COOLDOWN_MS) {
      this.err('LW_OTP_COOLDOWN', { retryAfterSec: Math.ceil((OTP_COOLDOWN_MS - (now - st.lastSendAt)) / 1000) });
    }
    const hourKey = `hour|${ownerPhone}`;
    const sends = (this.otps.get(hourKey)?.sends ?? []).filter((t) => now - t < 3600_000);
    if (sends.length >= 5) this.err('LW_RATE_LIMITED', { retryAfterSec: Math.ceil((3600_000 - (now - sends[0])) / 1000) });
    sends.push(now);
    this.otps.set(hourKey, { expiresAt: 0, attemptsLeft: 0, lastSendAt: now, sends });
    this.otps.set(key, { expiresAt: now + OTP_TTL_MS, attemptsLeft: 5, lastSendAt: now, sends: [] });
    return { sentTo: maskPhone(ownerPhone), expiresInSec: OTP_TTL_MS / 1000, resendInSec: OTP_COOLDOWN_MS / 1000 };
  }
  private checkOtp(key: string, code: string): void {
    const st = this.otps.get(key);
    if (!st) this.err('LW_OTP_EXPIRED');
    if (this.now() > st.expiresAt) {
      this.otps.delete(key);
      this.err('LW_OTP_EXPIRED');
    }
    if (st.attemptsLeft <= 0) this.err('LW_OTP_LOCKED');
    if (code !== OTP_CODE) {
      st.attemptsLeft -= 1;
      if (st.attemptsLeft <= 0) this.err('LW_OTP_LOCKED');
      this.err('LW_OTP_WRONG', { attemptsLeft: st.attemptsLeft });
    }
    this.otps.delete(key);
  }

  // ── API implementation (per actor) ─────────────────────────────────────

  lookupProperty(actor: string, ownerId: string): LookupResult {
    if (!/^PYP-\d{4,}$/.test(ownerId)) this.err('LW_BAD_OWNER_ID');
    const now = this.now();
    const recent = (this.lookups.get(actor) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 20) this.err('LW_RATE_LIMITED', { retryAfterSec: Math.ceil((3600_000 - (now - recent[0])) / 1000) });
    recent.push(now);
    this.lookups.set(actor, recent);
    const p = this.properties.get(ownerId);
    if (!p) return { found: false };
    if (!p.ownerPhone) this.err('LW_NO_PHONE_ON_FILE');
    return { found: true, property: { ownerId, name: p.name, address: p.address, ownerPhoneMasked: maskPhone(p.ownerPhone), managedByAgency: true } };
  }

  private toConnection(actor: string, p: MockProperty, connectedAt: string): Connection {
    const u = this.unlockUntil(actor, p);
    return {
      ownerId: p.ownerId,
      propertyName: p.name,
      address: p.address,
      connectedAt,
      unlocked: u !== null,
      unlockedUntil: typeof u === 'number' ? new Date(u).toISOString() : null,
    };
  }

  connect(actor: string, ownerId: string): { connection: Connection } {
    const p = this.prop(ownerId);
    if (!p.ownerPhone) this.err('LW_NO_PHONE_ON_FILE');
    const mine = this.connections.get(actor) ?? new Map<string, string>();
    if (!mine.has(ownerId) && mine.size >= MAX_CONNECTIONS) this.err('LW_CONNECTION_LIMIT');
    if (!mine.has(ownerId)) mine.set(ownerId, new Date(this.now()).toISOString());
    this.connections.set(actor, mine);
    return { connection: this.toConnection(actor, p, mine.get(ownerId)!) };
  }

  disconnect(actor: string, ownerId: string): { ok: true } {
    this.connections.get(actor)?.delete(ownerId);
    return { ok: true };
  }

  listConnections(actor: string): { connections: Connection[] } {
    const mine = this.connections.get(actor) ?? new Map<string, string>();
    return {
      connections: [...mine.entries()].map(([id, at]) => this.toConnection(actor, this.properties.get(id)!, at)),
    };
  }

  unlockSendOtp(actor: string, ownerId: string): OtpSent {
    const p = this.connected(actor, ownerId);
    if (!p.ownerPhone) this.err('LW_NO_PHONE_ON_FILE');
    return this.sendOtp(`unlock|${actor}|${p.ownerPhone}`, p.ownerPhone);
  }

  unlockVerifyOtp(actor: string, ownerId: string, code: string): UnlockResult {
    const p = this.connected(actor, ownerId);
    if (!p.ownerPhone) this.err('LW_NO_PHONE_ON_FILE');
    this.checkOtp(`unlock|${actor}|${p.ownerPhone}`, code);
    const until = this.now() + UNLOCK_MS;
    this.unlocks.set(`${actor}|${p.ownerPhone}`, until);
    return { unlocked: true, unlockedUntil: new Date(until).toISOString(), level: 'open' };
  }

  getSnapshot(actor: string, ownerId: string, month: string | undefined): SnapshotResult {
    const p = this.connected(actor, ownerId);
    const m = month ?? MONTHS_NEWEST_FIRST[0];
    if (!/^\d{4}-\d{2}$/.test(m) || !MONTH_DATA[m]) this.err('LW_BAD_MONTH');
    const u = this.unlockUntil(actor, p);
    let level: MaskLevel = u === null ? 'tenant' : 'open';
    let reason: Snapshot['mask']['reason'] = u === 'auto' ? 'auth_phone_match' : u === null ? 'locked' : 'otp';
    if (this.forceLevel) {
      level = this.forceLevel;
      reason = level === 'open' ? reason : 'locked';
    }
    const snapshot = this.buildSnapshot(p, m, level, reason, typeof u === 'number' ? new Date(u).toISOString() : null);
    return { snapshot, etag: `${ownerId}|${m}|${level}|${this.now()}` };
  }

  buildSnapshot(p: MockProperty, month: string, level: MaskLevel, reason: Snapshot['mask']['reason'], unlockedUntil: string | null): Snapshot {
    const f = level === 'full' ? MASKED_FMT : OPEN_FMT;
    const calc = this.calc(p, month);
    const statement: Statement = {
      source: calc.agent ? 'agent' : 'estimate',
      status: calc.agent ? 'finalized' : null,
      notes: level === 'full' || !calc.agent ? null : 'Thank you for your patience.',
      items: calc.items.map((i) => ({ label: level === 'full' ? '••••••' : i.label, kind: i.kind, amount: f.money(i.amount) })),
      income: f.money(calc.income),
      deductions: f.money(calc.deductions),
      netPayable: f.money(calc.netPayable),
    };

    const rows: TenantRow[] = calc.rows.map((r) => {
      const status = r.status;
      if (level === 'full') {
        return {
          ref: 't_masked' + r.ref.slice(-1),
          name: maskName(r.name),
          phone: maskPhone(r.phone),
          unit: '••',
          status: 'masked' as const,
          rent: f.money(0), billed: f.money(0), paid: f.money(0), balance: f.money(0),
          dueDate: null, paidOn: null, paidOnTime: null,
        };
      }
      return {
        ref: r.ref,
        name: level === 'open' ? r.name : maskName(r.name),
        phone: level === 'open' ? r.phone : maskPhone(r.phone),
        unit: r.unit,
        status,
        rent: f.money(r.rent), billed: f.money(r.total), paid: f.money(r.paid), balance: f.money(Math.max(0, r.total - r.paid)),
        dueDate: r.hasInvoice ? `${month}-05` : null,
        paidOn: r.firstPay,
        paidOnTime: r.firstPay ? r.firstPay <= `${month}-05` : null,
      };
    });

    const trendMonths = [...MONTHS_NEWEST_FIRST].reverse().slice(-6);
    return {
      schema: 1,
      ownerId: p.ownerId,
      month,
      generatedAt: new Date(this.now()).toISOString(),
      mask: { level, reason, unlockedUntil, canUnlock: !!p.ownerPhone },
      property: {
        name: level === 'full' ? maskName(p.name) : p.name,
        address: level === 'full' ? '••••••••' : p.address,
        maxUnits: f.count(p.maxUnits),
        commissionRatePct: f.pct(p.commissionPct),
        managedByAgency: true,
      },
      months: MONTHS_NEWEST_FIRST,
      summary: {
        tenants: {
          active: f.count(calc.active), occupiedUnits: f.count(calc.active),
          vacantUnits: f.count(Math.max(0, p.maxUnits - calc.active)),
          occupancyPct: f.pct((calc.active / p.maxUnits) * 100),
        },
        invoices: {
          total: f.count(calc.invoices), paid: f.count(calc.nPaid), partial: f.count(calc.nPartial),
          unpaid: f.count(calc.nUnpaid), noInvoice: f.count(calc.nNoInvoice),
        },
        billed: f.money(calc.billed), collected: f.money(calc.collected), pending: f.money(calc.pending),
        collectionRatePct: f.pct(calc.billed ? (calc.collected / calc.billed) * 100 : 0),
        baseRent: { billed: f.money(calc.baseBilled), collected: f.money(calc.baseCollected) },
        commission: { ratePct: f.pct(p.commissionPct), onCollected: f.money(calc.commOnCollected), onExpected: f.money(calc.commOnExpected) },
        net: { expected: f.money(calc.billed - calc.commOnExpected), payable: f.money(calc.netPayable), stillToCollect: f.money(calc.stillToCollect) },
        statement,
        remittance: {
          dueDate: `${month}-15`,
          collectedByDue: f.money(calc.byDue), collectedAfterDue: f.money(calc.afterDue),
          netByDue: f.money(calc.netByDue), netAfterDue: f.money(calc.netAfterDue),
        },
      },
      tenants: level === 'full' ? rows.slice(0, 5) : rows,
      trend: trendMonths.map((tm) => {
        const c = this.calc(p, tm);
        return { month: tm, billed: f.money(c.billed), collected: f.money(c.collected), pending: f.money(c.pending), netPayable: f.money(c.netPayable) };
      }),
    };
  }

  /** Section 5 calculations for one property and month. */
  private calc(p: MockProperty, month: string) {
    const data = MONTH_DATA[month];
    const rate = p.commissionPct;
    const inv = data.tenants.filter((t) => t.hasInvoice);
    const withTotals = data.tenants.map((t) => {
      const total = t.rent + t.bills;
      const status: TenantRow['status'] = !t.hasInvoice ? 'no_invoice' : t.paid >= total ? 'paid' : t.paid > 0 ? 'partial' : 'unpaid';
      return { ...t, total, status };
    });
    const billed = inv.reduce((s, t) => s + t.rent + t.bills, 0);
    const collected = inv.reduce((s, t) => s + t.paid, 0);
    const pending = inv.reduce((s, t) => s + Math.max(0, t.rent + t.bills - t.paid), 0);
    const baseBilled = inv.reduce((s, t) => s + t.rent, 0);
    const baseCollected = inv.filter((t) => t.paid > 0).reduce((s, t) => s + t.rent, 0);
    const commOnCollected = (baseCollected * rate) / 100;
    const commOnExpected = (baseBilled * rate) / 100;

    const items: { label: string; kind: 'income' | 'deduction'; amount: number }[] = [
      { label: 'Collected (rent and bills)', kind: 'income', amount: collected },
      { label: `Agent commission (${rate}% of base rent)`, kind: 'deduction', amount: commOnCollected },
    ];
    if (data.agentExtra) items.push({ label: data.agentExtra.label, kind: 'deduction', amount: data.agentExtra.amount });
    const income = items.filter((i) => i.kind === 'income').reduce((s, i) => s + i.amount, 0);
    const deductions = items.filter((i) => i.kind === 'deduction').reduce((s, i) => s + i.amount, 0);
    const netPayable = income - deductions;

    const due = `${month}-15`;
    const paidRows = inv.filter((t) => t.paid > 0 && t.firstPay);
    const byDueRows = paidRows.filter((t) => t.firstPay! <= due);
    const afterRows = paidRows.filter((t) => t.firstPay! > due);
    const byDue = byDueRows.reduce((s, t) => s + t.paid, 0);
    const afterDue = afterRows.reduce((s, t) => s + t.paid, 0);
    const commBy = (byDueRows.reduce((s, t) => s + t.rent, 0) * rate) / 100;
    const commAfter = (afterRows.reduce((s, t) => s + t.rent, 0) * rate) / 100;

    const order = { unpaid: 0, partial: 1, paid: 2, no_invoice: 3, masked: 4 } as const;
    const rows = [...withTotals].sort((a, b) => order[a.status] - order[b.status]);
    return {
      agent: data.agent, items, income, deductions, netPayable, rows,
      active: data.tenants.length, invoices: inv.length,
      nPaid: withTotals.filter((t) => t.status === 'paid').length,
      nPartial: withTotals.filter((t) => t.status === 'partial').length,
      nUnpaid: withTotals.filter((t) => t.status === 'unpaid').length,
      nNoInvoice: withTotals.filter((t) => t.status === 'no_invoice').length,
      billed, collected, pending, baseBilled, baseCollected, commOnCollected, commOnExpected,
      stillToCollect: Math.max(0, pending - (commOnExpected - commOnCollected)),
      byDue, afterDue, netByDue: byDue - commBy, netAfterDue: afterDue - commAfter,
    };
  }

  // ── transcripts ────────────────────────────────────────────────────────

  private quotaFor(ownerId: string): Quota {
    const period = nairobiMonth(this.now());
    const used = this.quotaUsed.get(`${ownerId}|${period}`) ?? 0;
    return { period, freeLimit: FREE_LIMIT, freeUsed: used, nextPriceKes: used < FREE_LIMIT ? 0 : PRICE_KES };
  }

  transcriptQuota(actor: string, ownerId: string): Quota {
    this.connected(actor, ownerId);
    return this.quotaFor(ownerId);
  }

  private strip(r: ReqRecord): TranscriptRequest {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { actor, otpKey, payStartedAt, generatingSince, payPhone, ...pub } = r;
    return { ...pub };
  }

  private req(actor: string, requestId: string): ReqRecord {
    const r = this.requests.get(requestId);
    if (!r) this.err('LW_NOT_FOUND');
    if (r.actor !== actor) this.err('LW_NOT_ALLOWED');
    return r;
  }

  transcriptStart(actor: string, ownerId: string, month: string): TranscriptRequest {
    const p = this.connected(actor, ownerId);
    if (!/^\d{4}-\d{2}$/.test(month) || !MONTH_DATA[month]) this.err('LW_BAD_MONTH');
    if (!p.ownerPhone) this.err('LW_NO_PHONE_ON_FILE');
    const requestId = `req_${++this.seq}_${this.now().toString(36)}`;
    const otpKey = `tr|${requestId}`;
    const sent = this.sendOtp(otpKey, p.ownerPhone);
    const r: ReqRecord = {
      requestId, ownerId, month, state: 'otp_pending', priceKes: this.quotaFor(ownerId).nextPriceKes,
      sentTo: sent.sentTo, expiresInSec: sent.expiresInSec, resendInSec: sent.resendInSec,
      createdAt: new Date(this.now()).toISOString(), actor, otpKey,
    };
    this.requests.set(requestId, r);
    return this.strip(r);
  }

  transcriptResendOtp(actor: string, requestId: string): OtpSent {
    const r = this.req(actor, requestId);
    if (r.state !== 'otp_pending') this.err('LW_NOT_ALLOWED');
    return this.sendOtp(r.otpKey, this.properties.get(r.ownerId)!.ownerPhone!);
  }

  private makeReady(r: ReqRecord, free: boolean): void {
    r.state = 'ready';
    r.url = PDF_URL;
    r.expiresAt = new Date(this.now() + READY_TTL_MS).toISOString();
    r.message = undefined;
    if (free) {
      const k = `${r.ownerId}|${nairobiMonth(this.now())}`;
      this.quotaUsed.set(k, (this.quotaUsed.get(k) ?? 0) + 1); // consumed only when a PDF is produced
    }
  }

  transcriptVerifyOtp(actor: string, requestId: string, code: string): TranscriptRequest {
    const r = this.req(actor, requestId);
    if (r.state !== 'otp_pending') this.err('LW_NOT_ALLOWED');
    this.checkOtp(r.otpKey, code);
    const q = this.quotaFor(r.ownerId);
    if (q.nextPriceKes === 0) {
      r.priceKes = 0;
      this.makeReady(r, true);
    } else {
      r.priceKes = q.nextPriceKes;
      r.state = 'payment_required';
    }
    r.sentTo = undefined;
    return this.strip(r);
  }

  transcriptPay(actor: string, requestId: string, phone: string): TranscriptRequest {
    const r = this.req(actor, requestId);
    if (r.state !== 'payment_required' && r.state !== 'failed') this.err('LW_NOT_ALLOWED');
    if (!/^\+254[17]\d{8}$/.test(phone)) this.err('LW_PAYMENT_FAILED');
    r.state = 'payment_pending';
    r.payStartedAt = this.now();
    r.payPhone = phone;
    r.reference = `MOCK${r.requestId.slice(-6).toUpperCase()}`;
    r.error = undefined;
    r.message = 'Check your phone for the M-Pesa prompt';
    return this.strip(r);
  }

  transcriptStatus(actor: string, requestId: string): TranscriptRequest {
    const r = this.req(actor, requestId);
    const now = this.now();
    if (r.state === 'payment_pending' && r.payStartedAt !== undefined && now - r.payStartedAt >= this.payDelayMs) {
      if (r.payPhone === '+254700000000') {
        r.state = 'failed';
        r.error = { code: 'LW_PAYMENT_FAILED', message: 'Payment was cancelled' };
      } else {
        r.state = 'paid';
        r.generatingSince = now;
      }
    } else if (r.state === 'paid') {
      r.state = 'generating';
      r.generatingSince = r.generatingSince ?? now;
    } else if (r.state === 'generating' && now - (r.generatingSince ?? now) >= this.generateDelayMs) {
      this.makeReady(r, false);
    } else if (r.state === 'ready') {
      if (r.expiresAt && Date.parse(r.expiresAt) <= now) {
        r.state = 'expired';
        r.url = undefined;
      } else {
        r.url = PDF_URL; // a fresh signed URL on every status call
      }
    }
    return this.strip(r);
  }

  transcriptList(actor: string, ownerId: string): { items: TranscriptRequest[] } {
    this.connected(actor, ownerId);
    const items = [...this.requests.values()]
      .filter((r) => r.actor === actor && r.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12)
      .map((r) => {
        const pub = this.strip(r);
        delete pub.url; // list entries never carry a URL; ask for status to get a fresh one
        if (pub.state === 'ready' && pub.expiresAt && Date.parse(pub.expiresAt) <= this.now()) pub.state = 'expired';
        return pub;
      });
    return { items };
  }

  // ── compliance reports (same rules as the server: one free per property per month, KES 200 after, nothing before checkout) ──

  private readonly reports = new Map<string, ReqRecord>();
  private readonly reportUsed = new Map<string, number>();
  private reportKey(ownerId: string): string { return `${ownerId}|${nairobiMonth(this.now())}`; }
  private reportPrice(ownerId: string): number { return (this.reportUsed.get(this.reportKey(ownerId)) ?? 0) < 1 ? 0 : 200; }
  private reportReq(actor: string, id: string): ReqRecord {
    const r = this.reports.get(id);
    if (!r || r.actor !== actor) this.err('LW_NOT_FOUND');
    return r;
  }

  /** Reports carry tenant names and amounts: like the server, they need the owner's details to be unlocked. */
  private reportAccess(actor: string, ownerId: string): MockProperty {
    const p = this.connected(actor, ownerId);
    if (this.unlockUntil(actor, p) === null) this.err('LW_LOCKED');
    return p;
  }

  reportQuote(actor: string, ownerId: string): ReportQuote {
    this.reportAccess(actor, ownerId);
    const used = this.reportUsed.get(this.reportKey(ownerId)) ?? 0;
    return { period: nairobiMonth(this.now()), freeIncluded: true, freeUsedThisMonth: used, priceKes: this.reportPrice(ownerId), listPriceKes: 200 };
  }

  reportOrder(actor: string, ownerId: string, month: string, kind: ReportKind): TranscriptRequest {
    this.reportAccess(actor, ownerId);
    if (!/^\d{4}-\d{2}$/.test(month) || !MONTH_DATA[month]) this.err('LW_BAD_MONTH');
    if (kind !== 'mri_monthly' && kind !== 'annual_summary') this.err('LW_BAD_MONTH');
    const requestId = `rp_${++this.seq}_${this.now().toString(36)}`;
    const r: ReqRecord = {
      requestId, ownerId, month, kind, title: kind === 'annual_summary' ? 'Annual rental income summary' : 'MRI working paper',
      state: 'payment_required', priceKes: this.reportPrice(ownerId), createdAt: new Date(this.now()).toISOString(), actor, otpKey: '',
    };
    this.reports.set(requestId, r);
    return this.strip(r);
  }

  reportCheckout(actor: string, requestId: string, phone?: string): TranscriptRequest {
    const r = this.reportReq(actor, requestId);
    if (r.state !== 'payment_required' && r.state !== 'failed') return this.strip(r);
    const price = this.reportPrice(r.ownerId);
    if (!phone) {
      if (price > 0) {                                   // the free report was used meanwhile: say so, charge nothing
        r.priceKes = price;
        return this.strip(r);
      }
      const k = this.reportKey(r.ownerId);
      this.reportUsed.set(k, (this.reportUsed.get(k) ?? 0) + 1);
      r.priceKes = 0; r.state = 'paid'; r.generatingSince = this.now();
      return this.strip(r);
    }
    if (!/^\+254[17]\d{8}$/.test(phone)) this.err('LW_PAYMENT_FAILED');
    r.priceKes = 200; r.state = 'payment_pending'; r.payStartedAt = this.now(); r.payPhone = phone; r.error = undefined;
    r.message = 'Check your phone for the M-Pesa prompt';
    return this.strip(r);
  }

  reportStatus(actor: string, requestId: string): TranscriptRequest {
    const r = this.reportReq(actor, requestId);
    const now = this.now();
    if (r.state === 'payment_pending' && r.payStartedAt !== undefined && now - r.payStartedAt >= this.payDelayMs) {
      if (r.payPhone === '+254700000000') { r.state = 'failed'; r.error = { code: 'LW_PAYMENT_FAILED', message: 'Payment was cancelled' }; }
      else { r.state = 'paid'; r.generatingSince = now; }
    } else if (r.state === 'paid') {
      r.state = 'generating'; r.generatingSince = r.generatingSince ?? now;
    } else if (r.state === 'generating' && now - (r.generatingSince ?? now) >= this.generateDelayMs) {
      r.state = 'ready'; r.url = PDF_URL; r.expiresAt = new Date(now + READY_TTL_MS).toISOString(); r.fileName = `mri-working-paper-${r.month}-${r.requestId.slice(-6)}.pdf`; r.message = undefined;
    } else if (r.state === 'ready') {
      if (r.expiresAt && Date.parse(r.expiresAt) <= now) { r.state = 'expired'; r.url = undefined; } else r.url = PDF_URL;
    }
    return this.strip(r);
  }

  reportList(actor: string, ownerId: string): { items: TranscriptRequest[] } {
    this.reportAccess(actor, ownerId);
    const items = [...this.reports.values()].filter((r) => r.actor === actor && r.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => { const o = this.strip(r); delete o.url; return o; });
    return { items };
  }
}

/** The actor-bound view of the mock backend (implements the same interface as the real client). */
export class MockLwApi implements LwApi {
  constructor(private readonly b: MockBackend, private readonly actor: string) {}

  private async run<T>(fn: () => T): Promise<T> {
    return fn();
  }
  lookupProperty(ownerId: string) { return this.run(() => this.b.lookupProperty(this.actor, ownerId)); }
  connect(ownerId: string) { return this.run(() => this.b.connect(this.actor, ownerId)); }
  disconnect(ownerId: string) { return this.run(() => this.b.disconnect(this.actor, ownerId)); }
  listConnections() { return this.run(() => this.b.listConnections(this.actor)); }
  unlockSendOtp(ownerId: string, _lang: Lang) { return this.run(() => this.b.unlockSendOtp(this.actor, ownerId)); }
  unlockVerifyOtp(ownerId: string, code: string) { return this.run(() => this.b.unlockVerifyOtp(this.actor, ownerId, code)); }
  getSnapshot(ownerId: string, month: string | undefined, _lang: Lang) { return this.run(() => this.b.getSnapshot(this.actor, ownerId, month)); }
  transcriptQuota(ownerId: string) { return this.run(() => this.b.transcriptQuota(this.actor, ownerId)); }
  transcriptStart(ownerId: string, month: string, _lang: Lang) { return this.run(() => this.b.transcriptStart(this.actor, ownerId, month)); }
  transcriptResendOtp(requestId: string) { return this.run(() => this.b.transcriptResendOtp(this.actor, requestId)); }
  transcriptVerifyOtp(requestId: string, code: string) { return this.run(() => this.b.transcriptVerifyOtp(this.actor, requestId, code)); }
  transcriptPay(requestId: string, phone: string) { return this.run(() => this.b.transcriptPay(this.actor, requestId, phone)); }
  transcriptStatus(requestId: string) { return this.run(() => this.b.transcriptStatus(this.actor, requestId)); }
  transcriptList(ownerId: string) { return this.run(() => this.b.transcriptList(this.actor, ownerId)); }
  reportQuote(ownerId: string) { return this.run(() => this.b.reportQuote(this.actor, ownerId)); }
  reportOrder(ownerId: string, month: string, kind: ReportKind) { return this.run(() => this.b.reportOrder(this.actor, ownerId, month, kind)); }
  reportCheckout(requestId: string, phone?: string) { return this.run(() => this.b.reportCheckout(this.actor, requestId, phone)); }
  reportStatus(requestId: string) { return this.run(() => this.b.reportStatus(this.actor, requestId)); }
  reportList(ownerId: string) { return this.run(() => this.b.reportList(this.actor, ownerId)); }
}

let shared: MockBackend | null = null;

/** Process-wide mock backend used when LW_MOCK=1. */
export function getSharedMockApi(actorPhone: string): LwApi {
  if (!shared) {
    shared = new MockBackend({
      ownerPhone: (process.env.LW_MOCK_OWNER_PHONE || '').trim() || undefined,
      forceLevel: (process.env.LW_MOCK_LEVEL as MaskLevel | undefined) || undefined,
    });
  }
  return new MockLwApi(shared, actorPhone);
}
