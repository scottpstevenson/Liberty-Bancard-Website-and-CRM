import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Send, Loader2, Bot, User, Briefcase, Headphones, ClipboardCheck, Megaphone, DollarSign, Shield, BarChart3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const departments = [
  { id: "sales", label: "Sales", icon: Briefcase, description: "Pipeline, follow-ups, offer paths" },
  { id: "support", label: "Support", icon: Headphones, description: "Tickets, troubleshooting, macros" },
  { id: "onboarding", label: "Onboarding", icon: ClipboardCheck, description: "Checklists, go-live, setup" },
  { id: "marketing", label: "Marketing", icon: Megaphone, description: "Content, campaigns, copy" },
  { id: "finance", label: "Finance", icon: DollarSign, description: "Reconciliation, commissions" },
  { id: "compliance", label: "Compliance", icon: Shield, description: "Review copy, disclaimers" },
  { id: "executive", label: "Executive", icon: BarChart3, description: "KPIs, bottlenecks, strategy" },
];

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [department, setDepartment] = useState("sales");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
  };

  const activeDept = departments.find(d => d.id === department);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col" data-testid="chat-page">
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-primary" data-testid="text-chat-title">AI Business Advisor</h2>
          <p className="text-sm text-muted-foreground">
            Department-specific guidance for Liberty Bancard operations.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {departments.map((dept) => {
            const Icon = dept.icon;
            return (
              <Button
                key={dept.id}
                variant={department === dept.id ? "default" : "outline"}
                size="sm"
                onClick={() => setDepartment(dept.id)}
                data-testid={`button-dept-${dept.id}`}
              >
                <Icon className="w-4 h-4 mr-1" />
                {dept.label}
              </Button>
            );
          })}
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {activeDept && (
              <>
                <Badge variant="secondary" data-testid="badge-active-dept">
                  {activeDept.label} Advisor
                </Badge>
                <span className="text-xs text-muted-foreground">{activeDept.description}</span>
              </>
            )}
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear} data-testid="button-clear-chat">
              Clear
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 && (
            <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground" data-testid="chat-empty-state">
              <div className="w-14 h-14 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="w-7 h-7 text-primary" />
              </div>
              <p className="font-medium text-foreground mb-1">Ask me anything about Liberty Bancard operations</p>
              <p className="text-sm max-w-md">
                I can help with {activeDept?.description.toLowerCase()}. Select a department above for specialized guidance.
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
                {department === "sales" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => { setInputValue("Draft a follow-up email for a merchant who uploaded their statement yesterday"); }} data-testid="button-suggestion-1">Draft follow-up email</Button>
                    <Button variant="outline" size="sm" onClick={() => { setInputValue("What offer path should I recommend for a restaurant doing $30K monthly volume?"); }} data-testid="button-suggestion-2">Recommend offer path</Button>
                  </>
                )}
                {department === "support" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => { setInputValue("A merchant says their deposit amount doesn't match. What should I check?"); }} data-testid="button-suggestion-1">Deposit mismatch help</Button>
                    <Button variant="outline" size="sm" onClick={() => { setInputValue("How should I handle a chargeback dispute for a merchant?"); }} data-testid="button-suggestion-2">Chargeback guidance</Button>
                  </>
                )}
                {department === "onboarding" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => { setInputValue("Generate a go-live checklist for a new merchant with a Dejavoo QD4 terminal"); }} data-testid="button-suggestion-1">Go-live checklist</Button>
                    <Button variant="outline" size="sm" onClick={() => { setInputValue("What documents do I need for underwriting a medical practice?"); }} data-testid="button-suggestion-2">Underwriting docs</Button>
                  </>
                )}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={cn("flex mb-4 gap-3", msg.role === "user" ? "justify-end" : "justify-start")} data-testid={`message-${msg.role}-${i}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}
              <div className={cn(
                "max-w-[80%] rounded-md px-4 py-3 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-4 h-4 text-accent" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex mb-4 gap-3 justify-start" data-testid="chat-loading">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-muted rounded-md px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </ScrollArea>

        <div className="p-4 border-t flex items-center gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`Ask the ${activeDept?.label || ''} advisor...`}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            disabled={isLoading}
            className="flex-1"
            data-testid="input-chat-message"
          />
          <Button
            onClick={handleSend}
            size="icon"
            disabled={!inputValue.trim() || isLoading}
            data-testid="button-send-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-4 pb-2">
          <p className="text-xs text-muted-foreground text-center">
            AI-generated guidance only. Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review. Not legal or tax advice.
          </p>
        </div>
      </Card>
    </div>
  );
}
