import { storage } from "../storage";

export interface ChainStepResult {
  name: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  durationMs: number;
}

export interface ChainSummary {
  contactId: number;
  dealId: number;
  steps: ChainStepResult[];
  hasFailures: boolean;
  failedSteps: string[];
  completedAt: string;
}

export class StatementChainTracker {
  private steps: ChainStepResult[] = [];

  async run(name: string, fn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await fn();
      this.steps.push({ name, status: "success", durationMs: Date.now() - start });
    } catch (err: any) {
      const error = err?.message || String(err);
      console.error(`[StatementChain] Step "${name}" failed:`, error);
      this.steps.push({ name, status: "failed", error, durationMs: Date.now() - start });
    }
  }

  skip(name: string, reason?: string): void {
    this.steps.push({ name, status: "skipped", error: reason, durationMs: 0 });
  }

  async persist(contactId: number, dealId: number): Promise<ChainSummary> {
    const failedSteps = this.steps.filter((s) => s.status === "failed").map((s) => s.name);
    const hasFailures = failedSteps.length > 0;

    const summary: ChainSummary = {
      contactId,
      dealId,
      steps: this.steps,
      hasFailures,
      failedSteps,
      completedAt: new Date().toISOString(),
    };

    const auditAction = hasFailures ? "statement_chain_partial_failure" : "statement_chain_complete";
    await storage
      .createAuditLog({
        action: auditAction,
        entityType: "deal",
        entityId: dealId,
        details: summary,
      })
      .catch((e) => console.error("[StatementChain] Audit log write failed:", e));

    return summary;
  }
}
