import { useCallback, useEffect, useState } from "react";

const CHANGE_EVENT = "liberty:urlparamchange";

function readParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/**
 * One validated query-string parameter that survives reload and Back/Forward. The raw URL value is parsed by `parse`,
 * which must return `undefined` for anything invalid; invalid values fall back to `fallback` (never trusted as-is).
 * Other query parameters (and the hash) are preserved. A value equal to the fallback is removed from the URL.
 */
export function useUrlParam<T extends string | number>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | undefined,
  options: { history?: "push" | "replace" } = {},
): [T, (next: T) => void] {
  const read = useCallback((): T => {
    const raw = readParam(key);
    if (raw === null) return fallback;
    const parsed = parse(raw);
    return parsed === undefined ? fallback : parsed;
    // `parse` and `fallback` are expected to be stable per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fallback]);
  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener("popstate", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    sync();
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, [read]);

  const set = useCallback((next: T) => {
    const url = new URL(window.location.href);
    if (next === fallback || String(next) === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(next));
    const target = `${url.pathname}${url.search}${url.hash}`;
    if (target !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      if ((options.history ?? "push") === "push") window.history.pushState(window.history.state, "", target);
      else window.history.replaceState(window.history.state, "", target);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
    setValue(next);
  }, [key, fallback, options.history]);

  return [value, set];
}

export const parseMonthParam = (raw: string): { year: number; month: number } | undefined => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : undefined;
};
