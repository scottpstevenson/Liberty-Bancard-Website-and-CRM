import { useEffect, useRef } from "react";
import { queryClient, protectedScope } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

type VersionedWork = { id: number; authorityFence: number };
/** Capture selection versions, not whichever version a background refetch
 * happens to return when Save is clicked. Retry identical intent with its UUID. */
export function useWorkCommands(kind: "task" | "ticket" | "rfi", selected?: Set<number>, records?: VersionedWork[]) {
  const { user } = useAuth();
  const versions = useRef(new Map<number, number>());
  const commands = useRef(new Map<string, string>());
  const actorContext=JSON.stringify(protectedScope(user));
  useEffect(() => { versions.current.clear(); commands.current.clear(); }, [actorContext]);
  useEffect(() => {
    if (!selected) return;
    for (const id of versions.current.keys()) if (!selected.has(id)) versions.current.delete(id);
    for (const row of records ?? []) if (selected.has(row.id) && !versions.current.has(row.id)) versions.current.set(row.id, row.authorityFence);
  }, [selected, records, user?.id]);
  function command(payload: Record<string, unknown>, identity: number | string = "bulk") {
    if (!user?.id) throw new Error("Sign-in unavailable. Reload before saving work.");
    const key = JSON.stringify([actorContext, kind, identity, payload]);
    if (!commands.current.has(key)) commands.current.set(key, crypto.randomUUID());
    return { ...payload, expectedActorId: user.id, expectedAccountVersion:user.accountVersion,
      commandId: commands.current.get(key)! };
  }
  return {
    create(fields:Record<string,unknown>) {
      return command(fields,"create");
    },
    finishCreate(fields:Record<string,unknown>) {
      // A confirmed save ends that intent. A lost reply must retain its UUID;
      // a later intentionally identical task is a new creation, not a retry.
      commands.current.delete(JSON.stringify([actorContext,kind,"create",fields]));
    },
    edit(row: VersionedWork, fields: Record<string, unknown>) {
      if (!row || !Number.isInteger(row.authorityFence)) throw new Error("Work version unavailable. Reload before saving.");
      return command({ ...fields, expectedFence: row.authorityFence },row.id);
    },
    bulk(ids: number[], fields: Record<string, unknown> = {}) {
      const items = [...new Set(ids)].sort((a,b) => a-b).map(id => {
        const expectedFence = versions.current.get(id);
        if (!Number.isInteger(expectedFence)) throw new Error("Selected work version unavailable. Reload and select the current work.");
        return { id, expectedFence };
      });
      return command({ ...fields, items });
    },
  };
}

export function invalidateWorkFacts() {
  return queryClient.invalidateQueries({ predicate: query => {
    const path = String(query.queryKey[0]);
    return workFactFamilies.some(prefix => path.startsWith(prefix));
  } });
}

/** Dependency families, not bare cache identities. Actor/filter suffixes remain
 * intact. The existing server freshness middleware invalidates factual caches
 * after successful owned commands; this mapping refreshes their observers. */
export const workFactFamilies = [
  "/api/tasks", "/api/tickets", "/api/analytics", "/api/overview/daily-briefing",
  "/api/my-day", "/api/kpi/summary", "/api/contacts", "/api/leads", "/api/deals",
  "/api/notifications", "/api/calendar-events", "/api/rfis", "/api/review-queue",
] as const;
