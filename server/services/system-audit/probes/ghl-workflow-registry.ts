import type { ProbeResult } from "./ghl-sync";

export async function probeGhlWorkflowRegistry(): Promise<ProbeResult> {
  try {
    const { GHL_WORKFLOW_REGISTRY, getWorkflowEnvValue, validateGhlWorkflowRegistry } = await import("../../ghl-workflows");
    const { isSdrGhlConfigured } = await import("../../sdr/ghl-client");
    const { isGhlConfigured } = await import("../../ghl");

    // ── Phase 1: configuration check (env/DB presence) ────────────────────
    const configResults = await Promise.all(
      GHL_WORKFLOW_REGISTRY.map(async wf => {
        const value = await getWorkflowEnvValue(wf.envKey);
        return {
          id: wf.id,
          name: wf.name,
          envKey: wf.envKey,
          configured: !!(value && value.trim()),
          category: wf.category,
        };
      })
    );

    const configured = configResults.filter(r => r.configured).length;
    const missing = configResults.filter(r => !r.configured);
    const total = configResults.length;
    const criticalMissing = missing.filter(r =>
      r.category === "inbound_lead" || r.category === "onboarding"
    );

    // ── Phase 2: live GHL validation (only when GHL is reachable) ──────────
    let liveValidation: {
      checkedCount: number;
      okCount: number;
      unresolvedKeys: string[];
      inactiveKeys: string[];
      apiErrorKeys: string[];
    } | null = null;
    let liveError: string | null = null;

    const ghlLive = isGhlConfigured() || isSdrGhlConfigured();
    if (ghlLive && configured > 0) {
      try {
        const v = await validateGhlWorkflowRegistry();
        liveValidation = {
          checkedCount: v.checkedCount,
          okCount: v.okCount,
          unresolvedKeys: v.unresolvedKeys,
          inactiveKeys: v.inactiveKeys,
          apiErrorKeys: v.apiErrorKeys,
        };
      } catch (err: any) {
        liveError = err.message ?? "Unknown validation error";
      }
    }

    // ── Determine overall status ──────────────────────────────────────────
    let status: ProbeResult["status"] = "ok";
    let summary = `GHL workflow registry: ${configured}/${total} configured`;

    if (criticalMissing.length > 0) {
      status = "error";
      summary = `${criticalMissing.length} critical GHL workflows not configured: ${criticalMissing.slice(0, 3).map(r => r.name).join(", ")}`;
    } else if (missing.length > 0) {
      status = "warn";
      summary = `${missing.length} non-critical GHL workflows not configured`;
    }

    // Live validation downgrades status further when real GHL IDs are broken
    if (liveValidation) {
      const brokenCount = liveValidation.unresolvedKeys.length + liveValidation.inactiveKeys.length;
      if (brokenCount > 0) {
        const criticalBroken = liveValidation.unresolvedKeys.filter(k => {
          const wf = GHL_WORKFLOW_REGISTRY.find(w => w.envKey === k);
          return wf?.category === "inbound_lead" || wf?.category === "onboarding";
        });
        if (criticalBroken.length > 0 || status === "ok") {
          status = criticalBroken.length > 0 ? "error" : "warn";
        }
        summary =
          `${configured}/${total} configured; ` +
          (liveValidation.unresolvedKeys.length > 0
            ? `${liveValidation.unresolvedKeys.length} workflow ID(s) not found in GHL` +
              (liveValidation.inactiveKeys.length > 0
                ? `, ${liveValidation.inactiveKeys.length} inactive`
                : "")
            : `${liveValidation.inactiveKeys.length} workflow(s) inactive in GHL`) +
          ` — automations silently skipping`;
      } else if (liveValidation.checkedCount > 0 && status === "ok") {
        summary = `${configured}/${total} configured; ${liveValidation.okCount}/${liveValidation.checkedCount} validated active in GHL`;
      }
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
        liveValidation: liveValidation ?? (liveError ? { error: liveError } : { skipped: "GHL not configured or no workflows set" }),
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
