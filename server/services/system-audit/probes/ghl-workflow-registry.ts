import type { ProbeResult } from "./ghl-sync";

export async function probeGhlWorkflowRegistry(): Promise<ProbeResult> {
  try {
    const { GHL_WORKFLOW_REGISTRY } = await import("../../ghl-workflows");

    const results = GHL_WORKFLOW_REGISTRY.map(wf => {
      const envValue = process.env[wf.envKey];
      return {
        id: wf.id,
        name: wf.name,
        envKey: wf.envKey,
        configured: !!(envValue && envValue.trim()),
        category: wf.category,
      };
    });

    const configured = results.filter(r => r.configured).length;
    const missing = results.filter(r => !r.configured);
    const total = results.length;
    const criticalMissing = missing.filter(r =>
      r.category === "inbound_lead" || r.category === "onboarding"
    );

    let status: ProbeResult["status"] = "ok";
    let summary = `GHL workflow registry: ${configured}/${total} workflows configured`;

    if (criticalMissing.length > 0) {
      status = "error";
      summary = `${criticalMissing.length} critical GHL workflows not configured: ${criticalMissing.slice(0, 3).map(r => r.name).join(", ")}`;
    } else if (missing.length > 0) {
      status = "warn";
      summary = `${missing.length} GHL workflows not configured (non-critical): ${missing.slice(0, 3).map(r => r.name).join(", ")}`;
    }

    return {
      subsystem: "ghl-workflow-registry",
      status,
      summary,
      details: {
        total,
        configured,
        missing: missing.length,
        criticalMissing: criticalMissing.length,
        missingWorkflows: missing.map(r => ({ id: r.id, name: r.name, envKey: r.envKey, category: r.category })),
      },
    };
  } catch (err: any) {
    return {
      subsystem: "ghl-workflow-registry",
      status: "error",
      summary: `GHL workflow registry probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
