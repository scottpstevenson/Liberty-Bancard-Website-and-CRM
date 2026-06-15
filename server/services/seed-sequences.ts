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
    // Force-overwrite on startup removed — edits made via the Sequences UI now
    // persist across restarts. To push canonical step changes, edit the sequences
    // directly in the dashboard or update server/data/seeds/sequences.json and
    // delete the corresponding DB rows so they are re-seeded fresh.
  } catch (error) {
    console.error("[Seed] Error seeding sequences:", error);
  }
}
