import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DESK_TOP_CODE } from "../../api";
import { useAgent } from "../../core/useAgent";
import { Card, FormField, buttonClass, inputClass } from "../../ui";
import type { ChangeKind, DeskGetTenantOut, PendingChangeView } from "../../api/lmmxContract.ts";
import { kes } from "../../api/lmmxContract.ts";
import { errorText, lmmx, lmmxCodeOf } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import OtpPanel from "./OtpPanel";
import { DedupePrompt, RecipientFields } from "./RecipientFields";
import { useRecipientCheck } from "./useRecipientCheck.ts";
import { useGuard, useIdempotencyKey, useNow, usePoll } from "./hooks.ts";
import { POLL_MS, PAYOUT_SETUP_PATH, deriveChangeView, emptyRecipientForm, hasErrors, parseKes, rentProblem, toRecipientInput, validateRecipient } from "./logic.ts";
import type { Errors, RecipientForm } from "./logic.ts";
import { S } from "./strings.ts";

export interface Resume { changeId: string; kind: ChangeKind }

/**
 * Changing landlord payment details or the rent. Step 1: honest copy and the form. Step 2: the tenant's code (typed here, or the tenant taps
 * the WhatsApp link), then the result (applied, waiting 48 hours, or after this month's payout). A change in progress can be cancelled.
 */
