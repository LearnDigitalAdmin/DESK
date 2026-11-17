import { useCallback, useEffect, useRef, useState } from "react";
import { DESK_TOP_CODE, deskApi } from "../api";
import { useAgent } from "../core/useAgent";
import type { OtpAction } from "../api";
import { Modal, FormField, buttonClass } from "../ui";
import { OtpInput } from "./OtpInput";
import { actionAlreadyConfirmed } from "./topSession";
import { errorMessage, isTransientError } from "./errors";
import { formatClock } from "./time";
import { useNow } from "./useActiveSession";

const CODE_VALID_MS = 5 * 60_000; // server: 5-minute expiry
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;           // server: at most 5 tries per code

export interface ActionOtpDialogProps {
  open: boolean;
  sessionId: string;
  action: OtpAction;
  /** Must be exactly the contract builder's text (summaryBulkSms / summaryRentStk / summaryExport): the server rejects anything else. */
  summary: string;
  /** Called once with the verified actionId. The caller owns closing the dialog (set `open` to false). */
  onVerified: (actionId: string) => void;
  onClose: () => void;
}

/**
 * Per-action customer OTP. Step 1: the agent sends the code (explicit tap, so no accidental SMS to the customer and no
 * wasted share of the daily OTP allowance). Step 2: the customer reads the code out, the agent enters it.
 */
export function ActionOtpDialog(props: ActionOtpDialogProps) {
  // The top desk (COG-0000) needs no customer code: the server confirms for it, so the dialog confirms by itself.
  const top = useAgent()?.agentCode === DESK_TOP_CODE;
  return (
    <Modal open={props.open} title={top ? "Confirm" : "Confirm with the customer"} onClose={props.onClose}>
      {props.open ? <Body {...props} autoConfirm={top} /> : null}
    </Modal>
  );
}

function Body({ sessionId, action, summary, onVerified, onClose, autoConfirm }: ActionOtpDialogProps & { autoConfirm: boolean }) {
  const [actionId, setActionId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [verified, setVerified] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const now = useNow(500);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const send = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy("send"); setError(null);
    try {
      const out = await deskApi.requestActionOtp({ sessionId, action, summary });
      if (!alive.current) return;
      if (actionAlreadyConfirmed(out)) { setActionId(out.actionId); setVerified(true); onVerified(out.actionId); return; }   // top desk: already confirmed, nothing was sent
      setActionId(out.actionId); setSentAt(Date.now()); setCode(""); setAttempts(0);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }, [sessionId, action, summary, onVerified]);

  const autoRan = useRef(false);
  useEffect(() => { if (autoConfirm && !autoRan.current) { autoRan.current = true; void send(); } }, [autoConfirm, send]);

  const verify = useCallback(async () => {
    if (!actionId || busyRef.current || code.length !== 6) return;
    busyRef.current = true; setBusy("verify"); setError(null);
    try {
      const out = await deskApi.verifyActionOtp({ actionId, otp: code });
      if (!alive.current) return;
      if (!out.ok) { setAttempts((n) => n + 1); setError("That code is not right. Check it with the customer."); return; }
      setVerified(true);
      onVerified(actionId);
    } catch (e) {
      if (!alive.current) return;
      if (!isTransientError(e)) setAttempts((n) => n + 1);
      setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }, [actionId, code, onVerified]);

  const sent = actionId !== null;
  const left = sent ? sentAt + CODE_VALID_MS - now : 0;
  const expired = sent && left <= 0;
  const locked = attempts >= MAX_ATTEMPTS;
  const cooldownLeft = sent ? sentAt + RESEND_COOLDOWN_MS - now : 0;

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 rounded-xl bg-gray-50 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{autoConfirm ? "You are confirming" : "The customer will be asked to approve"}</p>
        <p className="mt-1 break-words text-sm font-semibold text-gray-900">{summary}</p>
      </div>

      {verified ? (
        <div className="min-w-0 space-y-3">
          <p role="status" className="break-words rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">Verified. You can continue.</p>
          <button type="button" className={`${buttonClass.secondary} w-full`} onClick={onClose}>Close</button>
        </div>
      ) : !sent ? (
        <div className="min-w-0 space-y-3">
          <p className="break-words text-sm text-gray-700">
            {autoConfirm && !error ? "Confirming for the top desk. No customer code is needed." : "We will text a 6-digit code to the customer. They should only read it to you if they asked for this."}
          </p>
          {error && <p role="alert" className="break-words text-sm text-red-600">{error}</p>}
          <div className="flex min-w-0 flex-wrap gap-2">
            <button type="button" className={`${buttonClass.primary} flex-1`} disabled={busy === "send"} onClick={() => void send()}>
              {busy === "send" ? "Sending…" : "Send code to customer"}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="min-w-0 space-y-3">
          <FormField label="Code from the customer" htmlFor="action-otp"
            hint={expired ? undefined : `Valid for ${formatClock(left)}`}
            error={error ?? (expired ? "This code has expired. Send a new one." : locked ? "Too many wrong tries. Send a new code." : null)}>
            <OtpInput id="action-otp" value={code} onChange={setCode} onEnter={() => void verify()}
              disabled={busy !== null || expired || locked} invalid={Boolean(error)} />
          </FormField>
          {attempts > 0 && !locked && <p className="text-xs text-gray-500">Try {attempts} of {MAX_ATTEMPTS} used.</p>}
          <div className="flex min-w-0 flex-wrap gap-2">
            <button type="button" className={`${buttonClass.primary} flex-1`} onClick={() => void verify()}
              disabled={busy !== null || code.length !== 6 || expired || locked}>
              {busy === "verify" ? "Checking…" : "Confirm"}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => void send()} disabled={busy !== null || cooldownLeft > 0}>
              {cooldownLeft > 0 ? `Resend in ${Math.ceil(cooldownLeft / 1000)}s` : "Send a new code"}
            </button>
          </div>
          <button type="button" className="text-sm font-medium text-gray-600 underline" onClick={onClose}>Cancel</button>
        </div>
      )}
    </div>
  );
}
