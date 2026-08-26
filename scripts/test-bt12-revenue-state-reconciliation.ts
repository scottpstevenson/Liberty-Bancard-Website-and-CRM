/**
 * BT-12 source-backed authority regression guard.
 * It intentionally performs no network/provider/database work.
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const failures: string[] = [];
function expect(condition: boolean, message: string) {
  if (!condition) failures.push(message);
}

const schema = read("shared/schema.ts");
const dealStorage = read("server/storage/deals.ts");
const stageService = read("server/services/deal-stage-service.ts");
const stageEffects = read("server/services/deal-stage-effect-worker.ts");
const queueManager = read("server/services/queue-manager.ts");
const sequenceWorker = read("server/services/sequence-worker.ts");
const abWorker = read("server/services/ab-test-worker.ts");
const campaigns = read("server/routes/campaigns.ts");
const chargebacks = read("server/routes/chargebacks.ts");
const mids = read("server/routes/merchant-mids.ts");
const admin = read("server/routes/admin.ts");

expect(schema.includes('Omit<InsertDeal, "stage">'), "generic UpdateDealRequest must exclude stage");
expect(dealStorage.includes("DEAL_STAGE_AUTHORITY_REQUIRED"), "runtime generic deal update must reject stage");
expect(!dealStorage.includes("bulkUpdateDealStage"), "bulk stage storage bypass must be removed");
expect(stageService.includes("FOR UPDATE") && stageService.includes("AND stage = ${dealRow.stage}"), "stage service must lock and CAS");
expect(stageService.includes("dealStageEffectIntents"), "successful stage transitions must persist durable effect intents");
expect(stageEffects.includes("FOR UPDATE SKIP LOCKED") && stageEffects.includes("lease_token"), "stage intents require fenced leased dispatch");
expect(queueManager.includes("DEAL_STAGE_EFFECTS") && queueManager.includes("CHARGEBACK_COMMANDS"), "reconciliation workers must be startup-registered");
expect(!sequenceWorker.includes("Math.random() * 100 < splitRatio"), "sequence variants must not be randomly reselected");
expect(sequenceWorker.includes("getOrCreateSequenceAbAssignment"), "sequence variants require immutable assignment");
expect(!sequenceWorker.includes('void import("./ab-test-worker")'), "sequence sends must not launch competing A/B evaluation");
expect(abWorker.includes("sequence_ab_evaluation_runs") && abWorker.includes("lease_token"), "A/B evaluation requires a persisted fenced lease");
expect(campaigns.includes("AB_RESULTS_SERVER_OWNED") && campaigns.includes('requireRole("admin", "manager")'), "A/B mutation must be retired and trigger privileged");
expect(!chargebacks.includes("getDefaultProcessor") && chargebacks.includes("enqueueChargebackSubmission"), "chargeback route must enqueue instead of provider I/O");
expect(chargebacks.includes("Idempotency-Key"), "chargeback submission requires idempotency key");
expect(mids.includes("createMerchantMid") && mids.includes("updateMerchantMid"), "merchant MID routes must use MID authority");
expect(admin.includes("createMerchantMid") && admin.includes("updateMerchantMid"), "admin MID routes must use MID authority");
expect(sequenceWorker.includes("Outbound blocked: unresolved template placeholder"), "unresolved send-boundary tokens must fail closed");

if (failures.length) {
  console.error("BT-12 authority guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("BT-12 revenue state reconciliation authority guard passed.");