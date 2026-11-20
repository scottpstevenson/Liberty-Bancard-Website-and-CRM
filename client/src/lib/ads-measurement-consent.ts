// First-party revocation capabilities; never sent to advertising vendors.
const ACTIVE = "lb_ads_measurement_key",
  PENDING = "lb_ads_measurement_revoke";
let inFlight = false;
function pendingKeys(): string[] {
  const raw = localStorage.getItem(PENDING);
  if (!raw) return [];
  try {
    const keys = JSON.parse(raw);
    return Array.isArray(keys)
      ? keys.filter((v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v))
      : [];
  } catch {
    return /^[a-f0-9]{64}$/.test(raw) ? [raw] : [];
  }
}
function retain(keys: string[]) {
  if (keys.length)
    localStorage.setItem(PENDING, JSON.stringify([...new Set(keys)]));
  else localStorage.removeItem(PENDING);
}
export function retryAdsMeasurementRevocation() {
  try {
    const key = pendingKeys()[0];
    if (!key || inFlight || typeof fetch !== "function") return;
    inFlight = true;
    let delivered = false;
    // CSRF_EXEMPT: TOKEN_AUTH_FLOW - anonymous revocation requires the original 256-bit capability; no session authority.
    void fetch("/api/public/ads-measurement/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
      keepalive: true,
    })
      .then((r) => {
        if (r.ok) {
          retain(pendingKeys().filter((v) => v !== key));
          delivered = true;
        }
      })
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        if (delivered) retryAdsMeasurementRevocation();
      });
  } catch {
    inFlight = false;
  }
}
export function revokeAdsMeasurement() {
  try {
    const key = localStorage.getItem(ACTIVE);
    if (key) retain([...pendingKeys(), key]);
    localStorage.removeItem(ACTIVE);
  } catch {}
  retryAdsMeasurementRevocation();
}
export function adsMeasurementKey(): string | undefined {
  retryAdsMeasurementRevocation();
  try {
    let key = localStorage.getItem(ACTIVE);
    if (!key) {
      key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      localStorage.setItem(ACTIVE, key);
    }
    return /^[a-f0-9]{64}$/.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}
