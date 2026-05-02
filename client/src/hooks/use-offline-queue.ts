import { useState, useEffect, useCallback } from "react";

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

async function processQueue(onUpdate: (count: number) => void) {
  const q = getQueue();
  if (!q.length) return;

  const remaining: QueueEntry[] = [];
  for (const entry of q) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: entry.body ? { "Content-Type": "application/json" } : {},
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
        const res = await fetch(url, {
          method,
          headers: body ? { "Content-Type": "application/json" } : {},
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
