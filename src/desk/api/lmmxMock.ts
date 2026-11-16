/**
 * Offline fixtures for every LMMX callable the desk UI uses (VITE_LMMX_MOCK=true). Pure TypeScript, no Firebase, no import.meta,
 * so it also runs under `node --test`. Money and masks come from the contract helpers, never re-implemented.
 *
 * Magic inputs (so every screen can be shown without CORE):
 *  - setup code is always 4683 (LMM4683); a wrong code costs an attempt, 5 wrong tries lock it.
 *  - a new tenant becomes active by itself after `autoActivateAfterPolls` setupStatus polls (default 8, about 40 s): "the tenant tapped the link".
 *  - ID number ending 000: setup is locked.  ending 111: the code has already expired.  ID 00000001: LMMX_E_DESK_NOT_READY.
 *  - landlord account name containing "mismatch": needs review (COG-0000 must approve).  account 999999: LMMX_E_RECIPIENT_BLOCKED.
 *  - recipient check: account ending 0001 = reusable (token), ending 0002 = exists but not reusable, anything else = new.
 *  - any code on demand: `globalThis.__lmmxMock.failNext("LMMX_E_RATE")` (optionally `, "lmmx_desk_listTenants"`).
 *  - top-desk mutations throw LMMX_E_NEEDS_REAUTH until `__lmmxMock.reauthDone()` is called (the screen's re-login does this in demo mode).
 */
import {
  LMMX, cycleProjection, earningsTable, eatDate, nextDueDate, daysUntil, maskId, maskName, maskPhone, normalizeKePhone, parseLmmxCode,
} from "./lmmxContract.ts";
import type {
  AuditAction, AuditRow, Channel, DeskGetTenantOut, DeskTenantRow, Frequency, InstalmentView, LeadRow, LeadStage, LmmxCallableMap,
  LmmxCallableName, LmmxErrorCode, PendingChangeView, PipelineRow, TenantStatus, TopLeadGetOut, TopReviewRow,
} from "./lmmxContract.ts";
import { LMMX_ERROR_MESSAGES, LmmxApiError } from "./lmmxErrors.ts";

export const MOCK_CODE = "4683";
export const MOCK_DESK = "COG-0007";
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

export const mockControl = {
  latencyMs: 150,
  autoActivateAfterPolls: 8,
  asTop: false,
  reauthNeeded: true,
  breakChainAt: 0 as number,
  forced: [] as { code: LmmxErrorCode; op?: string }[],
  failNext(code: LmmxErrorCode, op?: string) { this.forced.push({ code, ...(op ? { op } : {}) }); },
  reauthDone() { this.reauthNeeded = false; },
  reset() { seed(); this.forced = []; this.asTop = false; this.reauthNeeded = true; this.breakChainAt = 0; this.latencyMs = 150; this.autoActivateAfterPolls = 8; },
};
(globalThis as unknown as { __lmmxMock?: typeof mockControl }).__lmmxMock = mockControl;

