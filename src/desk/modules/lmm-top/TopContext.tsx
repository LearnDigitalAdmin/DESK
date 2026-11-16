import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { LmmxApiError } from "../../api/lmmxErrors.ts";
import { Modal, buttonClass } from "../../ui";
import ReauthBox from "../top/ReauthBox";
import Notice from "../top/Notice";
import { runWithReauth } from "./logic.ts";
import { T } from "./strings.ts";

interface TopCtx { guarded: <R>(call: () => Promise<R>) => Promise<R> }
const Ctx = createContext<TopCtx | null>(null);

/**
 * Every lmmx_top_* call goes through `guarded`. If the server says the sign-in is too old (LMMX_E_NEEDS_REAUTH), a sign-in box opens (the same
 * ReauthBox the top desk already uses), and the call is retried once after a successful sign-in.
 */
export function TopProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ ok: () => void; no: () => void } | null>(null);

  const ask = useCallback(() => new Promise<void>((ok, no) => { pending.current = { ok, no }; setOpen(true); }), []);
  const settle = (good: boolean) => { const p = pending.current; pending.current = null; setOpen(false); if (p) { if (good) p.ok(); else p.no(); } };
  const guarded = useCallback(<R,>(call: () => Promise<R>) => runWithReauth(call, ask), [ask]);
  const value = useMemo(() => ({ guarded }), [guarded]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal open={open} title={T.reauth.title} onClose={() => settle(false)}>
        {import.meta.env.VITE_LMMX_MOCK === "true" ? (
          <div className="space-y-3"><Notice tone="info">{T.reauth.demo}</Notice><button type="button" className={buttonClass.primary} onClick={() => { void import("../../api/lmmxMock.ts").then((m) => { m.mockControl.reauthDone(); settle(true); }); }}>{T.reauth.demoBtn}</button></div>
        ) : <ReauthBox onDone={() => settle(true)} />}
        <button type="button" className={`${buttonClass.secondary} mt-3`} onClick={() => settle(false)}>{T.reauth.cancel}</button>
      </Modal>
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTopGuard(): TopCtx["guarded"] {
  const c = useContext(Ctx);
  if (!c) throw new LmmxApiError("internal", "Top desk screen is not ready.");
  return c.guarded;
}
