import { storage } from "../storage";
import { pool } from "../db";
import type { PoolClient } from "pg";
import sequencesData from "../data/seeds/sequences.json";

interface SequenceSeed {
  name: string;
  description: string;
  triggerType: string;
  triggerConfig: Record<string, any>;
  /** Wave 6 flag: if "paused", sequence is created with status "paused" instead of "active" */
  waveStatus?: string;
  /** Wave 6 metadata — stored as dedicated columns on follow_up_sequences */
  sequenceFamily?: string;
  eligibleConsentTiers?: string[];
  channelsAllowed?: string[];
  offerRoutes?: string[];
  lifecycleStagesAllowed?: string[];
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
  let lockClient: PoolClient | null = null;
  try {
    lockClient = await pool.connect();
    await lockClient.query("SELECT pg_advisory_lock($1)", [1_698_001]);
    const existingSequences = await storage.getFollowUpSequences();
    const existingByName = new Map(existingSequences.map((s: any) => [s.name, s]));

    // --- Pass 1: Create sequences missing from the DB entirely ---
    const toSeed = SEQUENCES.filter(seq => !existingByName.has(seq.name));
    if (toSeed.length === 0) {
      console.log(`[Seed] All ${existingSequences.length} sequences already exist, checking for stubs...`);
    } else {
      console.log(`[Seed] Seeding ${toSeed.length} drip campaign sequences (${existingSequences.length} already exist)...`);
    }

    for (const seq of toSeed) {
      // Seed content is promotional configuration, never a launch instruction.
      // Existing rows are deliberately not changed by this seeder.
      const status = "paused";

      const created = await storage.createFollowUpSequence({
        name: seq.name,
        description: seq.description,
        triggerType: seq.triggerType,
        triggerConfig: seq.triggerConfig,
        totalSteps: seq.steps.length,
        status,
        sequenceFamily: seq.sequenceFamily ?? null,
        eligibleConsentTiers: seq.eligibleConsentTiers ?? null,
        channelsAllowed: seq.channelsAllowed ?? null,
        offerRoutes: seq.offerRoutes ?? null,
        lifecycleStagesAllowed: seq.lifecycleStagesAllowed ?? null,
      } as any);

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

      console.log(`[Seed] Created sequence: "${seq.name}" (${seq.steps.length} steps, status: ${status})`);
    }

    // --- Pass 2: Hydrate only non-launchable stubs (totalSteps === 0) ---
    const stubs = SEQUENCES.filter(seq => {
      const existing = existingByName.get(seq.name);
      return existing &&
        ["paused", "draft"].includes((existing as any).status) &&
        (existing as any).totalSteps === 0 &&
        seq.steps.length > 0;
    });

    if (stubs.length > 0) {
      console.log(`[Seed] Hydrating ${stubs.length} stub sequences with seed steps...`);
      for (const seq of stubs) {
        const existing = existingByName.get(seq.name) as any;
        // Re-read immediately before writes. This makes repeated startup calls
        // idempotent when another process hydrated the stub first.
        const existingSteps = await storage.getSequenceSteps(existing.id);
        if (existingSteps.length > 0) continue;
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
          totalSteps: seq.steps.length,
        });
        console.log(`[Seed] Hydrated stub sequence: "${seq.name}" (${seq.steps.length} steps added)`);
      }
    } else {
      console.log(`[Seed] No stub sequences found — all seeded sequences have steps.`);
    }

    console.log("[Seed] All sequences seeded successfully.");
    // Force-overwrite on startup removed — edits made via the Sequences UI now
    // persist across restarts. To push canonical step changes, edit the sequences
    // directly in the dashboard or update server/data/seeds/sequences.json and
    // delete the corresponding DB rows so they are re-seeded fresh.
  } catch (error) {
    console.error("[Seed] Error seeding sequences:", error);
  } finally {
    if (lockClient) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [1_698_001]);
      } finally {
        lockClient.release();
      }
    }
  }
}