interface MockTenant {
  full: string; phone: string; idNumber: string; view: DeskGetTenantOut; otpExpiresAt: number; attemptsLeft: number; resendsLeft: number; wrongTotal: number;
  locked: boolean; polls: number; needsReview: boolean;
}
let tenants = new Map<string, MockTenant>();
let reviewItems: TopReviewRow[] = [];
let leads: (TopLeadGetOut)[] = [];
let audit: AuditRow[] = [];
let changeToTenant = new Map<string, string>();
let seq = 1;
const newId = (p: string) => `${p}_${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const todayIso = () => eatDate(Date.now());

function viewFor(id: string, o: { full: string; phone: string; idNumber: string; status: TenantStatus; rentMinor: number; dueDay: number; frequency?: Frequency; channel?: Channel; account?: string; desk?: string; unit?: string; property?: string }): DeskGetTenantOut {
  const channel = o.channel ?? "till", frequency = o.frequency ?? "weekly";
  const credit = Math.max(LMMX.MIN_CREDIT_MINOR, Math.round(o.rentMinor / 4 / 100) * 100);
  const p = cycleProjection(o.rentMinor, channel, credit);
  const active = o.status === "active";
  const due = nextDueDate(todayIso(), o.dueDay);
  const credited = active ? Math.round((o.rentMinor * 0.45) / 100) * 100 : 0;
  return {
    tenantId: id, status: o.status, deskCode: o.desk ?? MOCK_DESK, nameMasked: maskName(o.full), phoneMasked: maskPhone(o.phone), idMasked: maskId(o.idNumber),
    ...(o.unit ? { unitNumber: o.unit } : {}), ...(o.property ? { propertyName: o.property } : {}),
    rentMinor: o.rentMinor, dueDay: o.dueDay, frequency,
    recipient: { channel, accountNumber: o.account ?? "5123456", resolvedNameMasked: "Njoroge P.", nameMatch: "matched", status: "verified" },
    ...(active ? { cycle: { cycleId: `cy_${id}`, status: "open" as const, dueDate: due, payByDate: due, rentMinor: o.rentMinor, creditedMinor: credited, remainingMinor: o.rentMinor - credited, settledMinor: 0, pct: Math.round((credited * 100) / o.rentMinor) } } : {}),
    recent: active ? recentFor(o.rentMinor, channel) : [],
    earningsTable: earningsTable(o.rentMinor, channel),
    projection: { frequency, instalments: p.instalments, tenantPaysMinor: p.tenantPaysMinor, deskMinor: p.deskMinor, deskBonusMinor: p.deskBonusMinor },
    frozen: o.status === "frozen", createdAt: Date.now() - 9 * DAY,
  };
}
function recentFor(rent: number, channel: Channel): InstalmentView[] {
  const credit = Math.max(LMMX.MIN_CREDIT_MINOR, Math.round(rent / 8 / 100) * 100);
  void channel;
  return [1, 2, 3].map((i) => {
    const charge = Math.ceil((credit * 1.05) / 100) * 100;
    return { paymentId: `pay_${i}`, at: Date.now() - i * 2 * DAY, creditMinor: credit, chargeMinor: charge, feesMinor: charge - credit, deskShareMinor: Math.floor(credit * 0.04 * 0.6), status: "success" as const };
  });
}
function addTenant(id: string, full: string, phone: string, idNumber: string, status: TenantStatus, rentMinor: number, dueDay: number, extra: Partial<Parameters<typeof viewFor>[1]> = {}, locked = false) {
  tenants.set(id, {
    full, phone, idNumber, otpExpiresAt: Date.now() + 25 * MIN, attemptsLeft: LMMX.OTP_MAX_ATTEMPTS, resendsLeft: LMMX.OTP_RESEND_MAX_PER_HOUR, wrongTotal: 0, locked, polls: 0, needsReview: status === "draft",
    view: viewFor(id, { full, phone, idNumber, status, rentMinor, dueDay, ...extra }),
  });
}
const rowOf = (t: MockTenant): DeskTenantRow => ({
  tenantId: t.view.tenantId, nameMasked: t.view.nameMasked, phoneMasked: t.view.phoneMasked, status: t.view.status, rentMinor: t.view.rentMinor, dueDay: t.view.dueDay, deskCode: t.view.deskCode,
  creditedMinor: t.view.cycle?.creditedMinor ?? 0, remainingMinor: t.view.cycle?.remainingMinor ?? t.view.rentMinor, createdAt: t.view.createdAt,
  ...(t.view.status === "awaiting_confirmation" ? { awaitingSince: t.view.createdAt } : {}),
});

function pushAudit(action: AuditAction, summary: string, tenantId?: string, deskCode?: string, type: AuditRow["actor"]["type"] = "desk") {
  const n = audit.length + 1;
  audit.push({ seq: n, ts: Date.now() - (200 - n) * 20 * MIN, action, actor: { type, ...(deskCode ? { deskCode } : {}) }, ...(tenantId ? { tenantId } : {}), summary, hash: (0x1000 + n * 7919).toString(16).padStart(8, "0") + "cafe" });
}
function seed() {
  seq = 1; tenants = new Map(); changeToTenant = new Map(); audit = [];
  addTenant("t_active1", "Mary Wanjiku Kamau", "+254712345678", "23456789", "active", 1_200_000, 5, { unit: "B4", property: "Kileleshwa Heights" });
  addTenant("t_active2", "John Otieno Odhiambo", "+254722111222", "30112233", "active", 800_000, 10, { desk: "COG-0012", channel: "phone", account: "+254733445566", frequency: "daily" });
  addTenant("t_wait1", "Grace Akinyi Ouma", "+254701998877", "28877665", "awaiting_confirmation", 650_000, 5, { channel: "bank", account: "0123456789" });
  addTenant("t_frozen", "Peter Mwangi Njuguna", "+254745000111", "27001122", "frozen", 1_500_000, 1);
  addTenant("t_paused", "Fatuma Hassan Ali", "+254799123456", "26554433", "paused", 500_000, 15);
  addTenant("t_review", "Samuel Kiptoo Rotich", "+254712000999", "29001234", "draft", 900_000, 5, { channel: "phone", account: "+254711222333" });
  addTenant("t_closed", "Lucy Wambui Gitau", "+254733777888", "22334455", "closed", 700_000, 20, { desk: "COG-0012" });
  const pc: PendingChangeView = { changeId: "chg_seed", kind: "recipient", status: "cooling_off", summary: "New landlord payment account (TILL ...456)", coolingOffUntil: Date.now() + 30 * HOUR, applyAfter: Date.now() + 30 * HOUR, initiatedBy: "desk" };
  tenants.get("t_active1")!.view.pendingChange = pc; changeToTenant.set("chg_seed", "t_active1");
  reviewItems = [
    { recipientId: "rcp_1", channel: "till", accountNumber: "5009876", reason: "name_mismatch", tenants: 1, desks: 1, createdAt: Date.now() - 3 * HOUR },
    { recipientId: "rcp_2", channel: "phone", accountNumber: "+254711222333", reason: "shared_recipient", tenants: 4, desks: 2, createdAt: Date.now() - 20 * HOUR },
  ];
  const stages: LeadStage[] = ["new", "to_contact", "contacted", "interested", "follow_up", "not_interested", "closed_won", "closed_lost", "new"];
  leads = stages.map((stage, i) => ({
    leadId: `lead_${i + 1}`, landlordLabel: `Landlord #${i + 1} (${["Kileleshwa", "Rongai", "Naivasha", "Kasarani", "Thika"][i % 5]})`, tenants: 1 + (i % 4), monthlyRentMinor: (800_000 + i * 150_000), deskCodes: i % 2 ? [MOCK_DESK, "COG-0012"] : [MOCK_DESK],
    stage, onPms: stage === "closed_won", updatedAt: Date.now() - i * DAY, ...(stage === "follow_up" ? { nextFollowUpAt: Date.now() + 2 * DAY } : {}),
    contactName: ["Mr Njoroge", "Mrs Wairimu", "Mr Kamau", "Ms Achieng"][i % 4], contactPhone: `+25471200${String(1000 + i * 37).slice(-4)}`,
    notes: i % 3 === 0 ? [{ ts: Date.now() - DAY, by: "COG-0000", text: "Called, will call back Friday." }] : [],
  }));
  const acts: AuditAction[] = ["tenant_created", "setup_otp_sent", "setup_confirmed", "payment_credited", "settlement_paid", "change_requested", "freeze", "reveal", "lead_updated"];
  for (let i = 0; i < 60; i++) pushAudit(acts[i % acts.length], `Example event ${i + 1}`, i % 2 ? "t_active1" : "t_active2", i % 3 ? MOCK_DESK : "COG-0012", i % 9 === 6 || i % 9 === 7 ? "top" : "desk");
}
seed();

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function fail(code: LmmxErrorCode): never { throw new LmmxApiError("functions/failed-precondition", LMMX_ERROR_MESSAGES[code], code); }
const need = (id: string): MockTenant => tenants.get(id) ?? fail("LMMX_E_NOT_FOUND");
const reason = (r: string) => { if (typeof r !== "string" || r.trim().length < 10) fail("LMMX_E_VALIDATION"); };
const topMutation = () => { if (mockControl.reauthNeeded) fail("LMMX_E_NEEDS_REAUTH"); };
const normCode = (s: string): string | null => { const p = parseLmmxCode(s); if (p && p.kind === "otp") return p.code; return /^\s*(\d{4})\s*$/.exec(s)?.[1] ?? null; };

