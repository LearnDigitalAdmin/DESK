import { useEffect, useState } from "react";
import { FormField, buttonClass, inputClass } from "../../ui";
import { CHANNELS } from "../../api/lmmxContract.ts";
import type { Channel } from "../../api/lmmxContract.ts";
import { listBanks } from "../../api/lmmx.ts";
import type { Bank } from "../../api/lmmx.ts";
import { sanitizePhoneInput } from "../../access/phone.ts";
import Notice from "../top/Notice";
import type { Dedupe } from "./useRecipientCheck.ts";
import type { Errors, RecipientForm } from "./logic.ts";
import { S } from "./strings.ts";

/** The landlord payment fields (channel, bank, account, registered name, contact). Used by the wizard, the change form and the top-desk update. */
export function RecipientFields({ value, onChange, errors, disabled }: { value: RecipientForm; onChange: (v: RecipientForm) => void; errors: Errors<RecipientForm>; disabled?: boolean }) {
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (value.channel !== "bank" || banks) return;
    let alive = true;
    listBanks().then((b) => { if (alive) { setBanks(b); setBankError(null); } }, () => { if (alive) setBankError(S.wizard.banksFailed); });
    return () => { alive = false; };
  }, [value.channel, banks, tries]);
  const set = (p: Partial<RecipientForm>) => onChange({ ...value, ...p });
  const accountLabel = value.channel === "phone" ? S.wizard.accountPhone : value.channel === "till" ? S.wizard.accountTill : S.wizard.accountBank;
  return (
    <div className="min-w-0 space-y-4">
      <FormField label={S.wizard.channel} htmlFor="rf-channel">
        <select id="rf-channel" value={value.channel} disabled={disabled} onChange={(e) => set({ channel: e.target.value as Channel, bankCode: "", accountNumber: "" })} className={inputClass}>
          {CHANNELS.map((c) => <option key={c} value={c}>{S.channel[c]}</option>)}
        </select>
      </FormField>
      {value.channel === "bank" && (
        <FormField label={S.wizard.bank} htmlFor="rf-bank" error={errors.bankCode ?? bankError}>
          <select id="rf-bank" value={value.bankCode} disabled={disabled || !banks} onChange={(e) => set({ bankCode: e.target.value })} className={inputClass}>
            <option value="">{banks ? S.wizard.bankPick : S.wizard.banksLoading}</option>
            {banks?.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
          {bankError && <button type="button" className={`${buttonClass.secondary} mt-2`} onClick={() => setTries((n) => n + 1)}>{S.common.retry}</button>}
        </FormField>
      )}
      <FormField label={accountLabel} htmlFor="rf-account" error={errors.accountNumber}>
        <input id="rf-account" inputMode={value.channel === "bank" ? "text" : "numeric"} autoComplete="off" value={value.accountNumber} disabled={disabled}
          onChange={(e) => set({ accountNumber: value.channel === "phone" ? sanitizePhoneInput(e.target.value) : e.target.value.slice(0, 30) })} className={inputClass} />
      </FormField>
      <FormField label={S.wizard.accountName} htmlFor="rf-name" hint={S.wizard.accountNameHint} error={errors.accountName}>
        <input id="rf-name" autoComplete="off" value={value.accountName} disabled={disabled} onChange={(e) => set({ accountName: e.target.value.slice(0, 80) })} className={inputClass} />
      </FormField>
      <FormField label={S.wizard.contactName} htmlFor="rf-cname" error={errors.contactName}>
        <input id="rf-cname" autoComplete="off" value={value.contactName} disabled={disabled} onChange={(e) => set({ contactName: e.target.value.slice(0, 80) })} className={inputClass} />
      </FormField>
      <FormField label={S.wizard.contactPhone} htmlFor="rf-cphone" hint={S.wizard.contactHint} error={errors.contactPhone}>
        <input id="rf-cphone" type="tel" inputMode="tel" autoComplete="off" value={value.contactPhone} disabled={disabled} onChange={(e) => set({ contactPhone: sanitizePhoneInput(e.target.value) })} className={inputClass} />
      </FormField>
    </div>
  );
}

export function DedupePrompt({ dedupe, onAnswer }: { dedupe: Dedupe; onAnswer: (same: boolean) => void }) {
  if (dedupe.state !== "ask") return null;
  return (
    <Notice tone="info">
      <span className="block font-semibold">{S.wizard.dedupeTitle}</span>
      <span className="mt-1 block">{S.wizard.dedupeAccount}: <strong className="break-all">{dedupe.accountNumber}</strong></span>
      <span className="mt-2 block">{S.wizard.dedupeAsk}</span>
      <span className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass.primary} onClick={() => onAnswer(true)}>{S.wizard.dedupeYes}</button>
        <button type="button" className={buttonClass.secondary} onClick={() => onAnswer(false)}>{S.wizard.dedupeNo}</button>
      </span>
    </Notice>
  );
}
