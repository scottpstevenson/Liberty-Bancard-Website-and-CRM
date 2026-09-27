/** Restart-safe, strictly free SFP Phase A continuation. One tick scans at
 * most 250 canonical records and classifies at most 25. No paid transport,
 * contact, enrollment, GHL, campaign, or send path is reachable here. */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { CLASSIFIER_VERSION } from "./sfp-vertical-classifier";
import {
  freezeClassificationSnapshot,
  previewHighConfidenceClassificationCandidates,
  runFrozenClassificationSnapshot,
} from "./sfp-classification-bridge";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const SCAN_LIMIT = 250;
const RUN_LIMIT = 25;

export async function getSfpFreeClassificationContinuation(programId: string) {
  return rows(await db.execute(sql`
    SELECT * FROM sfp_free_classification_continuations
     WHERE program_id=${programId}::uuid
  `))[0] ?? null;
}

/** An explicit admin action, never triggered by deployment or program activation. */
export async function startSfpFreeClassificationContinuation(programId: string) {
  const program = rows(await db.execute(sql`
    SELECT id,policy_version,taxonomy_version,is_active FROM sfp_programs
     WHERE id=${programId}::uuid
  `))[0];
  if (!program || !program.is_active || Number(program.taxonomy_version) !== 2) {
    throw new Error("SFP_FREE_CONTINUATION_REQUIRES_ACTIVE_V2_PROGRAM");
  }
  const existing = await getSfpFreeClassificationContinuation(programId);
  if (existing?.state === "running" && existing.lease_expires_at &&
      new Date(existing.lease_expires_at).getTime() > Date.now()) {
    throw new Error("SFP_FREE_CONTINUATION_TICK_ACTIVE");
  }
  if (existing?.state === "running" || existing?.state === "paused") {
    if (Number(existing.policy_version) !== Number(program.policy_version) ||
        Number(existing.taxonomy_version) !== 2 || Number(existing.classifier_version) !== CLASSIFIER_VERSION) {
      throw new Error("SFP_FREE_CONTINUATION_POLICY_CHANGED_RESTART_REQUIRED");
    }
    return rows(await db.execute(sql`
      UPDATE sfp_free_classification_continuations
         SET state='running',last_error=NULL,updated_at=NOW()
       WHERE program_id=${programId}::uuid AND (state='paused' OR (state='running' AND (lease_expires_at IS NULL OR lease_expires_at<NOW())))
       RETURNING *
    `))[0] ?? existing;
  }
  // The upper bound is pinned for this pass so ongoing Sunbiz ingestion
  // cannot keep moving the finish line; a later explicit start begins a new
  // pass. Existing current-version evidence makes rescans inexpensive.
  const started = rows(await db.execute(sql`
    INSERT INTO sfp_free_classification_continuations
      (program_id,state,high_water_business_id,stop_business_id,policy_version,taxonomy_version,classifier_version,
       scanned_count,processed_count,target_count,rejected_count,lease_token,lease_expires_at,last_error,last_tick_at,started_at,updated_at)
    VALUES (${programId}::uuid,'running',0,(SELECT COALESCE(MAX(id),0) FROM businesses),
            ${Number(program.policy_version)},2,${CLASSIFIER_VERSION},0,0,0,0,NULL,NULL,NULL,NULL,NOW(),NOW())
    ON CONFLICT (program_id) DO UPDATE SET
       state='running',high_water_business_id=0,stop_business_id=EXCLUDED.stop_business_id,
       policy_version=EXCLUDED.policy_version,taxonomy_version=2,classifier_version=${CLASSIFIER_VERSION},
       scanned_count=0,processed_count=0,target_count=0,rejected_count=0,
       lease_token=NULL,lease_expires_at=NULL,last_error=NULL,last_tick_at=NULL,started_at=NOW(),updated_at=NOW()
       WHERE sfp_free_classification_continuations.state IN ('idle','completed')
    RETURNING *
  `))[0];
  return started ?? await getSfpFreeClassificationContinuation(programId);
}

export async function pauseSfpFreeClassificationContinuation(programId: string) {
  return rows(await db.execute(sql`
    UPDATE sfp_free_classification_continuations SET state='paused',updated_at=NOW()
     WHERE program_id=${programId}::uuid AND state='running' RETURNING *
  `))[0] ?? await getSfpFreeClassificationContinuation(programId);
}

/** Queue tick. A DB lease fences overlapping BullMQ workers; the cursor only
 * advances after the frozen, provider-free run finishes. A crash replays the
 * same window once the lease expires; current evidence avoids reclassifying
 * already completed target/non-target records. */
