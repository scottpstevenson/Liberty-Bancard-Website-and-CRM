import { useSyncExternalStore } from "react";

/**
 * Public overlay coordination.
 *
 * Several fixed-position surfaces compete for the bottom of a phone screen: the
 * cookie consent banner, the sticky upload dock, open dialogs/menus, the on-screen
 * keyboard, and the third-party chat launcher + greeting. The launcher is injected
 * by the server-rendered HTML shell (vendor loader script) and its position
 * cannot be configured: it is pinned `position: fixed` bottom-right with an
 * inline offset inside the vendor's own shadow root. We therefore never reach
 * into the vendor DOM. Instead this module publishes which public surfaces are
 * active as `data-public-overlay` on <html>, and `index.css` hides the vendor host
 * element (`chat-widget`) while a higher-priority surface is active. Hiding is
 * reversible and never removes the widget: a chat entry stays reachable from the
 * sticky dock (and the footer/contact pages keep their phone/email entries).
 *
 * Priority (highest first): open chat panel > consent > dialog/menu > focused
 * field (phone) > sticky dock > launcher visible.
 */
export type PublicOverlayFlag = "consent" | "dock" | "dialog" | "field" | "chat";

interface ChatApi {
  /** The vendor exposes `isLoaded` as a boolean property; older loaders used a function. */
  isLoaded?: boolean | (() => boolean);
  isActive?: () => boolean;
  openWidget?: () => void;
  closeWidget?: () => void;
}

interface OverlayState {
  flags: ReadonlySet<PublicOverlayFlag>;
  chatReady: boolean;
}

let state: OverlayState = { flags: new Set(), chatReady: false };
const listeners = new Set<() => void>();

function publish(next: OverlayState) {
  state = next;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    const active = Array.from(next.flags).sort().join(" ");
    if (active) root.setAttribute("data-public-overlay", active);
    else root.removeAttribute("data-public-overlay");
    if (next.flags.has("chat")) root.setAttribute("data-public-chat-active", "");
    else root.removeAttribute("data-public-chat-active");
    if (next.chatReady) root.setAttribute("data-public-chat-ready", "");
    else root.removeAttribute("data-public-chat-ready");
  }
  listeners.forEach((listener) => listener());
}

export function setPublicOverlayFlag(flag: PublicOverlayFlag, on: boolean) {
  if (state.flags.has(flag) === on) return;
  const flags = new Set(state.flags);
  if (on) flags.add(flag);
  else flags.delete(flag);
  publish({ ...state, flags });
}

export function setPublicChatReady(ready: boolean) {
  if (state.chatReady === ready) return;
  publish({ ...state, chatReady: ready });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePublicOverlay(): OverlayState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** True when the vendor API exists and reports loaded (boolean property or function form). */
export function isChatReady(api: ChatApi | null): api is ChatApi {
  if (!api || typeof api.openWidget !== "function") return false;
  const loaded = api.isLoaded;
  if (typeof loaded === "function") return !!loaded();
  return loaded === undefined ? true : !!loaded;
}

export function getChatApi(): ChatApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { leadConnector?: { chatWidget?: ChatApi } }).leadConnector?.chatWidget;
  return api ?? null;
}

/** Opens the vendor chat panel when the vendor script is present and loaded. */
export function openPublicChat(): boolean {
  const api = getChatApi();
  if (!isChatReady(api)) return false;
  // Reveal the host first: while the launcher is hidden by a higher-priority
  // surface, the panel must still become visible once it opens.
  setPublicOverlayFlag("chat", true);
  api.openWidget?.();
  return true;
}
