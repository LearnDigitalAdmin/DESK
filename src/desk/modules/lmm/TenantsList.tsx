import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, DataTable, EmptyState, buttonClass, cn, inputClass } from "../../ui";
import type { DeskTenantRow, TenantStatus } from "../../api/lmmxContract.ts";
import { kes } from "../../api/lmmxContract.ts";
import { errorText, lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { StatusBadge } from "./parts";
import { useDebounced } from "./hooks.ts";
import { LIST_LIMIT, LMM_BASE, SEARCH_DEBOUNCE_MS, STATUS_CHIPS, displayMasked, listKey, mergeRows, searchTerm } from "./logic.ts";
import { S } from "./strings.ts";

/** Search + status chips + paging for tenants. A desk gets its own tenants and COG-0000 gets all of them (the server decides); `showDesk` adds the desk column. */
export default function TenantsList({ detailBase, showDesk = false }: { detailBase: string; showDesk?: boolean }) {
  const [text, setText] = useState("");
  const [chip, setChip] = useState<TenantStatus | "all">("all");
  const debounced = useDebounced(text, SEARCH_DEBOUNCE_MS);
  const q = searchTerm(debounced);
  const status = chip === "all" ? undefined : chip;
  const key = listKey(q, status);

  const [rows, setRows] = useState<DeskTenantRow[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  async function fetchPage(cursor: string | undefined, append: boolean) {
    const mine = ++seq.current;
    if (append) setMore(true); else { setLoading(true); setRows([]); setNext(undefined); }
    setError(null);
    try {
      const out = await lmmx.listTenants({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), limit: LIST_LIMIT });
      if (mine !== seq.current) return;
      setRows((cur) => (append ? mergeRows(cur, out.tenants, (r) => r.tenantId) : out.tenants));
      setNext(out.nextCursor);
    } catch (e) { if (mine === seq.current) setError(errorText(e)); }
    finally { if (mine === seq.current) { setLoading(false); setMore(false); } }
  }
  // A new search or filter starts again from the top.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchPage(undefined, false); return () => { seq.current++; }; }, [key]);

  const filtered = !!q || chip !== "all";
  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <div className="min-w-0 space-y-3">
          <input type="search" aria-label={S.common.search} placeholder={S.list.searchPh} value={text} onChange={(e) => setText(e.target.value.slice(0, 40))} className={inputClass} />
          <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Filter by status">
            {STATUS_CHIPS.map((c) => (
              <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => setChip(c.id)}
                className={cn("inline-flex h-10 items-center rounded-full px-4 text-sm font-medium", chip === c.id ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50")}>{c.label}</button>
            ))}
          </div>
        </div>
      </Card>
      {error && <Notice tone="error">{error} <button type="button" className="font-semibold underline" onClick={() => void fetchPage(undefined, false)}>{S.common.retry}</button></Notice>}
      {loading ? <div className="py-8 text-center text-sm text-gray-500" role="status">{S.common.loading}</div> : (
        <DataTable<DeskTenantRow>
          rows={rows} rowKey={(r) => r.tenantId}
          empty={<EmptyState title={filtered ? S.list.emptyFiltered : S.list.empty} body={filtered ? undefined : S.list.emptyBody} action={filtered ? undefined : <Link to={`${LMM_BASE}/new`} className={buttonClass.primary}>{S.nav.add}</Link>} />}
          columns={[
            { key: "n", header: S.wizard.fullName, primary: true, cell: (r) => <Link to={`${detailBase}/tenant/${r.tenantId}`} className="text-blue-700 underline">{displayMasked(r.nameMasked)}</Link> },
            { key: "p", header: S.detail.phone, cell: (r) => displayMasked(r.phoneMasked) },
            ...(showDesk ? [{ key: "d", header: S.list.desk, cell: (r: DeskTenantRow) => r.deskCode }] : []),
            { key: "s", header: "Status", cell: (r) => (
              <span className="inline-flex flex-wrap items-center justify-end gap-2"><StatusBadge status={r.status} />
                {r.status === "awaiting_confirmation" && !showDesk && <Link to={`${LMM_BASE}/waiting/${r.tenantId}`} className="text-sm font-semibold text-blue-700 underline">{S.list.openWaiting}</Link>}</span>) },
            { key: "r", header: S.list.rent, align: "right", cell: (r) => kes(r.rentMinor) },
            { key: "due", header: S.list.due, align: "right", cell: (r) => `${S.common.day} ${r.dueDay}` },
            { key: "c", header: S.list.paid, align: "right", cell: (r) => `${kes(r.creditedMinor)} · ${S.list.left} ${kes(r.remainingMinor)}` },
          ]}
        />
      )}
      {next && !loading && <div className="flex justify-center"><button type="button" disabled={more} onClick={() => void fetchPage(next, true)} className={buttonClass.secondary}>{more ? S.common.loading : S.common.more}</button></div>}
    </div>
  );
}
