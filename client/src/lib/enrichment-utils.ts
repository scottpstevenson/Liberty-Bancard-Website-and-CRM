export function isEnrichmentRunning(status: string | undefined): boolean {
  return status === "running";
}
