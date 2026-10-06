import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "./use-auth";

export type DraftContext = {
  contextType: "global" | "contact" | "prospect" | "inbox";
  contextId: string;
  channel: "email" | "sms" | "ghl_chat" | "voicemail" | "site";
};
type Draft = { id: string; subject: string; body: string; version: number; savedAt: string };

/** Explicit loads never silently replace unsaved text on a background refetch. */
export function useMessageDraft(context: DraftContext, enabled: boolean, onLoad: (draft: Draft) => void) {
  const { user } = useAuth();
  const key = JSON.stringify([user?.id, context]);
  const keyRef = useRef(key); keyRef.current = key;
  const onLoadRef = useRef(onLoad); onLoadRef.current = onLoad;
  const [version, setVersion] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = useRef<{ payload: string; id: string } | null>(null);
  const load = async () => {
    const selectedKey = key;
    setLoading(true); setReady(false); setError(null);
    try {
      const query = new URLSearchParams(context);
      const res = await apiRequest("GET", `/api/message-drafts?${query}`);
      const { draft } = await res.json() as { draft: Draft | null };
      if (keyRef.current !== selectedKey) return;
      setVersion(draft?.version ?? 0); setSavedAt(draft?.savedAt ?? null);
      setReady(true);
      command.current = null;
      if (draft) onLoadRef.current(draft);
    } catch (err) {
      if (keyRef.current === selectedKey) setError((err as Error).message);
    } finally {
      if (keyRef.current === selectedKey) setLoading(false);
    }
  };
  useEffect(() => {
    setVersion(0); setSavedAt(null); setReady(false); command.current = null;
    if (enabled && user?.id) void load();
    // Primitive key binds actor/context; opening again is an explicit reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  const save = useMutation({
    mutationFn: async (text: { subject: string; body: string }) => {
      if (loading || !ready || !enabled || !user?.id) throw new Error("Reopen the authorized draft before saving");
      const payload = JSON.stringify({ context, ...text, expectedVersion: version });
      if (command.current?.payload !== payload) command.current = { payload, id: crypto.randomUUID() };
      const selectedKey = key;
      const res = await apiRequest("PUT", "/api/message-drafts", {
        context, ...text, expectedVersion: version, commandId: command.current.id,
      });
      return { ...(await res.json() as { draft: Draft }), key: selectedKey };
    },
    onSuccess: ({ draft, key: selectedKey }) => {
      if (keyRef.current !== selectedKey) return;
      setVersion(draft.version); setSavedAt(draft.savedAt); setError(null); command.current = null;
    },
    onError: err => setError((err as Error).message),
  });
  // A transport failure retains the exact command for a safe response-loss retry.
  const retrySave = (text: { subject: string; body: string }) => {
    setError(null);
    save.mutate(text);
  };
  return { version, savedAt, loading, error, save, retrySave, reopen: load };
}
