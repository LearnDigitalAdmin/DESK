import { useEffect, useRef, useState } from "react";
import { Badge, Card, DataTable, EmptyState, FormField, Modal, buttonClass, cn, inputClass } from "../../ui";
import type { LeadRow, LeadStage, TopLeadGetOut } from "../../api/lmmxContract.ts";
import { LEAD_STAGES, eatDate, kes } from "../../api/lmmxContract.ts";
import { errorText, lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { Spinner } from "../lmm/parts";
import { useDebounced, useGuard, useLoad } from "../lmm/hooks.ts";
import { LIST_LIMIT, SEARCH_DEBOUNCE_MS, fmtWhen, listKey, mergeRows, searchTerm } from "../lmm/logic.ts";
import { S } from "../lmm/strings.ts";
import { useTopGuard } from "./TopContext";
import { LEAD_TABS, followUpToMs } from "./logic.ts";
import { T } from "./strings.ts";

export default function LeadsCrm() {
  const guarded = useTopGuard();
  const [tab, setTab] = useState<LeadStage | "all">("all");
  const [text, setText] = useState("");
  const q = searchTerm(useDebounced(text, SEARCH_DEBOUNCE_MS));
  const stage = tab === "all" ? undefined : tab;
  const key = listKey(q, stage as never);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const seq = useRef(0);

  async function fetchPage(cursor: string | undefined) {
    const mine = ++seq.current;
    if (cursor) setMore(true); else { setLoading(true); setRows([]); setNext(undefined); }
    setError(null);
    try {
      const out = await guarded(() => lmmx.top.leadsList({ ...(q ? { q } : {}), ...(stage ? { stage } : {}), ...(cursor ? { cursor } : {}), limit: LIST_LIMIT }));
      if (mine !== seq.current) return;
      setRows((cur) => (cursor ? mergeRows(cur, out.leads, (r) => r.leadId) : out.leads)); setNext(out.nextCursor);
    } catch (e) { if (mine === seq.current) setError(errorText(e)); }
    finally { if (mine === seq.current) { setLoading(false); setMore(false); } }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchPage(undefined); return () => { seq.current++; }; }, [key]);

  return (
    <div className="min-w-0 space-y-4">
      <Card title={T.leads.title}>
        <div className="min-w-0 space-y-3">
          <input type="search" aria-label={T.leads.search} placeholder={T.leads.search} value={text} onChange={(e) => setText(e.target.value.slice(0, 40))} className={inputClass} />
          <div className="flex min-w-0 flex-wrap gap-2" role="tablist" aria-label="Lead stages">
            {LEAD_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={cn("inline-flex h-10 items-center rounded-full px-4 text-sm font-medium", tab === t.id ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50")}>{t.label}</button>
            ))}
          </div>
        </div>
      </Card>
      {error && <Notice tone="error">{error} <button type="button" className="font-semibold underline" onClick={() => void fetchPage(undefined)}>{S.common.retry}</button></Notice>}
      {loading ? <Spinner /> : (
        <DataTable<LeadRow> rows={rows} rowKey={(r) => r.leadId} empty={<EmptyState title={T.leads.empty} />}
          columns={[
            { key: "l", header: T.leads.landlord, primary: true, cell: (r) => <button type="button" className="text-left text-blue-700 underline" onClick={() => setOpenId(r.leadId)}>{r.landlordLabel}</button> },
            { key: "s", header: T.leads.stage, cell: (r) => <Badge tone="blue">{S.stage[r.stage]}</Badge> },
            { key: "t", header: T.leads.tenants, align: "right", cell: (r) => r.tenants },
            { key: "r", header: T.leads.rent, align: "right", cell: (r) => kes(r.monthlyRentMinor) },
            { key: "d", header: T.leads.desks, cell: (r) => r.deskCodes.join(", ") },
            { key: "f", header: T.leads.followUp, cell: (r) => (r.nextFollowUpAt ? fmtWhen(r.nextFollowUpAt) : "—") },
            { key: "p", header: T.leads.pms, cell: (r) => <Badge tone={r.onPms ? "green" : "gray"}>{r.onPms ? S.pipeline.yes : S.pipeline.no}</Badge> },
          ]} />
      )}
      {next && !loading && <div className="flex justify-center"><button type="button" disabled={more} onClick={() => void fetchPage(next)} className={buttonClass.secondary}>{more ? S.common.loading : S.common.more}</button></div>}
      {openId && <LeadModal leadId={openId} onClose={() => setOpenId(null)} onSaved={() => void fetchPage(undefined)} />}
    </div>
  );
}