export async function processSfpFreeClassificationTick(): Promise<{
  claimed: boolean; programId?: string; scanned?: number; processed?: number; target?: number; state?: string;
}> {
  const claimed = rows(await db.execute(sql`
    UPDATE sfp_free_classification_continuations AS c
       SET lease_token=gen_random_uuid(),lease_expires_at=NOW()+INTERVAL '60 minutes',last_tick_at=NOW(),updated_at=NOW()
     WHERE c.program_id=(
       SELECT program_id FROM sfp_free_classification_continuations
        WHERE state='running' AND (lease_expires_at IS NULL OR lease_expires_at<NOW())
        ORDER BY started_at,program_id FOR UPDATE SKIP LOCKED LIMIT 1
     ) AND c.state='running'
       AND (c.lease_expires_at IS NULL OR c.lease_expires_at<NOW())
     RETURNING c.*
  `))[0];
  if (!claimed) return { claimed: false };
  const programId = String(claimed.program_id);
  const token = String(claimed.lease_token);
  try {
    const program = rows(await db.execute(sql`
      SELECT policy_version,taxonomy_version,is_active,vertical_ids FROM sfp_programs WHERE id=${programId}::uuid
    `))[0];
    if (!program || !program.is_active || Number(program.policy_version) !== Number(claimed.policy_version) ||
        Number(program.taxonomy_version) !== 2 || Number(claimed.classifier_version) !== CLASSIFIER_VERSION) {
      throw new Error("SFP_FREE_CONTINUATION_POLICY_CHANGED");
    }
    const window = rows(await db.execute(sql`
      SELECT id FROM businesses WHERE record_class='canonical'
        AND id>${Number(claimed.high_water_business_id)} AND id<=${Number(claimed.stop_business_id)}
       ORDER BY id LIMIT ${SCAN_LIMIT}
    `));
    if (window.length === 0) {
      await db.execute(sql`
        UPDATE sfp_free_classification_continuations
           SET state='completed',lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
         WHERE program_id=${programId}::uuid AND state='running' AND lease_token=${token}::uuid AND lease_expires_at>NOW()
      `);
      return { claimed: true, programId, scanned: 0, processed: 0, target: 0, state: "completed" };
    }
    const windowIds = window.map((r: any) => Number(r.id));
    const preview = await previewHighConfidenceClassificationCandidates(programId, {
      businessIdFilter: windowIds, limit: SCAN_LIMIT,
    });
    // Read-only preview includes exclusions for operator visibility. Never
    // send them to freeze. Sort by ID so the cursor cannot skip an eligible
    // candidate if a window contains more than 25 safe names.
    const selected = preview.candidates.filter((c) => c.exclusionStatus === null)
      .sort((a, b) => a.businessId - b.businessId).slice(0, RUN_LIMIT);
    const selectedIds = selected.map((c) => c.businessId);
    let processed = 0;
    let target = 0;
    let rejected = 0;
    if (selectedIds.length > 0) {
      const stillCurrent = rows(await db.execute(sql`
        SELECT policy_version,taxonomy_version,is_active FROM sfp_programs WHERE id=${programId}::uuid
      `))[0];
      if (!stillCurrent?.is_active || Number(stillCurrent.policy_version) !== Number(claimed.policy_version) ||
          Number(stillCurrent.taxonomy_version) !== 2) throw new Error("SFP_FREE_CONTINUATION_POLICY_CHANGED");
      const frozen = await freezeClassificationSnapshot({
        programId,actorId:"system:sfp-free-continuation",businessIds:selectedIds,
        targetIds:preview.targetIds,policyVersion:preview.policyVersion,taxonomyVersion:2,
        allowedProvider:"none",maxUnits:RUN_LIMIT,ttlMinutes:60,
      });
      rejected += frozen.rejectedAtFreeze.length;
      if (frozen.businessIds.length > 0) {
        const run = await runFrozenClassificationSnapshot({
          snapshotId:frozen.snapshotId,actorId:"system:sfp-free-continuation",
        });
        if (run.costMicros !== 0) throw new Error("SFP_FREE_CONTINUATION_NONZERO_COST");
        processed = run.processed;
        target = run.targetCount;
        rejected += run.rejectedAtRun.length;
      }
    }
    const nextCursor = selectedIds.length === RUN_LIMIT
      ? selectedIds[selectedIds.length - 1]
      : windowIds[windowIds.length - 1];
    const updated = rows(await db.execute(sql`
      UPDATE sfp_free_classification_continuations
         SET high_water_business_id=${nextCursor},
             scanned_count=scanned_count+${windowIds.filter((id) => id <= nextCursor).length},
             processed_count=processed_count+${processed},target_count=target_count+${target},
             rejected_count=rejected_count+${rejected},
             lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=NOW()
       WHERE program_id=${programId}::uuid AND state='running' AND lease_token=${token}::uuid AND lease_expires_at>NOW()
       RETURNING program_id
    `));
    if (updated.length === 0) throw new Error("SFP_FREE_CONTINUATION_LEASE_LOST");
    return { claimed: true,programId,scanned:windowIds.filter((id) => id <= nextCursor).length,
      processed,target,state:"running" };
  } catch (error: any) {
    await db.execute(sql`
      UPDATE sfp_free_classification_continuations
         SET last_error=${String(error?.message ?? error).slice(0, 500)},
             lease_token=NULL,lease_expires_at=NULL,
             state=CASE WHEN ${String(error?.message ?? error).includes("POLICY_CHANGED")} THEN 'paused' ELSE state END,
             updated_at=NOW()
       WHERE program_id=${programId}::uuid AND lease_token=${token}::uuid
    `);
    throw error;
  }
}
