import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Send, MessageCircle, User, Clock, X, CheckCircle2, RefreshCw, Search, Link2, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { playChime, markSessionSeen, countUnreadSessions } from "@/lib/chatNotifications";

interface LiveChat {
  id: number;
  sessionId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  pageUrl: string | null;
  status: string;
  contactId: number | null;
  createdAt: string;
  lastMessageAt: string;
  closedAt: string | null;
}

interface ChatMessage {
  id: number;
  chatId: number;
  senderType: "visitor" | "agent";
  senderName: string | null;
  content: string;
  createdAt: string;
}

const BASE_TITLE = "Liberty Bancard";

interface ContactResult {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  companyName: string | null;
}

export default function LiveChat() {
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [filterStatus, setFilterStatus] = useState<"active" | "all">("active");
  const [sessionSearch, setSessionSearch] = useState("");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contactSearchRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Track lastMessageAt per session to detect new activity via the sessions poll
  const prevLastMessageAt = useRef<Record<number, string>>({});
  // True after the first session list load, so we don't chime on initial render
  const sessionsInitialized = useRef(false);
  // Keep a stable ref to selectedChatId for use inside effects without stale closure
  const selectedChatIdRef = useRef<number | null>(null);
  selectedChatIdRef.current = selectedChatId;

  const { data: sessions = [], isLoading: sessionsLoading, refetch: refetchSessions } = useQuery<LiveChat[]>({
    queryKey: ["/api/live-chat/sessions", filterStatus],
    queryFn: async () => {
      const res = await fetch(`/api/live-chat/sessions?status=${filterStatus}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
    refetchInterval: 8000,
  });

  const { data: chatData, isLoading: messagesLoading } = useQuery<{ messages: ChatMessage[]; chat: LiveChat }>({
    queryKey: ["/api/live-chat/sessions", selectedChatId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/live-chat/sessions/${selectedChatId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!selectedChatId,
    refetchInterval: 4000,
  });

  const { data: contactResults = [], isFetching: contactSearching } = useQuery<ContactResult[]>({
    queryKey: ["/api/live-chat/contacts/search", contactSearch],
    queryFn: async () => {
      if (contactSearch.trim().length < 2) return [];
      const res = await fetch(`/api/live-chat/contacts/search?q=${encodeURIComponent(contactSearch.trim())}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to search contacts");
      return res.json();
    },
    enabled: contactSearch.trim().length >= 2,
  });

  const messages = chatData?.messages || [];
  const selectedChat = chatData?.chat || sessions.find(s => s.id === selectedChatId);

  /** Returns true when the agent's tab is visible and focused. */
  const isTabFocused = () =>
    document.visibilityState === "visible" && document.hasFocus();

  // When the tab regains focus, mark the currently-open session as seen.
  useEffect(() => {
    const handleFocus = () => {
      if (selectedChatIdRef.current !== null) {
        markSessionSeen(selectedChatIdRef.current);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && selectedChatIdRef.current !== null) {
        markSessionSeen(selectedChatIdRef.current);
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // When a session is selected while the tab is focused, mark it seen immediately.
  useEffect(() => {
    if (selectedChatId !== null && isTabFocused()) {
      markSessionSeen(selectedChatId);
    }
  }, [selectedChatId]);

  // Detect new messages via the sessions list poll.
  // Chimes for any session whose lastMessageAt advanced — including the selected
  // session when the tab is NOT focused (agent is on another tab or window).
  useEffect(() => {
    if (sessions.length === 0) return;

    if (!sessionsInitialized.current) {
      // First load — record baseline timestamps without chiming.
      sessions.forEach(s => { prevLastMessageAt.current[s.id] = s.lastMessageAt; });
      sessionsInitialized.current = true;
      return;
    }

    let shouldChime = false;
    sessions.forEach(s => {
      const prev = prevLastMessageAt.current[s.id];
      if (prev === undefined) {
        // Newly appeared session — record baseline, no chime.
        prevLastMessageAt.current[s.id] = s.lastMessageAt;
        return;
      }
      if (s.lastMessageAt !== prev) {
        prevLastMessageAt.current[s.id] = s.lastMessageAt;
        const isCurrentlyOpen = s.id === selectedChatIdRef.current;
        // Chime for non-selected sessions always; for the selected session only
        // when the tab is not focused (agent isn't actually watching it).
        if (!isCurrentlyOpen || !isTabFocused()) {
          shouldChime = true;
        }
        // If the tab is focused and the session is open, mark it seen immediately.
        if (isCurrentlyOpen && isTabFocused()) {
          markSessionSeen(s.id);
        }
      }
    });

    if (shouldChime) playChime();
  }, [sessions]);

  const filteredSessions = sessions.filter(s => {
    if (!sessionSearch.trim()) return true;
    const q = sessionSearch.toLowerCase().trim();
    return (
      (s.visitorName || "").toLowerCase().includes(q) ||
      (s.visitorEmail || "").toLowerCase().includes(q) ||
      (s.pageUrl || "").toLowerCase().includes(q)
    );
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages]);

  // Update document title with unread count across ALL active sessions.
  // We do not exclude selectedChatId: if the tab is unfocused, that session can
  // still be unread because markSessionSeen is only called on actual focus.
  useEffect(() => {
    const activeSessions = sessions.filter(s => s.status === "active");
    const unread = countUnreadSessions(activeSessions);
    if (unread > 0) {
      document.title = `(${unread}) New Messages | ${BASE_TITLE}`;
    } else {
      document.title = `Live Chat | ${BASE_TITLE}`;
    }
    return () => {
      document.title = BASE_TITLE;
    };
  }, [sessions]);

  useEffect(() => {
    if (linkDialogOpen) {
      setContactSearch("");
      setTimeout(() => contactSearchRef.current?.focus(), 100);
    }
  }, [linkDialogOpen]);

  const replyMutation = useMutation({
    mutationFn: async ({ chatId, content }: { chatId: number; content: string }) => {
      const res = await apiRequest("POST", `/api/live-chat/sessions/${chatId}/reply`, { content });
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["/api/live-chat/sessions", selectedChatId, "messages"] });
    },
    onError: () => {
      toast({ title: "Failed to send reply", variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (chatId: number) => {
      const res = await apiRequest("PATCH", `/api/live-chat/sessions/${chatId}`, { status: "closed" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Chat closed", description: "Transcript saved to contact record." });
      queryClient.invalidateQueries({ queryKey: ["/api/live-chat/sessions", filterStatus] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-chat/sessions", selectedChatId, "messages"] });
    },
    onError: () => {
      toast({ title: "Failed to close chat", variant: "destructive" });
    },
  });

  const linkContactMutation = useMutation({
    mutationFn: async ({ chatId, contactId }: { chatId: number; contactId: number }) => {
      const res = await apiRequest("PATCH", `/api/live-chat/sessions/${chatId}`, { contactId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contact linked", description: "This chat is now linked to the CRM contact." });
      setLinkDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/live-chat/sessions", filterStatus] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-chat/sessions", selectedChatId, "messages"] });
    },
    onError: () => {
      toast({ title: "Failed to link contact", variant: "destructive" });
    },
  });

  const handleSendReply = () => {
    const text = replyText.trim();
    if (!text || !selectedChatId || replyMutation.isPending) return;
    replyMutation.mutate({ chatId: selectedChatId, content: text });
  };

  const statusColor: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    closed: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
    offline_captured: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col" data-testid="live-chat-page">
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-primary" data-testid="text-live-chat-title">Live Chat</h2>
          <p className="text-sm text-muted-foreground">Respond to visitor chats from the public website.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={filterStatus === "active" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("active")}
            data-testid="filter-active"
          >
            Active
          </Button>
          <Button
            variant={filterStatus === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("all")}
            data-testid="filter-all"
          >
            All
          </Button>
          <Button variant="outline" size="icon" aria-label="Refresh sessions" onClick={() => refetchSessions()} data-testid="refresh-sessions">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-0">
        {/* Sessions list */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="p-3 pb-2 shrink-0 space-y-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {filterStatus === "active" ? "Active Sessions" : "All Sessions"}
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name, email, or URL…"
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="session-search-input"
              />
              {sessionSearch && (
                <button
                  onClick={() => setSessionSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="session-search-clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </CardHeader>
          <ScrollArea className="flex-1">
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="text-center py-8 px-4">
                <MessageCircle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {sessionSearch ? "No sessions match your search" : `No ${filterStatus === "active" ? "active" : ""} chats`}
                </p>
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {filteredSessions.map(session => {
                  const isUnread = countUnreadSessions([session]) > 0 && session.id !== selectedChatId;
                  return (
                    <button
                      key={session.id}
                      onClick={() => {
                        setSelectedChatId(session.id);
                        markSessionSeen(session.id);
                      }}
                      className={cn(
                        "w-full text-left p-3 rounded-lg transition-colors hover:bg-accent/50",
                        selectedChatId === session.id ? "bg-accent" : ""
                      )}
                      data-testid={`session-item-${session.id}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className={cn("text-sm font-medium truncate", isUnread && "font-bold text-foreground")}>
                            {session.visitorName || "Visitor"}
                          </span>
                          {isUnread && (
                            <span className="flex h-2 w-2 rounded-full bg-destructive shrink-0" data-testid={`unread-dot-${session.id}`} />
                          )}
                          {session.contactId && (
                            <UserCheck className="w-3 h-3 text-emerald-500 shrink-0" title="Linked to CRM contact" />
                          )}
                        </div>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize", statusColor[session.status] || statusColor.closed)}>
                          {session.status.replace("_", " ")}
                        </span>
                      </div>
                      {session.visitorEmail && (
                        <p className="text-xs text-muted-foreground truncate mb-1">{session.visitorEmail}</p>
                      )}
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(session.lastMessageAt), { addSuffix: true })}
                        {session.pageUrl && <span className="truncate ml-1 max-w-[100px]">· {session.pageUrl}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>

        {/* Chat panel */}
        <Card className="flex flex-col min-h-0">
          {!selectedChatId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageCircle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Select a chat to view messages</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 gap-2 flex-wrap">
                <div>
                  <p className="font-semibold text-sm" data-testid="chat-visitor-name">
                    {selectedChat?.visitorName || "Visitor"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedChat?.visitorEmail || "No email"}
                    {selectedChat?.contactId && (
                      <a
                        href={`/dashboard/contacts/${selectedChat.contactId}`}
                        className="ml-2 text-sky-600 hover:underline inline-flex items-center gap-0.5"
                        data-testid="contact-link"
                      >
                        <UserCheck className="w-3 h-3" />
                        View Contact →
                      </a>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLinkDialogOpen(true)}
                    className="gap-1.5 text-xs"
                    data-testid="link-contact-button"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    {selectedChat?.contactId ? "Change Contact" : "Link to Contact"}
                  </Button>
                  {selectedChat?.status === "active" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => closeMutation.mutate(selectedChatId)}
                      disabled={closeMutation.isPending}
                      data-testid="close-chat-button"
                      className="gap-1.5 text-xs"
                    >
                      {closeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      Close Chat
                    </Button>
                  )}
                  <Badge variant="outline" className={cn("text-xs capitalize", statusColor[selectedChat?.status || "active"])}>
                    {(selectedChat?.status || "active").replace("_", " ")}
                  </Badge>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                {messagesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-6">No messages yet. The visitor hasn't sent anything.</p>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg, i) => (
                      <div
                        key={msg.id}
                        className={cn("flex gap-2 items-end", msg.senderType === "agent" ? "flex-row-reverse" : "flex-row")}
                        data-testid={`message-item-${i}`}
                      >
                        <div className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          msg.senderType === "agent" ? "bg-[hsl(222,47%,11%)] text-white" : "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400"
                        )}>
                          {msg.senderType === "agent" ? "A" : "V"}
                        </div>
                        <div className="max-w-[75%]">
                          <div className={cn(
                            "rounded-xl px-3 py-2 text-sm shadow-sm break-words",
                            msg.senderType === "agent"
                              ? "bg-[hsl(222,47%,11%)] text-white rounded-br-sm"
                              : "bg-white dark:bg-gray-800 text-foreground border border-border rounded-bl-sm"
                          )}>
                            {msg.content}
                          </div>
                          <p className={cn(
                            "text-[10px] text-muted-foreground mt-0.5",
                            msg.senderType === "agent" ? "text-right" : "text-left"
                          )}>
                            {msg.senderName || (msg.senderType === "agent" ? "Agent" : "Visitor")}
                            {" · "}
                            {format(new Date(msg.createdAt), "h:mm a")}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              {/* Reply input */}
              {selectedChat?.status === "active" ? (
                <div className="px-4 py-3 border-t border-border shrink-0">
                  <div className="flex gap-2">
                    <Input
                      ref={inputRef}
                      placeholder="Type your reply…"
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
                      disabled={replyMutation.isPending}
                      data-testid="reply-input"
                    />
                    <Button
                      onClick={handleSendReply}
                      disabled={replyMutation.isPending || !replyText.trim()}
                      className="gap-1.5"
                      data-testid="reply-send-button"
                    >
                      {replyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Send
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3 border-t border-border shrink-0 text-center">
                  <p className="text-sm text-muted-foreground">This chat is closed.</p>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Link to Contact dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md" data-testid="link-contact-dialog">
          <DialogHeader>
            <DialogTitle>Link to CRM Contact</DialogTitle>
            <DialogDescription>
              Search for a contact by name, email, or company to manually link this chat session.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={contactSearchRef}
                placeholder="Search contacts…"
                value={contactSearch}
                onChange={e => setContactSearch(e.target.value)}
                className="pl-9"
                data-testid="contact-search-input"
              />
              {contactSearching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {contactSearch.trim().length > 0 && contactSearch.trim().length < 2 && (
              <p className="text-xs text-muted-foreground text-center py-2">Type at least 2 characters to search</p>
            )}

            {contactSearch.trim().length >= 2 && !contactSearching && contactResults.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No contacts found</p>
            )}

            {contactResults.length > 0 && (
              <div className="space-y-1 max-h-60 overflow-y-auto" data-testid="contact-search-results">
                {contactResults.map(contact => (
                  <button
                    key={contact.id}
                    onClick={() => {
                      if (selectedChatId) {
                        linkContactMutation.mutate({ chatId: selectedChatId, contactId: contact.id });
                      }
                    }}
                    disabled={linkContactMutation.isPending}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg border border-border hover:bg-accent/50 transition-colors",
                      selectedChat?.contactId === contact.id ? "bg-accent border-primary/30" : ""
                    )}
                    data-testid={`contact-result-${contact.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {contact.firstName} {contact.lastName}
                          {selectedChat?.contactId === contact.id && (
                            <span className="ml-1.5 text-[10px] text-emerald-600 font-normal">(current)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                        {contact.companyName && (
                          <p className="text-xs text-muted-foreground truncate">{contact.companyName}</p>
                        )}
                      </div>
                      {linkContactMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                      ) : (
                        <Link2 className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
