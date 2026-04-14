import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Save, RefreshCw, Workflow, Search, Copy, Download, ChevronDown, ChevronRight, Bot, FileText, Phone, Mic, Mail, MessageSquare, Settings2, Map } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { jsPDF } from "jspdf";
import {
  SEQUENCE_PROMPTS,
  CONVERSATION_AI_SYSTEM_PROMPT,
  CATEGORY_LABELS,
  type SequencePrompt,
  type SequenceStep,
} from "@/lib/ghl-workflow-prompts";

const ALL_SEQUENCES = [
  { name: "1. Switch & Save — Statement Audit", category: "sales" },
  { name: "2. Payment Stack 101 — Education", category: "education" },
  { name: "3. Fast Approval — Application Completion", category: "onboarding" },
  { name: "4. Trust Builder — Authority Sequence", category: "sales" },
  { name: "5. Chargeback Defense", category: "risk" },
  { name: "6. Funding Speed & Reliability", category: "sales" },
  { name: "8. Liberty Smart Terminal — Product Showcase", category: "hardware" },
  { name: "9. Surcharge & Cash Discount — Compliance", category: "sales" },
  { name: "10. Retail Merchants — SDR Outbound + Drip", category: "sdr_outbound" },
  { name: "11. Auto Merchants — SDR Outbound + Drip", category: "sdr_outbound" },
  { name: "12. Medical & Med Spa — SDR Outbound + Drip", category: "sdr_outbound" },
  { name: "13. Recurring Billing — Subscription Merchants", category: "sales" },
  { name: "15. Omnichannel — Online + In-Person", category: "sales" },
  { name: "16. Security & PCI Compliance — Made Easy", category: "education" },
  { name: "17. Contract Escape — Switch Help", category: "sales" },
  { name: "18. Objection Crusher — Overcome Hesitation", category: "sales" },
  { name: "19. Reactivation — Cold Lead Revival", category: "reactivation" },
  { name: "20. Free Analysis Follow-Up", category: "sales" },
  { name: "Post-Call Review Follow-Up", category: "sales" },
  { name: "Proposal Follow-Up", category: "sales" },
  { name: "No-Show Reschedule", category: "sales" },
  { name: "Long-Term Nurture", category: "nurture" },
  { name: "SDR: Cold Outbound — Auto Repair", category: "sdr_cold_outbound" },
  { name: "SDR: Cold Outbound — Med Spa", category: "sdr_cold_outbound" },
  { name: "SDR: Cold Outbound — Dental", category: "sdr_cold_outbound" },
  { name: "SDR: Reply Engaged", category: "sdr_reply_engaged" },
  { name: "SDR: Statement Chase", category: "sdr_statement_chase" },
  { name: "SDR: Proposal Follow-Up", category: "sdr_proposal_followup" },
  { name: "SDR: No-Show Recovery", category: "sdr_noshow_recovery" },
  { name: "V-Retail: SDR Outbound Prospecting", category: "sdr" },
  { name: "V-Retail: Inbound Lead Nurture", category: "inbound" },
  { name: "V-Retail: Account Management Ops", category: "operations" },
  { name: "V-Auto: SDR Outbound Prospecting", category: "sdr" },
  { name: "V-Auto: Inbound Lead Nurture", category: "inbound" },
  { name: "V-Auto: Account Management Ops", category: "operations" },
  { name: "V-Medical: SDR Outbound Prospecting", category: "sdr" },
];

interface WorkflowMapping {
  id: number;
  sequenceName: string;
  ghlWorkflowId: string | null;
  category: string | null;
  description: string | null;
  updatedAt: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  sales: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  education: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  onboarding: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  risk: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  hardware: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  sdr_outbound: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  sdr_cold_outbound: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
  sdr_reply_engaged: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  sdr_statement_chase: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  sdr_proposal_followup: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  sdr_noshow_recovery: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  reactivation: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  nurture: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  sdr: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  inbound: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  operations: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  call: "Call",
  voicemail_drop: "Voicemail Drop",
  task: "Internal Task",
  ai_conversation: "Conversation AI",
};

