import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../services/firebaseService";
import { deskApi } from "../api";
import type { AgentView, NetRoleOption } from "../api";
import { Badge, Card, FormField, Modal, Page, buttonClass, cn, inputClass } from "../ui";
import { DESK_MODULES } from "../core/registry";
import { useAgent } from "../core/useAgent";
import { Spinner } from "../access/gates";
import { errorMessage } from "../access/errors";
import { AGENT_TERMS } from "./terms";
import { JOURNEY, journeyIndex, nextSteps } from "./steps";
import { sanitizePhoneInput, PHONE_MAX_INPUT_LENGTH } from "../access/phone";
import { cleanApplication, validateApplication } from "./validation";
import type { ApplicationErrors, ApplicationFields } from "./validation";
import { constituenciesOf, loadKenya, wardsOf, type KenyaCounty } from "./geo";

const RANK_LABEL: Record<AgentView["rank"], string> = { clerk: "Clerk", senior: "Senior", lead: "Lead", admin: "Admin", internal: "Internal" };
const hasModule = (path: string) => DESK_MODULES.some((m) => m.path === path);

/** The signed-in account's email (the server takes it from the auth token, never from the form). */
function useAccountEmail(): string | null | undefined {
  const [email, setEmail] = useState<string | null | undefined>(() => auth.currentUser?.email ?? undefined);
  useEffect(() => onAuthStateChanged(auth, (u) => setEmail(u ? (u.email ?? null) : null)), []);
  return email;
}

export default function OnboardingScreen() {
  const agent = useAgent();
  return (
    <Page title="Onboarding" subtitle="Become a Samuhia desk agent and see where your application stands.">
      {agent === undefined ? <Spinner /> : agent === null ? <ApplicationForm /> : <StatusView agent={agent} />}
    </Page>
  );
}

