import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, MessageCircle, User, Clock, X, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";

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

export default function LiveChat() {
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [lastMessageId, setLastMessageId] = useState(0);
  const [filterStatus, setFilterStatus] = useState<"active" | "all">("active");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const messages = chatData?.messages || [];
  const selectedChat = chatData?.chat || sessions.find(s => s.id === selectedChatId);

  useEffect(() => {
    if (messages.length > 0) {
      const maxId = Math.max(...messages.map(m => m.id));
      setLastMessageId(maxId);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages]);

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
          <Button variant="outline" size="icon" onClick={() => refetchSessions()} data-testid="refresh-sessions">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-0">
        {/* Sessions list */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="p-3 pb-2 shrink-0">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {filterStatus === "active" ? "Active Sessions" : "All Sessions"}
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 px-4">
                <MessageCircle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No {filterStatus === "active" ? "active" : ""} chats</p>
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {sessions.map(session => (
                  <button
                    key={session.id}
                    onClick={() => setSelectedChatId(session.id)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg transition-colors hover:bg-accent/50",
                      selectedChatId === session.id ? "bg-accent" : ""
                    )}
                    data-testid={`session-item-${session.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {session.visitorName || "Visitor"}
                        </span>
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
                ))}
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
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div>
                  <p className="font-semibold text-sm" data-testid="chat-visitor-name">
                    {selectedChat?.visitorName || "Visitor"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedChat?.visitorEmail || "No email"}
                    {selectedChat?.contactId && (
                      <a
                        href={`/dashboard/contacts/${selectedChat.contactId}`}
                        className="ml-2 text-sky-600 hover:underline"
                        data-testid="contact-link"
                      >
                        View Contact →
                      </a>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
    </div>
  );
}
