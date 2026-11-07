import { useEffect } from "react";
import { getChatApi, isChatReady, setPublicChatReady, setPublicOverlayFlag } from "@/lib/public-overlay";

const OPEN_DIALOG = '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="listbox"][data-state="open"]';
const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=range]),textarea,select,[contenteditable=""],[contenteditable="true"]';
const PHONE_QUERY = "(max-width: 767px)";

/**
 * Watches public-page state that must take precedence over the third-party chat
 * launcher and publishes it through `lib/public-overlay`. Mounted once in the
 * public layout. Consent and dock flags are published by their own components.
 * This component observes only the public DOM (Radix dialog state, focused
 * fields) and the vendor's documented `window.leadConnector.chatWidget` API; it
 * never reads the vendor's shadow DOM.
 */
export function PublicOverlayCoordinator() {
  useEffect(() => {
    let frame = 0;
    const syncDialog = () => {
      frame = 0;
      setPublicOverlayFlag("dialog", !!document.querySelector(OPEN_DIALOG));
    };
    const scheduleDialogSync = () => {
      if (!frame) frame = requestAnimationFrame(syncDialog);
    };
    const dialogObserver = new MutationObserver(scheduleDialogSync);
    dialogObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    syncDialog();

    const phone = window.matchMedia(PHONE_QUERY);
    let blurTimer = 0;
    const syncField = () => {
      const active = document.activeElement;
      setPublicOverlayFlag("field", phone.matches && !!active && active.matches(TEXT_FIELD));
    };
    const onFocusIn = () => {
      window.clearTimeout(blurTimer);
      syncField();
    };
    const onFocusOut = () => {
      window.clearTimeout(blurTimer);
      // Defer so moving focus between two fields does not flash the launcher.
      blurTimer = window.setTimeout(syncField, 120);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    phone.addEventListener("change", syncField);

    // The vendor script loads after hydration on server-rendered entries and is
    // absent on SPA-fallback entries, so poll for its documented API.
    let chatPoll = 0;
    let attempts = 0;
    const syncChat = () => {
      const api = getChatApi();
      const ready = isChatReady(api);
      setPublicChatReady(ready);
      // A vendor call that throws must never end the poll loop: treat it as "not active".
      let active = false;
      try {
        active = ready && !!api?.isActive?.();
      } catch {
        active = false;
      }
      setPublicOverlayFlag("chat", active);
      return ready;
    };
    const pollChat = () => {
      attempts += 1;
      const ready = syncChat();
      // Fast while a panel might be open (to notice close), slow while idle,
      // and stop looking for a vendor that never loads (SPA-fallback entries).
      const delay = ready ? 600 : 1000;
      if (!ready && attempts > 40) return;
      chatPoll = window.setTimeout(pollChat, delay);
    };
    pollChat();

    return () => {
      dialogObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(blurTimer);
      window.clearTimeout(chatPoll);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      phone.removeEventListener("change", syncField);
      setPublicOverlayFlag("dialog", false);
      setPublicOverlayFlag("field", false);
      setPublicOverlayFlag("chat", false);
      setPublicChatReady(false);
    };
  }, []);

  return null;
}