function checkOtp(t: MockTenant, otp: string): void {
  if (t.locked || t.attemptsLeft <= 0) fail("LMMX_E_OTP_LOCKED");
  if (Date.now() > t.otpExpiresAt) fail("LMMX_E_OTP_EXPIRED");
  if (normCode(otp) !== MOCK_CODE) {
    t.attemptsLeft -= 1; t.wrongTotal += 1;
    if (t.attemptsLeft <= 0) { t.locked = true; fail("LMMX_E_OTP_LOCKED"); }
    fail("LMMX_E_OTP_INVALID");
  }
}
const MAP_PAGE = 5;
function page<T>(all: T[], cursor: string | undefined, limit = MAP_PAGE): { items: T[]; next?: string } {
  const start = cursor ? Number(cursor) || 0 : 0;
  const items = all.slice(start, start + limit);
  return { items, ...(start + limit < all.length ? { next: String(start + limit) } : {}) };
}
const matches = (t: MockTenant, q: string) => { const s = q.trim().toLowerCase(); return !s || t.full.toLowerCase().includes(s) || t.phone.includes(s.replace(/\D/g, "") || "~") || t.idNumber.includes(s) || t.view.tenantId.toLowerCase().includes(s); };

type Handler<K extends LmmxCallableName> = (i: LmmxCallableMap[K]["in"]) => LmmxCallableMap[K]["out"];
const H: { [K in LmmxCallableName]?: Handler<K> } = {
  lmmx_desk_checkRecipient: (i) => {
    const a = i.accountNumber.replace(/\s+/g, "");
    if (a.endsWith("0001")) return { exists: true, accountNumber: a, nameMatchesEntered: true, reusable: true, reuseToken: "reuse_demo_token" };
    if (a.endsWith("0002")) return { exists: true, accountNumber: a, nameMatchesEntered: false, reusable: false };
    return { exists: false, accountNumber: a, nameMatchesEntered: false, reusable: false };
  },
  lmmx_desk_createTenant: (i) => {
    if (i.profile.idNumber === "00000001") fail("LMMX_E_DESK_NOT_READY");
    if (i.recipient.accountNumber.replace(/\s/g, "") === "999999") fail("LMMX_E_RECIPIENT_BLOCKED");
    const existing = [...tenants.values()].find((t) => t.view.tenantId === `t_${i.idempotencyKey.slice(0, 12)}`);
    if (existing) return { tenantId: existing.view.tenantId, status: existing.needsReview ? "draft" : "awaiting_confirmation", nameMatch: "matched", needsReview: existing.needsReview, expiresAt: existing.otpExpiresAt, resolvedNameMasked: "Njoroge P." };
    const phone = normalizeKePhone(i.profile.phone) ?? fail("LMMX_E_VALIDATION");
    for (const t of tenants.values()) if ((t.phone === phone || t.idNumber === i.profile.idNumber) && !["closed", "migrated"].includes(t.view.status)) fail("LMMX_E_DUPLICATE");
    const id = `t_${i.idempotencyKey.slice(0, 12)}`;
    const review = /mismatch/i.test(i.recipient.accountName);
    addTenant(id, i.profile.fullName, phone, i.profile.idNumber, review ? "draft" : "awaiting_confirmation", i.rentMinor, i.dueDay ?? LMMX.DUE_DAY_DEFAULT,
      { channel: i.recipient.channel, account: i.recipient.accountNumber, ...(i.frequency ? { frequency: i.frequency } : {}), ...(i.profile.unitNumber ? { unit: i.profile.unitNumber } : {}), ...(i.profile.propertyName ? { property: i.profile.propertyName } : {}) },
      i.profile.idNumber.endsWith("000"));
    const t = need(id);
    if (i.profile.idNumber.endsWith("111")) t.otpExpiresAt = Date.now() - MIN;
    else t.otpExpiresAt = Date.now() + LMMX.OTP_TTL_MS;
    if (review) t.view.recipient = { ...t.view.recipient, nameMatch: "mismatch", status: "needs_review" };
    pushAudit("tenant_created", "Tenant created", id, MOCK_DESK);
    return { tenantId: id, status: review ? "draft" : "awaiting_confirmation", nameMatch: review ? "mismatch" : "matched", needsReview: review, expiresAt: t.otpExpiresAt, resolvedNameMasked: "Njoroge P." };
  },
  lmmx_desk_setupStatus: (i) => {
    const t = need(i.tenantId);
    if (t.view.status === "awaiting_confirmation") {
      t.polls += 1;
      if (!t.locked && Date.now() <= t.otpExpiresAt && t.polls >= mockControl.autoActivateAfterPolls) t.view = { ...t.view, status: "active" };
    }
    const waiting = t.view.status === "awaiting_confirmation";
    return {
      tenantId: i.tenantId, status: t.view.status, ...(waiting ? { otpExpiresAt: t.otpExpiresAt, attemptsLeft: t.attemptsLeft, locked: t.locked || t.attemptsLeft <= 0, resendsLeft: t.resendsLeft } : {}),
      ...(t.needsReview ? { needsReview: true } : {}),
    };
  },
  lmmx_desk_confirmSetup: (i) => {
    const t = need(i.tenantId);
    if (t.view.status !== "awaiting_confirmation") fail("LMMX_E_STATE");
    checkOtp(t, i.otp);
    t.view = { ...viewFor(t.view.tenantId, { full: t.full, phone: t.phone, idNumber: t.idNumber, status: "active", rentMinor: t.view.rentMinor, dueDay: t.view.dueDay, frequency: t.view.frequency, channel: t.view.recipient.channel, account: t.view.recipient.accountNumber }) };
    pushAudit("setup_confirmed", "Setup confirmed by desk", t.view.tenantId, MOCK_DESK);
    return { tenantId: i.tenantId, status: "active" };
  },
  lmmx_desk_resendOtp: (i) => {
    const t = need(i.tenantId);
    if (t.resendsLeft <= 0) fail("LMMX_E_RATE");
    if (t.locked) fail("LMMX_E_OTP_LOCKED");
    t.resendsLeft -= 1; t.otpExpiresAt = Date.now() + LMMX.OTP_TTL_MS; t.attemptsLeft = LMMX.OTP_MAX_ATTEMPTS;
    return { otpExpiresAt: t.otpExpiresAt, resendsLeft: t.resendsLeft };
  },
  lmmx_desk_listTenants: (i) => {
    const all = [...tenants.values()].filter((t) => (mockControl.asTop || t.view.deskCode === MOCK_DESK) && (!i.status || t.view.status === i.status) && matches(t, i.q ?? ""));
    const p = page(all.map(rowOf), i.cursor, i.limit ?? MAP_PAGE);
    return { tenants: p.items, ...(p.next ? { nextCursor: p.next } : {}) };
  },
  lmmx_desk_getTenant: (i) => {
    const t = need(i.tenantId);
    if (!mockControl.asTop && t.view.deskCode !== MOCK_DESK) fail("LMMX_E_FORBIDDEN");
    return t.view;
  },
  lmmx_desk_requestChange: (i) => {
    const t = need(i.tenantId);
    if (t.view.status !== "active") fail("LMMX_E_STATE");
    if (t.view.pendingChange && ["awaiting_tenant_otp", "cooling_off", "deferred"].includes(t.view.pendingChange.status)) fail("LMMX_E_STATE");
    if (i.kind === "rent" && (!i.rentMinor || i.rentMinor < LMMX.RENT_MIN_MINOR || i.rentMinor > LMMX.RENT_MAX_MINOR)) fail("LMMX_E_AMOUNT");
    if (i.kind === "recipient" && !i.recipient) fail("LMMX_E_VALIDATION");
    const changeId = newId("chg"); changeToTenant.set(changeId, t.view.tenantId);
    t.otpExpiresAt = Date.now() + LMMX.OTP_TTL_MS; t.attemptsLeft = LMMX.OTP_MAX_ATTEMPTS; t.locked = false;
    t.view = { ...t.view, pendingChange: { changeId, kind: i.kind, status: "awaiting_tenant_otp", summary: i.kind === "rent" ? `New rent ${(i.rentMinor ?? 0) / 100}` : "New landlord payment account", initiatedBy: "desk" } };
    pushAudit("change_requested", `Change requested (${i.kind})`, t.view.tenantId, MOCK_DESK);
    return { changeId, status: "awaiting_tenant_otp", requiresTenantOtp: true, otpExpiresAt: t.otpExpiresAt };
  },
  lmmx_desk_confirmChange: (i) => {
    const tid = changeToTenant.get(i.changeId) ?? fail("LMMX_E_NOT_FOUND");
    const t = need(tid); const pc = t.view.pendingChange;
    if (!pc || pc.changeId !== i.changeId || pc.status !== "awaiting_tenant_otp") fail("LMMX_E_STATE");
    checkOtp(t, i.otp);
    const due = nextDueDate(todayIso(), t.view.dueDay);
    const near = daysUntil(due, todayIso()) <= LMMX.CHANGE_DEFER_DAYS_BEFORE_DUE;
    if (pc.kind === "recipient") {
      const applyAfter = Date.now() + LMMX.CHANGE_COOLING_OFF_MS;
      t.view.pendingChange = { ...pc, status: near ? "deferred" : "cooling_off", coolingOffUntil: applyAfter, applyAfter };
      return { changeId: i.changeId, status: near ? "deferred" : "cooling_off", applyAfter };
    }
    t.view.pendingChange = { ...pc, status: near ? "deferred" : "applied" };
    return { changeId: i.changeId, status: near ? "deferred" : "applied" };
  },
  lmmx_desk_cancelChange: (i) => {
    const tid = changeToTenant.get(i.changeId) ?? fail("LMMX_E_NOT_FOUND");
    const t = need(tid);
    if (!t.view.pendingChange) fail("LMMX_E_STATE");
    t.view.pendingChange = { ...t.view.pendingChange, status: "cancelled" };
    return { ok: true };
  },
  lmmx_desk_earnings: () => ({
    instalments: 42, deskShareMinor: 128_400, completionBonusMinor: 5_000, landlordBonusMinor: 30_000,
    byTenant: [...tenants.values()].filter((t) => t.view.deskCode === MOCK_DESK && t.view.status === "active").map((t, k) => ({ tenantId: t.view.tenantId, nameMasked: t.view.nameMasked, deskShareMinor: 64_200 - k * 20_000 })),
  }),
  lmmx_desk_preview: (i) => {
    const mk = (credit: number) => cycleProjection(i.rentMinor, i.channel, credit);
    const c = (f: number) => Math.max(LMMX.MIN_CREDIT_MINOR, Math.round(i.rentMinor / f / 100) * 100);
    const row = (credit: number) => { const p = mk(credit); return { instalments: p.instalments, tenantPaysMinor: p.tenantPaysMinor, deskMinor: p.deskMinor, deskBonusMinor: p.deskBonusMinor }; };
    return { table: earningsTable(i.rentMinor, i.channel), projection: { daily: row(c(30)), weekly: row(c(4)), biweekly: row(c(2)) } };
  },
  lmmx_desk_pipeline: (i) => {
    const rows: PipelineRow[] = [
      { leadIdMasked: "ld_***a1", landlordLabel: "Mr N. (Kileleshwa)", tenants: 2, monthlyRentMinor: 2_000_000, stage: "contacted", onPms: false, conversionNote: "When this landlord joins Plot Yangu and subscribes, your desk is paid a bonus." },
      { leadIdMasked: "ld_***b7", landlordLabel: "Mrs W. (Rongai)", tenants: 1, monthlyRentMinor: 800_000, stage: "closed_won", onPms: true, conversionNote: "Joined Plot Yangu. Your tenant moves to the landlord's invoices from the next cycle." },
      { leadIdMasked: "ld_***c3", landlordLabel: "Mr K. (Thika)", tenants: 1, monthlyRentMinor: 650_000, stage: "new", onPms: false, conversionNote: "Not contacted yet." },
    ];
    const p = page(rows, i.cursor, 2);
    return { landlords: p.items, ...(p.next ? { nextCursor: p.next } : {}) };
  },
  lmmx_top_reviewQueue: () => ({ items: [...reviewItems] }),
  lmmx_top_reviewDecision: (i) => { topMutation(); reason(i.reason); if (!reviewItems.some((r) => r.recipientId === i.recipientId)) fail("LMMX_E_NOT_FOUND"); reviewItems = reviewItems.filter((r) => r.recipientId !== i.recipientId); pushAudit("recipient_review_decided", `Review ${i.decision}`, undefined, "COG-0000", "top"); return { ok: true }; },
  lmmx_top_freeze: (i) => { topMutation(); reason(i.reason); if (i.scope === "tenant") { const t = need(i.id); t.view = { ...t.view, status: "frozen", frozen: true }; } pushAudit("freeze", `Freeze ${i.scope}`, i.scope === "tenant" ? i.id : undefined, "COG-0000", "top"); return { ok: true }; },
  lmmx_top_unfreeze: (i) => { topMutation(); reason(i.reason); if (i.scope === "tenant") { const t = need(i.id); t.view = { ...t.view, status: "active", frozen: false }; } pushAudit("unfreeze", `Unfreeze ${i.scope}`, i.scope === "tenant" ? i.id : undefined, "COG-0000", "top"); return { ok: true }; },
  lmmx_top_reassign: (i) => { topMutation(); reason(i.reason); const t = need(i.tenantId); if (!/^COG-\d{4}$/.test(i.toDeskCode)) fail("LMMX_E_VALIDATION"); t.view = { ...t.view, deskCode: i.toDeskCode }; pushAudit("reassign", `Moved to ${i.toDeskCode}`, i.tenantId, "COG-0000", "top"); return { ok: true }; },
  lmmx_top_reveal: (i) => {
    topMutation(); reason(i.reason); const t = need(i.tenantId);
    const values: Partial<Record<"phone" | "id" | "landlordContact" | "landlordName", string>> = {};
    for (const f of i.fields) values[f] = f === "phone" ? t.phone : f === "id" ? t.idNumber : f === "landlordContact" ? "+254712009876" : "Peter Njoroge Kariuki";
    pushAudit("reveal", `Revealed ${i.fields.join(", ")}`, i.tenantId, "COG-0000", "top");
    return { values };
  },
  lmmx_top_updateTenant: (i) => {
    topMutation(); reason(i.reason); const t = need(i.tenantId);
    if (i.rentMinor !== undefined && (i.rentMinor < LMMX.RENT_MIN_MINOR || i.rentMinor > LMMX.RENT_MAX_MINOR)) fail("LMMX_E_AMOUNT");
    t.view = { ...t.view, ...(i.rentMinor ? { rentMinor: i.rentMinor } : {}), ...(i.dueDay ? { dueDay: i.dueDay } : {}), ...(i.recipient ? { recipient: { ...t.view.recipient, channel: i.recipient.channel, accountNumber: i.recipient.accountNumber } } : {}) };
    pushAudit("top_update", "Updated by top desk", i.tenantId, "COG-0000", "top");
    return { ok: true };
  },
  lmmx_top_auditList: (i) => {
    const rows = audit.filter((r) => (!i.tenantId || r.tenantId === i.tenantId) && (!i.action || r.action === i.action) && (!i.deskCode || r.actor.deskCode === i.deskCode) && (!i.from || r.ts >= i.from) && (!i.to || r.ts <= i.to))
      .sort((a, b) => b.seq - a.seq).filter((r) => i.cursor === undefined || r.seq < i.cursor);
    const lim = i.limit ?? 15; const out = rows.slice(0, lim);
    return { rows: out, ...(rows.length > lim ? { nextCursor: out[out.length - 1].seq } : {}) };
  },
  lmmx_top_auditVerify: () => (mockControl.breakChainAt > 0 ? { ok: false, checked: mockControl.breakChainAt, brokenAtSeq: mockControl.breakChainAt } : { ok: true, checked: audit.length }),
  lmmx_top_leadsList: (i) => {
    const all = leads.filter((l) => (!i.stage || l.stage === i.stage) && (!i.q || l.landlordLabel.toLowerCase().includes(i.q.toLowerCase())));
    const p = page(all.map(({ contactName: _a, contactPhone: _b, notes: _c, ...row }) => { void _a; void _b; void _c; return row as LeadRow; }), i.cursor, i.limit ?? MAP_PAGE);
    return { leads: p.items, ...(p.next ? { nextCursor: p.next } : {}) };
  },
  lmmx_top_leadGet: (i) => leads.find((l) => l.leadId === i.leadId) ?? fail("LMMX_E_NOT_FOUND"),
  lmmx_top_leadUpdate: (i) => {
    topMutation();
    const l = leads.find((x) => x.leadId === i.leadId) ?? fail("LMMX_E_NOT_FOUND");
    if (i.stage) l.stage = i.stage;
    if (i.note) l.notes = [...l.notes, { ts: Date.now(), by: "COG-0000", text: i.note }];
    if (i.nextFollowUpAt !== undefined) { if (i.nextFollowUpAt === null) delete l.nextFollowUpAt; else l.nextFollowUpAt = i.nextFollowUpAt; }
    l.updatedAt = Date.now();
    return { ok: true };
  },
  lmmx_top_stats: () => {
    const c: Record<TenantStatus, number> = { draft: 0, awaiting_confirmation: 0, active: 0, paused: 0, frozen: 0, closed: 0, migrated: 0 };
    for (const t of tenants.values()) c[t.view.status] += 1;
    return { tenants: c, creditedThisMonthMinor: 4_250_000, settledThisMonthMinor: 3_900_000, payoutsPaused: false, standaloneEnabled: true, openAlerts: 2, reviewQueue: reviewItems.length };
  },
};

/** The mock behind callLmmx. Honours forced errors, the top-desk re-login rule and a little latency. */
export async function mockCall<K extends LmmxCallableName>(name: K, input: LmmxCallableMap[K]["in"]): Promise<LmmxCallableMap[K]["out"]> {
  if (mockControl.latencyMs > 0) await wait(mockControl.latencyMs);
  const idx = mockControl.forced.findIndex((f) => !f.op || f.op === name);
  if (idx >= 0) { const [f] = mockControl.forced.splice(idx, 1); fail(f.code); }
  if (name.startsWith("lmmx_top_")) mockControl.asTop = true;
  const h = H[name] as Handler<K> | undefined;
  if (!h) throw new LmmxApiError("functions/unimplemented", "Not available in demo mode.");
  return h(input);
}
export const mockSnapshot = () => ({ tenants: tenants.size, audit: audit.length, leads: leads.length });
