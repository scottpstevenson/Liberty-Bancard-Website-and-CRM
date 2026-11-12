import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/read-progress";

/**
 * Elapsed time for a read that is still running. The timer is local (no request), starts when `active` becomes true and
 * resets when it ends, so a slow read shows that it is working and for how long instead of a silent skeleton.
 */
export function useElapsedMs(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return elapsed;
}

export function ReadProgress({ active, label, deadlineMs, detail, testId }: {
  active: boolean; label: string; deadlineMs?: number; detail?: string | null; testId?: string;
}) {
  const elapsed = useElapsedMs(active);
  if (!active) return null;
  return (
    <p className="text-xs text-muted-foreground" role="status" data-testid={testId ?? "read-progress"}>
      {label} Running for {formatElapsed(elapsed)}
      {deadlineMs ? `; it is stopped, not extended, after ${Math.round(deadlineMs / 1000)} s.` : "."}
      {detail ? ` ${detail}` : ""}
    </p>
  );
}