/** One lead with the contact details (top desk only) and the CRM fields: stage, a note, a follow-up date. */
function LeadModal({ leadId, onClose, onSaved }: { leadId: string; onClose: () => void; onSaved: () => void }) {
  const guarded = useTopGuard();
  const { data, error, loading, reload } = useLoad<TopLeadGetOut>(() => guarded(() => lmmx.top.leadGet(leadId)), [leadId]);
  const [stage, setStage] = useState<LeadStage | "">("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const g = useGuard();
  const curDate = date ?? (data?.nextFollowUpAt ? eatDate(data.nextFollowUpAt) : "");

  async function save() {
    if (!data) return;
    const fu = date === null ? undefined : followUpToMs(date);
    const stageChanged = stage && stage !== data.stage;
    if (!stageChanged && !note.trim() && date === null) { setMsg({ tone: "error", text: T.leads.nothing }); return; }
    setMsg(null);
    await g.run(async () => {
      try {
        // Lead notes and stages are CRM work, and the contract's leadUpdate carries no reason field (see the report: CCR-2).
        await guarded(() => lmmx.top.leadUpdate({ leadId, ...(stageChanged ? { stage: stage as LeadStage } : {}), ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}), ...(date !== null && fu !== undefined ? { nextFollowUpAt: fu } : {}) }));
        setNote(""); setDate(null); setStage(""); setMsg({ tone: "ok", text: T.leads.saved }); reload(); onSaved();
      } catch (e) { setMsg({ tone: "error", text: errorText(e) }); }
    });
  }
  return (
    <Modal open title={data?.landlordLabel ?? T.leads.title} onClose={onClose}
      footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>{S.common.close}</button><button type="button" disabled={g.busy || !data} className={buttonClass.primary} onClick={() => void save()}>{g.busy ? T.leads.saving : T.leads.save}</button></>}>
      {loading && !data ? <Spinner /> : error || !data ? <Notice tone="error">{error ?? S.common.none}</Notice> : (
        <div className="min-w-0 space-y-4">
          <div><h3 className="text-sm font-semibold text-gray-800">{T.leads.contact}</h3>
            <p className="break-words text-sm">{T.leads.name}: {data.contactName}</p><p className="break-words text-sm">{T.leads.phone}: {data.contactPhone}</p></div>
          <FormField label={T.leads.stage} htmlFor="ld-stage"><select id="ld-stage" value={stage || data.stage} onChange={(e) => setStage(e.target.value as LeadStage)} className={inputClass}>{LEAD_STAGES.map((s) => <option key={s} value={s}>{S.stage[s]}</option>)}</select></FormField>
          <FormField label={T.leads.followUpDate} htmlFor="ld-date">
            <div className="flex min-w-0 gap-2"><input id="ld-date" type="date" value={curDate} onChange={(e) => setDate(e.target.value)} className={inputClass} /><button type="button" className={buttonClass.secondary} onClick={() => setDate("")}>{T.leads.clearDate}</button></div>
          </FormField>
          <FormField label={T.leads.addNote} htmlFor="ld-note"><textarea id="ld-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} h-auto py-2`} /></FormField>
          <div><h3 className="text-sm font-semibold text-gray-800">{T.leads.notes}</h3>
            {data.notes.length === 0 ? <p className="text-sm text-gray-500">{T.leads.noNotes}</p> : <ul className="space-y-2">{[...data.notes].reverse().map((n) => <li key={n.ts} className="break-words rounded-xl bg-gray-50 p-2 text-sm"><span className="block text-xs text-gray-500">{fmtWhen(n.ts)} · {n.by}</span>{n.text}</li>)}</ul>}</div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </div>
      )}
    </Modal>
  );
}
