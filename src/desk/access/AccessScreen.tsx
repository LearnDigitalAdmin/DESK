import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { deskApi } from "../api";
import type { AgentView, ResolveEntityOut, Scope } from "../api";
import { watchSession } from "../api/watch";
import { Badge, Card, FormField, Page, buttonClass, inputClass } from "../ui";
import { DESK_MODULES } from "../core/registry";
import { AgentGate } from "./gates";
import { OtpInput } from "./OtpInput";
import { errorMessage, isTransientError } from "./errors";
import { PRODUCT_LABEL, SCOPE_HELP, SCOPE_LABEL, scopesForProduct, splitEntityKey } from "./scopes";
import { clearStoredSession, setStoredSession } from "./sessionStore";
import { openedSession } from "./topSession";
import type { StoredSession } from "./sessionStore";
import { formatClock } from "./time";
import { useActiveSessionDetail, useNow } from "./useActiveSession";

const CODE_SHAPE = /^[A-Za-z0-9-]{3,40}$/;
const OTP_VALID_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

export default function AccessScreen() {
  return (
    <Page title="Access" subtitle="Open a customer's account, with their permission, to help them.">
      <AgentGate>{(agent) => <AccessBody agent={agent} />}</AgentGate>
    </Page>
  );
}

function AccessBody({ agent }: { agent: AgentView }) {
  const session = useActiveSessionDetail();
  return session ? <ActiveSession session={session} /> : <OpenSession agent={agent} />;
}

// ---------------------------------------------------------------------------------------------- active session
const TOOL_FOR_SCOPE: Partial<Record<Scope, string>> = {
  import: "import", manual_entry: "manual", schedule: "comms", bulk_sms: "comms", report: "reports", export: "reports", rent_stk: "rent",
};

