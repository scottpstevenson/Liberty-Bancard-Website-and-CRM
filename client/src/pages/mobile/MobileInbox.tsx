import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Search, MessageSquare, Loader2, Send, ChevronLeft, User, Clock } from "lucide-react";

function timeAgo(ts: string | null | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function stripHtml(html: string): string {
  return html?.replace(/<[^>]*>/g, "").trim() || "";
}

interface InboxItem {
  id: number;
  contactId: number | null;
  contactName: string | null;
  subject: string | null;
  preview: string | null;
  channel: string | null;
  isRead: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
  body?: string | null;
}

function ThreadView({ item, onBack }: { item: InboxItem; onBack: () => void }) {
  const [reply, setReply] = useState("");

  const { data: fullItem, isLoading } = useQuery<any>({
    queryKey: ["/api/inbox/items", item.id],
    queryFn: async () => {
      const res = await fetch(`/api/inbox/items/${item.id}`, { credentials: "include" });
      if (!res.ok) return item;
      return res.json();
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!reply.trim() || !item.contactId) return;
      const res = await apiRequest("POST", `/api/contacts/${item.contactId}/send-email`, {
        subject: `Re: ${item.subject || "Follow-up"}`,
        body: `<p>${reply.trim()}</p>`,
      });
      if (!res.ok) throw new Error("Send failed");
    },
    onSuccess: () => {
      setReply("");
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/items"] });
    },
  });

  const body = stripHtml(fullItem?.body || fullItem?.preview || item.preview || "");

  return (
    <div className="flex flex-col h-full">
      <div
        className="bg-white dark:bg-gray-900 px-4 pb-3 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <div className="flex items-center gap-3">
          <button data-testid="button-back-inbox" onClick={onBack}
            className="w-8 h-8 flex items-center justify-center text-gray-500 -ml-1">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white text-sm truncate">
              {item.contactName || "Unknown"}
            </div>
            <div className="text-xs text-gray-400 truncate">{item.subject || "No subject"}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white">{item.contactName || "Unknown"}</div>
                <div className="text-xs text-gray-400">{timeAgo(item.createdAt)}</div>
              </div>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {body || "(No message body)"}
            </p>
          </div>
        )}
      </div>

      {item.contactId && (
        <div
          className="bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-4 py-3 flex gap-2 items-end"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        >
          <textarea data-testid="input-inbox-reply" value={reply}
            onChange={(e) => setReply(e.target.value)} placeholder="Reply via email..." rows={2}
            className="flex-1 resize-none rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 border-0" />
          <button data-testid="button-send-reply" onClick={() => sendMutation.mutate()}
            disabled={!reply.trim() || sendMutation.isPending}
            className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform shrink-0">
            {sendMutation.isPending
              ? <Loader2 className="w-4 h-4 text-white animate-spin" />
              : <Send className="w-4 h-4 text-white" />}
          </button>
        </div>
      )}
    </div>
  );
}

export default function MobileInbox() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InboxItem | null>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/inbox/items"],
    staleTime: 1000 * 30,
  });

  const items: InboxItem[] = Array.isArray(data) ? data : data?.items ?? data?.data ?? [];
  const unreadCount = items.filter((i) => !i.isRead).length;

  const filtered = items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.contactName?.toLowerCase().includes(q) ||
      item.subject?.toLowerCase().includes(q) ||
      item.preview?.toLowerCase().includes(q)
    );
  });

  if (selected) return <ThreadView item={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="flex flex-col h-full">
      <div
        className="bg-white dark:bg-gray-900 px-4 pb-3 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Inbox</h1>
          <span className="text-xs text-gray-400">
            {unreadCount > 0 ? `${unreadCount} unread` : `${items.length} messages`}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input data-testid="input-search-inbox" type="search" value={search}
            onChange={(e) => setSearch(e.target.value)} placeholder="Search inbox..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 px-4">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {search ? "No messages found" : "Your inbox is empty"}
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((item) => (
              <div key={item.id} data-testid={`inbox-item-${item.id}`} onClick={() => setSelected(item)}
                className={`flex items-start gap-3 px-4 py-3.5 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700 ${
                  !item.isRead ? "bg-blue-50/50 dark:bg-blue-900/10" : ""}`}>
                <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-white text-xs font-semibold">
                    {((item.contactName || "?")[0] || "?").toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${!item.isRead
                      ? "font-semibold text-gray-900 dark:text-white"
                      : "font-medium text-gray-700 dark:text-gray-300"}`}>
                      {item.contactName || "Unknown"}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0 flex items-center gap-1">
                      <Clock className="w-3 h-3" />{timeAgo(item.updatedAt || item.createdAt)}
                    </span>
                  </div>
                  <div className={`text-xs truncate mt-0.5 ${!item.isRead
                    ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}`}>
                    {item.subject || "(No subject)"}
                  </div>
                  {item.preview && (
                    <div className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
                      {stripHtml(item.preview).slice(0, 80)}
                    </div>
                  )}
                </div>
                {!item.isRead && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
