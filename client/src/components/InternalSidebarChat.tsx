import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, X, ThumbsUp, ThumbsDown, Loader2, ChevronRight, PhoneCall, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { getCsrfToken } from "@/lib/queryClient";

interface Source {
  title: string;
  sourceId: number;
  chunkId: number;
  relevance: number;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  lowConfidence?: boolean;
  handoffSuggested?: boolean;
  rating?: "thumbs_up" | "thumbs_down";
}

async function apiPost(path: string, body: unknown) {
  const csrfToken = await getCsrfToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return res.json();
}

const SUGGESTIONS = [
  "How do I handle a chargeback?",
  "What are the onboarding steps for a new merchant?",
  "Explain the 0% processing program",
  "Draft a follow-up email for a statement review lead",
  "What docs are required for merchant application?",
];

export function InternalSidebarChat({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "ready" | "unavailable">("idle");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  // Initialize session
  useEffect(() => {
    if (collapsed) return;
    (async () => {
      try {
        // Check readiness
        const ready = await fetch("/api/assistant/readiness").then(r => r.json());
        setStatus(ready.status ?? "unavailable");

        // Create session
        const csrfToken = await getCsrfToken();
        const data = await fetch("/api/assistant/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
          credentials: "include",
          body: JSON.stringify({ sessionId: sessionId ?? undefined }),
        }).then(r => r.json());

        if (data.sessionId) setSessionId(data.sessionId);
      } catch { setStatus("unavailable"); }
    })();
  }, [collapsed]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading || !sessionId) return;
    const userMsg: Message = { id: Date.now(), role: "user", content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const data = await apiPost("/api/assistant/chat", { sessionId, message: text.trim() });
      if (data.error) {
        setMessages(prev => [...prev, {
          id: Date.now() + 1, role: "assistant", content: data.error, lowConfidence: true,
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: data.messageId ?? Date.now() + 1,
          role: "assistant",
          content: data.answer,
          sources: data.sources ?? [],
          lowConfidence: data.lowConfidence ?? false,
          handoffSuggested: data.handoffSuggested ?? false,
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: "assistant",
        content: "I'm temporarily unavailable. Please try again or contact support directly.",
        lowConfidence: true,
      }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [loading, sessionId, scrollToBottom]);

  const handleFeedback = useCallback(async (msgId: number, rating: "thumbs_up" | "thumbs_down") => {
    if (!sessionId) return;
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rating } : m));
    try {
      await apiPost("/api/assistant/feedback", { messageId: msgId, sessionId, rating });
    } catch { /* non-critical */ }
  }, [sessionId]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    // Will re-create session on next message
    (async () => {
      const csrfToken = await getCsrfToken();
      const data = await fetch("/api/assistant/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({}),
      }).then(r => r.json());
      if (data.sessionId) setSessionId(data.sessionId);
    })();
  }, []);

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex items-center gap-1.5 bg-primary text-primary-foreground px-2 py-4 rounded-l-lg shadow-lg hover:bg-primary/90 transition-colors text-xs font-medium writing-mode-vertical"
        aria-label="Open AI Assistant"
        data-testid="button-internal-chat-open"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        <Bot className="w-4 h-4" />
        <span>AI</span>
      </button>
    );
  }

  return (
    <aside
      className="flex flex-col h-full border-l border-border bg-background w-80 shrink-0"
      data-testid="internal-sidebar-chat"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-primary/5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">Liberty AI</p>
            <div className="flex items-center gap-1">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                status === "ready" ? "bg-emerald-500" : status === "unavailable" ? "bg-red-400" : "bg-amber-400"
              )} />
              <span className="text-[10px] text-muted-foreground capitalize">
                {status === "idle" ? "connecting…" : status}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={clearChat} aria-label="Clear chat" data-testid="button-internal-chat-clear">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onToggle} aria-label="Close AI assistant" data-testid="button-internal-chat-close">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Role badge */}
      <div className="px-3 py-1.5 border-b border-border/50 shrink-0">
        <Badge variant="outline" className="text-[10px] h-4">
          {user?.role ?? "staff"} · Grounded on Liberty Bancard KB
        </Badge>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center py-2">
                Ask me anything about Liberty Bancard products, onboarding, compliance, or sales.
              </p>
              <div className="space-y-1.5">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s)}
                    className="w-full text-left text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-accent transition-colors flex items-center gap-1.5"
                    data-testid={`button-suggestion-${i}`}
                  >
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={`${msg.id}-${i}`} className={cn("flex flex-col gap-1", msg.role === "user" && "items-end")}>
              <div className={cn(
                "rounded-xl px-3 py-2 text-xs max-w-[90%] break-words leading-relaxed",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted border border-border/50 rounded-bl-sm"
              )} data-testid={`msg-internal-${i}`}>
                {msg.content}
              </div>

              {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                <div className="flex flex-wrap gap-1 max-w-[90%]">
                  {msg.sources.slice(0, 3).map((s, si) => (
                    <span key={si} className="text-[9px] px-1.5 py-0.5 bg-primary/8 text-primary rounded border border-primary/20">
                      {s.title}
                    </span>
                  ))}
                </div>
              )}

              {msg.role === "assistant" && msg.lowConfidence && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 max-w-[90%]">
                  Low confidence — consider escalating to a human.
                </p>
              )}

              {msg.role === "assistant" && msg.handoffSuggested && (
                <a
                  href="mailto:support@libertybancard.com"
                  className="text-[10px] text-primary flex items-center gap-0.5 hover:underline"
                  data-testid={`link-handoff-${i}`}
                >
                  <PhoneCall className="w-3 h-3" /> Contact support
                </a>
              )}

              {msg.role === "assistant" && msg.id > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleFeedback(msg.id, "thumbs_up")}
                    className={cn("p-0.5 rounded hover:bg-accent transition-colors", msg.rating === "thumbs_up" && "text-emerald-600")}
                    aria-label="Thumbs up"
                    data-testid={`button-thumbsup-${i}`}
                  >
                    <ThumbsUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleFeedback(msg.id, "thumbs_down")}
                    className={cn("p-0.5 rounded hover:bg-accent transition-colors", msg.rating === "thumbs_down" && "text-red-500")}
                    aria-label="Thumbs down"
                    data-testid={`button-thumbsdown-${i}`}
                  >
                    <ThumbsDown className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-2 items-center">
              <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <Bot className="w-3 h-3 text-primary-foreground" />
              </div>
              <div className="bg-muted border border-border/50 rounded-xl rounded-bl-sm px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-2 border-t border-border shrink-0">
        <div className="flex gap-1.5 items-end">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder="Ask Liberty AI…"
            className="flex-1 resize-none text-xs min-h-[36px] max-h-[100px]"
            rows={1}
            disabled={loading || status === "unavailable"}
            data-testid="input-internal-chat"
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim() || status === "unavailable"}
            aria-label="Send message"
            data-testid="button-internal-chat-send"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
        <p className="text-[9px] text-muted-foreground mt-1 text-center">
          AI may make mistakes · Verify with official Liberty docs · No outbound actions
        </p>
      </div>
    </aside>
  );
}
