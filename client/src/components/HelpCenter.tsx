import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle, Calendar, Phone, Send, Loader2, Bot, User,
  X, CheckCircle, HelpCircle
} from "lucide-react";
import { Link } from "wouter";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface HelpCenterProps {
  context: "referral" | "merchant";
  department?: string;
  className?: string;
}

function AIChatPanel({ department, context }: { department: string; context: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const contextIntro = context === "referral"
    ? "I'm the Liberty Bancard Sales Advisor. I can help with referral best practices, partner questions, commission details, and how to maximize your referral success."
    : "I'm the Liberty Bancard Support Advisor. I can help you get started, understand what to expect during onboarding, answer questions about your account, and guide you through any issues.";

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    const userMessage: Message = { role: "user", content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue("");
    setIsLoading(true);

    try {
      const res = await apiRequest("POST", "/api/ai/chat", {
        department,
        messages: updatedMessages,
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.response }]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error. Please try again or call us at 954-266-8214." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const suggestions = context === "referral"
    ? [
        "How do referral commissions work?",
        "What makes a good referral?",
        "How do I track my referral status?",
      ]
    : [
        "What happens after I submit my application?",
        "How long does onboarding take?",
        "What documents do I need?",
      ];

  return (
    <div className="flex flex-col h-[400px]" data-testid="help-chat-panel">
      <ScrollArea className="flex-1 p-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-6 text-muted-foreground" data-testid="help-chat-empty">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Bot className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Hi! How can I help?</p>
            <p className="text-xs max-w-sm mb-4">{contextIntro}</p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-xs justify-start"
                  onClick={() => setInputValue(s)}
                  data-testid={`help-chat-suggestion-${i}`}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex mb-3 gap-2", msg.role === "user" ? "justify-end" : "justify-start")} data-testid={`help-msg-${msg.role}-${i}`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
            <div className={cn(
              "max-w-[80%] rounded-lg px-3 py-2 text-sm",
              msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
            )}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-accent" />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="flex mb-3 gap-2 justify-start" data-testid="help-chat-loading">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </ScrollArea>
      <div className="p-3 border-t flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type your question..."
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          disabled={isLoading}
          className="flex-1 text-sm"
          data-testid="help-chat-input"
        />
        <Button size="icon" onClick={handleSend} disabled={!inputValue.trim() || isLoading} data-testid="help-chat-send">
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center pb-2 px-3">
        AI-generated guidance. Eligibility, underwriting, and card brand rules apply.
      </p>
    </div>
  );
}

function CallbackPanel() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/public/callback", { name, phone, bestTime: "ASAP" });
      setSubmitted(true);
    } catch {
      toast({ title: "Something went wrong", description: "Please try calling us at 954-266-8214.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-8" data-testid="callback-success">
        <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
        <p className="text-sm font-medium">We'll call you back shortly!</p>
        <p className="text-xs text-muted-foreground mt-1">Usually within 30 minutes during business hours.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" data-testid="callback-panel">
      <div className="text-center">
        <Phone className="w-8 h-8 text-primary mx-auto mb-2" />
        <p className="text-sm font-medium">Request a Call Back</p>
        <p className="text-xs text-muted-foreground">Leave your info and we'll reach out shortly.</p>
      </div>
      <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} data-testid="help-callback-name" />
      <Input type="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="help-callback-phone" />
      <Button className="w-full gap-2" onClick={handleSubmit} disabled={submitting || !name.trim() || !phone.trim()} data-testid="help-callback-submit">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
        Request Callback
      </Button>
      <div className="text-center space-y-1">
        <a href="tel:9542668214" className="text-sm text-primary font-medium" data-testid="help-call-direct">
          Or call 954-266-8214
        </a>
        <p className="text-xs text-muted-foreground">Mon–Fri 9am–6pm ET</p>
      </div>
    </div>
  );
}

export function HelpCenter({ context, department, className }: HelpCenterProps) {
  const [activePanel, setActivePanel] = useState<"chat" | "book" | "call" | null>(null);
  const defaultDepartment = department || (context === "referral" ? "sales" : "support");

  return (
    <Card className={cn("overflow-hidden", className)} data-testid="help-center">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-primary" />
          Need Help? We're Here For You
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {context === "referral"
            ? "Get answers about referrals, commissions, and sales best practices."
            : "Get help with your account, onboarding, or any questions you have."
          }
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!activePanel && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="help-action-buttons">
            <Button
              variant="outline"
              className="h-auto flex flex-col items-center gap-2 py-4"
              onClick={() => setActivePanel("chat")}
              data-testid="help-btn-chat"
            >
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-medium">Chat with AI</span>
              <span className="text-[11px] text-muted-foreground">Instant answers 24/7</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex flex-col items-center gap-2 py-4"
              onClick={() => setActivePanel("book")}
              data-testid="help-btn-book"
            >
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <span className="text-sm font-medium">Book a Meeting</span>
              <span className="text-[11px] text-muted-foreground">Schedule a 1-on-1 call</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex flex-col items-center gap-2 py-4"
              onClick={() => setActivePanel("call")}
              data-testid="help-btn-call"
            >
              <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                <Phone className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <span className="text-sm font-medium">Call Us</span>
              <span className="text-[11px] text-muted-foreground">Talk to a real person</span>
            </Button>
          </div>
        )}

        {activePanel && (
          <div data-testid={`help-panel-${activePanel}`}>
            <div className="flex items-center justify-between mb-2">
              <Badge variant="secondary" className="text-xs">
                {activePanel === "chat" ? "AI Chat" : activePanel === "book" ? "Book Meeting" : "Call Us"}
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => setActivePanel(null)} data-testid="help-back-btn">
                <X className="w-4 h-4 mr-1" /> Close
              </Button>
            </div>

            {activePanel === "chat" && <AIChatPanel department={defaultDepartment} context={context} />}

            {activePanel === "book" && (
              <div className="text-center py-8 space-y-4" data-testid="help-book-panel">
                <Calendar className="w-12 h-12 text-green-600 mx-auto" />
                <div>
                  <p className="text-sm font-medium">Schedule a Meeting</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                    {context === "referral"
                      ? "Talk with our partnerships team about referral opportunities, commission structures, and how to grow together."
                      : "Book a one-on-one call with our onboarding team to walk through your account setup and answer any questions."
                    }
                  </p>
                </div>
                <div className="space-y-2">
                  <Link href="/dashboard/calendar">
                    <Button className="w-full max-w-xs gap-2" data-testid="help-book-calendar-btn">
                      <Calendar className="w-4 h-4" />
                      Open Calendar & Book Appointment
                    </Button>
                  </Link>
                  <a href="tel:9542668214">
                    <Button variant="outline" className="w-full max-w-xs gap-2 mt-2" data-testid="help-book-call-btn">
                      <Phone className="w-4 h-4" />
                      Call to Schedule: 954-266-8214
                    </Button>
                  </a>
                  <a href="mailto:support@libertybancard.com?subject=Meeting Request">
                    <Button variant="outline" className="w-full max-w-xs gap-2 mt-2" data-testid="help-book-email-btn">
                      <MessageCircle className="w-4 h-4" />
                      Email: support@libertybancard.com
                    </Button>
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">Available Mon–Fri 9am–6pm ET</p>
              </div>
            )}

            {activePanel === "call" && <CallbackPanel />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
