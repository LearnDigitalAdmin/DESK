import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Page, buttonClass } from "../../ui";
import type { DeskSetupStatusOut } from "../../api/lmmxContract.ts";
import { errorText, lmmx } from "../../api/lmmx.ts";
import Notice from "../top/Notice";
import OtpPanel from "./OtpPanel";
import { Spinner } from "./parts";
import { useNow, usePoll } from "./hooks.ts";
import { LMM_BASE, POLL_MS, deriveSetupView } from "./logic.ts";
import { S } from "./strings.ts";

/** "Waiting for verification": polls the setup every 5 s, takes the code the tenant reads out, and moves on once the tenant is active. */
export default function WaitingScreen() {
  const { tenantId = "" } = useParams();
  const nav = useNavigate();
  const [status, setStatus] = useState<DeskSetupStatusOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(true);

  async function refresh(quiet = true) {
    if (!quiet) setRefreshing(true);
    try { setStatus(await lmmx.setupStatus(tenantId)); setError(null); }
    catch (e) { setError(errorText(e)); }
    finally { setRefreshing(false); }
  }
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => { void refreshRef.current(false); }, [tenantId]);

  const view = status ? deriveSetupView(status, now) : null;
  const keepPolling = !!view && view.phase !== "done" && view.phase !== "closed" && view.phase !== "blocked";
  usePoll(async () => { try { setStatus(await lmmx.setupStatus(tenantId)); setError(null); } catch (e) { setError(errorText(e)); } }, POLL_MS, keepPolling);

  useEffect(() => {
    if (view?.phase === "done") nav(`${LMM_BASE}/tenant/${tenantId}`, { replace: true, state: { justActivated: true } });
  }, [view?.phase, tenantId, nav]);

  async function confirm(otp: string) {
    try { await lmmx.confirmSetup(tenantId, otp); } catch (e) { await refresh(); throw e; }
    await refresh();
  }
  async function resend() { await lmmx.resendOtp(tenantId); await refresh(); }

  return (
    <Page title={S.waiting.title} actions={<Link to={LMM_BASE} className={buttonClass.secondary}>{S.nav.tenants}</Link>}>
      {error && <Notice tone="error">{error} <button type="button" className="font-semibold underline" onClick={() => void refresh(false)}>{S.common.retry}</button></Notice>}
      {!view ? (error ? null : <Spinner />) : (
        <>
          <OtpPanel view={view} onSubmit={confirm} onResend={resend} refreshing={refreshing} />
          {(view.phase === "closed" || view.phase === "blocked") && (
            <div className="flex flex-wrap gap-2"><Link to={`${LMM_BASE}/tenant/${tenantId}`} className={buttonClass.secondary}>{S.waiting.openTenant}</Link><Link to={`${LMM_BASE}/new`} className={buttonClass.primary}>{S.wizard.again}</Link></div>
          )}
        </>
      )}
    </Page>
  );
}
