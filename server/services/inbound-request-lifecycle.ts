/**
 * Pure internal-effect lifecycle decision. Keep this module free of database
 * and transport imports so a held/sent/failed decision can be certified
 * without opening a connection or loading provider configuration.
 */
export function decideInboundLifecycle(
  effects: readonly { state: string }[],
  incompleteState: "processing" | "review_required" = "processing",
  completedState: "accepted" | "completed" = "accepted",
): "processing" | "review_required" | "accepted" | "completed" | "failed" {
  if (effects.some((effect) => effect.state === "failed")) return "failed";
  if (effects.some((effect) => effect.state !== "sent")) return incompleteState;
  return completedState;
}