import { useCallback, useEffect, useRef } from "react";

/**
 * Makes an in-page anchor work on a lazily rendered page.
 *
 * The browser resolves `#fragment` once, while the document is being parsed. A lazy-loaded route mounts after that, so a
 * cold entry, a reload, an in-app link from another page or a Back/Forward step lands at the top of the page with focus
 * outside the form. This hook runs after the page has mounted and on every hash-bearing navigation, and it:
 *   - recognises every alias of the target (`aliases`), and acts only while the current hash is one of them;
 *   - aligns the region under the fixed header using the region's own `scroll-margin-top` (instant, so reduced-motion
 *     preferences are honoured by construction and a history step never animates);
 *   - moves focus once to a meaningful heading (`focusId`, which must be programmatically focusable) without scrolling;
 *   - keeps aligning briefly while fonts, images and restored state settle, and stops the moment the visitor scrolls,
 *     types or presses anything, so it never fights them.
 * It never rewrites history: the browser's own hash navigation and Back/Forward entries stay as they are.
 */
export interface AnchorTargetConfig {
  /** Every fragment (without `#`) that means "this region". */
  aliases: readonly string[];
  /** The element that is scrolled into place (carries `scroll-margin-top` for the fixed header). */
  regionId: string;
  /** The element that receives focus. */
  focusId: string;
}

/** Re-alignment passes after the first placement, in ms. Bounded so a late layout shift never scrolls the visitor later. */
const SETTLE_PASSES_MS = [60, 250, 700, 1400];
const INPUT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

function currentFragment(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

export function useAnchorTarget(config: AnchorTargetConfig): { onAnchorClick: () => void } {
  const configRef = useRef(config);
  configRef.current = config;
  const timers = useRef<number[]>([]);
  const visitorActed = useRef(false);

  const matches = useCallback(() => configRef.current.aliases.includes(currentFragment()), []);

  const cancel = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, []);

  const align = useCallback(() => {
    const region = document.getElementById(configRef.current.regionId);
    if (!region) return;
    const margin = Number.parseFloat(window.getComputedStyle(region).scrollMarginTop) || 0;
    const delta = region.getBoundingClientRect().top - margin;
    if (Math.abs(delta) > 2) window.scrollBy({ top: delta, left: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const focusTarget = useCallback((onlyIfLost: boolean) => {
    const target = document.getElementById(configRef.current.focusId);
    if (!target) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || active === document.documentElement;
    if (onlyIfLost && !lost) return;
    // Never pull focus out of a field the visitor is already using inside the region.
    const region = document.getElementById(configRef.current.regionId);
    if (region && active && active !== target && region.contains(active) && active !== document.body) return;
    target.focus({ preventScroll: true });
  }, []);

  const reveal = useCallback(() => {
    cancel();
    visitorActed.current = false;
    align();
    focusTarget(false);
    const settle = () => {
      if (visitorActed.current || !matches()) return;
      align();
      focusTarget(true);
    };
    for (const delay of SETTLE_PASSES_MS) timers.current.push(window.setTimeout(settle, delay));
    if (document.readyState !== "complete") {
      const onLoad = () => settle();
      window.addEventListener("load", onLoad, { once: true });
    }
  }, [align, cancel, focusTarget, matches]);

  useEffect(() => {
    let lastHref = window.location.href;
    const onVisitorInput = () => { visitorActed.current = true; };
    const onHashNavigation = () => {
      lastHref = window.location.href;
      if (matches()) reveal();
      else cancel();
    };
    // An in-app navigation (wouter) pushes state without firing hashchange or popstate. Only a changed URL counts, so a
    // history call that leaves the URL alone never pulls a visitor back to the form.
    const onPushState = () => {
      if (window.location.href === lastHref) return;
      onHashNavigation();
    };
    if (matches()) reveal();
    for (const name of INPUT_EVENTS) window.addEventListener(name, onVisitorInput, { passive: true });
    window.addEventListener("hashchange", onHashNavigation);
    window.addEventListener("popstate", onHashNavigation);
    window.addEventListener("pushState", onPushState);
    return () => {
      cancel();
      for (const name of INPUT_EVENTS) window.removeEventListener(name, onVisitorInput);
      window.removeEventListener("hashchange", onHashNavigation);
      window.removeEventListener("popstate", onHashNavigation);
      window.removeEventListener("pushState", onPushState);
    };
  }, [cancel, matches, reveal]);

  /**
   * For a same-page link to the region. The browser performs the scroll and records history itself; when the hash was
   * already current no hashchange fires, so focus is applied after the default action has run.
   */
  const onAnchorClick = useCallback(() => {
    window.setTimeout(() => { if (matches()) reveal(); }, 0);
  }, [matches, reveal]);

  return { onAnchorClick };
}
