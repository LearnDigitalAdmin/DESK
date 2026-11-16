import { useRef, useState } from "react";
import type { DeskCheckRecipientOut } from "../../api/lmmxContract.ts";
import { lmmx } from "../../api/lmmx.ts";
import { useGuard } from "./hooks.ts";
import { accountForSend, recipientFingerprint } from "./logic.ts";
import type { RecipientForm } from "./logic.ts";

export type Dedupe = { state: "none" } | { state: "ask"; accountNumber: string; token: string } | { state: "decided"; token?: string; fingerprint: string };

/**
 * The duplicate check for a landlord account. Shows ONLY the account number and asks the tenant if it is the same landlord.
 * Nothing else about a match (names, contacts, tenants, desks) is ever shown, and a match that is not reusable is silent.
 */
export function useRecipientCheck() {
  const [dedupe, setDedupe] = useState<Dedupe>({ state: "none" });
  const guard = useGuard();
  const form = useRef<RecipientForm | null>(null);
  /** Resolves true when the agent may carry on (no match, or a choice was already made for these exact details). */
  async function check(f: RecipientForm): Promise<boolean> {
    if (dedupe.state === "decided" && dedupe.fingerprint === recipientFingerprint(f)) return true;
    form.current = f;
    const out = await guard.run(() => lmmx.checkRecipient({ channel: f.channel, ...(f.channel === "bank" ? { bankCode: f.bankCode } : {}), accountNumber: accountForSend(f.channel, f.accountNumber), enteredName: f.accountName.trim() }));
    if (!out) return false;
    return afterCheck(out, f);
  }
  function afterCheck(out: DeskCheckRecipientOut, f: RecipientForm): boolean {
    if (out.exists && out.reusable && out.reuseToken) { setDedupe({ state: "ask", accountNumber: out.accountNumber, token: out.reuseToken }); return false; }
    setDedupe({ state: "decided", fingerprint: recipientFingerprint(f) });
    return true;
  }
  /** `same` true sends the reuse token; false ("Not sure") makes a new recipient. */
  function answer(same: boolean) {
    if (dedupe.state !== "ask" || !form.current) return;
    setDedupe({ state: "decided", fingerprint: recipientFingerprint(form.current), ...(same ? { token: dedupe.token } : {}) });
  }
  const reuseToken = dedupe.state === "decided" ? dedupe.token : undefined;
  return { dedupe, check, answer, reuseToken, checking: guard.busy, reset: () => setDedupe({ state: "none" }) };
}

