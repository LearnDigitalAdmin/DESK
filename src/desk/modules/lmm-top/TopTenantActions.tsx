import { useEffect, useState } from "react";
import { Card, FormField, buttonClass, inputClass } from "../../ui";
import type { DeskGetTenantOut, TopRevealOut } from "../../api/lmmxContract.ts";
import { LMMX } from "../../api/lmmxContract.ts";
import { lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { DedupePrompt, RecipientFields } from "../lmm/RecipientFields";
import { useRecipientCheck } from "../lmm/useRecipientCheck.ts";
import { Row } from "../lmm/parts";
import { emptyRecipientForm, hasErrors, parseDueDay, parseKes, rentProblem, SHOW_REVEALED_MS, toRecipientInput, validateRecipient } from "../lmm/logic.ts";
import type { Errors, RecipientForm } from "../lmm/logic.ts";
import ReasonModal from "./ReasonModal";
import { deskCodeProblem } from "./logic.ts";
import { T } from "./strings.ts";

type Kind = "freeze" | "unfreeze" | "reassign" | "reveal" | "update";
type Field = keyof TopRevealOut["values"];
const FIELDS: Field[] = ["phone", "id", "landlordContact", "landlordName"];

/** Top-desk controls on one tenant. Revealed values live only in this component's state, are hidden after a few seconds and never stored. */
export default function TopTenantActions({ tenant, reload }: { tenant: DeskGetTenantOut; reload: () => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [ok, setOk] = useState(false);
  const [toDesk, setToDesk] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [revealed, setRevealed] = useState<TopRevealOut["values"] | null>(null);
  const [rent, setRent] = useState(""); const [due, setDue] = useState(""); const [chAcc, setChAcc] = useState(false);
  const [rec, setRec] = useState<RecipientForm>(emptyRecipientForm); const [re, setRe] = useState<Errors<RecipientForm>>({});
  const check = useRecipientCheck();
  const onHold = tenant.frozen || tenant.status === "frozen";

  // Hide revealed values after a while, and when leaving the screen.
  useEffect(() => { if (!revealed) return; const t = setTimeout(() => setRevealed(null), SHOW_REVEALED_MS); return () => clearTimeout(t); }, [revealed]);
  useEffect(() => () => setRevealed(null), []);

  function open(k: Kind) { setOk(false); setKind(k); }
  function closeAll() { setKind(null); setToDesk(""); setFields([]); setRent(""); setDue(""); setChAcc(false); setRec(emptyRecipientForm()); setRe({}); check.reset(); }

  function validate(): string | null {
    if (kind === "reassign") return deskCodeProblem(toDesk);
    if (kind === "reveal") return fields.length ? null : T.tenants.revealPickOne;
    if (kind === "update") {
      if (!rent.trim() && !due.trim() && !chAcc) return T.tenants.nothing;
      if (rent.trim()) { const p = rentProblem(rent); if (p) return p; }
      if (due.trim() && parseDueDay(due) === null) return `Pick a due day from ${LMMX.DUE_DAY_MIN} to ${LMMX.DUE_DAY_MAX}.`;
      if (chAcc) { const e = validateRecipient(rec); setRe(e); if (hasErrors(e)) return "Check the landlord payment details."; }
    }
    return null;
  }
  async function run(reason: string) {
    const id = tenant.tenantId;
    if (kind === "freeze") await lmmx.top.freeze({ scope: "tenant", id, reason });
    else if (kind === "unfreeze") await lmmx.top.unfreeze({ scope: "tenant", id, reason });
    else if (kind === "reassign") await lmmx.top.reassign({ tenantId: id, toDeskCode: toDesk.trim().toUpperCase(), reason });
    else if (kind === "reveal") { const out = await lmmx.top.reveal({ tenantId: id, fields, reason }); setRevealed(out.values); }
    else if (kind === "update") {
      if (chAcc && !(await check.check(rec))) throw new Error("Ask the tenant about the landlord account first, then confirm again.");
      await lmmx.top.updateTenant({ tenantId: id, reason, ...(rent.trim() ? { rentMinor: parseKes(rent) as number } : {}), ...(due.trim() ? { dueDay: parseDueDay(due) as number } : {}), ...(chAcc ? { recipient: toRecipientInput(rec, check.reuseToken) } : {}) });
    }
    setOk(true); closeAll(); reload();
  }
  const titles: Record<Kind, string> = { freeze: T.tenants.freezeTitle, unfreeze: T.tenants.unfreezeTitle, reassign: T.tenants.reassignTitle, reveal: T.tenants.revealTitle, update: T.tenants.updateTitle };

  return (
    <Card title={T.tenants.actions}>
      <div className="min-w-0 space-y-4">
        {ok && <Notice tone="ok">{T.tenants.ok}</Notice>}
        {revealed && (
          <Notice tone="info">
            <strong>{T.tenants.revealed}</strong>
            <dl className="mt-2">{FIELDS.filter((f) => revealed[f]).map((f) => <Row key={f} label={T.tenants.fields[f]}>{revealed[f]}</Row>)}</dl>
            <button type="button" className={`${buttonClass.secondary} mt-2`} onClick={() => setRevealed(null)}>{T.tenants.hideNow}</button>
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          {onHold ? <button type="button" className={buttonClass.secondary} onClick={() => open("unfreeze")}>{T.tenants.unfreeze}</button> : <button type="button" className={buttonClass.danger} onClick={() => open("freeze")}>{T.tenants.freeze}</button>}
          <button type="button" className={buttonClass.secondary} onClick={() => open("reassign")}>{T.tenants.reassign}</button>
          <button type="button" className={buttonClass.secondary} onClick={() => open("reveal")}>{T.tenants.reveal}</button>
          <button type="button" className={buttonClass.secondary} onClick={() => open("update")}>{T.tenants.update}</button>
        </div>
      </div>

      <ReasonModal open={kind !== null} title={kind ? titles[kind] : ""} danger={kind === "freeze"} onClose={closeAll} onConfirm={run} check={validate}>
        {kind === "reassign" && <FormField label={T.tenants.toDesk} htmlFor="ta-desk"><input id="ta-desk" autoComplete="off" value={toDesk} onChange={(e) => setToDesk(e.target.value.toUpperCase().slice(0, 8))} className={inputClass} /></FormField>}
        {kind === "reveal" && (
          <fieldset className="min-w-0 space-y-2"><legend className="mb-1 text-sm font-medium text-gray-800">{T.tenants.revealPick}</legend>
            {FIELDS.map((f) => (
              <label key={f} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={fields.includes(f)} onChange={(e) => setFields(e.target.checked ? [...fields, f] : fields.filter((x) => x !== f))} />{T.tenants.fields[f]}</label>
            ))}
          </fieldset>
        )}
        {kind === "update" && (
          <div className="min-w-0 space-y-4">
            <Notice tone="info">{T.tenants.updateNote}</Notice>
            <FormField label={T.tenants.newRent} htmlFor="ta-rent"><input id="ta-rent" inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value.replace(/[^\d,]/g, "").slice(0, 11))} className={inputClass} /></FormField>
            <FormField label={T.tenants.newDue} htmlFor="ta-due"><input id="ta-due" inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value.replace(/\D/g, "").slice(0, 2))} className={inputClass} /></FormField>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={chAcc} onChange={(e) => setChAcc(e.target.checked)} />{T.tenants.changeAccount}</label>
            {chAcc && <><RecipientFields value={rec} onChange={(v) => { setRec(v); check.reset(); }} errors={re} /><DedupePrompt dedupe={check.dedupe} onAnswer={(same) => check.answer(same)} /></>}
          </div>
        )}
      </ReasonModal>
    </Card>
  );
}
