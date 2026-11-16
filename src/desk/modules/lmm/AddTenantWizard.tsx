import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, FormField, buttonClass, inputClass } from "../../ui";
import { LMMX, kes } from "../../api/lmmxContract.ts";
import type { DeskPreviewOut, Frequency, IdType } from "../../api/lmmxContract.ts";
import { FREQUENCIES } from "../../api/lmmxContract.ts";
import { errorText, lmmx, lmmxCodeOf } from "../../api/lmmx.ts";
import { sanitizePhoneInput } from "../../access/phone.ts";
import Notice from "../top/Notice";
import { DedupePrompt, RecipientFields } from "./RecipientFields";
import { useRecipientCheck } from "./useRecipientCheck.ts";
import { EarningsTableView, ProjectionView, Row } from "./parts";
import { useDebounced, useGuard, useIdempotencyKey } from "./hooks.ts";
import {
  LMM_BASE, PAYOUT_SETUP_PATH, emptyRecipientForm, emptyRentForm, emptyTenantForm, fallbackPreview, hasErrors, parseDueDay, parseKes,
  rentProblem, toProfileInput, toRecipientInput, validateRecipient, validateRent, validateTenant,
} from "./logic.ts";
import type { Errors, RecipientForm, RentForm, TenantForm } from "./logic.ts";
import { S } from "./strings.ts";

const ID_TYPES: IdType[] = ["national_id", "alien_id", "passport"];

