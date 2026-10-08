/**
 * CommsHub — Unified Communications Hub
 *
 * Single chronological feed of all inbound channels:
 *   email / SMS / GHL chat / voicemail / site (live-chat)
 *
 * Two-panel layout:
 *   left  = scrollable item list with filter pills + smart filters
 *   right = conversation panel (cross-channel thread + channel-appropriate reply)
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCrmInfiniteQuery } from "@/hooks/use-crm-infinite-query";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { useOutboundPauseObservation } from "@/hooks/use-outbound-pause-observation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mail, MessageSquare, Phone, Voicemail, Globe, RefreshCw, Loader2,
  AlertTriangle, Search, X, Send, ArrowLeft, ExternalLink, Bot,
  CheckCircle2, Link2, Volume2, Play, Clock, Flag, User, Inbox,
} from "lucide-react";
import { apiRequest, protectedContextToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { useMessageDraft } from "@/hooks/use-message-draft";
import { CrmPageHeader, CrmDataState } from "@/components/crm/CrmPresentation";
import { decodeInboxSourceItem, decodeInboxSourcePage } from "@/lib/inbox-source";
import { buildInboxWorkspaceHref, inboxWorkspaceState } from "@/lib/crm-destination-state";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ChannelType = "all" | "email" | "sms" | "ghl_chat" | "voicemail" | "site";
type SmartFilter = "all" | "unread" | "needs_reply";

interface InboxItem {
  id: string;
  contactId: number | null;
  contactName: string;
  companyName: string;
  channel: "email" | "sms" | "ghl_chat" | "voicemail" | "site";
  direction: "inbound";
  body: string;
  subject?: string;
  preview?: string;
  receivedAt: string;
  intentLabel: string | null;
  confidence: number | null;
  isRead: boolean | null;
  assignedTo?: string | null;
  aiIntent?: string | null;
  phone?: string;
  ghlConversationId?: string;
  voicemailDuration?: number | null;
  voicemailUrl?: string | null;
  transcript?: string | null;
  liveChatSessionId?: string | null;
  liveChatStatus?: string | null;
  pageUrl?: string | null;
}

interface ThreadEvent {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  provider: string | null;
  body: string | null;
  subject: string | null;
  status: string;
  intent?: string | null;
  confidence?: number | null;
  createdAt: string;
  metadata?: Record<string, any> | null;
}

// ─── Channel metadata ───────────────────────────────────────────────────────

const CHANNEL_META: Record<string, { label: string; icon: React.ReactNode; color: string; pillColor: string }> = {
  email: {
    label: "Email",
    icon: <Mail className="w-3.5 h-3.5" />,
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    pillColor: "bg-blue-500",
  },
  sms: {
    label: "SMS",
    icon: <Phone className="w-3.5 h-3.5" />,
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    pillColor: "bg-green-500",
  },
  ghl_chat: {
    label: "GHL Chat",
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    pillColor: "bg-purple-500",
  },
  voicemail: {
    label: "Voicemail",
    icon: <Voicemail className="w-3.5 h-3.5" />,
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    pillColor: "bg-orange-500",
  },
  site: {
    label: "Site Chat",
    icon: <Globe className="w-3.5 h-3.5" />,
    color: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
    pillColor: "bg-teal-500",
  },
};

const INTENT_META: Record<string, { label: string; color: string }> = {
  interested: { label: "Interested", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  meeting_intent: { label: "Meeting", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  pricing_question: { label: "Pricing", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" },
  call_me: { label: "Call requested", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  not_interested: { label: "Not interested", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  stop: { label: "Opt-out", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  angry: { label: "Escalated tone", color: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100" },
  send_info: { label: "Information requested", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200" },
  booked: { label: "Booked", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
  unclear: { label: "Unclear", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "Time unavailable";
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Item Card ──────────────────────────────────────────────────────────────

function ItemCard({ item, selected, onClick }: { item: InboxItem; selected: boolean; onClick: () => void }) {
  const meta = CHANNEL_META[item.channel] || CHANNEL_META.email;
  const intentMeta = item.intentLabel ? INTENT_META[item.intentLabel] : null;

  return (
    <button
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border/60 hover:bg-accent/50 transition-colors",
        selected && "bg-accent",
        !item.isRead && "bg-primary/[0.03]"
      )}
      onClick={onClick}
      data-testid={`inbox-item-${item.id}`}
    >
      <div className="flex items-start gap-2.5">
        {/* Unread dot */}
        <div className="mt-1.5 shrink-0">
          {!item.isRead ? (
            <span className="flex h-2 w-2 rounded-full bg-primary" />
          ) : (
            <span className="flex h-2 w-2" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={cn("text-sm font-medium truncate", !item.isRead && "font-semibold")}>
              {item.contactName}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{formatTime(item.receivedAt)}</span>
          </div>

          {/* Channel badge + company */}
          <div className="flex items-center gap-1.5 mb-1">
            <Badge className={cn("text-[10px] px-1.5 py-0 h-4 gap-0.5 font-normal", meta.color)}>
              {meta.icon}
              {meta.label}
            </Badge>
            {item.companyName && (
              <span className="text-[10px] text-muted-foreground truncate">{item.companyName}</span>
            )}
          </div>

          {/* Preview text */}
          {item.channel === "voicemail" ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Volume2 className="w-3 h-3 shrink-0" />
              <span className="truncate">
                Voicemail{item.voicemailDuration ? ` · ${formatDuration(item.voicemailDuration)}` : ""}
                {item.transcript ? ` · "${item.transcript.slice(0, 60)}…"` : ""}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground truncate">
              {item.preview || item.body}
            </p>
          )}

          {/* AI intent badge */}
          {intentMeta && (
            <div className="mt-1">
              <Badge className={cn("text-[10px] px-1.5 py-0 h-4 font-normal", intentMeta.color)}>
                {intentMeta.label}
              </Badge>
            </div>
          )}

          {/* Assigned to chip */}
          {item.assignedTo && (
            <div className="flex items-center gap-0.5 mt-0.5 text-[10px] text-muted-foreground">
              <User className="w-2.5 h-2.5" />
              {item.assignedTo}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Thread Panel ───────────────────────────────────────────────────────────

function ThreadPanel({ item, onBack }: { item: InboxItem; onBack: () => void }) {
  const outbound=useOutboundPauseObservation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const draftChannel = item.channel;
  const draft = useMessageDraft(
    { contextType: "inbox", contextId: item.id, channel: draftChannel },
    !!item.contactId && item.channel !== "voicemail",
    loaded => setReplyText(loaded.body),
  );
  const meta = CHANNEL_META[item.channel] || CHANNEL_META.email;

  // Fetch cross-channel thread (only when contactId available)
  const { data: threadData, isLoading: threadLoading, isError: threadError, refetch: retryThread } = useQuery<{
    contactId: number;
    timeline: ThreadEvent[];
    total: number;
  }>({
    queryKey: ["/api/inbox/contacts", item.contactId, "thread"],
      queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/inbox/contacts/${item.contactId}/thread`, undefined, undefined, signal);
      return res.json();
    },
    enabled: !!item.contactId,
    staleTime: 30000,
  });

  // For SMS threads, also fetch the GHL conversation
  const { data: smsThread, isLoading: smsLoading, isError: smsError, refetch: retrySms } = useQuery<{ messages: any[] }>({
    queryKey: ["/api/sms-inbox/thread", item.ghlConversationId],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/sms-inbox/thread/${item.ghlConversationId}`, undefined, undefined, signal);
      return res.json();
    },
    enabled: item.channel === "sms" && !!item.ghlConversationId,
    staleTime: 15000,
    refetchInterval: item.channel === "sms" ? 15000 : false,
  });

  // For live-chat, fetch messages
  const chatId = item.id.startsWith("chat-")
    ? parseInt(item.id.replace("chat-", ""), 10)
    : item.channel === "site"
      ? Number(item.id.match(/:(\d+)$/)?.[1]) || null
      : null;
  const { data: liveChatData, isLoading: liveChatLoading, isError: liveChatError, refetch: retryLiveChat } = useQuery<{ messages: any[]; chat: any }>({
    queryKey: ["/api/live-chat/sessions", chatId, "messages"],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/live-chat/sessions/${chatId}/messages`, undefined, undefined, signal);
      return res.json();
    },
    enabled: item.channel === "site" && !!chatId,
    staleTime: 10000,
    refetchInterval: item.channel === "site" ? 10000 : false,
  });

  const canLinkAnonymousChat = item.channel === "site" && !item.contactId && !!chatId && (user?.role === "admin" || user?.role === "manager");
  const contactSearch = useQuery<Array<{ id: number; firstName: string; lastName: string; email: string }>>({
    queryKey: ["/api/live-chat/contacts/search", linkSearch],
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", `/api/live-chat/contacts/search?q=${encodeURIComponent(linkSearch)}`, undefined, undefined, signal);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row?.id) || row.id <= 0)) {
        throw new Error("Contact search returned an invalid result; no empty result is inferred.");
      }
      return rows;
    },
    enabled: canLinkAnonymousChat && linkSearch.trim().length >= 2,
  });
  const linkContactMutation = useMutation({
    onMutate: () => ({ context: protectedContextToken(), sourceId: item.id }),
    mutationFn: async (contactId: number) => {
      const response = await apiRequest("PATCH", `/api/live-chat/sessions/${chatId}`, { contactId });
      return response.json();
    },
    onSuccess: (_result, _contactId, submitted) => {
      if (submitted?.context !== protectedContextToken() ||
        submitted.sourceId !== inboxWorkspaceState(window.location.search).thread) return;
      toast({ title: "Chat linked to contact" });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-chat/sessions", chatId, "messages"] });
    },
    onError: (error: any, _contactId, submitted) => {
      if (submitted?.context === protectedContextToken() &&
        submitted.sourceId === inboxWorkspaceState(window.location.search).thread)
        toast({ title: "Could not link chat", description: error.message, variant: "destructive" });
    },
  });

  const canReply = !!item.contactId && item.channel !== "voicemail";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Button variant="ghost" size="icon" className="h-7 w-7 lg:hidden" onClick={onBack} aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{item.contactName}</span>
            <Badge className={cn("text-[10px] px-1.5 py-0 h-4 gap-0.5 font-normal", meta.color)}>
              {meta.icon}
              {meta.label}
            </Badge>
            {item.intentLabel && INTENT_META[item.intentLabel] && (
              <Badge className={cn("text-[10px] px-1.5 py-0 h-4 font-normal", INTENT_META[item.intentLabel].color)}>
                {INTENT_META[item.intentLabel].label}
              </Badge>
            )}
          </div>
          {item.phone && <p className="text-xs text-muted-foreground">{item.phone}</p>}
          {item.companyName && <p className="text-xs text-muted-foreground">{item.companyName}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.contactId && (
            <a
              href={`/dashboard/contacts/${item.contactId}`}
              className="text-xs text-sky-600 hover:underline flex items-center gap-0.5"
              data-testid="thread-contact-link"
            >
              <ExternalLink className="w-3 h-3" />
              View Contact
            </a>
          )}
          {item.channel === "site" && item.liveChatStatus === "active" && (
            <Badge className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
              Active
            </Badge>
          )}
        </div>
      </div>

      {/* Voicemail card */}
      {item.channel === "voicemail" && (
        <div className="p-4 border-b border-border bg-orange-50/50 dark:bg-orange-950/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
              <Voicemail className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Voicemail from {item.contactName}</p>
              <p className="text-xs text-muted-foreground">
                {formatTime(item.receivedAt)}
                {item.voicemailDuration ? ` · ${formatDuration(item.voicemailDuration)}` : ""}
              </p>
            </div>
            {item.voicemailUrl && (
              <a
                href={item.voicemailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
              >
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Play className="w-3.5 h-3.5" />
                  Play
                </Button>
              </a>
            )}
          </div>
          {item.transcript && (
            <div className="mt-3 p-3 bg-background rounded-lg border border-border">
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide font-medium">Transcript</p>
              <p className="text-sm leading-relaxed">{item.transcript}</p>
            </div>
          )}
          {!item.transcript && (
            <p className="text-xs text-muted-foreground mt-2">No transcript available. Click Play to listen.</p>
          )}
        </div>
      )}

      {/* Thread / message history */}
      <ScrollArea className="flex-1 min-h-0 p-4">
        {/* SMS thread */}
        {item.channel === "sms" && (
          <>
            {smsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : smsError ? (
              <div className="py-8 text-center" role="alert"><p className="text-sm text-destructive">SMS conversation history is unavailable.</p><Button variant="outline" className="mt-3" onClick={() => void retrySms()}>Retry history</Button></div>
            ) : (smsThread?.messages || []).length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">No messages yet.</p>
            ) : (
              <div className="space-y-3">
                {(smsThread?.messages || []).map((msg: any) => {
                  const isOut = msg.direction === "outbound";
                  return (
                    <div key={msg.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[75%] rounded-xl px-3 py-2 text-sm",
                        isOut ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                      )}>
                        <p>{msg.body}</p>
                        <p className={cn("text-[10px] mt-1", isOut ? "text-primary-foreground/70" : "text-muted-foreground")}>
                          {formatTime(msg.dateAdded)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Live chat thread */}
        {item.channel === "site" && (
          <>
            {liveChatLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : liveChatError ? (
              <div className="py-8 text-center" role="alert"><p className="text-sm text-destructive">Site conversation history is unavailable.</p><Button variant="outline" className="mt-3" onClick={() => void retryLiveChat()}>Retry history</Button></div>
            ) : (liveChatData?.messages || []).length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">No messages yet.</p>
            ) : (
              <div className="space-y-3">
                {(liveChatData?.messages || []).map((msg: any) => {
                  const isAgent = msg.senderType === "agent";
                  return (
                    <div key={msg.id} className={cn("flex gap-2 items-end", isAgent ? "flex-row-reverse" : "flex-row")}>
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                        isAgent ? "bg-foreground text-background" : "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400"
                      )}>
                        {isAgent ? "A" : "V"}
                      </div>
                      <div className="max-w-[75%]">
                        <div className={cn(
                          "rounded-xl px-3 py-2 text-sm shadow-sm break-words",
                          isAgent ? "bg-foreground text-background rounded-br-sm" : "bg-muted text-foreground border border-border rounded-bl-sm"
                        )}>
                          {msg.content}
                        </div>
                        <p className={cn("text-[10px] text-muted-foreground mt-0.5", isAgent ? "text-right" : "text-left")}>
                          {msg.senderName || (isAgent ? "Agent" : "Visitor")} · {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Cross-channel thread (email / ghl_chat / or when contactId is available) */}
        {(item.channel === "email" || item.channel === "ghl_chat") && (
          <>
            {!item.contactId ? (
              <div className="text-center py-8">
                <Bot className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No contact linked — unable to load thread.</p>
              </div>
            ) : threadLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : threadError ? (
              <div className="py-8 text-center" role="alert"><p className="text-sm text-destructive">Communication history is unavailable.</p><Button variant="outline" className="mt-3" onClick={() => void retryThread()}>Retry history</Button></div>
            ) : (threadData?.timeline || []).length === 0 ? (
              <div className="text-center py-8">
                <Inbox className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                {item.body ? <div className="min-w-0 text-left">
                  <p className="mb-2 text-xs text-muted-foreground">Selected incoming source message · canonical history contains no additional messages</p>
                  <p className="whitespace-pre-wrap break-all text-sm" data-testid="selected-source-message">{item.body}</p>
                </div> : <p className="text-sm text-muted-foreground">Canonical history contains no messages. Selected source content is unavailable.</p>}
              </div>
            ) : (
              <div className="space-y-3">
                {(threadData?.timeline || []).map((event) => {
                  const isOut = event.direction === "outbound";
                  const chMeta = CHANNEL_META[event.channel as string] || CHANNEL_META.email;
                  return (
                    <div key={event.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[80%] rounded-xl px-3 py-2.5 text-sm",
                        isOut ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                      )}>
                        <div className={cn("flex items-center gap-1.5 mb-1 text-[10px]", isOut ? "text-primary-foreground/70" : "text-muted-foreground")}>
                          <span>{chMeta.icon}</span>
                          <span className="capitalize">{event.channel.replace("_", " ")}</span>
                          {event.subject && <span>· {event.subject}</span>}
                        </div>
                        <p className="whitespace-pre-wrap break-words leading-relaxed">{event.body || "(no content)"}</p>
                        <p className={cn("text-[10px] mt-1.5", isOut ? "text-primary-foreground/70" : "text-muted-foreground")}>
                          {formatTime(event.createdAt)}
                          {event.intent && ` · ${event.intent}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Original message (for voicemail and fallback) */}
        {item.channel === "voicemail" && !item.transcript && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            Voicemail transcription not available.
          </div>
        )}
      </ScrollArea>

      {/* Reply input */}
      {canReply && (
        <div className="p-4 border-t border-border shrink-0">
          <div className="mb-3 rounded-md p-3 text-sm" data-crm-paused="true" role="status">
            {outbound.reason} Your draft is saved only when you choose Save draft.
          </div>
          <div className="flex gap-2">
            <Textarea
              placeholder={
                item.channel === "sms" ? "Reply via SMS…"
                : item.channel === "site" ? "Reply to visitor…"
                : "Reply via email…"
              }
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              className="resize-none min-h-[70px] text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                }
              }}
              aria-label={`Draft reply for ${CHANNEL_META[item.channel]?.label ?? item.channel}`}
              data-testid="thread-reply-input"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {draft.error ? `Draft issue: ${draft.error}` : draft.savedAt ? `Saved ${formatDistanceToNow(new Date(draft.savedAt), { addSuffix: true })}` : "Not sent · Enter adds a line"}
            </p>
            <Button variant="outline" disabled={!replyText.trim() || !draft.ready || draft.loading || draft.save.isPending}
              onClick={() => draft.save.mutate({ subject: item.subject || `Re: Your inquiry`, body: replyText })}
              data-testid="thread-save-draft">
              {draft.save.isPending ? "Saving…" : "Save draft"}
            </Button>
            <Button disabled aria-disabled="true" title={outbound.reason} data-crm-paused="true" data-testid="thread-reply-send">
              <Send className="w-4 h-4" /> Send paused
            </Button>
          </div>
          {draft.error && <Button variant="ghost" disabled={draft.loading || draft.save.isPending}
            className="mt-1 h-auto px-0 underline"
            onClick={() => draft.ready
              ? draft.retrySave({ subject: item.subject || "Re: Your inquiry", body: replyText })
              : draft.reopen()}>
            {draft.ready ? "Retry saving draft" : "Reopen authorized draft"}
          </Button>}
        </div>
      )}

      {item.channel === "site" && (
        <div className="px-4 pb-3 shrink-0">
          <div className="flex gap-2 flex-wrap">
            {canLinkAnonymousChat && (
              <div className="w-full rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2" data-testid="live-chat-link-contact">
                <p className="text-xs font-medium text-amber-900">Link this anonymous chat before handing it to an agent.</p>
                <Input
                  value={linkSearch}
                  onChange={(event) => setLinkSearch(event.target.value)}
                  placeholder="Search contact name or email"
                  className="h-8 bg-background text-xs"
                  data-testid="live-chat-contact-search"
                />
                {contactSearch.data?.map((contact) => (
                  <Button
                    key={contact.id}
                    variant="outline"
                    size="sm"
                    className="mr-1 h-7 text-xs"
                    onClick={() => linkContactMutation.mutate(contact.id)}
                    disabled={linkContactMutation.isPending}
                    data-testid={`live-chat-link-contact-${contact.id}`}
                  >
                    <Link2 className="mr-1 h-3 w-3" />
                    {contact.firstName} {contact.lastName} · {contact.email}
                  </Button>
                ))}
                {contactSearch.isError && <p role="alert" className="text-xs text-destructive">Authorized contact search failed. <button type="button" className="underline" onClick={() => void contactSearch.refetch()}>Retry</button></p>}
                {contactSearch.isLoading && <p role="status" className="text-xs text-muted-foreground">Searching authorized contacts…</p>}
              </div>
            )}
            {item.liveChatStatus === "active" && chatId && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1"
                onClick={async () => {
                  try {
                    await apiRequest("PATCH", `/api/live-chat/sessions/${chatId}`, { status: "closed" });
                    toast({ title: "Chat closed" });
                    queryClient.invalidateQueries({ queryKey: ["/api/inbox/items"] });
                  } catch {
                    toast({ title: "Failed to close chat", variant: "destructive" });
                  }
                }}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Close Chat
              </Button>
            )}
            {item.pageUrl && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />
                {item.pageUrl}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

const CHANNEL_FILTERS: { key: ChannelType; label: string; icon: React.ReactNode }[] = [
  { key: "all", label: "All", icon: <Inbox className="w-3.5 h-3.5" /> },
  { key: "email", label: "Email", icon: <Mail className="w-3.5 h-3.5" /> },
  { key: "sms", label: "SMS", icon: <Phone className="w-3.5 h-3.5" /> },
  { key: "voicemail", label: "Voicemail", icon: <Voicemail className="w-3.5 h-3.5" /> },
  { key: "ghl_chat", label: "Chat", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { key: "site", label: "Site", icon: <Globe className="w-3.5 h-3.5" /> },
];

export default function CommsHub() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const locationSearch = useSearch();
  const workspace = inboxWorkspaceState(locationSearch);
  useEffect(() => {
    const legacy = new URLSearchParams(locationSearch).get("tab");
    if ((legacy === "messages" || legacy === "live-chat") && workspace.issues.length === 0) {
      navigate(buildInboxWorkspaceHref(window.location.href, {
        channel: workspace.channel, filter: workspace.filter,
        search: workspace.search, thread: workspace.thread,
      }), { replace: true });
    }
  }, [locationSearch, navigate]);
  const channelFilter = workspace.channel as ChannelType;
  const smartFilter = workspace.filter as SmartFilter;
  const search = workspace.search;
  const { data, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError } = useCrmInfiniteQuery<{
    items: InboxItem[];
    knownFilteredCount: number;
    totalIsExact: boolean;
    resultScope: "all_sources_exhausted" | "partial_source_pages";
    complete: boolean;
    hasMoreKnown: boolean;
    sourceStatus: Array<{ source: string; status: "ok" | "failed" | "not_configured"; fetched: number; truncated: boolean; errorCode?: string }>;
    nextCursor: string | null;
    ghlConfigured: boolean;
  }>({
      queryKey: ["/api/inbox/items", { channel: channelFilter, filter: smartFilter, limit: 60 }],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ channel: channelFilter, filter: smartFilter, limit: "60" });
      if (typeof pageParam === "string" && pageParam) params.set("cursor", pageParam);
      const res = await apiRequest("GET", `/api/inbox/items?${params.toString()}`, undefined, undefined, signal);
      const body = await res.json();
      decodeInboxSourcePage(body);
      return body;
    },
    getNextPageParam: lastPage => lastPage.nextCursor || undefined,
    refetchInterval: 45000,
    staleTime: 30000,
  });

  const pages = data?.pages ?? [];
  const allItems = pages.flatMap(page => page.items);
  const lastPage = pages.at(-1);
  const inboxDegraded = pages.some(page => !page.complete || page.sourceStatus.some((source) => source.status === "failed"));

  // Client-side search filter
  const items = allItems.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    return (
      (item.contactName || "").toLowerCase().includes(q) ||
      (item.companyName || "").toLowerCase().includes(q) ||
      (item.body || "").toLowerCase().includes(q) ||
      (item.phone || "").includes(q)
    );
  });

  const unreadCount = allItems.filter(i => i.isRead === false).length;
  const voicemailCount = allItems.filter(i => i.channel === "voicemail").length;
  const siteActiveCount = allItems.filter(i => i.channel === "site" && i.liveChatStatus === "active").length;
  const selectedSource = useQuery({
    queryKey: ["/api/inbox/items", workspace.thread],
    enabled: !!workspace.thread && workspace.issues.length === 0,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", `/api/inbox/items/${encodeURIComponent(workspace.thread)}`, undefined, undefined, signal);
      return decodeInboxSourceItem(await response.json(), workspace.thread);
    },
  });
  const source = selectedSource.data;
  const loaded = allItems.find(item => item.id === workspace.thread);
  // Loaded-only media/model hints may supplement this occurrence, but never
  // supply its current contact, channel, body or source identity.
  const selected: InboxItem | null = source ? {
    ...loaded, id: source.id, contactId: source.contactId,
    contactName: source.contactName || "Unidentified contact",
    companyName: source.companyName || "", channel: source.channel,
    body: source.body ?? "", direction: "inbound", receivedAt: source.receivedAt || "",
    subject: source.subject ?? loaded?.subject, preview: source.preview ?? undefined,
    isRead: source.isRead, intentLabel: loaded?.intentLabel ?? null, confidence: loaded?.confidence ?? null,
    ghlConversationId: typeof source.ghlConversationId === "string" ? source.ghlConversationId : undefined,
    liveChatSessionId: typeof source.liveChatSessionId === "string" ? source.liveChatSessionId : undefined,
    liveChatStatus: typeof source.liveChatStatus === "string" ? source.liveChatStatus : undefined,
    pageUrl: typeof source.pageUrl === "string" ? source.pageUrl : undefined,
  } : null;
  const showPanel = !!workspace.thread;

  const handleSelect = (item: InboxItem) => {
    navigate(buildInboxWorkspaceHref(window.location.href, { thread: item.id }), { replace: false });
  };

  const handleBack = () => {
    navigate(buildInboxWorkspaceHref(window.location.href, { thread: "" }), { replace: false });
  };
  const changeWorkspace = (patch: Partial<Pick<typeof workspace, "channel" | "filter" | "search" | "thread">>, replace = false) =>
    navigate(buildInboxWorkspaceHref(window.location.href, patch), { replace });

  return (
    <div className="crm-page crm-inbox-workspace flex flex-col" data-testid="comms-hub">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap shrink-0">
        <div>
          <CrmPageHeader title="Inbox" description="Source-aware conversations in your authorized scope." />
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs" data-testid="badge-unread-count">
                {unreadCount} on page
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            All channels in one place — email, SMS, voicemail, chat, and site visitors
          </p>
          {inboxDegraded && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-testid="inbox-partial-state">
              Partial inbox window — one or more sources are unavailable or sampled.
            </p>
          )}
          {workspace.issues?.map((issue, index) => <p key={`${issue.key}-${index}`} className="mt-1 text-xs text-amber-700" role="status">{issue.reason}</p>)}
        </div>
        <div className="flex items-center gap-2">
          {voicemailCount > 0 && (
            <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 gap-1">
              <Voicemail className="w-3 h-3" />
              {voicemailCount} voicemail{voicemailCount !== 1 ? "s" : ""} on page
            </Badge>
          )}
          {siteActiveCount > 0 && (
            <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400 gap-1">
              <Globe className="w-3 h-3" />
              {siteActiveCount} live on page
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-inbox">
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Channel filter pills ── */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2 shrink-0">
        {CHANNEL_FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={channelFilter === f.key ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1.5 px-2.5"
            onClick={() => changeWorkspace({ channel: f.key, thread: "" })}
            data-testid={`filter-channel-${f.key}`}
          >
            {f.icon}
            {f.label}
          </Button>
        ))}
        <div className="w-px h-4 bg-border mx-1" />
        {/* Smart filters */}
        {(["all", "unread", "needs_reply"] as SmartFilter[]).map((f) => (
          <Button
            key={f}
            variant={smartFilter === f ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => changeWorkspace({ filter: f, thread: "" })}
            data-testid={`filter-smart-${f}`}
          >
            {f === "all" ? "All" : f === "unread" ? "Unread" : "Needs Reply"}
          </Button>
        ))}
      </div>

      {/* ── Two-panel layout ── */}
      <div className="crm-inbox-container flex-1 min-w-0 min-h-0">
      <div className="crm-inbox-layout">
        {/* Left panel — item list */}
        <Card className={cn(
          "crm-inbox-list flex flex-col min-w-0 min-h-0",
          showPanel && "crm-inbox-list-selected"
        )} data-testid="card-item-list">
          {/* Search */}
          <div className="p-3 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search loaded messages"
                value={search}
                onChange={(e) => changeWorkspace({ search: e.target.value, thread: "" }, true)}
                className="pl-8 h-8 text-sm"
                data-testid="input-search-inbox"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear inbox search"
                  onClick={() => changeWorkspace({ search: "", thread: "" }, true)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Item list */}
          <ScrollArea className="flex-1 min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="text-center py-8 px-4 text-sm text-muted-foreground" role="alert">
                <AlertTriangle className="w-5 h-5 text-yellow-500 mx-auto mb-2" />
                <p>Failed to load inbox. No empty state is assumed.</p>
                <Button variant="outline" className="mt-3" onClick={() => void refetch()}>Retry</Button>
              </div>
            ) : inboxDegraded && items.length === 0 ? (
              <div className="text-center py-12 px-4">
                <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                 {search && <p className="text-sm text-foreground mb-2">No loaded messages match your search</p>}
                <p className="text-sm text-muted-foreground">Inbox sources are unavailable or incomplete; this is not a confirmed empty inbox.</p>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Inbox className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {search ? "No loaded messages match your search" : "No messages on this loaded page"}
                </p>
              </div>
            ) : (
              <div>
                {items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    selected={selected?.id === item.id}
                    onClick={() => handleSelect(item)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Footer count */}
          {!isLoading && items.length > 0 && (
            <div className="px-4 py-2 border-t border-border shrink-0">
              <p className="text-[10px] text-muted-foreground">
                {items.length} matching messages loaded
                {lastPage && !lastPage.totalIsExact ? " · total not exact" : lastPage ? ` · ${lastPage.knownFilteredCount} known in scope` : ""}
              </p>
            </div>
          )}
          {(hasNextPage || isFetchNextPageError) && <div className="border-t p-2">
            {isFetchNextPageError && <p role="alert" className="mb-2 text-xs text-destructive">More source messages could not be loaded. Your current list is unchanged.</p>}
            <Button className="w-full" variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              {isFetchingNextPage ? "Loading next window…" : isFetchNextPageError ? "Retry next window" : "Load next window"}
            </Button>
          </div>}
        </Card>

        {/* Right panel — conversation / thread */}
        <Card className={cn(
          "crm-inbox-thread flex flex-col min-w-0 min-h-0",
          !showPanel && "crm-inbox-thread-unselected"
        )} data-testid="card-thread-panel">
          {workspace.thread && workspace.issues.length === 0 && selectedSource.isError ? (
            <div className="p-4">
              <CrmDataState state="unavailable"
                message="Selected source message is missing, unmapped or outside current access. No loaded preview is substituted."
                onRetry={() => void selectedSource.refetch()} />
              <Button variant="outline" onClick={handleBack}>Clear unavailable selection</Button>
            </div>
          ) : workspace.thread && workspace.issues.length === 0 && !selected ? (
            <div className="p-4"><CrmDataState state="loading" message="Loading authorized source message" /></div>
          ) : !selected ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Inbox className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground font-medium">{workspace.thread ? "This thread is not present in the loaded authorized source window." : "Select a message to view the conversation"}</p>
                <p className="text-xs text-muted-foreground mt-1">{workspace.thread ? "Clear the selection or refresh this channel; no other record was substituted." : "Source and channel identity remain attached to each thread."}</p>
                {workspace.thread && <Button variant="outline" className="mt-3" onClick={handleBack}>Clear unavailable selection</Button>}
              </div>
            </div>
          ) : (
            <ThreadPanel key={`${protectedContextToken()}:${selected.id}:${selected.channel}`} item={selected} onBack={handleBack} />
          )}
        </Card>
      </div>
      </div>
    </div>
  );
}
