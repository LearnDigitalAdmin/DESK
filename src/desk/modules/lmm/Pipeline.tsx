import { useEffect, useRef, useState } from "react";
import { Badge, Card, DataTable, EmptyState, buttonClass } from "../../ui";
import type { PipelineRow } from "../../api/lmmxContract.ts";
import { kes } from "../../api/lmmxContract.ts";
import { errorText, lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { Spinner } from "./parts";
import { mergeRows } from "./logic.ts";
import { S } from "./strings.ts";

/** Read-only: the landlords tied to this desk's tenants. All text (including what a conversion pays) comes from the server. */
export default function Pipeline() {
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  async function load(cursor?: string) {
    const mine = ++seq.current;
    if (cursor) setMore(true); else setLoading(true);
    setError(null);
    try {
      const out = await lmmx.pipeline(cursor);
      if (mine !== seq.current) return;
      setRows((cur) => (cursor ? mergeRows(cur, out.landlords, (r) => r.leadIdMasked) : out.landlords)); setNext(out.nextCursor);
    } catch (e) { if (mine === seq.current) setError(errorText(e)); }
    finally { if (mine === seq.current) { setLoading(false); setMore(false); } }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); return () => { seq.current++; }; }, []);
  return (
    <div className="min-w-0 space-y-4">
      <p className="break-words text-sm text-gray-600">{S.pipeline.sub}</p>
      {error && <Notice tone="error">{error} <button type="button" className="font-semibold underline" onClick={() => void load()}>{S.common.retry}</button></Notice>}
      {loading ? <Spinner /> : (
        <Card>
          <DataTable<PipelineRow> rows={rows} rowKey={(r) => r.leadIdMasked} empty={<EmptyState title={S.pipeline.empty} />}
            columns={[
              { key: "l", header: "Landlord", primary: true, cell: (r) => r.landlordLabel },
              { key: "t", header: S.pipeline.tenants, align: "right", cell: (r) => r.tenants },
              { key: "r", header: S.pipeline.rent, align: "right", cell: (r) => kes(r.monthlyRentMinor) },
              { key: "s", header: S.pipeline.stage, cell: (r) => <Badge tone="blue">{S.stage[r.stage]}</Badge> },
              { key: "p", header: S.pipeline.onPms, cell: (r) => <Badge tone={r.onPms ? "green" : "gray"}>{r.onPms ? S.pipeline.yes : S.pipeline.no}</Badge> },
              { key: "n", header: "What happens next", cell: (r) => r.conversionNote },
            ]} />
        </Card>
      )}
      {next && !loading && <div className="flex justify-center"><button type="button" disabled={more} onClick={() => void load(next)} className={buttonClass.secondary}>{more ? S.common.loading : S.common.more}</button></div>}
    </div>
  );
}
