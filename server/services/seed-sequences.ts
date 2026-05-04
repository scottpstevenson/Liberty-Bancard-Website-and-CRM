import { storage } from "../storage";
import sequencesData from "../data/seeds/sequences.json";

interface SequenceSeed {
  name: string;
  description: string;
  triggerType: string;
  triggerConfig: Record<string, any>;
  steps: Array<{
    stepOrder: number;
    actionType: string;
    delayDays: number;
    delayHours: number;
    subject?: string;
    body?: string;
    config?: Record<string, any>;
  }>;
}

const SEQUENCES: SequenceSeed[] = sequencesData as unknown as SequenceSeed[];

export async function seedSequences() {
  try {
    const existingSequences = await storage.getFollowUpSequences();
    const existingNames = new Set(existingSequences.map((s: any) => s.name));

    const toSeed = SEQUENCES.filter(seq => !existingNames.has(seq.name));
    if (toSeed.length === 0) {
      console.log(`[Seed] All ${existingSequences.length} sequences already exist, skipping new seed.`);
    } else {
      console.log(`[Seed] Seeding ${toSeed.length} drip campaign sequences (${existingSequences.length} already exist)...`);
    }

    for (const seq of toSeed) {

      const created = await storage.createFollowUpSequence({
        name: seq.name,
        description: seq.description,
        triggerType: seq.triggerType,
        triggerConfig: seq.triggerConfig,
        totalSteps: seq.steps.length,
        status: "active",
      });

      for (const step of seq.steps) {
        await storage.createSequenceStep({
          sequenceId: created.id,
          stepOrder: step.stepOrder,
          actionType: step.actionType,
          delayDays: step.delayDays,
          delayHours: step.delayHours,
          subject: step.subject || null,
          body: step.body || null,
          templateId: null,
          config: step.config || null,
        });
      }

      console.log(`[Seed] Created sequence: "${seq.name}" (${seq.steps.length} steps)`);
    }

    console.log("[Seed] All sequences seeded successfully.");

    const forceUpdateNames = new Set([
      "SDR: Cold Outbound — Auto Repair",
      "SDR: Cold Outbound — Med Spa",
      "SDR: Cold Outbound — Dental",
      "1. Switch & Save — Statement Audit",
      "20. Free Analysis Follow-Up",
      "SDR: Reply Engaged",
      "SDR: Statement Chase",
      "SDR: Proposal Follow-Up",
      "SDR: No-Show Recovery",
    ]);
    const toForceUpdate = SEQUENCES.filter(seq => forceUpdateNames.has(seq.name) && existingNames.has(seq.name));
    for (const seq of toForceUpdate) {
      const existing = existingSequences.find((s: { name: string; id: number }) => s.name === seq.name);
      if (!existing) continue;
      const oldSteps = await storage.getSequenceSteps(existing.id);
      for (const step of oldSteps) {
        await storage.deleteSequenceStep(step.id);
      }
      for (const step of seq.steps) {
        await storage.createSequenceStep({
          sequenceId: existing.id,
          stepOrder: step.stepOrder,
          actionType: step.actionType,
          delayDays: step.delayDays,
          delayHours: step.delayHours,
          subject: step.subject || null,
          body: step.body || null,
          templateId: null,
          config: step.config || null,
        });
      }
      await storage.updateFollowUpSequence(existing.id, {
        description: seq.description,
        totalSteps: seq.steps.length,
      });
      console.log(`[Seed] Force-updated sequence: "${seq.name}" (${seq.steps.length} steps)`);
    }
  } catch (error) {
    console.error("[Seed] Error seeding sequences:", error);
  }
}