function ActiveSession({ session }: { session: StoredSession }) {
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = session.expiresAt - now;
  const parts = splitEntityKey(session.entityKey);

  const end = async () => {
    setBusy(true); setError(null);
    try {
      await deskApi.endSession({ sessionId: session.sessionId });
      clearStoredSession(session.sessionId);
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  const tools = Array.from(new Set(session.scopes.map((s) => TOOL_FOR_SCOPE[s]).filter((p): p is string => Boolean(p))))
    .map((p) => DESK_MODULES.find((m) => m.path === p)).filter((m) => m !== undefined);

  return (
    <div className="min-w-0 space-y-4">
      <section aria-label="Active session" className="min-w-0 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Session open</p>
            <h2 className="mt-1 break-words text-lg font-bold text-emerald-950">{session.displayName}</h2>
            <p className="break-all text-sm text-emerald-900">
              {parts ? `${PRODUCT_LABEL[parts.product]} · ${parts.code}` : session.entityKey}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-emerald-800">Time left</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-950" aria-live="off">{formatClock(left)}</p>
          </div>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
          {session.scopes.map((s) => <Badge key={s} tone="green">{SCOPE_LABEL[s]}</Badge>)}
        </div>
        {error && <p role="alert" className="mt-3 break-words text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex min-w-0 flex-wrap gap-2">
          <button type="button" className={buttonClass.danger} onClick={() => void end()} disabled={busy}>
            {busy ? "Ending…" : "End session"}
          </button>
          {error && (
            <button type="button" className={buttonClass.secondary} onClick={() => clearStoredSession(session.sessionId)}>
              Forget it on this device
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-emerald-900">Sessions last 60 minutes. End it as soon as you are done helping.</p>
      </section>

      {tools.length > 0 && (
        <Card title="What you can do now">
          <ul className="grid min-w-0 grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            {tools.map((m) => (
              <li key={m.path} className="min-w-0">
                <Link to={`/desk/${m.path}`} className="flex min-w-0 items-start gap-3 rounded-xl border border-gray-200 p-3 hover:border-blue-300">
                  <m.icon size={20} className="mt-0.5 shrink-0 text-blue-600" />
                  <span className="min-w-0"><span className="block break-words text-sm font-semibold text-gray-900">{m.label}</span>
                    <span className="block break-words text-xs text-gray-600">{m.description}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- open a session
interface Pending { sessionId: string; otpSentTo: string; sentAt: number; scopes: Scope[] }

function OpenSession({ agent }: { agent: AgentView }) {
  const [code, setCode] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [entity, setEntity] = useState<ResolveEntityOut | null>(null);
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  // A code that was never verified must not linger on the server when the agent leaves this screen.
  useEffect(() => () => {
    const p = pendingRef.current;
    if (p) void deskApi.endSession({ sessionId: p.sessionId }).catch(() => undefined);
  }, []);

  const lookup = async (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (!CODE_SHAPE.test(c)) { setLookupError("Enter the customer's code, for example SMC-0042."); return; }
    setLookupBusy(true); setLookupError(null);
    try {
      const out = await deskApi.resolveEntity({ code: c });
      setEntity(out);
      const allowed = scopesForProduct(out.product);
      setScopes((cur) => { const kept = cur.filter((s) => allowed.includes(s)); return kept.length ? kept : ["read"]; });
    } catch (e) {
      setEntity(null); setLookupError(errorMessage(e));
    } finally { setLookupBusy(false); }
  };
  const onLookup = (ev: FormEvent) => { ev.preventDefault(); void lookup(code); };

  const toggle = (s: Scope) => setScopes((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]);

  const request = async (e: ResolveEntityOut, chosen: Scope[], previous: Pending | null) => {
    setRequestBusy(true); setRequestError(null);
    try {
      const out = await deskApi.requestAccess({ entityKey: e.entityKey, scopes: chosen });
      const open = openedSession(out, e, chosen);
      if (open) {
        // The top desk (COG-0000) needs no customer code: the server opened the session already.
        if (previous) void deskApi.endSession({ sessionId: previous.sessionId }).catch(() => undefined);
        setStoredSession(open);
        return;
      }
      setPending({ sessionId: out.sessionId, otpSentTo: out.otpSentTo, sentAt: Date.now(), scopes: chosen });
      if (previous) void deskApi.endSession({ sessionId: previous.sessionId }).catch(() => undefined);
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally { setRequestBusy(false); }
  };

  const cancelPending = () => {
    const p = pending;
    setPending(null); setRequestError(null);
    if (p) void deskApi.endSession({ sessionId: p.sessionId }).catch(() => undefined);
  };

  const onVerified = useCallback((expiresAt: number) => {
    const p = pendingRef.current;
    if (!p || !entity) return;
    // Clear the ref FIRST: storing the session unmounts this screen, and the unmount cleanup must not end a live session.
    pendingRef.current = null;
    setStoredSession({ sessionId: p.sessionId, entityKey: entity.entityKey, displayName: entity.displayName, scopes: p.scopes, expiresAt });
    setPending(null);
  }, [entity]);

  const handleDead = useCallback((message: string) => { pendingRef.current = null; setPending(null); setRequestError(message); }, []);

  if (entity && pending) {
    return (
      <OtpStep entity={entity} pending={pending} error={requestError} resending={requestBusy}
        onResend={() => void request(entity, pending.scopes, pending)} onCancel={cancelPending}
        onVerified={onVerified} onDead={handleDead} />
    );
  }

  const options = entity ? scopesForProduct(entity.product) : [];
  return (
    <div className="min-w-0 space-y-4">
      <Card title="1. Find the customer">
        <form onSubmit={onLookup} className="min-w-0 space-y-3" noValidate>
          <FormField label="Customer code" htmlFor="entity-code" hint="MyChama: SMC-0042 · Plot Yangu: PYL-0007 · MyRegister: the school's KNEC code" error={lookupError}>
            <input id="entity-code" className={inputClass} value={code} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              onChange={(ev) => { setCode(ev.target.value.toUpperCase()); setEntity(null); setLookupError(null); setRequestError(null); }}
              placeholder="SMC-0042" maxLength={40} />
          </FormField>
          <button type="submit" className={`${buttonClass.primary} w-full sm:w-auto`} disabled={lookupBusy || code.trim().length === 0}>
            {lookupBusy ? "Looking…" : "Find customer"}
          </button>
        </form>
      </Card>

      {entity && (
        <Card title="2. Choose what you will help with">
          <div className="min-w-0 space-y-4">
            <div className="min-w-0">
              <p className="break-words text-base font-semibold text-gray-900">{entity.displayName}</p>
              <p className="break-words text-sm text-gray-600">{PRODUCT_LABEL[entity.product]} · admin phone {entity.adminPhoneMasked}</p>
            </div>

            {!entity.agentHasGrant ? (
              <div className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="break-words font-medium">Your desk is not authorised on this account yet.</p>
                <p className="mt-1 break-words">
                  Ask the customer to add your desk code <span className="font-bold">{agent.agentCode}</span> under Settings → Support Agents, then check again.
                </p>
                <button type="button" className={`${buttonClass.secondary} mt-3`} disabled={lookupBusy} onClick={() => void lookup(entity.entityKey.split(":").slice(1).join(":"))}>
                  {lookupBusy ? "Checking…" : "Check again"}
                </button>
              </div>
            ) : (
              <>
                <fieldset className="min-w-0">
                  <legend className="mb-2 text-sm font-medium text-gray-800">Tick only what the customer asked for</legend>
                  <div className="grid min-w-0 grid-cols-1 gap-2 min-[560px]:grid-cols-2">
                    {options.map((s) => (
                      <label key={s} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={scopes.includes(s)} onChange={() => toggle(s)} />
                        <span className="min-w-0"><span className="block break-words text-sm font-medium text-gray-900">{SCOPE_LABEL[s]}</span>
                          <span className="block break-words text-xs text-gray-600">{SCOPE_HELP[s]}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {requestError && <p role="alert" className="break-words text-sm text-red-600">{requestError}</p>}
                <p className="break-words text-xs text-gray-500">We will text a 6-digit code to the account admin. They read it to you only if they want your help.</p>
                <button type="button" className={`${buttonClass.primary} w-full sm:w-auto`} disabled={requestBusy || scopes.length === 0}
                  onClick={() => void request(entity, scopes, null)}>
                  {requestBusy ? "Sending code…" : "Request access"}
                </button>
              </>
            )}
          </div>
        </Card>
      )}
      {!entity && requestError && <p role="alert" className="break-words text-sm text-red-600">{requestError}</p>}
    </div>
  );
}

function OtpStep({ entity, pending, error, resending, onResend, onCancel, onVerified, onDead }: {
  entity: ResolveEntityOut; pending: Pending; error: string | null; resending: boolean;
  onResend: () => void; onCancel: () => void; onVerified: (expiresAt: number) => void; onDead: (message: string) => void;
}) {
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const now = useNow(500);
  const busyRef = useRef(false);

  const sessionId = pending.sessionId;
  // New code (resend) -> fresh attempts.
  useEffect(() => { setOtp(""); setAttempts(0); setVerifyError(null); }, [sessionId]);

  // The server ends a session after 5 wrong tries or when the code lapses.
  useEffect(() => watchSession(sessionId, (s) => {
    if (s && (s.status === "ended" || s.status === "expired")) onDead("That code is no longer valid. Request access again to get a new one.");
  }), [sessionId, onDead]);

  const left = pending.sentAt + OTP_VALID_MS - now;
  const expired = left <= 0;
  const locked = attempts >= MAX_ATTEMPTS;
  const cooldown = pending.sentAt + RESEND_COOLDOWN_MS - now;

  const verify = async () => {
    if (busyRef.current || otp.length !== 6) return;
    busyRef.current = true; setBusy(true); setVerifyError(null);
    try {
      const out = await deskApi.verifyAccess({ sessionId, otp });
      onVerified(out.expiresAt);
    } catch (e) {
      if (!isTransientError(e)) setAttempts((n) => n + 1);
      setVerifyError(errorMessage(e));
    } finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <Card title="3. Enter the customer's code">
      <div className="min-w-0 space-y-4">
        <p className="break-words text-sm text-gray-700">
          We sent a 6-digit code to <span className="font-semibold">{pending.otpSentTo}</span>, the admin of {entity.displayName}. Ask them to read it to you.
        </p>
        <FormField label="6-digit code" htmlFor="access-otp" hint={expired ? undefined : `Valid for ${formatClock(left)}`}
          error={verifyError ?? error ?? (expired ? "This code has expired. Send a new one." : locked ? "Too many wrong tries. Send a new code." : null)}>
          <OtpInput id="access-otp" value={otp} onChange={setOtp} onEnter={() => void verify()} disabled={busy || expired || locked} invalid={Boolean(verifyError)} />
        </FormField>
        {attempts > 0 && !locked && <p className="text-xs text-gray-500">Try {attempts} of {MAX_ATTEMPTS} used.</p>}
        <div className="flex min-w-0 flex-wrap gap-2">
          <button type="button" className={`${buttonClass.primary} flex-1`} disabled={busy || otp.length !== 6 || expired || locked} onClick={() => void verify()}>
            {busy ? "Checking…" : "Open session"}
          </button>
          <button type="button" className={buttonClass.secondary} disabled={resending || busy || cooldown > 0} onClick={onResend}>
            {resending ? "Sending…" : cooldown > 0 ? `Resend in ${Math.ceil(cooldown / 1000)}s` : "Send a new code"}
          </button>
        </div>
        <p className="text-xs text-gray-500">You can ask for up to 3 codes per customer each hour.</p>
        <button type="button" className="text-sm font-medium text-gray-600 underline" onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  );
}
