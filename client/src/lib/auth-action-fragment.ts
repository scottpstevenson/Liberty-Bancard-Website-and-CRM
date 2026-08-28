/** Capture an opaque auth bearer before effects, telemetry, or fetches run. */
export function captureAuthActionToken(): string | null {
  if (typeof window === "undefined") return null;
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("token");
  const query = new URLSearchParams(window.location.search);
  // Legacy bearer transports are deliberately discarded, never accepted.
  let queryChanged = false;
  for (const key of ["token", "reset", "invite", "code"]) {
    if (query.has(key)) { query.delete(key); queryChanged = true; }
  }
  if (window.location.hash || queryChanged) {
    const safeQuery = query.toString();
    window.history.replaceState(window.history.state, document.title,
      `${window.location.pathname}${safeQuery ? `?${safeQuery}` : ""}`);
  }
  return token;
}