export default function AddTenantWizard() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [tenant, setTenant] = useState<TenantForm>(emptyTenantForm);
  const [rec, setRec] = useState<RecipientForm>(emptyRecipientForm);
  const [rent, setRent] = useState<RentForm>(emptyRentForm);
  const [te, setTe] = useState<Errors<TenantForm>>({});
  const [re, setRe] = useState<Errors<RecipientForm>>({});
  const [rte, setRte] = useState<Errors<RentForm>>({});
  const [error, setError] = useState<{ text: string; notReady: boolean } | null>(null);
  const [review, setReview] = useState(false);
  const check = useRecipientCheck();
  const submit = useGuard();
  const idem = useIdempotencyKey();

  function goBack() { setError(null); idem.renew(); setStep((s) => Math.max(0, s - 1)); }

  function next0() { const e = validateTenant(tenant); setTe(e); if (!hasErrors(e)) setStep(1); }
  async function next1() {
    const e = validateRecipient(rec); setRe(e);
    if (hasErrors(e)) return;
    setError(null);
    try { if (await check.check(rec)) setStep(2); } catch (err) { setError({ text: errorText(err), notReady: false }); }
  }
  function next2() { const e = validateRent(rent); setRte(e); if (!hasErrors(e)) setStep(3); }
  function answerDedupe(same: boolean) { check.answer(same); setStep(2); }

  async function send() {
    const rentMinor = parseKes(rent.rentKes), dueDay = parseDueDay(rent.dueDay);
    if (rentMinor === null || dueDay === null) return;
    setError(null);
    await submit.run(async () => {
      try {
        const out = await lmmx.createTenant({ profile: toProfileInput(tenant), rentMinor, dueDay, frequency: rent.frequency, recipient: toRecipientInput(rec, check.reuseToken), idempotencyKey: idem.key });
        if (out.needsReview || out.status === "draft") setReview(true);
        else nav(`${LMM_BASE}/waiting/${out.tenantId}`, { replace: true });
      } catch (err) { setError({ text: errorText(err), notReady: lmmxCodeOf(err) === "LMMX_E_DESK_NOT_READY" }); }
    });
  }

  if (review) {
    return (
      <Card title={S.wizard.needsReviewTitle}>
        <div className="space-y-4"><Notice tone="info">{S.wizard.needsReviewBody}</Notice>
          <div className="flex flex-wrap gap-2"><Link to={LMM_BASE} className={buttonClass.primary}>{S.wizard.goTenants}</Link></div></div>
      </Card>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <ol className="flex min-w-0 flex-wrap gap-2 text-xs" aria-label={S.wizard.title}>
        {S.wizard.steps.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={`rounded-full px-3 py-1 font-medium ${i === step ? "bg-blue-600 text-white" : i < step ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>{i + 1}. {label}</li>
        ))}
      </ol>
      {error && (
        <Notice tone="error">
          {error.text}
          {error.notReady && <span className="mt-2 block"><strong>{S.wizard.notReadyTitle}.</strong> {S.wizard.notReadyBody}{" "}<Link to={PAYOUT_SETUP_PATH} className="font-semibold underline">{S.wizard.notReadyLink}</Link></span>}
        </Notice>
      )}

      {step === 0 && (
        <Card title={S.wizard.steps[0]}>
          <div className="min-w-0 space-y-4">
            <FormField label={S.wizard.fullName} htmlFor="w-name" error={te.fullName}><input id="w-name" autoComplete="off" value={tenant.fullName} onChange={(e) => setTenant({ ...tenant, fullName: e.target.value.slice(0, 80) })} className={inputClass} /></FormField>
            <FormField label={S.wizard.phone} htmlFor="w-phone" hint={S.wizard.phoneHint} error={te.phone}><input id="w-phone" type="tel" inputMode="tel" autoComplete="off" value={tenant.phone} onChange={(e) => setTenant({ ...tenant, phone: sanitizePhoneInput(e.target.value) })} className={inputClass} /></FormField>
            <FormField label={S.wizard.idType} htmlFor="w-idtype"><select id="w-idtype" value={tenant.idType} onChange={(e) => setTenant({ ...tenant, idType: e.target.value as IdType })} className={inputClass}>{ID_TYPES.map((t) => <option key={t} value={t}>{S.idType[t]}</option>)}</select></FormField>
            <FormField label={S.wizard.idNumber} htmlFor="w-id" error={te.idNumber}><input id="w-id" autoComplete="off" inputMode={tenant.idType === "passport" ? "text" : "numeric"} value={tenant.idNumber} onChange={(e) => setTenant({ ...tenant, idNumber: e.target.value.replace(/\s+/g, "").slice(0, 9) })} className={inputClass} /></FormField>
            <FormField label={S.wizard.email} htmlFor="w-email" error={te.email}><input id="w-email" type="email" autoComplete="off" value={tenant.email} onChange={(e) => setTenant({ ...tenant, email: e.target.value.slice(0, 120) })} className={inputClass} /></FormField>
            <FormField label={S.wizard.unit} htmlFor="w-unit" error={te.unitNumber}><input id="w-unit" autoComplete="off" value={tenant.unitNumber} onChange={(e) => setTenant({ ...tenant, unitNumber: e.target.value.slice(0, 30) })} className={inputClass} /></FormField>
            <FormField label={S.wizard.property} htmlFor="w-prop" error={te.propertyName}><input id="w-prop" autoComplete="off" value={tenant.propertyName} onChange={(e) => setTenant({ ...tenant, propertyName: e.target.value.slice(0, 80) })} className={inputClass} /></FormField>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={next0} className={buttonClass.primary}>{S.common.next}</button></div>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title={S.wizard.steps[1]}>
          <div className="min-w-0 space-y-4">
            <RecipientFields value={rec} onChange={(v) => { setRec(v); check.reset(); }} errors={re} disabled={check.checking || check.dedupe.state === "ask"} />
            <DedupePrompt dedupe={check.dedupe} onAnswer={answerDedupe} />
            {check.dedupe.state !== "ask" && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={goBack} className={buttonClass.secondary}>{S.common.back}</button>
                <button type="button" disabled={check.checking} onClick={() => void next1()} className={buttonClass.primary}>{check.checking ? S.wizard.checking : S.common.next}</button>
              </div>
            )}
          </div>
        </Card>
      )}

      {step === 2 && (
        <>
          <Card title={S.wizard.steps[2]}>
            <div className="min-w-0 space-y-4">
              <FormField label={S.wizard.rent} htmlFor="w-rent" hint={S.wizard.rentHint} error={rte.rentKes}><input id="w-rent" inputMode="numeric" autoComplete="off" value={rent.rentKes} onChange={(e) => setRent({ ...rent, rentKes: e.target.value.replace(/[^\d,]/g, "").slice(0, 11) })} className={inputClass} /></FormField>
              <FormField label={S.wizard.dueDay} htmlFor="w-due" hint={S.wizard.dueDayHint} error={rte.dueDay}>
                <select id="w-due" value={rent.dueDay} onChange={(e) => setRent({ ...rent, dueDay: e.target.value })} className={inputClass}>
                  {Array.from({ length: LMMX.DUE_DAY_MAX }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </FormField>
              <FormField label={S.wizard.frequency} htmlFor="w-freq"><select id="w-freq" value={rent.frequency} onChange={(e) => setRent({ ...rent, frequency: e.target.value as Frequency })} className={inputClass}>{FREQUENCIES.map((f) => <option key={f} value={f}>{S.freq[f]}</option>)}</select></FormField>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={goBack} className={buttonClass.secondary}>{S.common.back}</button>
                <button type="button" onClick={next2} className={buttonClass.primary}>{S.common.next}</button>
              </div>
            </div>
          </Card>
          <Preview rentKes={rent.rentKes} channel={rec.channel} />
        </>
      )}

      {step === 3 && (
        <Card title={S.wizard.reviewTitle}>
          <div className="min-w-0 space-y-4">
            <dl>
              <Row label={S.wizard.fullName}>{tenant.fullName.trim()}</Row>
              <Row label={S.wizard.phone}>{tenant.phone.trim()}</Row>
              <Row label={S.wizard.idType}>{S.idType[tenant.idType]} {tenant.idNumber}</Row>
              <Row label={S.wizard.channel}>{S.channel[rec.channel]}</Row>
              <Row label={S.wizard.account}>{rec.accountNumber.trim()}</Row>
              <Row label={S.wizard.accountName}>{rec.accountName.trim()}</Row>
              <Row label={S.wizard.contactName}>{rec.contactName.trim()} · {rec.contactPhone.trim()}</Row>
              <Row label={S.wizard.rent}>{kes((parseKes(rent.rentKes) ?? 0))}</Row>
              <Row label={S.wizard.dueDay}>{rent.dueDay}</Row>
              <Row label={S.wizard.frequency}>{S.freq[rent.frequency]}</Row>
              {check.reuseToken && <Row label={S.wizard.dedupeTitle}>{S.common.yes}</Row>}
            </dl>
            <p className="break-words text-sm text-gray-600">{S.wizard.sendHelp}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={goBack} disabled={submit.busy} className={buttonClass.secondary}>{S.common.back}</button>
              <button type="button" onClick={() => void send()} disabled={submit.busy} className={buttonClass.primary}>{submit.busy ? S.wizard.sending : S.wizard.send}</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Live "what the desk earns" from the server, falling back to the contract helpers (an estimate) if the call fails. */
function Preview({ rentKes, channel }: { rentKes: string; channel: RecipientForm["channel"] }) {
  const debounced = useDebounced(rentKes, 400);
  const rentMinor = useMemo(() => (rentProblem(debounced) ? null : parseKes(debounced)), [debounced]);
  const [state, setState] = useState<{ key: string; data: DeskPreviewOut; offline: boolean } | null>(null);
  const key = `${rentMinor}|${channel}`;
  useEffect(() => {
    if (rentMinor === null) return;
    let alive = true;
    lmmx.preview({ rentMinor, channel }).then(
      (data) => { if (alive) setState({ key, data, offline: false }); },
      () => { if (alive) setState({ key, data: fallbackPreview(rentMinor, channel), offline: true }); },
    );
    return () => { alive = false; };
  }, [rentMinor, channel, key]);
  if (rentMinor === null) return null;
  const ready = state && state.key === key ? state : null;
  return (
    <Card title={S.wizard.previewTitle}>
      {!ready ? <p className="text-sm text-gray-500" role="status">{S.wizard.previewLoading}</p> : (
        <div className="min-w-0 space-y-4">
          <EarningsTableView rows={ready.data.table} />
          <h3 className="text-sm font-semibold text-gray-800">{S.wizard.monthTitle}</h3>
          <ProjectionView rows={ready.data.projection} />
          {ready.offline && <p className="text-xs text-gray-500">{S.wizard.previewOffline}</p>}
        </div>
      )}
    </Card>
  );
}