export default function ChangeFlow({ tenant, kind, resume, onClose, onChanged }: { tenant: DeskGetTenantOut; kind: ChangeKind; resume?: Resume; onClose: () => void; onChanged: () => void }) {
  const [stage, setStage] = useState<"form" | "code">(resume ? "code" : "form");
  const [changeId, setChangeId] = useState(resume?.changeId ?? "");
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | undefined>();
  const [error, setError] = useState<{ text: string; notReady: boolean } | null>(null);
  const [rec, setRec] = useState<RecipientForm>(emptyRecipientForm);
  const [re, setRe] = useState<Errors<RecipientForm>>({});
  const [rentText, setRentText] = useState("");
  const [rentErr, setRentErr] = useState<string | null>(null);
  const [pc, setPc] = useState<PendingChangeView | undefined>(tenant.pendingChange);
  const [wrong, setWrong] = useState(0);
  const check = useRecipientCheck();
  const submit = useGuard();
  const cancel = useGuard();
  const idem = useIdempotencyKey();
  const now = useNow(stage === "code");

  const view = deriveChangeView(pc, changeId, otpExpiresAt, now, wrong);
  usePoll(async () => { const t = await lmmx.getTenant(tenant.tenantId); setPc(t.pendingChange); }, POLL_MS, stage === "code" && view.phase !== "done" && view.phase !== "closed");
  const changedRef = useRef(onChanged); changedRef.current = onChanged;
  useEffect(() => { if (view.phase === "done") changedRef.current(); }, [view.phase]);

  async function request() {
    setError(null);
    let body: { rentMinor?: number; recipient?: ReturnType<typeof toRecipientInput> } = {};
    if (kind === "rent") {
      const p = rentProblem(rentText);
      if (p) { setRentErr(p); return; }
      const m = parseKes(rentText) as number;
      if (m === tenant.rentMinor) { setRentErr("That is the same as the rent now."); return; }
      body = { rentMinor: m };
    } else {
      const e = validateRecipient(rec); setRe(e);
      if (hasErrors(e)) return;
      try { if (!(await check.check(rec))) return; } catch (err) { setError({ text: errorText(err), notReady: false }); return; }
      body = { recipient: toRecipientInput(rec, check.reuseToken) };
    }
    await submit.run(async () => {
      try {
        const out = await lmmx.requestChange({ tenantId: tenant.tenantId, kind, ...body, idempotencyKey: idem.key });
        setChangeId(out.changeId); setOtpExpiresAt(out.otpExpiresAt); setWrong(0);
        setPc({ changeId: out.changeId, kind, status: out.status, initiatedBy: "desk", summary: "", ...(out.coolingOffUntil ? { coolingOffUntil: out.coolingOffUntil } : {}), ...(out.applyAfter ? { applyAfter: out.applyAfter } : {}) });
        setStage("code");
      } catch (err) { setError({ text: errorText(err), notReady: lmmxCodeOf(err) === "LMMX_E_DESK_NOT_READY" }); }
    });
  }
  async function confirm(otp: string) {
    try {
      const out = await lmmx.confirmChange(changeId, otp);
      setPc((cur) => (cur ? { ...cur, status: out.status, ...(out.applyAfter ? { applyAfter: out.applyAfter, coolingOffUntil: out.applyAfter } : {}) } : cur));
    } catch (e) {
      const c = lmmxCodeOf(e);
      if (c === "LMMX_E_OTP_INVALID") setWrong((n) => n + 1);
      if (c === "LMMX_E_OTP_LOCKED") setWrong(5);
      throw e;
    }
  }
  async function doCancel() {
    await cancel.run(async () => {
      try { await lmmx.cancelChange(changeId); setPc((cur) => (cur ? { ...cur, status: "cancelled" } : cur)); onChanged(); }
      catch (e) { setError({ text: errorText(e), notReady: false }); }
    });
  }

  const top = useAgent()?.agentCode === DESK_TOP_CODE;   // COG-0000: no tenant code, no cooling-off
  const copy = top ? S.change.topCopy : kind === "recipient" ? S.change.payoutCopy : S.change.rentCopy;
  const title = kind === "recipient" ? S.change.payoutTitle : S.change.rentTitle;

  if (stage === "form") {
    return (
      <Card title={title}>
        <div className="min-w-0 space-y-4">
          <Notice tone="info"><ul className="list-disc space-y-1 pl-5">{copy.map((c) => <li key={c}>{c}</li>)}</ul></Notice>
          {error && <Notice tone="error">{error.text}{error.notReady && <span className="mt-2 block"><Link to={PAYOUT_SETUP_PATH} className="font-semibold underline">{S.wizard.notReadyLink}</Link></span>}</Notice>}
          {kind === "rent" ? (
            <FormField label={S.change.newRent} htmlFor="ch-rent" hint={`Now: ${kes(tenant.rentMinor)}`} error={rentErr}>
              <input id="ch-rent" inputMode="numeric" autoComplete="off" value={rentText} disabled={submit.busy} onChange={(e) => { setRentText(e.target.value.replace(/[^\d,]/g, "").slice(0, 11)); setRentErr(null); }} className={inputClass} />
            </FormField>
          ) : (
            <>
              <RecipientFields value={rec} onChange={(v) => { setRec(v); check.reset(); }} errors={re} disabled={submit.busy || check.checking || check.dedupe.state === "ask"} />
              <DedupePrompt dedupe={check.dedupe} onAnswer={(same) => check.answer(same)} />
            </>
          )}
          {check.dedupe.state !== "ask" && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass.secondary} onClick={onClose} disabled={submit.busy}>{S.common.cancel}</button>
              <button type="button" className={buttonClass.primary} disabled={submit.busy || check.checking} onClick={() => void request()}>{submit.busy || check.checking ? (top ? S.change.topSending : S.change.sending) : (top ? S.change.topSend : S.change.send)}</button>
            </div>
          )}
        </div>
      </Card>
    );
  }

  const canCancel = pc && (pc.status === "awaiting_tenant_otp" || pc.status === "cooling_off" || pc.status === "deferred");
  const finished = view.phase === "done" || view.phase === "closed";
  return (
    <div className="min-w-0 space-y-4">
      {view.phase === "done" ? (
        <Notice tone="ok"><strong>{S.change.doneTitle}.</strong> {pc?.status === "applied" ? S.change.appliedBody : pc?.status === "deferred" ? S.change.deferredBody : S.change.coolingBody}</Notice>
      ) : view.phase === "closed" ? (
        <Notice tone={pc?.status === "cancelled" ? "info" : "error"}>{pc?.status === "cancelled" ? S.change.cancelled : S.detail.changeStatus[pc?.status ?? "expired"]}</Notice>
      ) : (
        <OtpPanel view={view} title={S.change.codeTitle} onSubmit={confirm} />
      )}
      {error && <Notice tone="error">{error.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        {canCancel && <button type="button" disabled={cancel.busy} onClick={() => void doCancel()} className={buttonClass.danger}>{cancel.busy ? S.detail.cancelling : S.detail.cancelChange}</button>}
        <button type="button" onClick={onClose} className={buttonClass.secondary}>{finished ? S.common.close : S.common.back}</button>
      </div>
    </div>
  );
}
