import { useState, useEffect, useCallback } from "react";
import { getCsrfToken } from "@/lib/queryClient";

const QUEUE_KEY = "lb_mobile_mutation_queue";

interface QueueEntry {
  id: string;
  method: string;
  url: string;
  body?: any;
  timestamp: number;
}

function getQueue(): QueueEntry[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(q: QueueEntry[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {}
}

/**
 * Replay all queued mutations from offline storage.
 *
 * CSRF token is acquired at send time (not at enqueue time) so the
 * token is always fresh when the offline replay actually executes.
 *
 * Public flows that do not require authentication (merchant application,
 * statement upload token flows) are NOT routed through this queue —
 * they use their own submission paths without session cookies.
 */
async function processQueue(onUpdate: (count: number) => void) {
  const q = getQueue();
  if (!q.length) return;

  // Acquire CSRF token once per replay batch — all queued mutations are
  // authenticated (session-cookie) routes that require the token.
  const csrfToken = getCsrfToken();

  const remaining: QueueEntry[] = [];
  for (const entry of q) {
    try {
      const headers: Record<string, string> = {};
      if (entry.body) headers["Content-Type"] = "application/json";
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      const res = await fetch(entry.url, {
        method: entry.method,
        headers,
        body: entry.body ? JSON.stringify(entry.body) : undefined,
        credentials: "include",
      });
      if (!res.ok && res.status !== 404) {
        remaining.push(entry);
      }
    } catch {
      remaining.push(entry);
    }
  }

  saveQueue(remaining);
  onUpdate(remaining.length);
}

export function useOfflineQueue() {
  const [queueCount, setQueueCount] = useState(() => getQueue().length);

  const updateCount = useCallback(() => {
    setQueueCount(getQueue().length);
  }, []);

  useEffect(() => {
    updateCount();

    const handleOnline = async () => {
      console.log("[OfflineQueue] Back online — processing queued mutations");
      await processQueue(setQueueCount);
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [updateCount]);

  const enqueue = useCallback((method: string, url: string, body?: any) => {
    const q = getQueue();
    q.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      method,
      url,
      body,
      timestamp: Date.now(),
    });
    saveQueue(q);
    setQueueCount(q.length);
    console.log(`[OfflineQueue] Queued ${method} ${url}. Queue size: ${q.length}`);
  }, []);

  const executeOrQueue = useCallback(
    async (
      method: string,
      url: string,
      body?: any,
      onSuccess?: () => void
    ): Promise<{ ok: boolean; queued: boolean }> => {
      if (!navigator.onLine) {
        enqueue(method, url, body);
        return { ok: false, queued: true };
      }

      try {
        // Acquire CSRF token at send time for authenticated mutations.
        const csrfToken = getCsrfToken();
        const headers: Record<string, string> = {};
        if (body) headers["Content-Type"] = "application/json";
        if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          credentials: "include",
        });

        if (res.ok && onSuccess) onSuccess();
        return { ok: res.ok, queued: false };
      } catch {
        enqueue(method, url, body);
        return { ok: false, queued: true };
      }
    },
    [enqueue]
  );

  return { queueCount, enqueue, executeOrQueue };
}
