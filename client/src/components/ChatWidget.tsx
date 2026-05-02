import { useState, useEffect, useRef, useCallback } from "react";
import { X, MessageCircle, Send, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: number;
  senderType: "visitor" | "agent";
  senderName: string | null;
  content: string;
  createdAt: string;
}

type WidgetState = "bubble" | "open";
type ChatPhase = "pre-identify" | "chatting" | "offline";

const BUSINESS_HOURS_MSG = "Mon–Fri, 9 AM–6 PM ET · We typically reply in under 5 minutes.";
const GREETING = "Hi! 👋 Thanks for reaching out. Our team typically replies within a few minutes during business hours. What can we help you with?";
const OFFLINE_GREETING = "We're offline right now. Leave us a message and we'll get back to you by next business day.";

function checkBusinessHours(): boolean {
  const now = new Date();
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = eastern.getDay();
  const hour = eastern.getHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
}

export default function ChatWidget() {
  const [mounted, setMounted] = useState(false);
  const [widgetState, setWidgetState] = useState<WidgetState>("bubble");
  const [phase, setPhase] = useState<ChatPhase>(checkBusinessHours() ? "pre-identify" : "offline");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastMessageId, setLastMessageId] = useState<number>(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [offlineName, setOfflineName] = useState("");
  const [offlineEmail, setOfflineEmail] = useState("");
  const [offlineMsg, setOfflineMsg] = useState("");
  const [offlineSent, setOfflineSent] = useState(false);
  const [offlineSubmitting, setOfflineSubmitting] = useState(false);
  const [identifyError, setIdentifyError] = useState("");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lazy-mount after interaction/delay to avoid affecting Core Web Vitals
  useEffect(() => {
    const onInteract = () => setMounted(true);
    const timer = setTimeout(() => setMounted(true), 3000);
    window.addEventListener("mousemove", onInteract, { once: true });
    window.addEventListener("touchstart", onInteract, { once: true });
    window.addEventListener("scroll", onInteract, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", onInteract);
      window.removeEventListener("touchstart", onInteract);
      window.removeEventListener("scroll", onInteract);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const pollMessages = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/public/chat/session/${sessionId}/messages?afterId=${lastMessageId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMsgs = data.messages.filter((m: ChatMessage) => !existingIds.has(m.id));
          if (newMsgs.length > 0) {
            const newLastId = Math.max(...data.messages.map((m: ChatMessage) => m.id));
            setLastMessageId(newLastId);
            const agentNew = newMsgs.filter((m: ChatMessage) => m.senderType === "agent");
            if (agentNew.length > 0 && widgetState !== "open") {
              setUnreadCount(c => c + agentNew.length);
            }
            return [...prev, ...newMsgs];
          }
          return prev;
        });
        scrollToBottom();
      }
    } catch (_) {}
  }, [sessionId, lastMessageId, widgetState, scrollToBottom]);

  useEffect(() => {
    if (sessionId && phase === "chatting") {
      pollRef.current = setInterval(pollMessages, 4000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [sessionId, phase, pollMessages]);

  useEffect(() => {
    if (widgetState === "open") {
      setUnreadCount(0);
      scrollToBottom();
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [widgetState, scrollToBottom]);

  const startSession = async (): Promise<string | null> => {
    if (sessionStarted && sessionIdRef.current) return sessionIdRef.current;
    try {
      const res = await fetch("/api/public/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: window.location.pathname }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      setSessionStarted(true);
      setSessionId(data.sessionId);
      sessionIdRef.current = data.sessionId;
      setChatId(data.chatId);
      return data.sessionId as string;
    } catch (_) {}
    return null;
  };

  const openWidget = () => {
    setWidgetState("open");
    if (!sessionStarted && phase !== "offline") {
      startSession();
    }
  };

  const handleIdentify = async () => {
    if (!visitorName.trim()) { setIdentifyError("Please enter your name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitorEmail)) { setIdentifyError("Please enter a valid email address."); return; }
    setIdentifyError("");
    setSending(true);

    let activeSessionId = sessionIdRef.current || sessionId;
    if (!activeSessionId) {
      activeSessionId = await startSession();
    }

    if (!activeSessionId) {
      setIdentifyError("Unable to connect. Please try again.");
      setSending(false);
      return;
    }

    try {
      await fetch(`/api/public/chat/session/${activeSessionId}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: visitorName, email: visitorEmail }),
      });
    } catch (_) {}

    setPhase("chatting");
    setMessages([{
      id: -1,
      senderType: "agent",
      senderName: "Liberty Bancard",
      content: GREETING,
      createdAt: new Date().toISOString(),
    }]);
    scrollToBottom();
    setSending(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !sessionId) return;
    setSending(true);
    setInput("");

    const tempId = -(Date.now());
    const tempMsg: ChatMessage = {
      id: tempId,
      senderType: "visitor",
      senderName: visitorName || "You",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempMsg]);
    scrollToBottom();

    try {
      const res = await fetch(`/api/public/chat/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        const saved = await res.json();
        setMessages(prev => prev.map(m => m.id === tempId ? saved : m));
        setLastMessageId(prev => Math.max(prev, saved.id));
      }
    } catch (_) {}
    setSending(false);
  };

  const handleOfflineSubmit = async () => {
    if (!offlineName.trim() || !offlineEmail.trim() || !offlineMsg.trim()) return;
    setOfflineSubmitting(true);
    try {
      await fetch("/api/public/chat/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: offlineName, email: offlineEmail, message: offlineMsg, pageUrl: window.location.pathname }),
      });
      setOfflineSent(true);
    } catch (_) {}
    setOfflineSubmitting(false);
  };

  const handleClose = () => {
    if (sessionId) {
      fetch(`/api/public/chat/session/${sessionId}/close`, { method: "POST" }).catch(() => {});
    }
    setWidgetState("bubble");
  };

  if (!mounted) return null;

  const online = checkBusinessHours();

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3" data-testid="chat-widget">

      {widgetState === "open" && (
        <div
          className="w-[360px] flex flex-col rounded-2xl shadow-2xl border border-border bg-white dark:bg-gray-900 overflow-hidden"
          style={{ maxHeight: "min(540px, calc(100vh - 96px))" }}
          data-testid="chat-widget-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[hsl(222,47%,11%)] text-white shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center text-xs font-bold">LB</div>
                <span className={cn(
                  "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[hsl(222,47%,11%)]",
                  online ? "bg-emerald-400" : "bg-gray-400"
                )} />
              </div>
              <div>
                <p className="text-sm font-semibold leading-none">Liberty Bancard</p>
                <p className="text-[10px] text-white/60 mt-0.5">{online ? "● Online now" : "● Away"}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWidgetState("bubble")}
                className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                aria-label="Minimize chat"
                data-testid="chat-widget-minimize"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                aria-label="Close chat"
                data-testid="chat-widget-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 bg-gray-50 dark:bg-gray-950">

            {phase === "offline" && (
              offlineSent ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="font-semibold text-foreground">Message received!</p>
                  <p className="text-sm text-muted-foreground mt-1">We'll follow up by next business day.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-2 items-start">
                    <div className="w-7 h-7 rounded-full bg-[hsl(222,47%,11%)] flex items-center justify-center text-[9px] text-white font-bold shrink-0 mt-0.5">LB</div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-foreground shadow-sm border border-border">
                      {OFFLINE_GREETING}
                    </div>
                  </div>
                  <Input
                    placeholder="Your name"
                    value={offlineName}
                    onChange={e => setOfflineName(e.target.value)}
                    data-testid="offline-name-input"
                  />
                  <Input
                    type="email"
                    placeholder="Your email"
                    value={offlineEmail}
                    onChange={e => setOfflineEmail(e.target.value)}
                    data-testid="offline-email-input"
                  />
                  <Textarea
                    placeholder="Your message…"
                    value={offlineMsg}
                    onChange={e => setOfflineMsg(e.target.value)}
                    className="resize-none h-24"
                    data-testid="offline-message-input"
                  />
                  <Button
                    className="w-full bg-[hsl(222,47%,11%)] text-white hover:bg-[hsl(222,47%,18%)]"
                    onClick={handleOfflineSubmit}
                    disabled={offlineSubmitting || !offlineName || !offlineEmail || !offlineMsg}
                    data-testid="offline-submit-button"
                  >
                    {offlineSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Send Message
                  </Button>
                </div>
              )
            )}

            {phase === "pre-identify" && (
              <div className="space-y-3">
                <div className="flex gap-2 items-start">
                  <div className="w-7 h-7 rounded-full bg-[hsl(222,47%,11%)] flex items-center justify-center text-[9px] text-white font-bold shrink-0 mt-0.5">LB</div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-foreground shadow-sm border border-border">
                    Hi there! 👋 Before we start, may I get your name and email so we can follow up if needed?
                  </div>
                </div>
                <Input
                  placeholder="Your name"
                  value={visitorName}
                  onChange={e => setVisitorName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleIdentify()}
                  data-testid="chat-name-input"
                />
                <Input
                  type="email"
                  placeholder="Your email"
                  value={visitorEmail}
                  onChange={e => setVisitorEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleIdentify()}
                  data-testid="chat-email-input"
                />
                {identifyError && (
                  <p className="text-xs text-destructive" data-testid="chat-identify-error">{identifyError}</p>
                )}
                <Button
                  className="w-full bg-[hsl(222,47%,11%)] text-white hover:bg-[hsl(222,47%,18%)]"
                  onClick={handleIdentify}
                  disabled={sending}
                  data-testid="chat-start-button"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Start Chat
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">{BUSINESS_HOURS_MSG}</p>
              </div>
            )}

            {phase === "chatting" && (
              <>
                {messages.map((msg, i) => (
                  <div
                    key={`${msg.id}-${i}`}
                    className={cn("flex gap-2 items-end", msg.senderType === "visitor" ? "flex-row-reverse" : "flex-row")}
                    data-testid={`chat-message-${i}`}
                  >
                    {msg.senderType === "agent" && (
                      <div className="w-6 h-6 rounded-full bg-[hsl(222,47%,11%)] flex items-center justify-center text-[9px] text-white font-bold shrink-0">LB</div>
                    )}
                    <div
                      className={cn(
                        "rounded-xl px-3 py-2 text-sm max-w-[80%] shadow-sm break-words",
                        msg.senderType === "visitor"
                          ? "bg-[hsl(222,47%,11%)] text-white rounded-br-sm"
                          : "bg-white dark:bg-gray-800 text-foreground border border-border rounded-bl-sm"
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input area */}
          {phase === "chatting" && (
            <div className="px-3 py-3 border-t border-border bg-white dark:bg-gray-900 shrink-0">
              <div className="flex gap-2 items-center">
                <Input
                  ref={inputRef}
                  placeholder="Type a message…"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  disabled={sending}
                  className="flex-1"
                  data-testid="chat-message-input"
                />
                <Button
                  size="icon"
                  className="bg-[hsl(222,47%,11%)] text-white hover:bg-[hsl(222,47%,18%)] shrink-0"
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  data-testid="chat-send-button"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-1.5">Liberty Bancard · Secure Chat</p>
            </div>
          )}
        </div>
      )}

      {/* Floating bubble */}
      <button
        onClick={openWidget}
        className="relative w-14 h-14 rounded-full shadow-lg bg-[hsl(222,47%,11%)] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform focus:outline-none"
        aria-label="Open chat with Liberty Bancard"
        data-testid="chat-widget-bubble"
      >
        {widgetState === "open"
          ? <ChevronDown className="w-6 h-6" />
          : <MessageCircle className="w-6 h-6" />
        }
        {unreadCount > 0 && widgetState !== "open" && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center" data-testid="chat-unread-badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
