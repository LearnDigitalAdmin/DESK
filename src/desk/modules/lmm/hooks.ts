import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../api/lmmx.ts";

/** Double-tap protection: a second call while the first is still running is ignored (checked on a ref, so it works even before React re-renders). */
export function useGuard() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true; setBusy(true);
    try { return await fn(); } finally { running.current = false; setBusy(false); }
  }, []);
  return { busy, run };
}

/** Loads once and on `reload()`. A slow old answer can never overwrite a newer one. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true); setError(null);
    loadRef.current().then(
      (d) => { if (mine === seq.current) { setData(d); setLoading(false); } },
      (e) => { if (mine === seq.current) { setError(errorText(e)); setLoading(false); } },
    );
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); return () => { seq.current++; }; }, deps);
  return { data, error, loading, reload, setData };
}

/**
 * Calls `fn` every `ms` while `enabled`. Stops when the component goes away and pauses while the tab is hidden
 * (it checks again straight away when the tab comes back). A call never starts before the last one ended.
 */
export function usePoll(fn: () => Promise<void>, ms: number, enabled: boolean) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { if (!stopped) timer = setTimeout(tick, ms); };
    const tick = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.hidden) { schedule(); return; }
      try { await fnRef.current(); } catch { /* the screen shows errors itself; keep polling */ }
      schedule();
    };
    const onVisible = () => { if (!document.hidden && !stopped) { if (timer) clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [ms, enabled]);
}

/** A clock that ticks every second while `enabled`. */
export function useNow(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** One random key per mount: a double tap or a retry of the same form reuses it, so only one tenant or change can be created. */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const make = () => (globalThis.crypto && "randomUUID" in globalThis.crypto ? globalThis.crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`).replace(/-/g, "");
  const ref = useRef<string>("");
  if (!ref.current) ref.current = make();
  return { key: ref.current, renew: () => { ref.current = make(); } };
}
