import { useRef, useState } from "react";
import { Badge, Card, DataTable, EmptyState, FormField, buttonClass, inputClass } from "../../ui";
import type { AuditRow } from "../../api/lmmxContract.ts";
import { errorText, lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { useGuard } from "../lmm/hooks.ts";
import { fmtWhen, mergeRows } from "../lmm/logic.ts";
import { useTopGuard } from "./TopContext";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, auditQuery, emptyAuditFilters, verifyMessage } from "./logic.ts";
import type { AuditFilters } from "./logic.ts";
import { T } from "./strings.ts";

export default function AuditViewer() {
  const guarded = useTopGuard();
  const [f, setF] = useState<AuditFilters>(emptyAuditFilters);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [next, setNext] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const load = useGuard(); const ver = useGuard();
  const applied = useRef<AuditFilters>(f);

  async function search(cursor?: number) {
    const filters = cursor === undefined ? f : applied.current;
    const q = auditQuery(filters, cursor);
    if (!q) { setError(T.audit.badRange); return; }
    setError(null);
    await load.run(async () => {
      try {
        const out = await guarded(() => lmmx.top.auditList(q));
        if (cursor === undefined) applied.current = f;
        setRows((cur) => (cursor === undefined || !cur ? out.rows : mergeRows(cur, out.rows, (r) => String(r.seq)))); setNext(out.nextCursor);
      } catch (e) { setError(errorText(e)); }
    });
  }
  async function doVerify() {
    setVerify(null);
    await ver.run(async () => {
      try { setVerify(verifyMessage(await guarded(() => lmmx.top.auditVerify({})))); } catch (e) { setVerify({ tone: "error", text: errorText(e) }); }
    });
  }
  const set = (p: Partial<AuditFilters>) => setF({ ...f, ...p });
  return (
    <div className="min-w-0 space-y-4">
      <Card title={T.audit.title}>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <FormField label={T.audit.tenant} htmlFor="au-t"><input id="au-t" autoComplete="off" value={f.tenantId} onChange={(e) => set({ tenantId: e.target.value.slice(0, 60) })} className={inputClass} /></FormField>
          <FormField label={T.audit.desk} htmlFor="au-d"><input id="au-d" autoComplete="off" value={f.deskCode} onChange={(e) => set({ deskCode: e.target.value.toUpperCase().slice(0, 8) })} className={inputClass} /></FormField>
          <FormField label={T.audit.action} htmlFor="au-a"><select id="au-a" value={f.action} onChange={(e) => set({ action: e.target.value as AuditFilters["action"] })} className={inputClass}><option value="">{T.audit.anyAction}</option>{AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{AUDIT_ACTION_LABELS[a]}</option>)}</select></FormField>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <FormField label={T.audit.from} htmlFor="au-f"><input id="au-f" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className={inputClass} /></FormField>
            <FormField label={T.audit.to} htmlFor="au-to"><input id="au-to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className={inputClass} /></FormField>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={load.busy} onClick={() => void search()} className={buttonClass.primary}>{load.busy ? T.reason.working : T.audit.apply}</button>
          <button type="button" disabled={ver.busy} onClick={() => void doVerify()} className={buttonClass.secondary}>{ver.busy ? T.audit.verifying : T.audit.verify}</button>
        </div>
      </Card>
      {verify && <Notice tone={verify.tone}><strong>{verify.text}</strong></Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {rows && (
        <Card>
          <DataTable<AuditRow> rows={rows} rowKey={(r) => String(r.seq)} empty={<EmptyState title={T.audit.empty} />}
            columns={[
              { key: "s", header: T.audit.seq, primary: true, cell: (r) => `#${r.seq} · ${fmtWhen(r.ts)}` },
              { key: "a", header: T.audit.what, cell: (r) => <Badge tone="blue">{AUDIT_ACTION_LABELS[r.action] ?? r.action}</Badge> },
              { key: "w", header: T.audit.who, cell: (r) => `${r.actor.type}${r.actor.deskCode ? ` ${r.actor.deskCode}` : ""}` },
              { key: "t", header: T.audit.tenant, cell: (r) => r.tenantId ?? "—" },
              { key: "d", header: T.audit.summary, cell: (r) => r.summary },
              { key: "h", header: T.audit.hash, cell: (r) => <code className="text-xs">{r.hash.slice(0, 12)}</code> },
            ]} />
        </Card>
      )}
      {next !== undefined && <div className="flex justify-center"><button type="button" disabled={load.busy} onClick={() => void search(next)} className={buttonClass.secondary}>{load.busy ? T.reason.working : "Show more"}</button></div>}
    </div>
  );
}
