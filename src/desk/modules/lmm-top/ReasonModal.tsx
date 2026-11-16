import { useState } from "react";
import type { ReactNode } from "react";
import { FormField, Modal, buttonClass, inputClass } from "../../ui";
import { errorText } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { useGuard } from "../lmm/hooks.ts";
import { useTopGuard } from "./TopContext";
import { validateTopReason } from "./logic.ts";
import { T } from "./strings.ts";

/**
 * Every top-desk change asks for a written reason (at least 10 characters) here. `onConfirm` gets the cleaned reason and does the call;
 * the call runs through the re-login guard (retry once). `check` can veto first (extra fields). Nothing is optimistic: the dialog stays
 * open, with the server's words, until the server says yes.
 */
export default function ReasonModal({ open, title, confirmLabel, danger, onClose, onConfirm, check, children }: {
  open: boolean; title: string; confirmLabel?: string; danger?: boolean; onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  /** Return an error text to stop before sending, or null to go on. */
  check?: () => string | null;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guarded = useTopGuard();
  const g = useGuard();

  function close() { if (g.busy) return; setReason(""); setFieldError(null); setError(null); onClose(); }
  async function go() {
    setError(null);
    const extra = check?.() ?? null;
    if (extra) { setError(extra); return; }
    const r = validateTopReason(reason);
    if (!r.ok) { setFieldError(r.error); return; }
    setFieldError(null);
    await g.run(async () => {
      try { await guarded(() => onConfirm(r.value)); setReason(""); onClose(); }
      catch (e) { setError(errorText(e)); }
    });
  }

  return (
    <Modal open={open} title={title} onClose={close}
      footer={<><button type="button" className={buttonClass.secondary} disabled={g.busy} onClick={close}>{T.reason.cancel}</button>
        <button type="button" className={danger ? buttonClass.danger : buttonClass.primary} disabled={g.busy} onClick={() => void go()}>{g.busy ? T.reason.working : (confirmLabel ?? T.reason.confirm)}</button></>}>
      <div className="min-w-0 space-y-4">
        {children}
        <FormField label={T.reason.label} htmlFor="top-reason" hint={T.reason.hint} error={fieldError}>
          <textarea id="top-reason" rows={3} maxLength={500} value={reason} disabled={g.busy} onChange={(e) => { setReason(e.target.value); setFieldError(null); }} className={`${inputClass} h-auto py-2`} />
        </FormField>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
