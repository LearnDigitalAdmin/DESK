import { useState } from "react";
import { Card, FormField, Stat, StatGrid, buttonClass, inputClass } from "../../ui";
import type { TenantStatus } from "../../api/lmmxContract.ts";
import { kes } from "../../api/lmmxContract.ts";
import { lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { Spinner } from "../lmm/parts";
import { useLoad } from "../lmm/hooks.ts";
import { S } from "../lmm/strings.ts";
import ReasonModal from "./ReasonModal";
import { useTopGuard } from "./TopContext";
import { deskCodeProblem } from "./logic.ts";
import { T } from "./strings.ts";

export default function StatsView() {
  const guarded = useTopGuard();
  const { data, error, loading, reload } = useLoad(() => guarded(() => lmmx.top.stats()), []);
  const [desk, setDesk] = useState("");
  const [act, setAct] = useState<"freeze" | "unfreeze" | null>(null);
  const [ok, setOk] = useState(false);

  async function run(reason: string) {
    const id = desk.trim().toUpperCase();
    if (act === "freeze") await lmmx.top.freeze({ scope: "desk", id, reason }); else await lmmx.top.unfreeze({ scope: "desk", id, reason });
    setOk(true); setAct(null); setDesk("");
  }
  return (
    <div className="min-w-0 space-y-4">
      {error && <Notice tone="error">{error} <button type="button" className="font-semibold underline" onClick={reload}>{S.common.retry}</button></Notice>}
      {loading && !data ? <Spinner /> : data && (
        <>
          {data.payoutsPaused && <Notice tone="error"><strong>{T.stats.paused}</strong></Notice>}
          {!data.standaloneEnabled && <Notice tone="error"><strong>{T.stats.disabled}</strong></Notice>}
          <StatGrid>
            <Stat label={T.stats.credited} value={kes(data.creditedThisMonthMinor)} />
            <Stat label={T.stats.settled} value={kes(data.settledThisMonthMinor)} tone="good" />
            <Stat label={T.stats.alerts} value={data.openAlerts} tone={data.openAlerts > 0 ? "warn" : "default"} />
            <Stat label={T.stats.queue} value={data.reviewQueue} tone={data.reviewQueue > 0 ? "warn" : "default"} />
          </StatGrid>
          <Card title={T.stats.tenantsBy}>
            <StatGrid>{(Object.keys(data.tenants) as TenantStatus[]).map((s) => <Stat key={s} label={S.status[s]} value={data.tenants[s]} />)}</StatGrid>
          </Card>
        </>
      )}
      <Card title={T.tenants.deskFreeze}>
        <div className="min-w-0 space-y-3">
          {ok && <Notice tone="ok">{T.tenants.ok}</Notice>}
          <FormField label={T.tenants.deskCode} htmlFor="st-desk" error={desk && deskCodeProblem(desk)}><input id="st-desk" autoComplete="off" value={desk} onChange={(e) => { setDesk(e.target.value.toUpperCase().slice(0, 8)); setOk(false); }} className={inputClass} /></FormField>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!deskCodeProblem(desk)} className={buttonClass.danger} onClick={() => setAct("freeze")}>{T.tenants.freezeDesk}</button>
            <button type="button" disabled={!!deskCodeProblem(desk)} className={buttonClass.secondary} onClick={() => setAct("unfreeze")}>{T.tenants.unfreezeDesk}</button>
          </div>
        </div>
      </Card>
      <ReasonModal open={act !== null} title={act === "freeze" ? T.tenants.freezeDesk : T.tenants.unfreezeDesk} danger={act === "freeze"} onClose={() => setAct(null)} onConfirm={run} />
    </div>
  );
}
