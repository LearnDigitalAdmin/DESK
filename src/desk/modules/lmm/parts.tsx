import type { ReactNode } from "react";
import { Badge, DataTable } from "../../ui";
import type { EarningsRow, Frequency, TenantStatus } from "../../api/lmmxContract.ts";
import { kes } from "../../api/lmmxContract.ts";
import { STATUS_TONE } from "./logic.ts";
import { S } from "./strings.ts";

export const StatusBadge = ({ status }: { status: TenantStatus }) => <Badge tone={STATUS_TONE[status]}>{S.status[status]}</Badge>;

/** A label and a value on one line, wrapping safely on phones. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-gray-100 py-2 text-sm last:border-0">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-gray-900">{children}</dd>
    </div>
  );
}

/** What the desk earns per instalment size (server table, or the helper estimate in the wizard). */
export function EarningsTableView({ rows }: { rows: EarningsRow[] }) {
  return (
    <DataTable<EarningsRow>
      rows={rows} rowKey={(r) => String(r.creditMinor)}
      columns={[
        { key: "c", header: S.wizard.perInstalment, primary: true, cell: (r) => kes(r.creditMinor) },
        { key: "p", header: S.wizard.tenantPays, align: "right", cell: (r) => kes(r.chargeMinor) },
        { key: "f", header: S.wizard.fees, align: "right", cell: (r) => `${kes(r.feesMinor)} (${r.feePct}%)` },
        { key: "d", header: S.wizard.deskGets, align: "right", cell: (r) => <strong>{kes(r.deskShareMinor)}</strong> },
      ]}
    />
  );
}

export interface ProjectionRow { instalments: number; tenantPaysMinor: number; deskMinor: number; deskBonusMinor: number }
export function ProjectionView({ rows }: { rows: Record<Frequency, ProjectionRow> }) {
  const list = (["daily", "weekly", "biweekly"] as const).map((f) => ({ f, ...rows[f] }));
  return (
    <DataTable<{ f: Frequency } & ProjectionRow>
      rows={list} rowKey={(r) => r.f}
      columns={[
        { key: "f", header: S.wizard.frequency, primary: true, cell: (r) => S.freq[r.f] },
        { key: "n", header: S.wizard.instalments, align: "right", cell: (r) => r.instalments },
        { key: "t", header: S.wizard.tenantPays, align: "right", cell: (r) => kes(r.tenantPaysMinor) },
        { key: "d", header: S.wizard.deskGets, align: "right", cell: (r) => <strong>{kes(r.deskMinor)}{r.deskBonusMinor > 0 ? ` ${S.wizard.bonus} ${kes(r.deskBonusMinor)}` : ""}</strong> },
      ]}
    />
  );
}

export function Spinner() {
  return <div className="flex min-h-[20vh] items-center justify-center" role="status" aria-label={S.common.loading}><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" /></div>;
}