// ------------------------------------------------------------------------------------------------ application
function ApplicationForm() {
  const email = useAccountEmail();
  const [f, setF] = useState<ApplicationFields>({ name: "", phone: "", idNumber: "", county: "", constituency: "", ward: "", uplineCode: "", inviteCode: "", role: "" });
  // The two code fields are optional in the type, so read them through this one flag.
  const hasCode = Boolean(f.uplineCode?.trim() || f.inviteCode?.trim());
  const [kenya, setKenya] = useState<KenyaCounty[]>([]);
  const [roles, setRoles] = useState<NetRoleOption[]>([]);
  const [haveCode, setHaveCode] = useState(false);
  useEffect(() => { void loadKenya().then(setKenya).catch(() => setKenya([])); }, []);
  // Which roles this ward can offer (only where the hierarchy already exists). Everyone else is a clerk under Samuhia.
  useEffect(() => {
    setRoles([]);
    if (!f.county || !f.constituency || !f.ward || hasCode) return;
    let live = true;
    deskApi.net.options({ county: f.county, constituency: f.constituency, ward: f.ward }).then((o) => { if (live) setRoles(o.roles.filter((r) => r.available)); }).catch(() => undefined);
    return () => { live = false; };
  }, [f.county, f.constituency, f.ward, hasCode]);
  const [accepted, setAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors: ApplicationErrors = validateApplication(f);
  const set = (k: keyof ApplicationFields) => (ev: { target: { value: string } }) => setF((cur) => ({ ...cur, [k]: ev.target.value }));
  const show = (k: keyof ApplicationFields) => (tried ? errors[k] : undefined) ?? null;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setTried(true); setError(null);
    if (Object.keys(errors).length > 0 || !accepted || !email) return;
    setBusy(true);
    try {
      await deskApi.applyAgent(cleanApplication(f));
      setSent(true); // the live agent record replaces this form as soon as it arrives
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <Card>
        <div className="flex min-w-0 items-center gap-3" role="status">
          <div className="h-6 w-6 shrink-0 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="min-w-0 break-words text-sm text-gray-800">Application sent. Setting up your desk…</p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Apply to become a desk agent">
      <form onSubmit={(ev) => void submit(ev)} className="min-w-0 space-y-4" noValidate>
        <p className="break-words text-sm text-gray-600">
          Desk agents help chamas, schools and landlords set up and run their accounts, and earn from the services they provide.
        </p>

        <FormField label="Sign-in email" htmlFor="ob-email" hint="Taken from your account. Change it later in Account.">
          <input id="ob-email" className={inputClass} value={email ?? ""} readOnly disabled />
        </FormField>
        {email === null && (
          <p role="alert" className="break-words text-sm text-red-600">Your account has no email address, so we cannot create a desk for it. Sign in with an email account.</p>
        )}

        <FormField label="Full name" htmlFor="ob-name" error={show("name")}>
          <input id="ob-name" className={inputClass} value={f.name} onChange={set("name")} autoComplete="name" maxLength={80} />
        </FormField>
        <FormField label="Mobile phone" htmlFor="ob-phone" hint="Safaricom numbers only (07xx or 01xx). We send customer codes, payment alerts and payouts to this number." error={show("phone")}>
          <input id="ob-phone" className={inputClass} value={f.phone} onChange={(e) => set("phone")({ target: { value: sanitizePhoneInput(e.target.value) } })} type="tel" inputMode="tel" autoComplete="tel" maxLength={PHONE_MAX_INPUT_LENGTH} placeholder="0712 345 678" />
        </FormField>
        <FormField label="National ID number" htmlFor="ob-id" hint="Only the last 4 digits are ever shown again." error={show("idNumber")}>
          <input id="ob-id" className={inputClass} value={f.idNumber} onChange={set("idNumber")} inputMode="numeric" autoComplete="off" maxLength={12} />
        </FormField>
        <FormField label="County" htmlFor="ob-county" error={show("county")}>
          <select id="ob-county" className={inputClass} value={f.county} onChange={(e) => setF((c) => ({ ...c, county: e.target.value, constituency: "", ward: "", role: "" }))}>
            <option value="">Choose county</option>{kenya.map((c) => <option key={c.n} value={c.n}>{c.n}</option>)}
          </select>
        </FormField>
        <FormField label="Constituency" htmlFor="ob-const" error={show("constituency")}>
          <select id="ob-const" className={inputClass} value={f.constituency} disabled={!f.county} onChange={(e) => setF((c) => ({ ...c, constituency: e.target.value, ward: "", role: "" }))}>
            <option value="">Choose constituency</option>{constituenciesOf(kenya, f.county).map((k) => <option key={k.n} value={k.n}>{k.n}</option>)}
          </select>
        </FormField>
        <FormField label="Ward" htmlFor="ob-ward" error={show("ward")}>
          <select id="ob-ward" className={inputClass} value={f.ward} disabled={!f.constituency} onChange={(e) => setF((c) => ({ ...c, ward: e.target.value, role: "" }))}>
            <option value="">Choose ward</option>{wardsOf(kenya, f.county, f.constituency).map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </FormField>

        <div className="min-w-0">
          <button type="button" className="text-sm font-medium text-blue-700 underline" onClick={() => setHaveCode((v) => !v)}>{haveCode ? "I do not have a code" : "I have an agent code or an invite code"}</button>
        </div>
        {haveCode && (
          <>
            <FormField label="Agent code (optional)" htmlFor="ob-up" hint="A senior's code makes you a clerk, a lead's a senior, an admin's a lead." error={show("uplineCode")}>
              <input id="ob-up" className={inputClass} value={f.uplineCode ?? ""} onChange={(e) => set("uplineCode")({ target: { value: e.target.value.toUpperCase() } })} placeholder="COG-0123" maxLength={20} autoComplete="off" />
            </FormField>
            <FormField label="Invite code (optional)" htmlFor="ob-inv" hint="From the SMS an agent sent you." error={show("inviteCode")}>
              <input id="ob-inv" className={inputClass} value={f.inviteCode ?? ""} onChange={(e) => set("inviteCode")({ target: { value: e.target.value.toUpperCase() } })} maxLength={12} autoComplete="off" />
            </FormField>
          </>
        )}
        {roles.length > 0 && !hasCode && (
          <FormField label="Join as" htmlFor="ob-role" hint="Your ward already has a team. We place you with the team that has the fewest members. Leave on the default to start as a clerk under Samuhia.">
            <select id="ob-role" className={inputClass} value={f.role ?? ""} onChange={(e) => setF((c) => ({ ...c, role: e.target.value as ApplicationFields["role"] }))}>
              <option value="">Clerk under Samuhia (default)</option>
              {roles.map((r) => <option key={r.role} value={r.role}>{RANK_LABEL[r.role]}{r.slotsLeft !== undefined ? ` (${r.slotsLeft} place${r.slotsLeft === 1 ? "" : "s"} left)` : ""}</option>)}
            </select>
          </FormField>
        )}

        <div className="min-w-0">
          <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={accepted} onChange={(ev) => setAccepted(ev.target.checked)} />
            <span className="min-w-0 break-words text-sm text-gray-800">
              I have read and accept the{" "}
              <button type="button" className="font-medium text-blue-700 underline" onClick={() => setShowTerms(true)}>desk agent terms</button>.
            </span>
          </label>
          {tried && !accepted && <p role="alert" className="mt-1 text-xs text-red-600">You need to accept the terms to apply.</p>}
        </div>

        {error && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button type="submit" className={cn(buttonClass.primary, "w-full sm:w-auto")} disabled={busy || email === null}>
          {busy ? "Sending…" : "Submit application"}
        </button>
      </form>

      <Modal open={showTerms} title="Desk agent terms" onClose={() => setShowTerms(false)}
        footer={<button type="button" className={cn(buttonClass.primary, "w-full")} onClick={() => { setAccepted(true); setShowTerms(false); }}>I accept</button>}>
        <ol className="min-w-0 space-y-3">
          {AGENT_TERMS.map((t, i) => (
            <li key={t.title} className="min-w-0">
              <p className="break-words text-sm font-semibold text-gray-900">{i + 1}. {t.title}</p>
              <p className="mt-0.5 break-words text-sm text-gray-700">{t.body}</p>
            </li>
          ))}
        </ol>
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ status
const STATUS_TONE = { applied: "blue", training: "blue", certified: "blue", active: "green", suspended: "amber", closed: "red" } as const;
const BANNER = {
  blue: "border-blue-200 bg-blue-50 text-blue-950", green: "border-emerald-200 bg-emerald-50 text-emerald-950",
  amber: "border-amber-200 bg-amber-50 text-amber-950", red: "border-red-200 bg-red-50 text-red-950",
} as const;

function StatusView({ agent }: { agent: AgentView }) {
  const idx = journeyIndex(agent.status);
  const next = nextSteps(agent.status);
  const pre = agent.status === "applied" || agent.status === "training" || agent.status === "certified";
  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Your desk code</p>
            <p className="break-all text-2xl font-bold text-gray-900">{agent.agentCode}</p>
            <p className="mt-1 break-words text-sm text-gray-600">{agent.name}</p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Badge tone={STATUS_TONE[agent.status]}>{agent.status}</Badge>
            <Badge tone="gray">{RANK_LABEL[agent.rank]}</Badge>
          </div>
        </div>

        <ol className="mt-5 grid min-w-0 grid-cols-4 gap-1" aria-label="Application progress">
          {JOURNEY.map((s, i) => {
            const done = idx >= 0 && i < idx; const current = i === idx;
            return (
              <li key={s.status} aria-current={current ? "step" : undefined} className="min-w-0 text-center">
                <div className={cn("mx-auto h-2 rounded-full", done || current ? (agent.status === "active" ? "bg-emerald-500" : "bg-blue-600") : "bg-gray-200")} />
                <p className={cn("mt-1.5 truncate text-[11px] sm:text-xs", current ? "font-semibold text-gray-900" : "text-gray-500")}>{s.label}</p>
              </li>
            );
          })}
        </ol>
      </Card>

      <section className={cn("min-w-0 rounded-2xl border p-4 sm:p-5", BANNER[next.tone])} aria-label="Next steps">
        <h2 className="break-words text-base font-semibold">{next.headline}</h2>
        <ul className="mt-2 min-w-0 list-disc space-y-1.5 pl-5 text-sm">
          {next.lines.map((l) => <li key={l} className="break-words">{l}</li>)}
        </ul>
        <div className="mt-4 flex min-w-0 flex-wrap gap-2">
          {pre && hasModule("account") && <Link to="/desk/account" className={buttonClass.primary}>Open Account</Link>}
          {agent.status === "active" && hasModule("access") && <Link to="/desk/access" className={buttonClass.primary}>Go to Access</Link>}
        </div>
      </section>
    </div>
  );
}