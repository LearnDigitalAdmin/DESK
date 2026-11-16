import { useState } from "react";
import { Badge, Card, EmptyState, buttonClass } from "../../ui";
import type { TopReviewRow } from "../../api/lmmxContract.ts";
import { channelLabel } from "../../api/lmmxContract.ts";
import { lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { Spinner } from "../lmm/parts";
import { useLoad } from "../lmm/hooks.ts";
import { fmtWhen } from "../lmm/logic.ts";
import ReasonModal from "./ReasonModal";
import { useTopGuard } from "./TopContext";
import { T } from "./strings.ts";

type Act = { row: TopReviewRow; kind: "approve" | "reject" | "freeze" };

export default function ReviewQueue() {
  const guarded = useTopGuard();
  const { data, error, loading, reload } = useLoad(() => guarded(() => lmmx.top.reviewQueue()), []);
  const [act, setAct] = useState<Act | null>(null);
  const [done, setDone] = useState(false);

  async function confirm(reason: string) {
    if (!act) return;
    const id = act.row.recipientId;
    if (act.kind === "freeze") await lmmx.top.freeze({ scope: "recipient", id, reason });
    else await lmmx.top.reviewDecision({ recipientId: id, decision: act.kind, reason });
    setDone(true); reload();
  }
  const title = act?.kind === "approve" ? T.review.approveTitle : act?.kind === "reject" ? T.review.rejectTitle : T.review.freezeTitle;
  return (
    <div className="min-w-0 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">{T.review.title}</h2>
      {done && <Notice tone="ok">{T.review.done}</Notice>}
      {error && <Notice tone="error">{error} <button type="button" className="font-semibold underline" onClick={reload}>Try again</button></Notice>}
      {loading && !data ? <Spinner /> : data && (data.items.length === 0 ? <EmptyState title={T.review.empty} /> : (
        <ul className="min-w-0 space-y-3">
          {data.items.map((r) => (
            <li key={r.recipientId}><Card>
              <div className="min-w-0 space-y-3">
                <p className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="amber">{T.review.reason[r.reason]}</Badge><span className="text-gray-500">{fmtWhen(r.createdAt)}</span></p>
                <p className="break-words text-sm">{T.review.account}: <strong>{channelLabel(r.channel)} {r.accountNumber}</strong></p>
                <p className="text-sm text-gray-600">{T.review.tenants}: {r.tenants} · {T.review.desks}: {r.desks}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass.primary} onClick={() => { setDone(false); setAct({ row: r, kind: "approve" }); }}>{T.review.approve}</button>
                  <button type="button" className={buttonClass.danger} onClick={() => { setDone(false); setAct({ row: r, kind: "reject" }); }}>{T.review.reject}</button>
                  <button type="button" className={buttonClass.secondary} onClick={() => { setDone(false); setAct({ row: r, kind: "freeze" }); }}>{T.review.freeze}</button>
                </div>
              </div>
            </Card></li>
          ))}
        </ul>
      ))}
      <ReasonModal open={!!act} title={title} danger={act?.kind !== "approve"} onClose={() => setAct(null)} onConfirm={confirm} />
    </div>
  );
}
