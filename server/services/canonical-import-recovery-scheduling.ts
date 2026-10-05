/** Alternate bounded wakeup slots. Reusing the ACTIVE job's ID would cause
 * BullMQ to deduplicate its successor before removeOnComplete can run. */
export function canonicalImportContinuationOptions(activeJobId?:string) {
  return {
    jobId: activeJobId==="canonical-import-next-batch-a"
      ? "canonical-import-next-batch-b" : "canonical-import-next-batch-a",
    delay:1000,
    removeOnComplete:true,
    removeOnFail:true,
  };
}
