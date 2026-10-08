import { useState, useEffect } from "react";
import type { InfiniteData, QueryKey } from "@tanstack/react-query";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { useCrmInfiniteQuery } from "@/hooks/use-crm-infinite-query";
import { apiRequest } from "@/lib/queryClient";
import { Search, MessageSquare, Send, ChevronLeft, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessageDraft } from "@/hooks/use-message-draft";
import { useOutboundPauseObservation } from "@/hooks/use-outbound-pause-observation";
import type { DraftContext } from "@/hooks/use-message-draft";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useSearch } from "wouter";
import { buildInboxWorkspaceHref, inboxWorkspaceState, inboxChannels } from "@/lib/crm-destination-state";
import { protectedContextToken } from "@/lib/queryClient";
import { decodeInboxSourceItem, decodeInboxSourcePage, type InboxSourceItem, type InboxSourcePage } from "@/lib/inbox-source";
import { CrmDataState } from "@/components/crm/CrmPresentation";

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

const AVATAR_COLORS = [
  "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500",
  "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-red-500",
];
function avatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash)];
}
function getInitials(name: string): string {
  return name.trim().split(" ").map((p) => p[0] || "").slice(0, 2).join("").toUpperCase();
}

type InboxItem = InboxSourceItem;

function ThreadView({ item, onBack }: { item: InboxItem; onBack: () => void }) {
  const outbound=useOutboundPauseObservation();
  const [reply, setReply] = useState("");
  const draftChannel = item.channel as DraftContext["channel"];
  const draft = useMessageDraft(
    { contextType: "inbox", contextId: item.id, channel: draftChannel },
    !!item.contactId && item.channel !== "voicemail",
    loaded => setReply(loaded.body),
  );

  const { data: fullItem, isLoading, isError, refetch } = useQuery<InboxItem>({
    queryKey: ["/api/inbox/items", item.id],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/inbox/items/${encodeURIComponent(item.id)}`, undefined, undefined, signal);
      return decodeInboxSourceItem(await res.json(), item.id);
    },
    staleTime: 30000,
  });

  const body = stripHtml(fullItem?.body || fullItem?.preview || item.preview || "");
  const name = item.contactName || "Unknown";
  const color = avatarColor(name);
  const initials = getInitials(name);

  return (
    <div className="flex flex-col h-full">
      <div
        className="bg-white dark:bg-gray-900 px-4 pb-3 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          data-testid="button-back-inbox"
          onClick={onBack}
          className="flex items-center gap-1 text-blue-600 mb-2 active:opacity-70"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm">Inbox</span>
        </button>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full ${color} flex items-center justify-center shrink-0`}>
            <span className="text-white text-xs font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{name}</h1>
            <div className="text-xs text-gray-400 truncate">{item.subject || "Subject not captured"}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="space-y-3" role="status" aria-label="Loading message">
            <div className="h-24 animate-pulse rounded-2xl bg-muted" />
            <div className="h-14 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border p-4 text-sm" role="alert">
            <AlertTriangle className="mb-2 h-5 w-5 text-destructive" />
            <p>Message details could not be loaded; the preview is not substituted.</p>
            <Button variant="outline" className="mt-3" onClick={() => void refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center shrink-0`}>
                <span className="text-white text-xs font-semibold">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white">{name}</div>
                <div className="text-xs text-gray-400">{timeAgo(item.receivedAt || item.createdAt)}</div>
              </div>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
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
          <textarea
            data-testid="input-inbox-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Draft a reply…"
            rows={2}
            className="flex-1 resize-none rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
          />
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" disabled={!reply.trim() || !draft.ready || draft.loading || draft.save.isPending}
              onClick={() => draft.save.mutate({ subject: item.subject || "Re: Your inquiry", body: reply })}>
              {draft.save.isPending ? "Saving…" : "Save draft"}
            </Button>
            <Button size="sm" disabled aria-disabled="true" data-crm-paused="true" data-testid="button-send-reply"
               title={outbound.reason}><Send className="mr-1 h-4 w-4" />Send paused</Button>
          </div>
        </div>
      )}
      {item.channel !== "voicemail" && <div className="px-4 pb-2 text-xs text-muted-foreground" role="status" data-crm-paused="true">
         {outbound.reason} {draft.error ? `Draft issue: ${draft.error}` : draft.savedAt ? `Draft saved ${timeAgo(draft.savedAt)}` : "Drafts save only when requested."}
        {draft.error && <button type="button" disabled={draft.loading || draft.save.isPending}
          className="ml-2 underline" onClick={() => draft.ready
            ? draft.retrySave({ subject: item.subject || "Re: Your inquiry", body: reply })
            : draft.reopen()}>
          {draft.ready ? "Retry draft save" : "Reopen authorized draft"}
        </button>}
      </div>}
    </div>
  );
}

export default function MobileInbox() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const locationSearch = useSearch();
  const workspace = inboxWorkspaceState(locationSearch);
  const { search, filter, channel } = workspace;
  const changeWorkspace = (patch: Parameters<typeof buildInboxWorkspaceHref>[1], replace = false) =>
    navigate(buildInboxWorkspaceHref(window.location.href, patch), { replace });
  useEffect(() => {
    if (new URLSearchParams(locationSearch).has("tab") && workspace.issues.length === 0) {
      navigate(buildInboxWorkspaceHref(window.location.href, workspace), { replace: true });
    }
  }, [locationSearch, navigate]);
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } =
    useCrmInfiniteQuery<InboxSourcePage, Error, InfiniteData<InboxSourcePage>, QueryKey, string | null>({
    queryKey: ["/api/inbox/items", { channel, filter, limit: 30 }],
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ channel, filter, limit: "30" });
      if (pageParam) params.set("cursor", pageParam);
      const res = await apiRequest("GET", `/api/inbox/items?${params.toString()}`, undefined, undefined, signal);
      return decodeInboxSourcePage(await res.json());
    },
    getNextPageParam: lastPage => lastPage.nextCursor || undefined,
    staleTime: 1000 * 30,
  });

  const selected = useQuery({
    queryKey: ["/api/inbox/items", workspace.thread],
    enabled: !!workspace.thread && workspace.issues.length === 0,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", `/api/inbox/items/${encodeURIComponent(workspace.thread)}`, undefined, undefined, signal);
      return decodeInboxSourceItem(await response.json(), workspace.thread);
    },
  });
  const pages = data?.pages ?? [];
  const items = pages.flatMap(page => page.items);
  const lastPage = pages.at(-1);
  const degraded = pages.some(page => !page.complete || page.sourceStatus?.some(source => source.status === "failed"));
  const unreadCount = items.filter((i) => i.isRead === false).length;
  const filtered = items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.contactName?.toLowerCase().includes(q) ||
      item.subject?.toLowerCase().includes(q) ||
      item.preview?.toLowerCase().includes(q)
      || item.companyName?.toLowerCase().includes(q)
    );
  });

  if (workspace.thread && workspace.issues.length === 0) {
    const back = () => changeWorkspace({ thread: "" });
    if (selected.isError) return <div className="p-4 space-y-3">
      <Button variant="outline" onClick={back}>Back to loaded messages</Button>
      <CrmDataState state="unavailable"
        message="The selected source may be missing, unmapped or outside your current access. No preview or reply channel is substituted."
        onRetry={() => void selected.refetch()} />
    </div>;
    if (!selected.data) return <div className="p-4 space-y-3">
      <Button variant="outline" onClick={back}>Back to loaded messages</Button>
      <CrmDataState state="loading" message="Loading authorized message" />
    </div>;
    return <ThreadView key={`${user?.id}:${protectedContextToken()}:${selected.data.id}:${selected.data.channel}`}
      item={selected.data} onBack={back} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="bg-white dark:bg-gray-900 px-4 pb-3 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <div className="flex items-center justify-between mb-3 pr-14">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Inbox</h1>
          <span className="text-xs text-gray-400">
             {unreadCount > 0 ? `${unreadCount} unread loaded` : `${items.length} messages loaded`}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <Input
            data-testid="input-search-inbox"
            type="search"
            value={search}
            onChange={(e) => changeWorkspace({ search: e.target.value, thread: "" }, true)}
            placeholder="Search loaded messages"
            aria-label="Search loaded messages"
            className="w-full h-11 rounded-xl border-0 bg-gray-100 pl-9 pr-4 text-sm text-gray-900 placeholder-gray-400 focus-visible:ring-primary dark:bg-gray-800 dark:text-white"
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          Channel
          <select aria-label="Message channel" value={channel}
            onChange={event => changeWorkspace({ channel: event.target.value as typeof channel, thread: "" })}
            className="min-h-11 min-w-0 flex-1 rounded-md border bg-background px-3">
            {inboxChannels.map(value => <option key={value} value={value}>
              {value === "all" ? "All channels" : value === "ghl_chat" ? "GHL chat" : value === "site" ? "Site chat" : value}
            </option>)}
          </select>
        </label>
        <div className="mt-3 flex gap-2 flex-wrap" aria-label="Inbox filters">
          {(["all", "unread", "needs_reply"] as const).map(value => <button key={value} type="button"
            aria-pressed={filter === value} onClick={() => changeWorkspace({ filter: value, thread: "" })}
            className={`min-h-9 rounded-full px-3 text-xs font-semibold ${filter === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {value === "all" ? "All" : value === "unread" ? `Unread · ${unreadCount}` : "Needs Reply"}
          </button>)}
        </div>
        {degraded && <p className="mt-2 text-xs text-amber-700" role="status">Partial source window. A partial list is not treated as empty.</p>}
        {workspace.issues.map((issue, index) => <p key={index} role="status" className="mt-2 text-sm">{issue.reason}</p>)}
        <details className="mt-2 text-sm">
          <summary className="min-h-11 cursor-pointer flex items-center">Source coverage</summary>
          <ul>{lastPage?.sourceStatus.map(source => <li key={source.source}>
            {source.source}: {source.status}{source.truncated ? " · more source rows remain or coverage is unknown" : ""}
          </li>)}</ul>
          {degraded && <Button variant="outline" onClick={() => void refetch()}>Retry sources</Button>}
        </details>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 p-4" role="status" aria-label="Loading inbox">
            {[1, 2, 3].map(index => <div key={index} className="h-20 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : isError ? (
          <div className="mx-4 my-8 rounded-xl border p-4 text-center" role="alert">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-destructive" />
            <p className="text-sm">Inbox sources could not be loaded. No empty state is assumed.</p>
            <Button variant="outline" className="mt-3" onClick={() => void refetch()}>Retry</Button>
          </div>
        ) : degraded && filtered.length === 0 ? (
          <div className="py-12 px-4 text-center text-sm text-muted-foreground">Sources are incomplete; this is not a confirmed empty inbox.</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 px-4">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">
               {search ? "No loaded messages match; other source windows have not been searched." : "Your inbox is empty"}
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((item) => {
              const name = item.contactName || "Unknown";
              const color = avatarColor(name);
              const initials = getInitials(name);
              return (
                <button
                  type="button"
                  key={item.id}
                  data-testid={`inbox-item-${item.id}`}
                   onClick={() => changeWorkspace({ thread: item.id })}
                  className={`flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-gray-50 dark:active:bg-gray-700 ${
                    !item.isRead ? "bg-blue-50/50 dark:bg-blue-900/10" : ""
                  }`}
                >
                  <div className={`w-9 h-9 rounded-full ${color} flex items-center justify-center shrink-0 mt-0.5`}>
                    <span className="text-white text-xs font-semibold">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate ${!item.isRead
                        ? "font-semibold text-gray-900 dark:text-white"
                        : "font-medium text-gray-700 dark:text-gray-300"}`}>
                        {name}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0 flex items-center gap-1">
                        <Clock className="w-3 h-3" />{timeAgo(item.receivedAt || item.updatedAt || item.createdAt)}
                      </span>
                    </div>
                    <div className={`text-xs truncate mt-0.5 ${!item.isRead
                      ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}`}>
                      {item.subject || "(No subject)"}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      {item.channel && <span className="capitalize">{item.channel.replace("_", " ")}</span>}
                      {item.companyName && <span className="truncate">{item.companyName}</span>}
                    </div>
                    {item.preview && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
                        {stripHtml(item.preview).slice(0, 80)}
                      </div>
                    )}
                  </div>
                  {!item.isRead && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2" />}
                </button>
              );
            })}
          </div>
        )}
        {(hasNextPage || isFetchNextPageError) && <div className="p-4">
          {isFetchNextPageError && <p className="mb-2 text-xs text-destructive" role="alert">Next source window failed; current messages are unchanged.</p>}
          <Button className="w-full" variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {isFetchingNextPage ? "Loading…" : isFetchNextPageError ? "Retry next window" : "Load more"}
          </Button>
        </div>}
        {!isLoading && filtered.length > 0 && <p className="px-4 pb-4 text-center text-xs text-muted-foreground">
          {filtered.length} matching messages loaded{lastPage && !lastPage.totalIsExact ? " · total not exact" : ""}
        </p>}
      </div>
    </div>
  );
}
