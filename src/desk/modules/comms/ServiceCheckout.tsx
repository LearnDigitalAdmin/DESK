import { useState, type ReactNode } from "react";
import { deskApi, formatKes, type QuoteServiceOut } from "../../api";
import { Badge, Card, FormField, buttonClass, inputClass } from "../../ui";
import { ActionOtpDialog } from "./lib/access";
import { messageOf } from "./lib/messages";
import { phoneProblem, sanitizePhoneInput, PHONE_MAX_INPUT_LENGTH } from "../../access/phone";
import { useTicketDoc, type TicketLiveView } from "./useTicketDoc";

const isKenyanPhone = (v: string): boolean => phoneProblem(v) === null;

interface Props {
  sessionId: string;
  quote: QuoteServiceOut;
  /** What is being bought, e.g. "Bulk reminder". */
  label: string;
  /** Plain-language summary of what the agent is about to do. */
  details: ReactNode;
  /** Stores the request on the ticket. Runs right before the customer is asked to approve. */
  saveDraft: () => Promise<void>;
  /** Bulk reminders need the customer's approval for exactly this many recipients. */
  otpSummary?: (recipients: number) => string;
  doneText: string;
  /** Shown once the service is done, in place of the plain text (a compliance report shows its download here). */
  doneContent?: (ticket: TicketLiveView) => ReactNode;
  onReset: () => void;
}

/** Review the price, save the draft, get the customer's OTP when the action needs one, charge, then follow the ticket live. */
export function ServiceCheckout({ sessionId, quote, label, details, saveDraft, otpSummary, doneText, doneContent, onReset }: Props) {
  const live = useTicketDoc(quote.ticketId);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpOpen, setOtpOpen] = useState(false);

  if (live.state === "loading") return <p className="py-8 text-center text-sm text-gray-500" role="status">Loading your quote…</p>;
  if (live.state === "error") {
    return (
      <Card>
        <p role="alert" className="break-words text-sm text-red-700">{live.message}</p>
        <button type="button" onClick={onReset} className={`${buttonClass.secondary} mt-3`}>Start again</button>
      </Card>
    );
  }
  const { ticket } = live;

  if (ticket.status !== "draft") return <Tracking status={ticket.status} reason={ticket.failureReason} reference={ticket.paystackRef} doneText={doneText} done={doneContent ? doneContent(ticket) : null} onReset={onReset} />;

  const recipients = ticket.recipients;
  const needsRecipients = otpSummary !== undefined;
  const phoneOk = isKenyanPhone(phone);
  const ready = phoneOk && (!needsRecipients || (recipients !== undefined && recipients > 0));

  async function charge() {
    setBusy(true); setError(null);
    try { await deskApi.chargeTicket({ ticketId: quote.ticketId, phone: phone.trim() }); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  async function begin() {
    setBusy(true); setError(null);
    try { await saveDraft(); }
    catch (e) { setError(messageOf(e)); setBusy(false); return; }
    setBusy(false);
    if (otpSummary) setOtpOpen(true); else await charge();
  }

  return (
    <Card title={`Review: ${label}`}>
      <div className="min-w-0 space-y-4">
        <div className="min-w-0 break-words text-sm text-gray-800">{details}</div>
        {needsRecipients && (
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500">Recipients</dt><dd className="text-right font-semibold text-gray-900">{recipients ?? "…"}</dd>
            <dt className="text-gray-500">Customer SMS credits used</dt><dd className="text-right font-semibold text-gray-900">{ticket.credits ?? "…"}</dd>
          </dl>
        )}
        <ul className="min-w-0 divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
          {quote.breakdown.map((l) => (
            <li key={l.label} className="flex min-w-0 justify-between gap-3 px-3 py-2"><span className="min-w-0 break-words text-gray-700">{l.label}</span><span className="shrink-0 tabular-nums text-gray-900">{formatKes(l.amountMinor)}</span></li>
          ))}
          <li className="flex min-w-0 justify-between gap-3 bg-gray-50 px-3 py-2 font-semibold"><span>You pay</span><span className="tabular-nums">{formatKes(quote.amountMinor)}</span></li>
        </ul>
        <FormField label="Your M-PESA number" htmlFor="checkout-phone" hint="The M-PESA prompt is sent to this number." error={phone && !phoneOk ? phoneProblem(phone) : null}>
          <input id="checkout-phone" inputMode="tel" autoComplete="tel" className={inputClass} value={phone} onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))} maxLength={PHONE_MAX_INPUT_LENGTH} disabled={busy} />
        </FormField>
        {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <button type="button" className={buttonClass.primary} disabled={!ready || busy} onClick={() => void begin()}>
            {busy ? "Please wait…" : otpSummary ? `Get customer approval and pay ${formatKes(quote.amountMinor)}` : `Pay ${formatKes(quote.amountMinor)}`}
          </button>
          <button type="button" className={buttonClass.secondary} disabled={busy} onClick={onReset}>Change details</button>
        </div>
      </div>
      {otpSummary && recipients !== undefined && (
        <ActionOtpDialog
          open={otpOpen} sessionId={sessionId} action="bulk_sms" summary={otpSummary(recipients)}
          onVerified={() => { setOtpOpen(false); void charge(); }} onClose={() => setOtpOpen(false)}
        />
      )}
    </Card>
  );
}

function Tracking({ status, reason, reference, doneText, done, onReset }: {
  status: string; reason?: string; reference?: string; doneText: string; done: ReactNode; onReset: () => void;
}) {
  const view =
    status === "awaiting_payment" ? { tone: "amber" as const, title: "Waiting for your payment", body: "Check your phone for the M-PESA prompt and enter your PIN." }
    : status === "paid" ? { tone: "blue" as const, title: "Payment received", body: "Sending this to the customer's account now…" }
    : status === "committed" ? { tone: "green" as const, title: "Done", body: doneText }
    : status === "expired" ? { tone: "red" as const, title: "This quote expired", body: "Nothing was charged. Start again to get a new quote." }
    : { tone: "red" as const, title: "This could not be completed", body: reason ?? "The customer's account refused the request. Contact the top desk and quote the reference below." };
  const finished = status === "committed" || status === "failed" || status === "expired";
  return (
    <Card>
      <div className="min-w-0 space-y-3" role="status" aria-live="polite">
        <Badge tone={view.tone}>{view.title}</Badge>
        <p className="break-words text-sm text-gray-800">{view.body}</p>
        {status === "committed" && done}
        {reference && <p className="break-all text-xs text-gray-500">Reference: {reference}</p>}
        {finished && <button type="button" className={buttonClass.primary} onClick={onReset}>{status === "committed" ? "Start another" : "Start again"}</button>}
      </div>
    </Card>
  );
}