const CHANNEL_COLORS: Record<string, string> = {
  email: "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800",
  sms: "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800",
  call: "bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800",
  voicemail_drop: "bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800",
  task: "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800",
  ai_conversation: "bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied", description: `${label} copied to clipboard.` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Error", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 px-2 text-xs shrink-0"
      data-testid={`button-copy-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
    >
      {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="w-3.5 h-3.5" />,
  sms: <MessageSquare className="w-3.5 h-3.5" />,
  call: <Phone className="w-3.5 h-3.5" />,
  voicemail_drop: <Mic className="w-3.5 h-3.5" />,
  task: <FileText className="w-3.5 h-3.5" />,
  ai_conversation: <Bot className="w-3.5 h-3.5" />,
};

function StepCard({ step, sequenceId }: { step: SequenceStep; sequenceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const channelColor = CHANNEL_COLORS[step.channel] || "";

  const isCall = step.channel === "call";
  const isVoicemail = step.channel === "voicemail_drop";

  const primaryCopyText = isCall
    ? (step.callScript || "")
    : isVoicemail
    ? (step.voicemailScript || "")
    : step.subject
    ? `Subject: ${step.subject}\n\n${step.body}`
    : step.body;

  const previewText = isCall
    ? (step.callScript?.slice(0, 80) + "…")
    : isVoicemail
    ? (step.voicemailScript?.slice(0, 80) + "…")
    : step.subject
    ? step.subject
    : step.body.slice(0, 80) + "…";

  return (
    <div className={`border rounded-lg overflow-hidden ${channelColor}`} data-testid={`card-step-${sequenceId}-${step.stepNumber}`}>
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(e => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setExpanded(v => !v); }}
        data-testid={`button-expand-step-${sequenceId}-${step.stepNumber}`}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-xs font-bold shrink-0 w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center">
            {step.stepNumber}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                isCall ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                : isVoicemail ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                : "bg-foreground/10 text-foreground/60"
              }`}>
                {CHANNEL_ICONS[step.channel]}
                {CHANNEL_LABELS[step.channel] || step.channel}
              </span>
              <span className="text-xs text-muted-foreground">— {step.delayDescription}</span>
              {step.callMode && (
                <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">Mode: {step.callMode}</span>
              )}
            </div>
            <p className="text-sm text-foreground/80 truncate mt-0.5">{previewText}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <CopyButton text={primaryCopyText} label={`Step ${step.stepNumber} of ${sequenceId}`} />
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {isCall && (
            <>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Call Script (30–45 sec)</p>
                <div className="flex items-start gap-2">
                  <pre className="text-sm whitespace-pre-wrap font-sans flex-1 leading-relaxed text-foreground/90 bg-orange-50 dark:bg-orange-900/10 rounded p-2 border border-orange-200 dark:border-orange-800">{step.callScript}</pre>
                  <CopyButton text={step.callScript || ""} label={`Call script step ${step.stepNumber} ${sequenceId}`} />
                </div>
              </div>
              {step.callMode && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mode:</span>
                  <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 px-2 py-0.5 rounded font-medium">{step.callMode}</span>
                </div>
              )}
              {step.ghlNote && (
                <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded p-2">
                  <Settings2 className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-800 dark:text-blue-300"><span className="font-semibold">GHL Setup: </span>{step.ghlNote}</p>
                </div>
              )}
            </>
          )}
          {isVoicemail && (
            <>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Voicemail Script (15–20 sec)</p>
                <div className="flex items-start gap-2">
                  <pre className="text-sm whitespace-pre-wrap font-sans flex-1 leading-relaxed text-foreground/90 bg-purple-50 dark:bg-purple-900/10 rounded p-2 border border-purple-200 dark:border-purple-800">{step.voicemailScript}</pre>
                  <CopyButton text={step.voicemailScript || ""} label={`Voicemail script step ${step.stepNumber} ${sequenceId}`} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground italic">Record this as an audio file and upload to GHL Voicemail Drops library.</p>
              {step.ghlNote && (
                <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded p-2">
                  <Settings2 className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-800 dark:text-blue-300"><span className="font-semibold">GHL Setup: </span>{step.ghlNote}</p>
                </div>
              )}
            </>
          )}
          {!isCall && !isVoicemail && (
            <>
              {step.subject && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Subject Line</p>
                  <div className="flex items-start gap-2">
                    <p className="text-sm font-medium flex-1">{step.subject}</p>
                    <CopyButton text={step.subject} label={`Subject step ${step.stepNumber} ${sequenceId}`} />
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {step.channel === "email" ? "Email Body" : step.channel === "sms" ? "SMS Message" : "Task / Notes"}
                </p>
                <div className="flex items-start gap-2">
                  <pre className="text-sm whitespace-pre-wrap font-sans flex-1 leading-relaxed text-foreground/90">{step.body}</pre>
                  <CopyButton text={step.body} label={`Body step ${step.stepNumber} ${sequenceId}`} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const COLD_OUTBOUND_IDS = ["cold-outbound-auto-repair", "cold-outbound-dental", "cold-outbound-medspa"];

const CHANNEL_CHIP_STYLES: Record<string, { bg: string; icon: React.ReactNode }> = {
  email: { bg: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", icon: <Mail className="w-3 h-3" /> },
  sms: { bg: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300", icon: <MessageSquare className="w-3 h-3" /> },
  call: { bg: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300", icon: <Phone className="w-3 h-3" /> },
  voicemail_drop: { bg: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300", icon: <Mic className="w-3 h-3" /> },
  task: { bg: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", icon: <FileText className="w-3 h-3" /> },
  ai_conversation: { bg: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300", icon: <Bot className="w-3 h-3" /> },
};

function CadenceBlueprints() {
  const sequences = SEQUENCE_PROMPTS.filter(s => COLD_OUTBOUND_IDS.includes(s.id));

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Map className="w-5 h-5 text-primary" />
          Cold Outbound Cadence Blueprints
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Visual cadence timelines for all 3 cold outbound sequences. Use these to build each workflow in GHL.
        </p>
      </div>

      {sequences.map(seq => (
        <Card key={seq.id} className="overflow-hidden" data-testid={`card-blueprint-${seq.id}`}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[seq.category] || "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                    {CATEGORY_LABELS[seq.category] || seq.category}
                  </span>
                </div>
                <CardTitle className="text-base">{seq.name}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{seq.triggerConditions}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Cadence Timeline</p>
              <div className="overflow-x-auto pb-2">
                <div className="flex gap-2 min-w-max">
                  {seq.steps.map(step => {
                    const style = CHANNEL_CHIP_STYLES[step.channel] || CHANNEL_CHIP_STYLES.email;
                    return (
                      <div
                        key={step.stepNumber}
                        className={`flex flex-col items-center gap-1 px-2.5 py-2 rounded-lg border text-center min-w-[72px] ${style.bg}`}
                        data-testid={`chip-step-${seq.id}-${step.stepNumber}`}
                      >
                        <span className="flex items-center gap-1">{style.icon}</span>
                        <span className="text-[10px] font-semibold leading-tight">{CHANNEL_LABELS[step.channel]}</span>
                        <span className="text-[10px] opacity-70 leading-tight">{step.delayDescription}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">If/Then Branch Logic</p>
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-xs text-foreground/80">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <span><span className="font-semibold">Call Answered</span> → Remove from sequence, enroll in Inbound Nurture workflow</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                  <span><span className="font-semibold">Voicemail</span> → Drop voicemail audio + send follow-up SMS (5 min delay)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                  <span><span className="font-semibold">No Answer</span> → Continue sequence to next step</span>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Exit Conditions</p>
              <ul className="text-xs text-foreground/80 space-y-1 list-none">
                <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> Contact replies to any email or SMS → stop sequence</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> Appointment booked (tag LB-BOOKING-READY added) → stop sequence</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> DNC / STOP reply received → stop sequence immediately</li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">GHL Build Checklist</p>
              <ul className="text-xs text-foreground/80 space-y-1.5">
                {[
                  `Create workflow with trigger: Contact Tag Added = LB-COLD-${seq.id === "cold-outbound-auto-repair" ? "AUTO-REPAIR" : seq.id === "cold-outbound-dental" ? "DENTAL" : "MEDSPA"}`,
                  "Add each step as a GHL action in order",
                  "Configure If/Then branches on all Call steps",
                  "Add exit conditions for reply detection and booking tag",
                  "Upload voicemail audio files to GHL Voicemail Drops library",
                  "Test with a dummy contact",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2" data-testid={`checklist-${seq.id}-${i}`}>
                    <span className="w-4 h-4 border border-border rounded shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SequenceCard({ sequence }: { sequence: SequencePrompt }) {
  const [expanded, setExpanded] = useState(false);
  const [aiPromptExpanded, setAiPromptExpanded] = useState(false);
  const categoryLabel = CATEGORY_LABELS[sequence.category] || sequence.category;
  const categoryColor = CATEGORY_COLORS[sequence.category] || "bg-gray-100 text-gray-700";

  const aiPromptBlock = sequence.usesConversationAI
    ? `\n\nCONVERSATION AI SYSTEM PROMPT (paste into GHL AI Agent Settings):\n${"─".repeat(60)}\n${CONVERSATION_AI_SYSTEM_PROMPT}\n${"─".repeat(60)}\n`
    : "";

  const fullSequenceText = [
    `SEQUENCE: ${sequence.name}`,
    `CATEGORY: ${categoryLabel}`,
    ``,
    `TRIGGER CONDITIONS:`,
    sequence.triggerConditions,
    ``,
    sequence.usesConversationAI
      ? `USES CONVERSATION AI: Yes\n${aiPromptBlock}`
      : `USES CONVERSATION AI: No`,
    ``,
    ...sequence.steps.flatMap(step => {
      const lines = [
        `─────────────────────────────────`,
        `STEP ${step.stepNumber} — ${CHANNEL_LABELS[step.channel] || step.channel}`,
        `Timing: ${step.delayDescription}`,
      ];
      if (step.channel === "call") {
        if (step.callMode) lines.push(`Call Mode: ${step.callMode}`);
        lines.push(``, `CALL SCRIPT (30–45 sec):`, step.callScript || "");
        if (step.ghlNote) lines.push(``, `GHL SETUP: ${step.ghlNote}`);
      } else if (step.channel === "voicemail_drop") {
        lines.push(``, `VOICEMAIL SCRIPT (15–20 sec):`, step.voicemailScript || "");
        if (step.ghlNote) lines.push(``, `GHL SETUP: ${step.ghlNote}`);
        lines.push(`NOTE: Record as audio file and upload to GHL Voicemail Drops library.`);
      } else {
        if (step.subject) lines.push(`Subject: ${step.subject}`, ``);
        lines.push(step.body);
        if (step.ghlNote) lines.push(``, `GHL SETUP: ${step.ghlNote}`);
      }
      lines.push(``);
      return lines;
    }),
  ].filter(l => l !== undefined).join("\n");

  return (
    <Card className="overflow-hidden" data-testid={`card-sequence-prompt-${sequence.id}`}>
      <div className="flex items-start justify-between gap-4 p-4">
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded(e => !e)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setExpanded(v => !v); }}
          data-testid={`button-expand-sequence-${sequence.id}`}
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor}`}>
              {categoryLabel}
            </span>
            {sequence.usesConversationAI && (
              <span className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 font-medium">
                <Bot className="w-3 h-3" /> Conversation AI
              </span>
            )}
            <span className="text-xs text-muted-foreground">{sequence.steps.length} steps</span>
          </div>
          <h3 className="font-semibold text-foreground text-sm">{sequence.name}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{sequence.triggerConditions}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CopyButton text={fullSequenceText} label={`sequence ${sequence.id}`} />
          <div
            className="cursor-pointer p-1"
            onClick={() => setExpanded(e => !e)}
            role="button"
            tabIndex={-1}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/60 pt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Trigger Conditions</p>
            <p className="text-sm text-foreground/80">{sequence.triggerConditions}</p>
          </div>
          {sequence.usesConversationAI && (
            <div className="rounded-lg border border-purple-200 dark:border-purple-800 overflow-hidden">
              <div className="flex items-center justify-between gap-2 p-3 bg-purple-50 dark:bg-purple-900/20">
                <div
                  className="flex items-center gap-2 text-purple-800 dark:text-purple-300 text-sm font-medium flex-1 cursor-pointer"
                  onClick={() => setAiPromptExpanded(v => !v)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setAiPromptExpanded(v => !v); }}
                  data-testid={`button-expand-ai-prompt-${sequence.id}`}
                >
                  <Bot className="w-4 h-4 shrink-0" />
                  <span>Conversation AI System Prompt (paste into GHL AI Agent Settings)</span>
                  {aiPromptExpanded ? <ChevronDown className="w-4 h-4 ml-1" /> : <ChevronRight className="w-4 h-4 ml-1" />}
                </div>
                <CopyButton text={CONVERSATION_AI_SYSTEM_PROMPT} label={`ai-prompt-${sequence.id}`} />
              </div>
              {aiPromptExpanded && (
                <div className="p-3 bg-background border-t border-purple-200 dark:border-purple-800">
                  <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/80 leading-relaxed max-h-80 overflow-y-auto" data-testid={`text-ai-prompt-${sequence.id}`}>
                    {CONVERSATION_AI_SYSTEM_PROMPT}
                  </pre>
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</p>
            {sequence.steps.map(step => (
              <StepCard key={step.stepNumber} step={step} sequenceId={sequence.id} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function PromptsDocument() {
  const { toast } = useToast();
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const categories = Array.from(new Set(SEQUENCE_PROMPTS.map(s => s.category)));

  const filtered = SEQUENCE_PROMPTS.filter(seq => {
    const matchCategory = filterCategory === "all" || seq.category === filterCategory;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || seq.name.toLowerCase().includes(q) || seq.category.toLowerCase().includes(q) || seq.triggerConditions.toLowerCase().includes(q);
    return matchCategory && matchSearch;
  });

  const handleDownload = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const maxLineWidth = pageWidth - margin * 2;
    const lineHeight = 11;
    let y = margin;

    const addText = (text: string, fontSize = 8, bold = false) => {
      doc.setFontSize(fontSize);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      const splitLines = doc.splitTextToSize(text, maxLineWidth);
      for (const line of splitLines) {
        if (y + lineHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += lineHeight;
      }
    };

    const addBlankLine = () => { y += lineHeight * 0.5; };

    addText("LIBERTY BANCARD — GHL AI WORKFLOW PROMPTS", 13, true);
    addText(`Generated: ${new Date().toLocaleDateString()}`, 8);
    addBlankLine();
    addText("=".repeat(90), 7);
    addText("CONVERSATION AI SYSTEM PROMPT", 11, true);
    addText("Paste into GHL → Automation → [Workflow] → Conversation AI → AI Agent → System Prompt", 8);
    addText("=".repeat(90), 7);
    addBlankLine();
    addText(CONVERSATION_AI_SYSTEM_PROMPT, 7);
    addBlankLine();
    addText("=".repeat(90), 7);
    addText("SEQUENCE PROMPTS", 11, true);
    addText("=".repeat(90), 7);
    addBlankLine();

    for (const seq of SEQUENCE_PROMPTS) {
      addText("─".repeat(90), 7);
      addText(`SEQUENCE: ${seq.name}`, 10, true);
      addText(`Category: ${CATEGORY_LABELS[seq.category] || seq.category}`, 8);
      addText(`Conversation AI: ${seq.usesConversationAI ? "Yes — apply system prompt to AI Agent step" : "No"}`, 8);
      addBlankLine();
      addText("TRIGGER CONDITIONS:", 8, true);
      addText(seq.triggerConditions, 7);
      addBlankLine();

      if (seq.usesConversationAI) {
        addText("CONVERSATION AI SYSTEM PROMPT (paste into GHL AI Agent Settings):", 8, true);
        addText(CONVERSATION_AI_SYSTEM_PROMPT, 7);
        addBlankLine();
      }

      for (const step of seq.steps) {
        addText(`STEP ${step.stepNumber} — ${CHANNEL_LABELS[step.channel] || step.channel}`, 9, true);
        addText(`Timing: ${step.delayDescription}`, 8);
        if (step.channel === "call") {
          if (step.callMode) addText(`Call Mode: ${step.callMode}`, 8);
          addBlankLine();
          addText("CALL SCRIPT (30–45 sec):", 8, true);
          addText(step.callScript || "", 7);
          if (step.ghlNote) { addBlankLine(); addText(`GHL SETUP: ${step.ghlNote}`, 7); }
        } else if (step.channel === "voicemail_drop") {
          addBlankLine();
          addText("VOICEMAIL SCRIPT (15–20 sec):", 8, true);
          addText(step.voicemailScript || "", 7);
          if (step.ghlNote) { addBlankLine(); addText(`GHL SETUP: ${step.ghlNote}`, 7); }
          addText("NOTE: Record as audio file and upload to GHL Voicemail Drops library.", 7);
        } else {
          if (step.subject) addText(`Subject: ${step.subject}`, 8);
          addBlankLine();
          addText(step.body, 7);
          if (step.ghlNote) { addBlankLine(); addText(`GHL SETUP: ${step.ghlNote}`, 7); }
        }
        addBlankLine();
      }
      addBlankLine();
    }

    doc.save("liberty-bancard-ghl-workflow-prompts.pdf");
    toast({ title: "Downloaded", description: "Prompts document saved as PDF." });
  };

  const handleCopyAll = async () => {
    const lines: string[] = [
      "LIBERTY BANCARD — GHL AI WORKFLOW PROMPTS",
      "=".repeat(80),
      "",
      "CONVERSATION AI SYSTEM PROMPT",
      "=".repeat(80),
      CONVERSATION_AI_SYSTEM_PROMPT,
      "",
    ];
    for (const seq of SEQUENCE_PROMPTS) {
      lines.push(`${"─".repeat(60)}`);
      lines.push(`SEQUENCE: ${seq.name}`);
      lines.push(`TRIGGER: ${seq.triggerConditions}`);
      lines.push(`CONVERSATION AI: ${seq.usesConversationAI ? "Yes" : "No"}`);
      lines.push("");
      for (const step of seq.steps) {
        lines.push(`STEP ${step.stepNumber} [${CHANNEL_LABELS[step.channel]}] — ${step.delayDescription}`);
        if (step.channel === "call") {
          if (step.callMode) lines.push(`Call Mode: ${step.callMode}`);
          lines.push(`CALL SCRIPT: ${step.callScript || ""}`);
          if (step.ghlNote) lines.push(`GHL SETUP: ${step.ghlNote}`);
        } else if (step.channel === "voicemail_drop") {
          lines.push(`VOICEMAIL SCRIPT: ${step.voicemailScript || ""}`);
          if (step.ghlNote) lines.push(`GHL SETUP: ${step.ghlNote}`);
          lines.push(`NOTE: Record as audio file and upload to GHL Voicemail Drops library.`);
        } else {
          if (step.subject) lines.push(`Subject: ${step.subject}`);
          lines.push(step.body);
          if (step.ghlNote) lines.push(`GHL SETUP: ${step.ghlNote}`);
        }
        lines.push("");
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: "Copied", description: "All prompts copied to clipboard." });
    } catch {
      toast({ title: "Error", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            GHL AI Workflow Prompts Document
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Copy-paste-ready prompts for all sequences. Expand a sequence to view and copy individual steps.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyAll} data-testid="button-copy-all-prompts">
            <Copy className="w-4 h-4 mr-1" /> Copy All
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-download-prompts">
            <Download className="w-4 h-4 mr-1" /> Download PDF
          </Button>
        </div>
      </div>

      <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2 text-purple-800 dark:text-purple-300">
              <Bot className="w-4 h-4" />
              Conversation AI System Prompt
            </CardTitle>
            <CopyButton text={CONVERSATION_AI_SYSTEM_PROMPT} label="Conversation AI system prompt" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Paste into GHL → Automation → [Workflow] → Conversation AI → AI Agent → System Prompt
          </p>
        </CardHeader>
        <CardContent>
          <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/80 max-h-64 overflow-y-auto leading-relaxed border border-border rounded-md p-3 bg-background" data-testid="text-conversation-ai-prompt">
            {CONVERSATION_AI_SYSTEM_PROMPT}
          </pre>
        </CardContent>
      </Card>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search sequences..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-prompts"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button
            variant={filterCategory === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterCategory("all")}
            data-testid="button-filter-all"
          >
            All ({SEQUENCE_PROMPTS.length})
          </Button>
          {categories.map(cat => (
            <Button
              key={cat}
              variant={filterCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterCategory(cat)}
              data-testid={`button-filter-${cat}`}
            >
              {CATEGORY_LABELS[cat] || cat} ({SEQUENCE_PROMPTS.filter(s => s.category === cat).length})
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No sequences match your search.</div>
        ) : (
          filtered.map(seq => <SequenceCard key={seq.id} sequence={seq} />)
        )}
      </div>
    </div>
  );
}

export default function GhlWorkflowManager() {
  const { toast } = useToast();
  const [editingIds, setEditingIds] = useState<Record<string, string>>({});
  const [savingSequences, setSavingSequences] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const { data: mappings = [], isLoading } = useQuery<WorkflowMapping[]>({
    queryKey: ["/api/ghl/workflow-mappings"],
  });

  const mappingByName = Object.fromEntries(mappings.map(m => [m.sequenceName, m]));

  const saveMutation = useMutation({
    mutationFn: async ({ sequenceName, ghlWorkflowId, category }: { sequenceName: string; ghlWorkflowId: string; category: string }) => {
      return apiRequest("PUT", `/api/ghl/workflow-mappings/${encodeURIComponent(sequenceName)}`, { ghlWorkflowId: ghlWorkflowId || null, category });
    },
    onSuccess: (_, { sequenceName }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ghl/workflow-mappings"] });
      setSavingSequences(prev => { const next = new Set(prev); next.delete(sequenceName); return next; });
      setEditingIds(prev => { const next = { ...prev }; delete next[sequenceName]; return next; });
      toast({ title: "Saved", description: "Workflow ID updated successfully." });
    },
    onError: (_, { sequenceName }) => {
      setSavingSequences(prev => { const next = new Set(prev); next.delete(sequenceName); return next; });
      toast({ title: "Error", description: "Failed to save workflow ID.", variant: "destructive" });
    },
  });

  const handleSave = (sequenceName: string, category: string) => {
    const ghlWorkflowId = editingIds[sequenceName] ?? (mappingByName[sequenceName]?.ghlWorkflowId || "");
    setSavingSequences(prev => new Set(prev).add(sequenceName));
    saveMutation.mutate({ sequenceName, ghlWorkflowId, category });
  };

  const getWorkflowId = (sequenceName: string) => {
    if (sequenceName in editingIds) return editingIds[sequenceName];
    return mappingByName[sequenceName]?.ghlWorkflowId || "";
  };

  const isEdited = (sequenceName: string) => sequenceName in editingIds;
  const hasId = (sequenceName: string) => {
    const id = mappingByName[sequenceName]?.ghlWorkflowId;
    return !!id && id.trim() !== "";
  };

  const configuredCount = ALL_SEQUENCES.filter(s => hasId(s.name)).length;

  const filteredSequences = ALL_SEQUENCES.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Workflow className="w-6 h-6 text-primary" />
            GHL Workflows
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage GHL workflow IDs and access copy-paste-ready prompts for all sequences.
          </p>
        </div>
      </div>

      <Tabs defaultValue="id-manager">
        <TabsList data-testid="tabs-ghl-workflows">
          <TabsTrigger value="id-manager" data-testid="tab-id-manager">
            <Workflow className="w-4 h-4 mr-1.5" />
            Workflow ID Manager
          </TabsTrigger>
          <TabsTrigger value="prompts" data-testid="tab-prompts">
            <FileText className="w-4 h-4 mr-1.5" />
            AI Workflow Prompts
          </TabsTrigger>
          <TabsTrigger value="blueprints" data-testid="tab-blueprints">
            <Map className="w-4 h-4 mr-1.5" />
            Cadence Blueprints
          </TabsTrigger>
        </TabsList>

        <TabsContent value="id-manager" className="space-y-4 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <Card className="flex-1" data-testid="card-ghl-workflow-summary">
              <CardContent className="p-4">
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-sm"><span className="font-semibold">{configuredCount}</span> sequences connected to GHL</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span className="text-sm"><span className="font-semibold">{ALL_SEQUENCES.length - configuredCount}</span> sequences need a workflow ID</span>
                  </div>
                </div>
                {configuredCount < ALL_SEQUENCES.length && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Sequences without a GHL workflow ID will not enroll contacts in GHL. Copy the workflow ID from GHL → Automation → Workflows → [workflow] → Settings.
                  </p>
                )}
              </CardContent>
            </Card>
            <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/ghl/workflow-mappings"] })} data-testid="button-refresh-mappings">
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search sequences by name or category..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-sequences"
            />
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading workflow mappings...</div>
            ) : (
              filteredSequences.map(seq => {
                const currentId = getWorkflowId(seq.name);
                const edited = isEdited(seq.name);
                const configured = hasId(seq.name);
                const isSaving = savingSequences.has(seq.name);
                const categoryColor = CATEGORY_COLORS[seq.category] || "bg-gray-100 text-gray-700";

                return (
                  <Card key={seq.name} className={`transition-all ${edited ? "ring-2 ring-primary/30" : ""}`} data-testid={`card-sequence-${seq.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-medium text-sm text-foreground truncate">{seq.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor}`}>{seq.category}</span>
                            {configured && !edited && (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                <CheckCircle className="w-3 h-3" /> Connected
                              </span>
                            )}
                            {!configured && (
                              <span className="flex items-center gap-1 text-xs text-red-500">
                                <XCircle className="w-3 h-3" /> No ID set
                              </span>
                            )}
                            {edited && (
                              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Unsaved</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <Input
                              placeholder="Paste GHL workflow ID here (e.g. abc123def456...)"
                              value={currentId}
                              onChange={e => setEditingIds(prev => ({ ...prev, [seq.name]: e.target.value }))}
                              className="font-mono text-xs h-8 flex-1"
                              data-testid={`input-workflow-id-${seq.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}
                            />
                            <Button
                              size="sm"
                              variant={edited ? "default" : "outline"}
                              disabled={isSaving || (!edited && configured)}
                              onClick={() => handleSave(seq.name, seq.category)}
                              className="shrink-0 h-8"
                              data-testid={`button-save-${seq.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}
                            >
                              {isSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              <span className="ml-1 text-xs">{isSaving ? "Saving..." : "Save"}</span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>

        <TabsContent value="prompts" className="mt-4">
          <PromptsDocument />
        </TabsContent>

        <TabsContent value="blueprints" className="mt-4">
          <CadenceBlueprints />
        </TabsContent>
      </Tabs>
    </div>
  );
}
