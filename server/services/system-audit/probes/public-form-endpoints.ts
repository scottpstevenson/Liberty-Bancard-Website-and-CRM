import { ProbeResult } from "./ghl-sync";

const PROBE_ENDPOINTS = [
  { path: "/api/contacts/public", label: "public contact form" },
  { path: "/api/merchant-applications/draft", label: "merchant app draft" },
  { path: "/api/affiliate/signup", label: "affiliate signup" },
  { path: "/api/public/chat/session", label: "live chat session init" },
  { path: "/api/data-requests", label: "data request form" },
  { path: "/api/public/free-analysis", label: "free analysis form" },
];

export async function probePublicFormEndpoints(): Promise<ProbeResult> {
  const port = process.env.PORT ?? 5000;
  const base = `http://localhost:${port}`;
  const results: { path: string; label: string; status: number; ok: boolean; note?: string }[] = [];

  for (const ep of PROBE_ENDPOINTS) {
    try {
      const res = await fetch(`${base}${ep.path}?probe=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(5000),
      });
      const ok = res.status >= 200 && res.status < 300;
      results.push({
        path: ep.path,
        label: ep.label,
        status: res.status,
        ok,
        note: ok ? undefined : `unexpected HTTP ${res.status}`,
      });
    } catch (err: any) {
      results.push({ path: ep.path, label: ep.label, status: 0, ok: false, note: err.message });
    }
  }

  const failed = results.filter(r => !r.ok);
  let probeStatus: "ok" | "warn" | "error" = "ok";
  let summary = `All ${results.length} public form endpoints returned 2xx via probe guard`;

  if (failed.length > 0) {
    probeStatus = failed.length === 1 ? "warn" : "error";
    summary = `${failed.length}/${results.length} public form endpoints did not return 2xx: ${failed.map(r => `${r.path} (${r.note ?? r.status})`).join(", ")}`;
  }

  return {
    subsystem: "public-form-endpoints",
    status: probeStatus,
    summary,
    details: {
      total: results.length,
      passing: results.filter(r => r.ok).length,
      failing: failed.length,
      results: results.map(r => ({ path: r.path, label: r.label, httpStatus: r.status, ok: r.ok, note: r.note })),
    },
  };
}
