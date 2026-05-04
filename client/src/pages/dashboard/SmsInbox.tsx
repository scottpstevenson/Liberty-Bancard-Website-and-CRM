import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, Send, AlertTriangle, RefreshCw, Phone, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SmsThread {
  id: string;
  contactId: string;
  contactName: string;
  lastMessage: string;
  lastMessageDate: string | null;
  unread: boolean;
  unreadCount: number;
  phone: string;
}

interface SmsMessage {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  dateAdded: string;
  status: string;
  type: string;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function SmsInbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<SmsThread | null>(null);
  const [replyText, setReplyText] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<{ threads: SmsThread[]; configured: boolean; totalUnread: number }>({
    queryKey: ["/api/sms-inbox/threads"],
    refetchInterval: 30000,
  });

  const { data: threadData, isLoading: threadLoading } = useQuery<{ messages: SmsMessage[] }>({
    queryKey: ["/api/sms-inbox/thread", selectedThread?.id],
    enabled: !!selectedThread?.id,
    refetchInterval: 15000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await apiRequest("POST", `/api/sms-inbox/mark-read/${conversationId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sms-inbox/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sms-inbox/unread-count"] });
    },
  });

  const replyMutation = useMutation({
    mutationFn: async ({ conversationId, message }: { conversationId: string; message: string }) => {
      const res = await apiRequest("POST", "/api/sms-inbox/reply", { conversationId, message });
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["/api/sms-inbox/thread", selectedThread?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/sms-inbox/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sms-inbox/unread-count"] });
      toast({ title: "Message sent" });
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const threads = data?.threads || [];
  const filtered = threads.filter((t) =>
    !search || t.contactName.toLowerCase().includes(search.toLowerCase()) || t.phone.includes(search)
  );
  const messages = threadData?.messages || [];

  if (!data?.configured && !isLoading) {
    return (
      <div className="space-y-4" data-testid="page-sms-inbox">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">SMS Inbox</h2>
          <p className="text-muted-foreground">Two-way SMS messaging with your contacts</p>
        </div>
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
            <p className="font-medium mb-1">GHL not configured</p>
            <p className="text-sm text-muted-foreground">
              Set <code className="bg-muted px-1 rounded">GHL_API_KEY</code> and{" "}
              <code className="bg-muted px-1 rounded">GHL_LOCATION_ID</code> to enable SMS inbox.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="page-sms-inbox">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Messages
            {(data?.totalUnread || 0) > 0 && (
              <Badge variant="destructive" className="text-xs" data-testid="badge-sms-unread-count">
                {data?.totalUnread}
              </Badge>
            )}
          </h2>
          <p className="text-muted-foreground text-sm">Two-way SMS with your contacts via GHL</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-inbox">
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[600px]">
        {/* Thread list */}
        <Card className="md:col-span-1" data-testid="card-thread-list">
          <CardHeader className="pb-2 pt-4 px-4">
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
              data-testid="input-search-threads"
            />
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="text-center py-8 text-sm text-muted-foreground px-4">
                <AlertTriangle className="w-5 h-5 text-yellow-500 mx-auto mb-2" />
                Failed to load threads
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground px-4">
                <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-40" />
                {search ? "No matching conversations" : "No SMS conversations yet"}
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map((thread) => (
                  <button
                    key={thread.id}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${selectedThread?.id === thread.id ? "bg-muted" : ""}`}
                    onClick={() => {
                      setSelectedThread(thread);
                      if (thread.unreadCount > 0) {
                        markReadMutation.mutate(thread.id);
                      }
                    }}
                    data-testid={`thread-item-${thread.id}`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-sm font-medium truncate ${thread.unread ? "font-semibold" : ""}`}>
                        {thread.contactName}
                      </span>
                      <div className="flex items-center gap-1.5 ml-2 shrink-0">
                        {thread.unreadCount > 0 && (
                          <Badge variant="destructive" className="h-4 min-w-4 text-[10px] px-1">
                            {thread.unreadCount}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">{formatTime(thread.lastMessageDate)}</span>
                      </div>
                    </div>
                    {thread.phone && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                        <Phone className="w-3 h-3" />
                        {thread.phone}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground truncate">{thread.lastMessage || "No messages"}</p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Message view */}
        <Card className="md:col-span-2 flex flex-col" data-testid="card-message-view">
          {!selectedThread ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground p-8">
              <div className="text-center">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a conversation to view messages</p>
              </div>
            </div>
          ) : (
            <>
              <CardHeader className="pb-3 border-b">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 md:hidden"
                    aria-label="Back to threads"
                    onClick={() => setSelectedThread(null)}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div>
                    <CardTitle className="text-base" data-testid="text-selected-contact">
                      {selectedThread.contactName}
                    </CardTitle>
                    {selectedThread.phone && (
                      <p className="text-xs text-muted-foreground">{selectedThread.phone}</p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[420px]">
                {threadLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No messages in this conversation
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOutbound = msg.direction === "outbound";
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                        data-testid={`message-${msg.id}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                            isOutbound
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          <p>{msg.body}</p>
                          <p className={`text-[10px] mt-1 ${isOutbound ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            {formatTime(msg.dateAdded)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Type a message..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className="resize-none min-h-[60px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (replyText.trim()) replyMutation.mutate({ conversationId: selectedThread.id, message: replyText.trim() });
                      }
                    }}
                    data-testid="textarea-reply"
                  />
                  <Button
                    onClick={() => {
                      if (replyText.trim()) replyMutation.mutate({ conversationId: selectedThread.id, message: replyText.trim() });
                    }}
                    disabled={!replyText.trim() || replyMutation.isPending}
                    className="shrink-0"
                    data-testid="button-send-reply"
                  >
                    {replyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Press Enter to send, Shift+Enter for new line</p>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
