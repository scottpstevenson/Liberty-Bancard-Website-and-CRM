import { useEffect, useState } from "react";
import { loadTicketDraft, saveTicketDraft, clearTicketDraft } from "@/lib/ticket-draft";

// Encapsulates the reply-draft persistence behavior used by Tickets.tsx's
// TicketConversation reply box, extracted so it can be mounted and tested
// in isolation (see scripts/test-ticket-reply-box.tsx).
export function useTicketDraft(
  ticketId: number,
  draftToInsert?: { text: string; nonce: number } | null,
  onDraftInserted?: () => void
) {
  const [replyContent, setReplyContentState] = useState<string>(() => loadTicketDraft(ticketId));

  useEffect(() => {
    if (draftToInsert && draftToInsert.text) {
      setReplyContentState(draftToInsert.text);
      saveTicketDraft(ticketId, draftToInsert.text);
      onDraftInserted?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftToInsert?.nonce]);

  const setReplyContent = (value: string) => {
    setReplyContentState(value);
    saveTicketDraft(ticketId, value);
  };

  const discard = () => {
    setReplyContentState("");
    clearTicketDraft(ticketId);
  };

  const clearAfterSend = () => {
    setReplyContentState("");
    clearTicketDraft(ticketId);
  };

  return { replyContent, setReplyContent, discard, clearAfterSend };
}
