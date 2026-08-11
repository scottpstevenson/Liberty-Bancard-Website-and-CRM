/**
 * DashboardDataAgent — floating bottom-right AI assistant for logged-in
 * dashboard users.  Answers questions about data, reporting, company
 * historicals, pipeline metrics, and platform best-practices.
 *
 * Uses the same /api/assistant/* endpoints as InternalSidebarChat but is
 * surfaced as a compact floating bubble (not the full sidebar panel) so
 * it's always accessible without displacing the main content area.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot,
  Send,
  X,
  Minimize2,
  Maximize2,
  Loader2,
  ChevronDown,
  BarChart2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { getCsrfToken } from "@/lib/queryClient";

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  lowConfidence?: boolean;
}

const DATA_SUGGESTIONS = [
  "What are this month's pipeline conversion rates?",
  "Show me the top performing agents by deal volume",
  "How many merchants activated this quarter?",
  "What's our average statement-to-close cycle time?",
  "Which lead sources are driving the best quality contacts?",
  "Explain the residual calculation for a merchant",
];

async function apiPost(path: string, body: unknown) {
  const csrfToken = await getCsrfToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return res.json();
}

export function DashboardDataAgent() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "ready" | "unavailable">("idle");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  // Initialise session when first opened
  useEffect(() => {
    if (!open || sessionId) return;
    (async () => {
      try {
        const ready = await fetch("/api/assistant/readiness").then((r) => r.json());
        setStatus(ready.status ?? "unavailable");
        const csrfToken = await getCsrfToken();
        const data = await fetch("/api/assistant/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
          credentials: "include",
          body: JSON.stringify({}),
        }).then((r) => r.json());
        if (data.sessionId) setSessionId(data.sessionId);
      } catch {
        setStatus("unavailable");
      }
    })();
  }, [open, sessionId]);

  // Focus input when opened/un-minimised
  useEffect(() => {
    if (open && !minimized) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open, minimized]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = { id: nextId.current++, role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);
    scrollToBottom();

    try {
      const data = await apiPost("/api/assistant/chat", {
        sessionId,
        message: text,
      });

      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

      const reply = data.response || data.message || "I wasn't able to generate a response. Please try again.";
      setMessages((m) => [
        ...m,
        {
          id: nextId.current++,
          role: "assistant",
          content: reply,
          lowConfidence: data.lowConfidence,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: nextId.current++,
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [input, loading, sessionId, scrollToBottom]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setSessionId(null);
    setStatus("idle");
  };

  // Only show for authenticated dashboard users (not merchants)
  if (!user || user.role === "merchant") return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3"
      data-testid="dashboard-data-agent"
    >
      {/* Chat panel */}
      {open && (
        <div
          className={cn(
            "bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200",
            minimized ? "w-72 h-12" : "w-96 h-[520px] max-h-[80vh]"
          )}
          style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-primary text-primary-foreground rounded-t-2xl shrink-0">
            <BarChart2 className="w-4 h-4 shrink-0" />
            <span className="font-semibold text-sm flex-1">Data & Reporting Assistant</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMinimized((m) => !m)}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                aria-label={minimized ? "Expand" : "Minimize"}
              >
                {minimized ? (
                  <Maximize2 className="w-3.5 h-3.5" />
                ) : (
                  <Minimize2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              {/* Messages */}
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-3 flex flex-col gap-3">
                  {messages.length === 0 && (
                    <div className="flex flex-col gap-3 pt-2">
                      <p className="text-xs text-muted-foreground text-center leading-relaxed">
                        Ask me about pipeline data, reporting metrics, company historicals, or platform best-practices.
                      </p>
                      <div className="grid grid-cols-1 gap-1.5">
                        {DATA_SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              setInput(s);
                              setTimeout(() => inputRef.current?.focus(), 50);
                            }}
                            className="text-left text-xs px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-foreground/80"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex flex-col gap-1",
                        msg.role === "user" ? "items-end" : "items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-2xl px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        )}
                      >
                        {msg.content}
                      </div>
                      {msg.lowConfidence && (
                        <Badge variant="outline" className="text-[10px] h-4">
                          Low confidence — verify with source data
                        </Badge>
                      )}
                    </div>
                  ))}

                  {loading && (
                    <div className="flex items-start gap-2">
                      <div className="bg-muted rounded-2xl px-3 py-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Thinking…
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              {/* Status bar when unavailable */}
              {status === "unavailable" && (
                <div className="px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800">
                  <p className="text-[11px] text-yellow-700 dark:text-yellow-300 text-center">
                    AI assistant unavailable — check OpenAI credentials
                  </p>
                </div>
              )}

              {/* Input */}
              <div className="p-3 border-t border-border shrink-0 flex gap-2 items-end bg-background">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask about data, metrics, or reporting…"
                  className="resize-none text-sm min-h-[38px] max-h-28 flex-1"
                  rows={1}
                  data-testid="input-data-agent"
                />
                <div className="flex flex-col gap-1">
                  <Button
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    aria-label="Send"
                    data-testid="button-data-agent-send"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                  {messages.length > 0 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0"
                      onClick={clearChat}
                      aria-label="Clear conversation"
                      title="Clear conversation"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Floating trigger button */}
      <button
        onClick={() => {
          setOpen((o) => !o);
          setMinimized(false);
        }}
        className={cn(
          "w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
          open
            ? "bg-primary text-primary-foreground"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
        aria-label={open ? "Close data assistant" : "Open data & reporting assistant"}
        data-testid="button-data-agent-fab"
      >
        {open ? (
          <ChevronDown className="w-6 h-6" />
        ) : (
          <Bot className="w-6 h-6" />
        )}
      </button>
    </div>
  );
}
