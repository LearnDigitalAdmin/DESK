import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Badge, Card, DataTable, Page, buttonClass } from "../../ui";
import type { ChangeKind, DeskGetTenantOut, InstalmentView } from "../../api/lmmxContract.ts";
import { kes, shortDate } from "../../api/lmmxContract.ts";
import { lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import ChangeFlow from "./ChangeFlow";
import type { Resume } from "./ChangeFlow";
import { EarningsTableView, Row, Spinner, StatusBadge } from "./parts";
import { useLoad, usePoll } from "./hooks.ts";
import { POLL_MS, canEditTenant, displayMasked, fmtWhen } from "./logic.ts";
import { S } from "./strings.ts";

const CHANGE_TONE = { awaiting_tenant_otp: "amber", cooling_off: "blue", deferred: "blue", applied: "green", cancelled: "gray", expired: "gray", rejected: "red" } as const;

/** One tenant: masked identity, rent, the landlord payment details, this month, recent payments, what the desk earns, and edits. `topActions` adds the top-desk controls. */
export default function TenantDetail({ tenantId, backTo, backLabel, allowEdit = true, topActions }: { tenantId: string; backTo: string; backLabel: string; allowEdit?: boolean; topActions?: (t: DeskGetTenantOut, reload: () => void) => ReactNode }) {
  const loc = useLocation();
  const justActivated = !!(loc.state as { justActivated?: boolean } | null)?.justActivated;
  const { data: t, error, loading, reload } = useLoad(() => lmmx.getTenant(tenantId), [tenantId]);
  const [flow, setFlow] = useState<{ kind: ChangeKind; resume?: Resume } | null>(null);

  const pc = t?.pendingChange;
  const watching = !!pc && (pc.status === "awaiting_tenant_otp" || pc.status === "cooling_off" || pc.status === "deferred") && !flow;
  usePoll(async () => { reload(); }, POLL_MS * 6, watching);

  if (loading && !t) return <Page title={S.detail.title}><Spinner /></Page>;
  if (error || !t) return <Page title={S.detail.title}><Notice tone="error">{error ?? S.common.none} <button type="button" className="font-semibold underline" onClick={reload}>{S.common.retry}</button></Notice><Link to={backTo} className={buttonClass.secondary}>{backLabel}</Link></Page>;

  const closeFlow = () => { setFlow(null); reload(); };
  return (
    <Page title={displayMasked(t.nameMasked)} subtitle={`${S.detail.desk} ${t.deskCode}`} actions={<Link to={backTo} className={buttonClass.secondary}>{backLabel}</Link>}>
      {justActivated && <Notice tone="ok"><strong>{S.waiting.doneTitle}.</strong> {S.waiting.doneBody}</Notice>}
      {(t.frozen || t.status === "frozen") && <Notice tone="error">{S.detail.holdBanner}</Notice>}
      {t.status === "awaiting_confirmation" && <Notice tone="info"><Link to={`/desk/lipa-mdogo/waiting/${t.tenantId}`} className="font-semibold underline">{S.list.openWaiting}</Link></Notice>}

      <Card title={S.detail.identity}>
        <dl>
          <Row label="Status"><StatusBadge status={t.status} /></Row>
          <Row label={S.detail.phone}>{displayMasked(t.phoneMasked)}</Row>
          <Row label={S.detail.id}>{displayMasked(t.idMasked)}</Row>
          {t.unitNumber && <Row label={S.detail.unit}>{t.unitNumber}</Row>}
          {t.propertyName && <Row label={S.detail.property}>{t.propertyName}</Row>}
          <Row label={S.detail.rent}>{kes(t.rentMinor)}</Row>
          <Row label={S.detail.dueDay}>{t.dueDay}</Row>
          <Row label={S.detail.plan}>{S.freq[t.frequency]}</Row>
        </dl>
      </Card>

      <Card title={S.detail.recipient}>
        <dl>
          <Row label={S.detail.channel}>{S.channel[t.recipient.channel]}</Row>
          <Row label={S.detail.account}>{t.recipient.accountNumber}</Row>
          <Row label={S.detail.resolvedName}>{t.recipient.resolvedNameMasked || "—"}</Row>
          <Row label={S.detail.nameMatch}><Badge tone={t.recipient.nameMatch === "matched" ? "green" : t.recipient.nameMatch === "mismatch" ? "red" : "gray"}>{S.nameMatch[t.recipient.nameMatch]}</Badge></Row>
          <Row label={S.detail.recStatus}><Badge tone={t.recipient.status === "verified" ? "green" : t.recipient.status === "frozen" ? "red" : "amber"}>{S.recipientStatus[t.recipient.status]}</Badge></Row>
        </dl>
      </Card>

      {t.cycle && (
        <Card title={S.detail.cycle}>
          <div className="space-y-3">
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, t.cycle.pct)} aria-label={S.detail.cycle}>
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, t.cycle.pct))}%` }} />
            </div>
            <dl>
              <Row label={S.detail.cycleCredited}>{kes(t.cycle.creditedMinor)} ({t.cycle.pct}%)</Row>
              <Row label={S.detail.cycleLeft}>{kes(t.cycle.remainingMinor)}</Row>
              <Row label={S.detail.cycleSettled}>{kes(t.cycle.settledMinor)}</Row>
              <Row label={S.detail.cycleDue}>{shortDate(t.cycle.dueDate)}</Row>
              <Row label={S.detail.cyclePay}>{shortDate(t.cycle.payByDate)}</Row>
            </dl>
          </div>
        </Card>
      )}

      {pc && (
        <Card title={S.detail.pending}>
          <div className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={CHANGE_TONE[pc.status]}>{S.detail.changeStatus[pc.status]}</Badge><span className="break-words">{pc.summary}</span></p>
            {pc.coolingOffUntil && <p className="text-sm text-gray-600">{S.detail.coolingUntil}: {fmtWhen(pc.coolingOffUntil)}</p>}
            {allowEdit && !flow && (pc.status === "awaiting_tenant_otp" || pc.status === "cooling_off" || pc.status === "deferred") && (
              <div className="flex flex-wrap gap-2">
                {pc.status === "awaiting_tenant_otp" && <button type="button" className={buttonClass.primary} onClick={() => setFlow({ kind: pc.kind, resume: { changeId: pc.changeId, kind: pc.kind } })}>{S.detail.openCode}</button>}
                {pc.status !== "awaiting_tenant_otp" && <button type="button" className={buttonClass.danger} onClick={() => setFlow({ kind: pc.kind, resume: { changeId: pc.changeId, kind: pc.kind } })}>{S.detail.cancelChange}</button>}
              </div>
            )}
          </div>
        </Card>
      )}

      {flow && <ChangeFlow tenant={t} kind={flow.kind} {...(flow.resume ? { resume: flow.resume } : {})} onClose={closeFlow} onChanged={reload} />}

      {allowEdit && !flow && canEditTenant(t.status, pc) && (
        <Card title={S.detail.edit}>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setFlow({ kind: "recipient" })}>{S.detail.changePayout}</button>
            <button type="button" className={buttonClass.secondary} onClick={() => setFlow({ kind: "rent" })}>{S.detail.changeRent}</button>
          </div>
        </Card>
      )}

      <Card title={S.detail.recent}>
        <DataTable<InstalmentView>
          rows={t.recent} rowKey={(r) => r.paymentId} empty={<p className="py-4 text-center text-sm text-gray-500">{S.detail.recentEmpty}</p>}
          columns={[
            { key: "at", header: S.detail.at, primary: true, cell: (r) => fmtWhen(r.at) },
            { key: "c", header: S.detail.credit, align: "right", cell: (r) => kes(r.creditMinor) },
            { key: "p", header: S.detail.charge, align: "right", cell: (r) => kes(r.chargeMinor) },
            { key: "d", header: S.detail.deskShare, align: "right", cell: (r) => (r.deskShareMinor !== undefined ? kes(r.deskShareMinor) : "—") },
            { key: "s", header: "Status", align: "right", cell: (r) => <Badge tone={r.status === "success" ? "green" : r.status === "failed" ? "red" : "gray"}>{r.status}</Badge> },
          ]}
        />
      </Card>

      <Card title={S.detail.earnTitle}>
        <div className="min-w-0 space-y-4">
          <EarningsTableView rows={t.earningsTable} />
          <h3 className="text-sm font-semibold text-gray-800">{S.detail.month}</h3>
          <p className="break-words text-sm text-gray-700">{S.detail.projLine(t.projection.instalments, S.freq[t.projection.frequency])}</p>
          <dl>
            <Row label={S.detail.tenantPays}>{kes(t.projection.tenantPaysMinor)}</Row>
            <Row label={S.detail.deskTotal}>{kes(t.projection.deskMinor)}{t.projection.deskBonusMinor > 0 ? ` ${S.wizard.bonus} ${kes(t.projection.deskBonusMinor)}` : ""}</Row>
          </dl>
        </div>
      </Card>

      {topActions?.(t, reload)}
    </Page>
  );
}
