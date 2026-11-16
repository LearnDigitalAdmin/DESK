import { useState } from "react";
import { Card, DataTable, EmptyState, FormField, Stat, StatGrid, buttonClass, inputClass } from "../../ui";
import { kes } from "../../api/lmmxContract.ts";
import { lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { Spinner } from "./parts";
import { useLoad } from "./hooks.ts";
import { defaultRange, displayMasked, rangeToMs } from "./logic.ts";
import { S } from "./strings.ts";

export default function Earnings() {
  const [range, setRange] = useState(() => defaultRange(Date.now()));
  const [applied, setApplied] = useState(range);
  const ms = rangeToMs(applied.from, applied.to);
  const { data, error, loading, reload } = useLoad(() => (ms ? lmmx.earnings(ms.from, ms.to) : Promise.reject(new Error(S.earnings.badRange))), [applied.from, applied.to]);
  const bad = rangeToMs(range.from, range.to) === null;
  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <FormField label={S.earnings.from} htmlFor="e-from"><input id="e-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={inputClass} /></FormField>
          <FormField label={S.earnings.to} htmlFor="e-to"><input id="e-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={inputClass} /></FormField>
          <button type="button" disabled={bad} onClick={() => setApplied(range)} className={buttonClass.primary}>{S.earnings.show}</button>
        </div>
        {bad && <p role="alert" className="mt-2 text-xs text-red-600">{S.earnings.badRange}</p>}
      </Card>
      {error && <Notice tone="error">{error} <button type="button" className="font-semibold underline" onClick={reload}>{S.common.retry}</button></Notice>}
      {loading && !data ? <Spinner /> : data && (
        <>
          <StatGrid>
            <Stat label={S.earnings.instalments} value={data.instalments} />
            <Stat label={S.earnings.share} value={kes(data.deskShareMinor)} tone="good" />
            <Stat label={S.earnings.completion} value={kes(data.completionBonusMinor)} />
            <Stat label={S.earnings.landlordBonus} value={kes(data.landlordBonusMinor)} />
          </StatGrid>
          <Card title={S.earnings.byTenant}>
            <DataTable rows={data.byTenant} rowKey={(r) => r.tenantId} empty={<EmptyState title={S.earnings.empty} />}
              columns={[{ key: "n", header: S.wizard.fullName, primary: true, cell: (r) => displayMasked(r.nameMasked) }, { key: "d", header: S.earnings.share, align: "right", cell: (r) => kes(r.deskShareMinor) }]} />
          </Card>
        </>
      )}
    </div>
  );
}
