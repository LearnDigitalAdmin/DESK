import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Lock } from "lucide-react";
import { Card, FormField, buttonClass, inputClass } from "../../ui";
import { errorText } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import { useGuard, useNow } from "./hooks.ts";
import { fmtCountdown, normaliseOtp, sanitizeOtpInput, secondsLeft } from "./logic.ts";
import type { OtpView } from "./logic.ts";
import { S } from "./strings.ts";

/**
 * The "Waiting for verification" box, shared by setup and by changes. It only SHOWS state it is given (`view`): the parent polls the
 * server. Typing the code never changes the screen by itself (no optimistic updates): after a try, `onSubmit` must refresh `view`.
 */
export default function OtpPanel({ view, title, subtitle, onSubmit, onResend, extra, refreshing }: {
  view: OtpView;
  title?: string;
  subtitle?: string;
  /** Throws with the server's message on a wrong code; the panel shows it. */
  onSubmit: (otp: string) => Promise<void>;
  /** Omit for changes (a change has no resend). */
  onResend?: () => Promise<void>;
  extra?: React.ReactNode;
  refreshing?: boolean;
}) {
  const now = useNow(view.phase === "waiting");
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = useGuard();
  const resend = useGuard();

  if (view.phase === "done") return <Notice tone="ok"><span className="inline-flex items-center gap-2"><CheckCircle2 size={18} />{S.waiting.doneTitle}</span></Notice>;

  const left = secondsLeft(view.expiresAt, now);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const p = normaliseOtp(text);
    if (!p.ok) { setFieldError(S.waiting.badCode); return; }
    setFieldError(null);
    await submit.run(async () => {
      try { await onSubmit(p.otp); setText(""); } catch (err) { setError(errorText(err)); }
    });
  }
  async function again() {
    if (!onResend) return;
    setError(null);
    await resend.run(async () => { try { await onResend(); setText(""); } catch (err) { setError(errorText(err)); } });
  }

  const resendBlock = onResend && (view.phase === "waiting" || view.phase === "expired") && (
    <div className="space-y-1">
      <button type="button" disabled={!view.canResend || resend.busy} onClick={() => void again()} className={buttonClass.secondary}>{resend.busy ? S.waiting.resending : S.waiting.resend}</button>
      {view.resendsLeft !== undefined && <p className="text-xs text-gray-500">{view.canResend ? S.waiting.resendsLeft(view.resendsLeft) : S.waiting.noResends}</p>}
    </div>
  );

  return (
    <Card title={title ?? S.waiting.title}>
      <div className="min-w-0 space-y-4">
        {view.phase === "waiting" && (
          <>
            <p className="break-words text-sm text-gray-700">{subtitle ?? S.waiting.sub}</p>
            {view.expiresAt !== undefined && <p className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900"><Clock size={18} aria-hidden />{S.waiting.left}: <span className="tabular-nums" aria-live="off">{fmtCountdown(left)}</span></p>}
            <form onSubmit={(e) => void send(e)} className="min-w-0 space-y-3">
              <FormField label={S.waiting.codeLabel} htmlFor="lmm-otp" hint={S.waiting.codeHint} error={fieldError}>
                <input id="lmm-otp" inputMode="text" autoComplete="one-time-code" autoCapitalize="characters" maxLength={8} value={text} disabled={submit.busy}
                  onChange={(e) => { setText(sanitizeOtpInput(e.target.value)); setFieldError(null); }} className={`${inputClass} text-center text-xl font-semibold tracking-widest`} placeholder="LMM4683" />
              </FormField>
              <button type="submit" disabled={!view.canSubmit || submit.busy} className={buttonClass.primary}>{submit.busy ? S.waiting.confirming : S.waiting.confirm}</button>
              {view.attemptsLeft !== undefined && <p className="text-xs text-gray-500">{S.waiting.attempts(view.attemptsLeft)}</p>}
            </form>
            <p className="break-words text-sm text-gray-600">{S.waiting.whatsapp}</p>
            {refreshing && <p className="text-xs text-gray-400" role="status">{S.waiting.refreshing}</p>}
          </>
        )}
        {view.phase === "expired" && (
          <div className="space-y-3"><p className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle size={18} aria-hidden />{S.waiting.expiredTitle}</p><p className="text-sm text-gray-700">{S.waiting.expiredBody}</p></div>
        )}
        {view.phase === "locked" && (
          <div className="space-y-2"><p className="flex items-center gap-2 text-sm font-semibold text-red-800"><Lock size={18} aria-hidden />{S.waiting.lockedTitle}</p><p className="text-sm text-gray-700">{S.waiting.lockedBody}</p></div>
        )}
        {view.phase === "review" && <Notice tone="info"><strong>{S.waiting.reviewTitle}.</strong> {S.waiting.reviewBody}</Notice>}
        {view.phase === "closed" && <Notice tone="error"><strong>{S.waiting.closedTitle}.</strong> {S.waiting.closedBody}</Notice>}
        {view.phase === "blocked" && <Notice tone="info"><strong>{S.waiting.blockedTitle}.</strong> {S.waiting.blockedBody}</Notice>}
        {resendBlock}
        {error && <Notice tone="error">{error}</Notice>}
        {extra}
      </div>
    </Card>
  );
}
