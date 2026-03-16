import { useEffect, useCallback } from "react";
import { useLocation } from "wouter";

const GHL_WIDGET_ID = import.meta.env.VITE_GHL_CHAT_WIDGET_ID || "";

function pushPageContext(pagePath: string) {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.LC_API === "object" && w.LC_API !== null) {
    const api = w.LC_API as Record<string, unknown>;
    if (typeof api.set_custom_variables === "function") {
      (api.set_custom_variables as Function)([
        { name: "page_url", value: window.location.href },
        { name: "page_path", value: pagePath },
      ]);
      return true;
    }
  }
  return false;
}

export default function ChatWidget() {
  const [location] = useLocation();

  useEffect(() => {
    if (!GHL_WIDGET_ID) return;

    const existingScript = document.getElementById("ghl-chat-widget-script");
    if (existingScript) return;

    const script = document.createElement("script");
    script.id = "ghl-chat-widget-script";
    script.src = `https://widgets.leadconnectorhq.com/loader.js`;
    script.async = true;
    script.setAttribute("data-resources-url", "https://widgets.leadconnectorhq.com/chat-widget/loader.js");
    script.setAttribute("data-widget-id", GHL_WIDGET_ID);
    document.body.appendChild(script);

    return () => {
      const el = document.getElementById("ghl-chat-widget-script");
      if (el) el.remove();
    };
  }, []);

  const pushWithRetry = useCallback((pagePath: string) => {
    if (pushPageContext(pagePath)) return;

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (pushPageContext(pagePath) || attempts >= 10) {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!GHL_WIDGET_ID) return;
    const cleanup = pushWithRetry(location);
    return cleanup;
  }, [location, pushWithRetry]);

  return null;
}
