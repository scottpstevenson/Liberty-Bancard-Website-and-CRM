import { useState, useRef, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Send, Loader2, Bot, User, Briefcase, Headphones, ClipboardCheck, Megaphone, DollarSign, Shield, BarChart3, Tag, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import type { Contact } from "@shared/schema";

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

const VERTICALS = [
  { slug: "med_spa", label: "Med Spa" },
  { slug: "dental", label: "Dental" },
  { slug: "auto_repair", label: "Auto Repair" },
  { slug: "salon", label: "Salon / Beauty" },
  { slug: "gym", label: "Gym / Fitness" },
  { slug: "hotel", label: "Hotel / Lodging" },
  { slug: "landscaping", label: "Landscaping" },
  { slug: "construction", label: "Construction" },
  { slug: "legal", label: "Legal" },
];

function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s\/\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function matchContactVertical(contactVertical: string | null | undefined): string | null {
  if (!contactVertical) return null;
  const slug = normalizeSlug(contactVertical);
  const supportedSlugs = VERTICALS.map(v => v.slug);
  if (supportedSlugs.includes(slug)) return slug;
  const mapping: Record<string, string> = {
    medical_dental_medspa: "med_spa",
    medicaldentalmedspa: "med_spa",
    medspa: "med_spa",
    med_spa: "med_spa",
    dental: "dental",
    automotive: "auto_repair",
    auto_repair: "auto_repair",
    salon: "salon",
    beauty: "salon",
    gym: "gym",
    fitness: "gym",
    hotel: "hotel",
    lodging: "hotel",
    hospitality: "hotel",
    landscaping: "landscaping",
    landscape: "landscaping",
    construction: "construction",
    legal: "legal",
    law: "legal",
  };
  return mapping[slug] || null;
}

const VERTICAL_SUGGESTIONS: Record<string, [string, string][]> = {
  med_spa: [
    ["Handle Amex objection", "A med spa prospect says they process a lot of Amex and are worried about losing it. How do I handle this?"],
    ["Draft follow-up email", "Draft a follow-up email for a med spa owner who uploaded their statement showing 3.2% effective rate."],
  ],
  dental: [
    ["Split payment concern", "A dental office asks if we can handle split insurance + patient payments. What do I say?"],
    ["Draft follow-up email", "Draft a follow-up email for a dental practice processing $80K/month at 3.5% effective rate."],
  ],
  auto_repair: [
    ["Cash Discount pitch", "Draft a cash discount program pitch for an auto repair shop owner who uses Square."],
    ["Fleet card question", "An auto shop asks if we handle fleet cards (WEX, Voyager). How do I respond?"],
  ],
  salon: [
    ["Tip adjustment concern", "A salon owner is worried about how tip adjustments work on our terminal. What should I tell them?"],
    ["Square comparison", "A salon doing $18K/month uses Square. Draft a comparison showing the savings."],
  ],
  gym: [
    ["Recurring billing pitch", "A gym owner wants to move membership billing from Mindbody's processor. How do I pitch this?"],
    ["Chargeback concern", "A gym owner says they get chargebacks from cancelled memberships. How do I address this?"],
  ],
  hotel: [
    ["Lodging interchange", "A hotel owner says their rates are fine. How do I explain lodging interchange and why they might be misclassified?"],
    ["Pre-auth question", "A hotel asks about pre-authorization for incidental holds. What should I explain?"],
  ],
  landscaping: [
    ["Seasonal volume concern", "A landscaping company worries their seasonal volume swings will flag their account. How do I reassure them?"],
    ["Mobile payment pitch", "Draft an email for a landscaping company that currently uses checks and wants to accept cards in the field."],
  ],
  construction: [
    ["Large ticket processing", "A construction company asks about processing $50K+ draw invoices by card. What do I tell them?"],
    ["ACH vs card pitch", "A GC wants to know if ACH is better than card for large progress billings. What's the recommendation?"],
  ],
  legal: [
    ["IOLTA compliance question", "A law firm partner asks if card processing violates bar rules for their trust account. How do I respond?"],
    ["Retainer billing pitch", "Draft an email to a law firm about accepting card payments for retainers with full IOLTA compliance."],
  ],
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [department, setDepartment] = useState("sales");
  const [vertical, setVertical] = useState<string>("");
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [loadedFromContact, setLoadedFromContact] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const search = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(search);
    const vParam = params.get("vertical");
    if (vParam) {
      const matched = matchContactVertical(vParam);
      if (matched) setVertical(matched);
    }
  }, [search]);

  const { data: contactsData } = useQuery<{ data: Contact[] }>({
    queryKey: ["/api/contacts", { limit: 200 }],
    queryFn: () => fetch("/api/contacts?limit=200").then(r => r.json()),
  });

  const filteredContacts = (contactsData?.data || []).filter(c => {
    if (!contactSearch.trim()) return false;
    const q = contactSearch.toLowerCase();
    const name = `${c.firstName} ${c.lastName}`.toLowerCase();
    const company = (c.companyName || "").toLowerCase();
    return name.includes(q) || company.includes(q);
  }).slice(0, 8);

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
        vertical: vertical || undefined,
      });
      const data = await res.json();
      if (data?.error) {
        setMessages(prev => [...prev, { role: "assistant", content: data.message || "The AI assistant is temporarily unavailable. Please try again later." }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: data.response || "No response generated." }]);
      }
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

  const handleSelectContact = useCallback((contact: Contact) => {
    const mapped = matchContactVertical(contact.vertical);
    if (mapped) {
      setVertical(mapped);
      setLoadedFromContact(`${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""}`);
    } else {
      setLoadedFromContact(`${contact.firstName} ${contact.lastName} (no matching vertical)`);
    }
    setContactPickerOpen(false);
    setContactSearch("");
  }, []);

  const handleClearVertical = () => {
    setVertical("");
    setLoadedFromContact(null);
  };

  const activeDept = departments.find(d => d.id === department);
  const activeVertical = VERTICALS.find(v => v.slug === vertical);
  const verticalSuggestions = vertical ? (VERTICAL_SUGGESTIONS[vertical] || []) : [];

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

      <div className="mb-3 flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-2 pt-1">
          <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm text-muted-foreground whitespace-nowrap">Vertical context:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={vertical} onValueChange={(v) => { setVertical(v); setLoadedFromContact(null); }}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="trigger-vertical">
              <SelectValue placeholder="None (general)" />
            </SelectTrigger>
            <SelectContent>
              {VERTICALS.map(v => (
                <SelectItem key={v.slug} value={v.slug} data-testid={`option-vertical-${v.slug}`}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover open={contactPickerOpen} onOpenChange={setContactPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs text-muted-foreground"
                data-testid="button-load-from-contact"
              >
                <Search className="w-3.5 h-3.5" />
                Load from contact
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Search by name or company..."
                  value={contactSearch}
                  onValueChange={setContactSearch}
                  data-testid="input-contact-search"
                />
                <CommandList>
                  <CommandEmpty>
                    {contactSearch.length < 2
                      ? "Type to search contacts..."
                      : "No contacts found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {filteredContacts.map(c => {
                      const mapped = matchContactVertical(c.vertical);
                      return (
                        <CommandItem
                          key={c.id}
                          value={`${c.firstName} ${c.lastName} ${c.companyName || ""}`}
                          onSelect={() => handleSelectContact(c)}
                          data-testid={`contact-option-${c.id}`}
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium text-sm truncate">{c.firstName} {c.lastName}</span>
                            {c.companyName && <span className="text-xs text-muted-foreground truncate">{c.companyName}</span>}
                            {mapped
                              ? <span className="text-xs text-primary">{VERTICALS.find(v => v.slug === mapped)?.label}</span>
                              : c.vertical
                                ? <span className="text-xs text-muted-foreground">{c.vertical} (no context match)</span>
                                : <span className="text-xs text-muted-foreground italic">no vertical tagged</span>
                            }
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {vertical && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground"
              onClick={handleClearVertical}
              aria-label="Clear vertical"
              data-testid="button-clear-vertical"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}

          {activeVertical && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-active-vertical">
              {activeVertical.label} context active
              {loadedFromContact && <span className="ml-1 opacity-70">· {loadedFromContact}</span>}
            </Badge>
          )}
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
                {activeVertical
                  ? `${activeVertical.label} vertical context is loaded. Every response will be tailored to this industry's pain points, objections, and compliance rules.`
                  : `I can help with ${activeDept?.description.toLowerCase()}. Select a department above, choose a vertical for industry-specific advice, or load context from a tagged contact.`
                }
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
                {verticalSuggestions.length > 0 ? (
                  verticalSuggestions.map(([label, prompt], i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      onClick={() => setInputValue(prompt)}
                      data-testid={`button-suggestion-${i + 1}`}
                    >
                      {label}
                    </Button>
                  ))
                ) : (
                  <>
                    {department === "sales" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setInputValue("Draft a follow-up email for a merchant who uploaded their statement yesterday")} data-testid="button-suggestion-1">Draft follow-up email</Button>
                        <Button variant="outline" size="sm" onClick={() => setInputValue("What offer path should I recommend for a restaurant doing $30K monthly volume?")} data-testid="button-suggestion-2">Recommend offer path</Button>
                      </>
                    )}
                    {department === "support" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setInputValue("A merchant says their deposit amount doesn't match. What should I check?")} data-testid="button-suggestion-1">Deposit mismatch help</Button>
                        <Button variant="outline" size="sm" onClick={() => setInputValue("How should I handle a chargeback dispute for a merchant?")} data-testid="button-suggestion-2">Chargeback guidance</Button>
                      </>
                    )}
                    {department === "onboarding" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setInputValue("Generate a go-live checklist for a new merchant with a Liberty Smart Terminal")} data-testid="button-suggestion-1">Go-live checklist</Button>
                        <Button variant="outline" size="sm" onClick={() => setInputValue("What documents do I need for underwriting a medical practice?")} data-testid="button-suggestion-2">Underwriting docs</Button>
                      </>
                    )}
                    {department === "compliance" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setInputValue("Review this email draft for compliance issues: 'We guarantee you'll save 30% on processing fees immediately.'")} data-testid="button-suggestion-1">Review email copy</Button>
                        <Button variant="outline" size="sm" onClick={() => setInputValue("What disclaimer language do I need for a surcharge program?")} data-testid="button-suggestion-2">Surcharge disclaimers</Button>
                      </>
                    )}
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
            placeholder={activeVertical ? `Ask the ${activeDept?.label || ''} advisor about ${activeVertical.label}...` : `Ask the ${activeDept?.label || ''} advisor...`}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            disabled={isLoading}
            className="flex-1"
            data-testid="input-chat-message"
          />
          <Button
            onClick={handleSend}
            size="icon"
            aria-label="Send message"
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
