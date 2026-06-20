import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Mail, MessageSquare, Phone, Mic, ClipboardList, Bot, Copy, CheckCircle2,
  Tag, ArrowRight, AlertCircle, Zap, ExternalLink, ChevronDown, ChevronRight,
  ListChecks, Calendar, Users, Settings, Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Step {
  num: number;
  channel: "email" | "sms" | "call" | "voicemail" | "task" | "ai";
  delay: string;
  subject?: string;
  copy: string;
  ghlNote?: string;
  branch?: string;
}

interface Workflow {
  id: string;
  name: string;
  goal: string;
  trigger: string;
  triggerTag: string;
  color: string;
  steps: Step[];
  exitConditions: string[];
  checklist: string[];
}

// ─── Channel config ────────────────────────────────────────────────────────────

const CHANNEL_META: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
  email:     { icon: Mail,          label: "Email",        color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  sms:       { icon: MessageSquare, label: "SMS",          color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  call:      { icon: Phone,         label: "AI Voice Call",color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  voicemail: { icon: Mic,           label: "Voicemail Drop",color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  task:      { icon: ClipboardList, label: "Internal Task", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  ai:        { icon: Bot,           label: "AI Conversation", color: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300" },
};

// ─── Workflow data ─────────────────────────────────────────────────────────────

const WORKFLOWS: Workflow[] = [
  {
    id: "inbound",
    name: "Workflow 1 — Speed-to-Lead (Inbound)",
    goal: "Reach the merchant within 60 seconds. Speed-to-lead is the #1 conversion lever for inbound leads.",
    trigger: "Contact submits any web form, chat widget, or GHL landing page. Fire immediately.",
    triggerTag: "LB-INBOUND-NEW",
    color: "border-blue-500",
    steps: [
      {
        num: 1, channel: "email", delay: "Immediately (< 2 min)",
        subject: "Got your request — here's what happens next, {{contact.firstName}}",
        copy: `Hi {{contact.firstName}},

We got your message and someone from our team will reach out within the hour.

Quick shortcut: if you have a recent merchant processing statement, reply and attach it now. We'll run a full cost comparison before we even talk — so instead of starting from scratch on the call, you come in knowing exactly what you're overpaying.

Takes us 24 hours. Costs you nothing.

— Scott Allen, Liberty Bancard
📞 (888) 555-0100 | www.libertybancard.com

Eligibility, underwriting, and card brand rules apply.`,
        ghlNote: "GHL Action: Send Email → use Liberty Bancard branded template. Add reply-tracking.",
      },
      {
        num: 2, channel: "sms", delay: "2 minutes after form submit",
        copy: `Hi {{contact.firstName}} — Liberty Bancard here. Got your request. Someone's calling you shortly. If you have a merchant statement handy, reply with it and we'll have your savings analysis ready before the call. Reply STOP to opt out.`,
        ghlNote: "GHL Action: Send SMS. Enable two-way SMS. Trigger Reply Engaged workflow on any inbound reply.",
      },
      {
        num: 3, channel: "task", delay: "5 minutes after form submit",
        copy: `⚡ PRIORITY LEAD — Call NOW\n{{contact.firstName}} {{contact.lastName}} just submitted a form.\nPhone: {{contact.phone}} | Business: {{contact.companyName}}\nGoal: Book statement review call or get statement on the call.\nCheck inbox — they may have already replied with a statement.`,
        ghlNote: "GHL Action: Create Task → assign to assigned user or round-robin SDR group.",
      },
      {
        num: 4, channel: "call", delay: "15 minutes (GHL Voice AI — intro_qualification mode)",
        copy: `"Hi, is this {{contact.firstName}}? [pause] Great — this is the Liberty Bancard AI calling to follow up on the request you just submitted. I can answer questions and help you get started right now, or connect you with one of our account managers.\n\nDo you have a merchant processing statement we could review for you? [If yes] → Excellent. I can connect you with our analysis team right now, or you can email it to analysis@libertybancard.com and we'll have a full breakdown back to you within 24 hours.\n\n[If no/not sure] → No problem. Our account managers can walk you through exactly what to pull up. Can I book a 15-minute call for you?"`,
        branch: "Answered → qualification flow | Voicemail → Step 5 voicemail drop | No Answer → wait 2 hr → retry call",
        ghlNote: "GHL Action: AI Voice Call → Voice AI Employee (intro_qualification). Set to business hours 9 AM–5 PM local time. Connect GHL calendar for live booking.",
      },
      {
        num: 5, channel: "voicemail", delay: "If no answer on Step 4 (pre-recorded drop)",
        copy: `"Hi {{contact.firstName}}, this is Scott with Liberty Bancard calling about the request you just submitted. Give me a call back at 888-555-0100 or reply to the text we just sent you — I'll be watching for it. Talk soon."`,
        ghlNote: "GHL Action: Voicemail Drop → select pre-recorded audio from Media Library. Record separately and upload before activating workflow.",
      },
      {
        num: 6, channel: "call", delay: "2 hours later — retry if still no contact",
        copy: `[Same Voice AI script as Step 4 — intro_qualification mode]`,
        branch: "Answered → stop sequence, tag LB-CALLED | Voicemail → drop VM | No Answer → continue to Day 1 email",
        ghlNote: "GHL: Add If/Else branch after call — check contact.replied or tag LB-CALLED.",
      },
      {
        num: 7, channel: "email", delay: "Next morning, 9 AM local time",
        subject: "One thing most merchants don't know about their rates",
        copy: `Hi {{contact.firstName}},

Most merchants assume their processing rate is competitive. Most are wrong.

The way processor pricing works, the markup your processor charges sits on top of the base interchange rate set by Visa/Mastercard. That markup is 100% negotiable — but most merchants never push back because they don't know what number to push back to.

When we run a statement review, the first thing we do is strip out the interchange (the fixed part you can't change) and show you exactly what you're paying your processor in markup. That's the number that matters.

If you're willing to take 2 minutes to upload a statement, I'll tell you where you stand:

[Statement Upload Link]

— Scott Allen, Liberty Bancard`,
      },
      {
        num: 8, channel: "sms", delay: "Day 2, 10 AM",
        copy: `{{contact.firstName}} — quick follow-up from Liberty Bancard. Did you get a chance to pull a recent statement? Reply with a photo or PDF and we'll run your free analysis. Reply STOP to opt out.`,
      },
      {
        num: 9, channel: "ai", delay: "Day 3 — GHL AI SMS Conversation",
        copy: `"Hi {{contact.firstName}}, this is the Liberty Bancard AI assistant. Just checking in — do you have questions about our statement review process, or would you like to book a quick call with our team? I can answer questions or get a time on the calendar right now."`,
        ghlNote: "GHL Action: Assign conversation to AI Employee (Text channel). AI handles objections, books via GHL calendar link, or escalates to human SDR on trigger phrases.",
      },
    ],
    exitConditions: [
      "Any reply received → tag LB-SDR-REPLY-ENGAGED → enroll in Workflow 3",
      "Statement uploaded → tag LB-STATEMENT-RECEIVED → trigger statement review workflow",
      "Appointment booked → tag LB-BOOKING-READY → stop sequence",
      "STOP reply → tag LB-DNC → stop all sequences immediately",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-INBOUND-NEW",
      "Configure email template with Liberty Bancard branding",
      "Enable two-way SMS and set reply trigger → enroll in Workflow 3",
      "Create Voice AI Employee (Phone channel) with intro_qualification script",
      "Record and upload Voicemail Drop audio to GHL Media Library",
      "Create Task action → assign to SDR round-robin group",
      "Create AI Employee (Text/SMS channel) with conversation AI system prompt",
      "Connect GHL calendar to AI Employee for live appointment booking",
      "Add If/Else branches for each call disposition",
      "Set workflow timezone to contact's local timezone",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
  {
    id: "cold",
    name: "Workflow 2 — Cold Outbound Prospecting",
    goal: "12-day multi-touch cadence to get a statement or book an intro call from a cold prospect.",
    trigger: "Prospect identified via SDR enrichment, Sunbiz import, or manual upload. Volume sequence.",
    triggerTag: "LB-COLD-OUTBOUND",
    color: "border-slate-500",
    steps: [
      {
        num: 1, channel: "email", delay: "Day 1 — 9 AM local time",
        subject: "Your processor is probably charging you too much",
        copy: `Hi {{contact.firstName}},

Quick question: when's the last time you actually looked at what you're paying in processing fees vs. what your processor is marking up?

Most merchants on legacy pricing are paying 0.30–0.80% more than they should. On $100,000/month in volume, that's $300–$800/month going straight to your processor as pure margin.

We do a free statement review that shows you exactly where your money is going — no obligation, no sales pressure. Just numbers.

Worth 2 minutes of your time? Reply "yes" and I'll send you the upload link.

— Scott Allen, Liberty Bancard
Eligibility, underwriting, and card brand rules apply.`,
        ghlNote: "GHL: Send Email. Use merge fields. Enable reply detection → trigger Workflow 3 (Reply Engaged).",
      },
      {
        num: 2, channel: "sms", delay: "Day 2 — 10 AM",
        copy: `Hi {{contact.firstName}}, Scott with Liberty Bancard. Most merchants never look at their processing markup — it's usually buried in the statement. Want me to pull it out and show you what you're actually paying? Reply YES and I'll send instructions. Reply STOP to opt out.`,
      },
      {
        num: 3, channel: "task", delay: "Day 3 — internal",
        copy: `Review contact profile for {{contact.firstName}} {{contact.lastName}} at {{contact.companyName}}.\nCheck LinkedIn/website for recent news or triggers.\nAdd personalization note to Day 5 email if possible.\nNo response yet — do not call today.`,
        ghlNote: "GHL: Create Task → assign to rep. Internal prep only, no outbound contact on Day 3.",
      },
      {
        num: 4, channel: "email", delay: "Day 5 — 9 AM",
        subject: "The one fee merchants never think about",
        copy: `Hi {{contact.firstName}},

There's a fee on your merchant statement called the "processor markup" or "non-qualified surcharge" — it goes by different names depending on your provider.

It's usually between 0.10% and 1.50% of your entire volume. On $50K/month that's $50–$750/month that has nothing to do with Visa or Mastercard. It's pure processor margin.

We reviewed a restaurant last month paying 1.2% markup. We got them to 0.15%. That's $525/month back in their pocket — $6,300/year.

If you want to know where you stand, reply with your business name and state and I'll send you the statement upload link.

— Scott Allen
Eligibility, underwriting, and card brand rules apply.`,
      },
      {
        num: 5, channel: "sms", delay: "Day 7 — 11 AM",
        copy: `{{contact.firstName}} — one more check-in from Liberty Bancard. If you've been meaning to review your processing costs, this is a good time. Takes 5 minutes to upload, 24 hrs to get results. No cost, no contract. Interested? Reply YES. Reply STOP to opt out.`,
      },
      {
        num: 6, channel: "call", delay: "Day 8 — 9:30 AM local (GHL Voice AI — cold_outbound mode)",
        copy: `"Hi, may I speak with {{contact.firstName}}? [pause] Hi {{contact.firstName}} — this is Liberty Bancard calling about your merchant processing. We specialize in statement reviews that show business owners exactly what they're paying vs. what they should be paying. The review is free, takes about 24 hours, and most merchants are pretty surprised by what we find.\n\nDo you currently accept credit cards at your business? [yes] Are you locked into a current processor contract? [listen] We can work around contracts in most cases. Can I get 15 minutes on your calendar this week to walk you through how it works?"`,
        branch: "Books → stop, tag LB-BOOKING-READY | Interested/can't talk → tag LB-CALLBACK | Not interested → tag LB-COLD-EXIT, exit",
        ghlNote: "GHL: AI Voice Call → cold_outbound mode. Enforce business hours. Add If/Else branches for each disposition. Connect calendar for live booking.",
      },
      {
        num: 7, channel: "voicemail", delay: "Day 8 — if no answer on Step 6",
        copy: `"Hi {{contact.firstName}}, this is Scott with Liberty Bancard. I've sent you a couple of emails about your merchant processing — just wanted to put a voice to the name. If you'd like a free look at what you're paying, give me a call at 888-555-0100 or just reply to one of my emails. Hope to connect soon."`,
      },
      {
        num: 8, channel: "email", delay: "Day 10 — 9 AM",
        subject: "Last thing I'll say about this",
        copy: `{{contact.firstName}},

I've sent a few notes over the past couple of weeks. I know your inbox is busy, so I'll keep this short.

If you accept credit cards and haven't had an independent review of your rates in the last 12 months, there's a reasonable chance you're overpaying. Maybe a little, maybe a lot — I genuinely don't know without seeing the statement.

If you want to find out: [Statement Upload Link]

If now's not the right time: no problem. I'll check back in a few months.

— Scott Allen`,
      },
      {
        num: 9, channel: "sms", delay: "Day 12 — final touch",
        copy: `{{contact.firstName}} — this is my last message from Liberty Bancard. If you ever want a free review of your processing costs, we're here: www.libertybancard.com/statement-review — No pressure. Take care. Reply STOP to opt out.`,
        ghlNote: "After this step: tag contact LB-COLD-EXHAUSTED. Exit workflow.",
      },
    ],
    exitConditions: [
      "Any reply → tag LB-SDR-REPLY-ENGAGED → enroll in Workflow 3 (Reply Engaged)",
      "Appointment booked → tag LB-BOOKING-READY → stop sequence",
      "Statement uploaded → tag LB-STATEMENT-RECEIVED → trigger review workflow",
      "Not interested (voice AI disposition) → tag LB-COLD-EXIT → exit",
      "STOP reply → tag LB-DNC → stop immediately",
      "No engagement after Day 12 → tag LB-COLD-EXHAUSTED → exit",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-COLD-OUTBOUND",
      "Set all email sends to 9 AM contact local timezone using GHL time window",
      "Set all SMS sends to 10–11 AM to avoid quiet hours violations",
      "Configure Voice AI Employee — cold_outbound script",
      "Record and upload cold outbound voicemail audio to GHL Media Library",
      "Add If/Else branch after Day 8 call for each disposition outcome",
      "Add reply detection on all emails and SMS → stop sequence → enroll Workflow 3",
      "Set Day 12 as final step — auto-tag LB-COLD-EXHAUSTED after last SMS",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
  {
    id: "reply",
    name: "Workflow 3 — Reply Engaged",
    goal: "Someone replied. Move fast. Get them to a booking or statement within 48 hours.",
    trigger: "Any inbound reply to email or SMS from Workflow 1 or 2. Fire immediately on reply detection.",
    triggerTag: "LB-SDR-REPLY-ENGAGED",
    color: "border-green-500",
    steps: [
      {
        num: 1, channel: "sms", delay: "Immediately (< 5 min after reply detected)",
        copy: `Got your message, {{contact.firstName}}! An account manager will respond within 30 minutes. In the meantime, here's our calendar if you'd like to grab a time: [Calendar Link]`,
        ghlNote: "GHL: Send SMS immediately on workflow trigger. This is the acknowledgment — reply comes before the human reads the conversation.",
      },
      {
        num: 2, channel: "task", delay: "Day 1 — immediate internal alert",
        copy: `🔥 HOT LEAD — Replied to outreach\n{{contact.firstName}} {{contact.lastName}} responded.\nReview their reply in GHL conversation tab before calling.\nGoal: book a 15-min statement review call OR get statement uploaded.\nPersonalize your approach based on what they said.`,
        ghlNote: "GHL: Create Task → high priority → assign to SDR. Alert via SMS or app notification.",
      },
      {
        num: 3, channel: "email", delay: "Day 2 — 9 AM",
        subject: "Re: your message",
        copy: `Hi {{contact.firstName}},

Thanks for getting back to me.

Here's the direct link to upload your statement so we can run the analysis before we talk:
[Statement Upload Link]

Or grab a time on my calendar:
[Calendar Link]

Either way works — just let me know what's easier for you.

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Personalize this email if the rep added a contact note from the Task in Step 2.",
      },
      {
        num: 4, channel: "call", delay: "Day 3 — 10 AM (GHL Voice AI — follow_up_callback mode)",
        copy: `"Hi {{contact.firstName}}, this is Liberty Bancard calling back — you reached out to us recently and I wanted to personally follow up. Did you get a chance to look at the calendar link or the statement upload we sent over?"`,
        branch: "Answered + interested → book appointment, stop sequence | Voicemail → drop VM + continue",
        ghlNote: "GHL: Voice AI → follow_up_callback mode. If appointment booked → tag LB-BOOKING-READY → exit workflow.",
      },
      {
        num: 5, channel: "voicemail", delay: "Day 3 — if no answer on Step 4",
        copy: `"Hi {{contact.firstName}}, Scott from Liberty Bancard again. Just wanted to make sure you didn't get lost in the shuffle — I know you reached out and I want to make sure we take care of you. Give me a call at 888-555-0100 or grab a time on my calendar. I'll send the link again right now."`,
      },
      {
        num: 6, channel: "sms", delay: "Day 5 — final",
        copy: `{{contact.firstName}} — wanted to make sure you didn't fall through the cracks. Still happy to run that free analysis anytime. Calendar: [Link] | Upload: [Link]. Reply STOP to opt out.`,
        ghlNote: "After Day 5 with no booking or statement: tag LB-REPLY-EXHAUSTED. Return to long-term nurture sequence.",
      },
    ],
    exitConditions: [
      "Appointment booked → tag LB-BOOKING-READY → stop sequence",
      "Statement uploaded → tag LB-STATEMENT-RECEIVED → enroll in Workflow 4",
      "STOP reply → tag LB-DNC → stop immediately",
      "No engagement after Day 5 → tag LB-REPLY-EXHAUSTED → enroll in long-term nurture",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-SDR-REPLY-ENGAGED",
      "Set Step 1 SMS to fire within 5 minutes — no wait delay",
      "Create high-priority Task with SDR alert (push notification or internal SMS)",
      "Configure Voice AI → follow_up_callback script",
      "Record and upload reply-engaged voicemail audio",
      "Set appointment booking branch → tag LB-BOOKING-READY → exit workflow",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
  {
    id: "statement",
    name: "Workflow 4 — Statement Chase",
    goal: "Prospect agreed to send a statement but hasn't. Get it within 7 days.",
    trigger: "Prospect verbally or by text agreed to send a statement. Manual tag or voice AI disposition trigger.",
    triggerTag: "LB-SDR-STATEMENT-CHASE",
    color: "border-yellow-500",
    steps: [
      {
        num: 1, channel: "sms", delay: "Immediately after tag applied",
        copy: `{{contact.firstName}} — here's the statement upload link we mentioned: [Upload Link]. Takes 2 minutes. We'll have your analysis back within 24 hours. Reply STOP to opt out.`,
        ghlNote: "GHL: Fire immediately on trigger. No wait. This is the instant delivery of the promised link.",
      },
      {
        num: 2, channel: "email", delay: "Day 2 — 9 AM",
        subject: "Upload link + what to look for on your statement",
        copy: `Hi {{contact.firstName}},

Here's the link to upload your statement: [Upload Link]

If you're not sure what to pull, look for:
• Your most recent monthly merchant statement (PDF is fine)
• Any document with "processing volume" or "interchange" on it
• Even a screenshot of the fees section works

Once we have it, our analysis team runs it through our cost model and sends you a side-by-side comparison within 24 hours.

[Upload Link]

— Scott Allen`,
      },
      {
        num: 3, channel: "sms", delay: "Day 3 — 11 AM",
        copy: `Quick check-in — did you get a chance to grab that statement, {{contact.firstName}}? [Upload Link] — we'll take it from here. Reply STOP to opt out.`,
      },
      {
        num: 4, channel: "call", delay: "Day 5 — 10 AM (GHL Voice AI — statement_chase mode)",
        copy: `"Hi {{contact.firstName}}, Scott with Liberty Bancard. We spoke recently about running a statement review for you — just calling to see if you've had a chance to pull it. I can walk you through exactly where to find it if that's helpful. Give me a call back at 888-555-0100 or just reply to one of my texts."`,
        branch: "Has statement → get email/upload now | Can't find it → walk through on call | Not interested → tag LB-COLD-EXIT, exit",
        ghlNote: "GHL: Voice AI → statement_chase mode. Disposition: promised_statement → stay in workflow. Not interested → exit.",
      },
      {
        num: 5, channel: "voicemail", delay: "Day 5 — if no answer on Step 4",
        copy: `"Hi {{contact.firstName}}, this is Scott from Liberty Bancard. Just following up on the statement we were going to review together. If you want to send it over, just reply to one of my texts with a photo or PDF — that works great. Hope to hear from you soon."`,
      },
      {
        num: 6, channel: "email", delay: "Day 7 — final",
        subject: "Leaving the door open",
        copy: `{{contact.firstName}},

I know timing isn't always right. If the statement review is something you want to revisit later, just keep this link: [Upload Link]

We'll be here when you're ready.

— Scott Allen, Liberty Bancard`,
        ghlNote: "After Day 7 with no statement: tag LB-STATEMENT-EXHAUSTED. Move to long-term nurture.",
      },
    ],
    exitConditions: [
      "Statement uploaded → tag LB-STATEMENT-RECEIVED → stop sequence, trigger review workflow",
      "STOP reply → tag LB-DNC → stop immediately",
      "Not interested (voice AI) → tag LB-COLD-EXIT → exit",
      "No statement after Day 7 → tag LB-STATEMENT-EXHAUSTED → long-term nurture",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-SDR-STATEMENT-CHASE",
      "Step 1 SMS fires immediately — zero wait delay",
      "Include statement upload link in every step (use GHL custom value for link)",
      "Configure Voice AI → statement_chase script",
      "Record and upload statement chase voicemail audio",
      "Set webhook or Zapier trigger: statement uploaded → tag LB-STATEMENT-RECEIVED → stop workflow",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
  {
    id: "proposal",
    name: "Workflow 5 — Proposal Follow-Up",
    goal: "Close the deal. 7-day decision-focused sequence after sending the savings analysis.",
    trigger: "Deal stage moves to 'Proposal Sent' OR tag LB-SDR-PROPOSAL is applied after analysis is sent.",
    triggerTag: "LB-SDR-PROPOSAL",
    color: "border-purple-500",
    steps: [
      {
        num: 1, channel: "email", delay: "Immediately after proposal sent",
        subject: "Your Liberty Bancard analysis — {{contact.companyName}}",
        copy: `Hi {{contact.firstName}},

Attached is your payment processing analysis. Here's a quick summary:

• Your current effective rate: {{custom.currentRate}}%
• Liberty Bancard rate: {{custom.lbRate}}%
• Estimated monthly savings: \${{custom.monthlySavings}}
• Annualized: \${{custom.annualSavings}}

The next step is a 15-minute call to walk through the numbers and answer any questions. You can book directly here: [Calendar Link]

A few things to know:
• No long-term contract required
• Equipment swap handled at no charge
• First statement review post-switch is on us

Questions? Reply here or call me directly.

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Use custom values for rate/savings fields populated from the platform's proposal data. Attach analysis PDF if generated.",
      },
      {
        num: 2, channel: "sms", delay: "Day 2 — 10 AM",
        copy: `{{contact.firstName}} — just sent over your analysis. Any questions before we jump on a call? Book a time here: [Calendar Link]. Reply STOP to opt out.`,
      },
      {
        num: 3, channel: "task", delay: "Day 3 — internal",
        copy: `Follow up on proposal for {{contact.firstName}} at {{contact.companyName}}.\nReview their analysis numbers in the platform.\nPrepare objection handling:\n• Contract length / ETF concern\n• Equipment swap logistics\n• Batch timing / settlement questions\n• Current processor relationship\n\nGoal: get a decision or a specific objection to address.`,
        ghlNote: "GHL: Create Task → assign to deal owner. High priority.",
      },
      {
        num: 4, channel: "call", delay: "Day 5 — 10 AM (GHL Voice AI — proposal_reminder mode)",
        copy: `"Hi {{contact.firstName}}, Scott with Liberty Bancard. I sent over your processing analysis a few days ago — just calling to see if you had a chance to look it over. Happy to walk through the numbers, answer any questions, or talk through the switch process. Give me a call back or grab a time on my calendar."`,
        branch: "Ready to move → book closing call, tag LB-VERBAL-COMMIT | Objection → note in CRM, stay in workflow | Not interested → tag LB-CLOSED-LOST, exit",
        ghlNote: "GHL: Voice AI → proposal_reminder mode. Disposition branches: booked_meeting → tag LB-BOOKING-READY. not_interested → tag LB-CLOSED-LOST, exit workflow.",
      },
      {
        num: 5, channel: "voicemail", delay: "Day 5 — if no answer on Step 4",
        copy: `"Hi {{contact.firstName}}, Scott from Liberty Bancard. Wanted to touch base on the analysis I sent over — I think there's a real opportunity here and I don't want you to miss it. Give me a call at 888-555-0100 or grab a time on my calendar. I'll send the link right now."`,
      },
      {
        num: 6, channel: "sms", delay: "Day 7 — final",
        copy: `{{contact.firstName}} — following up one last time on your analysis. If the timing's not right, no problem — just let me know. If you're ready to move forward: [Calendar Link]. Reply STOP to opt out.`,
        ghlNote: "After Day 7: if no response, tag LB-PROPOSAL-EXHAUSTED. Move deal stage to Negotiation/Follow-Up. Enroll in long-term nurture.",
      },
    ],
    exitConditions: [
      "Appointment booked / verbal commit → tag LB-VERBAL-COMMIT → stop sequence",
      "Deal closed won → tag LB-CLOSED-WON → enroll in onboarding workflow",
      "Deal closed lost → tag LB-CLOSED-LOST → exit",
      "STOP reply → tag LB-DNC → stop immediately",
      "No response after Day 7 → tag LB-PROPOSAL-EXHAUSTED → long-term nurture",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-SDR-PROPOSAL",
      "Set up custom values: currentRate, lbRate, monthlySavings, annualSavings",
      "Step 1 email fires immediately — attach analysis PDF if available",
      "Configure Voice AI → proposal_reminder script",
      "Record and upload proposal follow-up voicemail audio",
      "Add disposition branches: verbal commit → LB-VERBAL-COMMIT | closed lost → LB-CLOSED-LOST",
      "Connect to onboarding workflow: LB-CLOSED-WON → enroll onboarding sequence",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
  {
    id: "onboarding",
    name: "Workflow 6 — Merchant Welcome & App Completion",
    goal: "Get the merchant through the application and document collection within 5 business days of closing.",
    trigger: "Deal stage moves to 'Closed Won' OR tag LB-CLOSED-WON is applied. Fire immediately.",
    triggerTag: "LB-CLOSED-WON",
    color: "border-emerald-500",
    steps: [
      {
        num: 1, channel: "email", delay: "Immediately after Closed Won",
        subject: "Welcome to Liberty Bancard, {{contact.firstName}} — here's what happens next",
        copy: `Hi {{contact.firstName}},

Welcome to Liberty Bancard. We're glad to have you.

Here's exactly what happens from here:

1. Complete your merchant application (takes 5–10 minutes): [Application Link]
2. Our team reviews and approves your account — typically within 1–2 business days.
3. We ship your terminal or configure your payment gateway.
4. You go live. We monitor your first statement and confirm your savings.

A few things to have handy when you fill out the application:
• EIN or SSN
• Voided check or bank letter (for deposits)
• Government-issued ID

If you have questions at any point, reply here or call (888) 555-0100.

Looking forward to saving you money.

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Send Email immediately on LB-CLOSED-WON tag. Use Liberty Bancard welcome template. Attach application link as a GHL custom value.",
      },
      {
        num: 2, channel: "sms", delay: "5 minutes after email",
        copy: `Hi {{contact.firstName}} — welcome to Liberty Bancard! 🎉 Your application link: [App Link]. Takes 5–10 min. Let us know if you have questions. Reply STOP to opt out.`,
        ghlNote: "GHL: Send SMS 5 minutes after Step 1. Short and action-focused — the email has the detail, the SMS is the push.",
      },
      {
        num: 3, channel: "task", delay: "Day 1 — internal",
        copy: `New merchant onboarding started: {{contact.firstName}} {{contact.lastName}} — {{contact.companyName}}\nDeal value: {{opportunity.monetaryValue}}\nAssigned rep: {{user.firstName}}\n\nAction items:\n• Confirm application link was received (check delivery)\n• Verify contact has EIN / voided check ready\n• Note any special requirements from sales call in contact record\n• Set reminder for Day 3 if app not submitted`,
        ghlNote: "GHL: Create Task → assign to deal owner. High priority. Set due date = tomorrow.",
      },
      {
        num: 4, channel: "email", delay: "Day 3 — if application NOT yet submitted",
        subject: "Quick check — did you get the application link?",
        copy: `Hi {{contact.firstName}},

Just checking in — wanted to make sure the application link came through okay.

Here it is again: [Application Link]

Most merchants finish in under 10 minutes. If you hit any questions on the form, reply here and I'll walk you through it.

— Scott Allen`,
        ghlNote: "GHL: Add If/Else condition before this step — check if tag LB-APP-SUBMITTED exists. If yes, skip this step and go to Step 5. If no, send this email.",
      },
      {
        num: 5, channel: "sms", delay: "Day 4 — if application still not submitted",
        copy: `Hi {{contact.firstName}} — just a quick nudge on your Liberty Bancard application. Any questions? Reply here or call us at (888) 555-0100. Direct link: [App Link]. Reply STOP to opt out.`,
        ghlNote: "GHL: Same condition as Step 4 — only send if LB-APP-SUBMITTED tag is NOT present.",
      },
      {
        num: 6, channel: "call", delay: "Day 5 — if application still not submitted (GHL Voice AI — onboarding_assist mode)",
        copy: `"Hi {{contact.firstName}}, this is Liberty Bancard calling about your merchant application. We sent it over a few days ago and wanted to make sure you didn't hit any snags. I can answer questions about the form, or connect you with your account manager right now. Is there anything I can help with to get you started?"`,
        branch: "Submitted/submitting → tag LB-APP-SUBMITTED, exit | Needs help → create task for rep | Not ready yet → log note, stay in workflow",
        ghlNote: "GHL: Voice AI → onboarding_assist mode. Business hours only. Disposition: submitted → LB-APP-SUBMITTED; needs_help → create priority task.",
      },
    ],
    exitConditions: [
      "Application submitted → tag LB-APP-SUBMITTED → stop sequence → enroll in Workflow 7 (Approval & Go-Live)",
      "STOP reply → tag LB-DNC → stop immediately",
      "No app after Day 7 → tag LB-ONBOARDING-STALLED → alert assigned rep",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-CLOSED-WON",
      "Set application link as a GHL custom value (reusable across all templates)",
      "Step 1 email fires immediately — zero wait delay",
      "Step 2 SMS fires 5 minutes after Step 1",
      "Add If/Else branches on Steps 4–6: check for LB-APP-SUBMITTED tag before sending",
      "Configure Voice AI → onboarding_assist script",
      "Set application submission webhook: when app submitted → tag LB-APP-SUBMITTED → exit workflow → enroll WF7",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
  {
    id: "golive",
    name: "Workflow 7 — Approval, Go-Live & Terminal Setup",
    goal: "Take the merchant from approved application to first live transaction. Confirm savings on first statement.",
    trigger: "Merchant application approved by underwriting. Platform applies tag LB-MERCHANT-APPROVED.",
    triggerTag: "LB-MERCHANT-APPROVED",
    color: "border-teal-500",
    steps: [
      {
        num: 1, channel: "email", delay: "Immediately on approval",
        subject: "You're approved! Here's your next step, {{contact.firstName}}",
        copy: `Hi {{contact.firstName}},

Great news — your Liberty Bancard merchant account has been approved.

Your Merchant ID (MID): {{custom.merchantId}}

Here's what happens next:

If you're using a physical terminal:
→ Your equipment will ship within 1–2 business days. Track it here: [Tracking Link]
→ Setup takes about 15 minutes. We'll send a step-by-step guide when it ships.

If you're using a payment gateway (online):
→ Your gateway credentials are in the Merchant Portal: [Portal Link]
→ Our team will schedule a 30-minute integration call with you.

Merchant Portal access (manage transactions, view statements, update banking):
[Portal Link] — Password reset link was sent to this email address.

First question or issue: call (888) 555-0100 or reply here. We answer fast.

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Send Email immediately on LB-MERCHANT-APPROVED. Use custom value for merchantId and portal link. This email must fire within minutes of approval — merchant is expecting it.",
      },
      {
        num: 2, channel: "sms", delay: "10 minutes after approval email",
        copy: `{{contact.firstName}} — you're approved! 🎉 MID: {{custom.merchantId}}. Portal: [Link]. Terminal ships in 1–2 days. Questions? Call (888) 555-0100. Reply STOP to opt out.`,
        ghlNote: "GHL: 10-minute delay after Step 1. Short confirmation with MID — merchants screenshot this.",
      },
      {
        num: 3, channel: "email", delay: "Day 2 — terminal shipped (conditional)",
        subject: "Your terminal shipped — {{contact.companyName}} setup guide inside",
        copy: `Hi {{contact.firstName}},

Your payment terminal shipped today. Tracking: [Tracking Link]

Once it arrives, here's how to get set up in 15 minutes:

1. Plug in the terminal (power + ethernet or WiFi)
2. Follow the on-screen setup wizard — it will auto-configure your merchant settings
3. Run a $1.00 test transaction with your own card to confirm it's processing
4. Call us at (888) 555-0100 if anything looks off

You'll process your first live transaction with Liberty Bancard rates from the moment it's configured. Your first statement will arrive in about 30 days — we'll send a savings summary at that point.

[Video: How to set up your terminal — 4 min]

— Liberty Bancard Onboarding Team`,
        ghlNote: "GHL: Fire when terminal label is created/shipped. If gateway-only merchant, replace this step with a 'gateway credentials' email instead. Use If/Else on custom field: terminal_type = physical → send this email; gateway → send gateway setup email.",
      },
      {
        num: 4, channel: "task", delay: "Day 3 — internal",
        copy: `Go-Live Check: {{contact.firstName}} at {{contact.companyName}}\n• Confirm terminal delivered or gateway access granted\n• Check merchant portal — has the merchant logged in?\n• Any open support tickets?\n• If no activity 3 days post-ship, call merchant proactively`,
        ghlNote: "GHL: Create Task → assign to onboarding rep. Due = Day 3 after approval.",
      },
      {
        num: 5, channel: "sms", delay: "Day 5 — go-live confirmation",
        copy: `Hi {{contact.firstName}} — checking in! Have you run your first transaction yet? Reply YES and you're all set. Need help? Call (888) 555-0100 or reply here. Reply STOP to opt out.`,
        ghlNote: "GHL: Day 5. If first transaction detected (via webhook or manual tag LB-FIRST-TXN), skip this step. Otherwise send.",
      },
      {
        num: 6, channel: "email", delay: "Day 32 — first statement follow-up",
        subject: "Your first Liberty Bancard statement — here's your savings breakdown",
        copy: `Hi {{contact.firstName}},

Your first full month of processing with Liberty Bancard is done. Here's a summary:

• Volume processed: {{custom.month1Volume}}
• Your effective rate this month: {{custom.month1Rate}}%
• Estimated savings vs. your previous processor: \${{custom.month1Savings}}

You can see the full statement breakdown in your Merchant Portal: [Portal Link]

A couple of things to note:
• If your volume was lower this month than expected, your effective rate may be slightly higher — interchange is tiered.
• If you have high-ticket transactions (over $500), we can review the card mix and see if there's more to optimize.

We're working for you every month. Let me know if you have any questions.

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Fire on Day 32 after LB-MERCHANT-APPROVED. Requires custom values month1Volume, month1Rate, month1Savings populated from the platform's statement reconciliation data. If data isn't ready, delay to Day 35.",
      },
    ],
    exitConditions: [
      "First transaction processed → tag LB-FIRST-TXN → mark onboarding complete",
      "Day 32 savings email sent → tag LB-MERCHANT-ACTIVE → enroll in Workflow 8 (Retention)",
      "Merchant unreachable after Day 7 → tag LB-GOLIVE-STALLED → escalate to manager",
      "STOP reply → tag LB-DNC → stop immediately",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-MERCHANT-APPROVED",
      "Set custom values: merchantId, portalLink, trackingLink, month1Volume, month1Rate, month1Savings",
      "Step 1 fires immediately — test with a sample approval to confirm sub-minute delivery",
      "Add If/Else on Step 3: terminal_type field → physical vs. gateway → different email content",
      "Connect shipping webhook: label created → tag LB-TERMINAL-SHIPPED → trigger Step 3",
      "Day 32 email requires statement reconciliation data — coordinate with platform data feed",
      "After Day 32 email: apply tag LB-MERCHANT-ACTIVE → auto-enroll in Workflow 8",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
  {
    id: "retention",
    name: "Workflow 8 — Retention, NPS & Referral",
    goal: "Keep active merchants engaged, identify at-risk accounts, and generate referrals from satisfied merchants.",
    trigger: "Tag LB-MERCHANT-ACTIVE applied after first statement delivered (Day 32+ post-go-live).",
    triggerTag: "LB-MERCHANT-ACTIVE",
    color: "border-sky-500",
    steps: [
      {
        num: 1, channel: "email", delay: "Day 30 — NPS survey",
        subject: "Quick question about your first month, {{contact.firstName}}",
        copy: `Hi {{contact.firstName}},

You've been processing with Liberty Bancard for about a month now — I wanted to check in.

On a scale of 0–10, how likely are you to recommend Liberty Bancard to another business owner?

[0–6] [7–8] [9–10]

(Click your score — takes 10 seconds. We read every response.)

If anything isn't working the way you expected, reply here and I'll personally make sure it's resolved.

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Send NPS email at Day 30. Connect NPS link to a GHL survey or external NPS tool. Set If/Else on score: 9–10 → tag LB-NPS-PROMOTER → enroll in referral sequence (Step 3). 7–8 → tag LB-NPS-PASSIVE. 0–6 → tag LB-NPS-DETRACTOR → create urgent task for account manager.",
      },
      {
        num: 2, channel: "task", delay: "Day 30 — NPS detractor alert (conditional)",
        copy: `⚠️ NPS DETRACTOR — Immediate follow-up required\n{{contact.firstName}} at {{contact.companyName}} scored 0–6 on NPS survey.\nContact within 24 hours — identify the issue and resolve it before they churn.\nCheck: terminal issues, unexpected fees, settlement timing, support ticket history.`,
        ghlNote: "GHL: This task only fires if NPS score is 0–6 (tag LB-NPS-DETRACTOR applied). Assign to account manager. High priority. Due = today.",
      },
      {
        num: 3, channel: "email", delay: "Day 60 — savings recap",
        subject: "Your 60-day savings report — {{contact.companyName}}",
        copy: `Hi {{contact.firstName}},

Two months in. Here's how your savings are stacking up:

• Total savings since switching: \${{custom.cumulativeSavings}}
• Your average effective rate: {{custom.avgRate}}%
• Transactions processed: {{custom.txnCount}}

Annualized, you're on track to save approximately \${{custom.annualProjection}} this year vs. your previous processor.

One thing worth knowing: if your volume grows, your rate doesn't. You're already on our best interchange-plus pricing.

If you know another business owner who's been complaining about their processing fees, we'll handle their statement review and you'll earn a referral bonus when they switch.

[Refer a merchant → earn \${{custom.referralBonus}}]

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Day 60. Requires custom values cumulativeSavings, avgRate, txnCount, annualProjection, referralBonus from platform data feed. If data unavailable, send a simplified 'checking in' version without the numbers.",
      },
      {
        num: 4, channel: "sms", delay: "Day 90 — referral push",
        copy: `Hi {{contact.firstName}} — 3 months in and going strong! Know a business owner who could save on processing? Reply REFER and I'll send you the details on our referral program. Reply STOP to opt out.`,
        ghlNote: "GHL: Day 90 SMS. Short and conversational. If they reply REFER → apply tag LB-REFERRAL-INTERESTED → assign task to rep to send referral program details.",
      },
      {
        num: 5, channel: "email", delay: "Day 180 — 6-month check-in",
        subject: "6 months with Liberty Bancard — a quick check-in",
        copy: `Hi {{contact.firstName}},

Six months in — and your account is in great shape.

Running total saved: \${{custom.cumulativeSavings}}

A few things we're monitoring for you:
• Your card mix is {{custom.cardMix}}% premium cards — we're watching for any interchange creep
• Chargeback rate: {{custom.chargebackRate}}% (industry average: 0.6%)

If your business has grown and you're processing significantly more volume now, it's worth a quick call to review your setup. Volume thresholds can unlock additional rate improvements.

Reply here or call (888) 555-0100.

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Day 180 from LB-MERCHANT-ACTIVE. Continue on 90-day cadence after this: Day 270, Day 360 (annual review). Requires platform data feed for metrics.",
      },
    ],
    exitConditions: [
      "NPS Detractor (0–6) → tag LB-NPS-DETRACTOR → urgent task + stay in sequence",
      "NPS Promoter (9–10) → tag LB-NPS-PROMOTER → referral outreach added",
      "Account cancellation → tag LB-MERCHANT-CHURNED → exit → enroll in Workflow 9 (Win-Back)",
      "STOP reply → tag LB-DNC → stop immediately",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-MERCHANT-ACTIVE",
      "Day 30 NPS email — connect NPS score click to If/Else branches in GHL",
      "NPS Detractor (0–6) branch: apply LB-NPS-DETRACTOR → high-priority task → rep contacts within 24h",
      "NPS Promoter (9–10) branch: apply LB-NPS-PROMOTER → referral email sequence",
      "Day 60/180 emails require platform data feed for savings figures — set up custom values",
      "Day 90 SMS: REFER reply detection → tag LB-REFERRAL-INTERESTED → rep task",
      "Churn detection: cancellation event → tag LB-MERCHANT-CHURNED → exit WF8 → enroll WF9",
      "Continue sequence on 90-day cadence after Day 180 (quarterly touch)",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
  {
    id: "winback",
    name: "Workflow 9 — Win-Back (Churned Merchant)",
    goal: "Re-engage churned merchants within 90 days of cancellation. Target: 15% win-back rate.",
    trigger: "Merchant account cancelled or ported away. Platform applies tag LB-MERCHANT-CHURNED.",
    triggerTag: "LB-MERCHANT-CHURNED",
    color: "border-rose-500",
    steps: [
      {
        num: 1, channel: "email", delay: "Day 3 after churn — cooling-off period",
        subject: "We're sorry to see you go — and we want to make it right",
        copy: `Hi {{contact.firstName}},

We saw that your Liberty Bancard account has been closed. I'm not going to pretend that's not disappointing — but I do want to understand what happened.

If there was something we could have done better — a fee that surprised you, a support issue we didn't resolve, or a competitor offer we should have matched — I'd genuinely like to know.

Reply to this email. I read every response personally.

If it's a rate issue: I'd like 10 minutes to show you what we can do.
If it's a service issue: I want to fix it, even if you don't come back.

No pitch. Just a conversation.

— Scott Allen, Liberty Bancard
(888) 555-0100`,
        ghlNote: "GHL: 3-day delay after LB-MERCHANT-CHURNED. Do NOT send immediately — give the merchant cooling-off time. Tone is empathetic, not sales-focused. Reply detection → tag LB-WINBACK-REPLIED → create priority task for account manager.",
      },
      {
        num: 2, channel: "task", delay: "Day 3 — internal",
        copy: `Churned merchant — review exit reason\n{{contact.firstName}} at {{contact.companyName}} cancelled their account.\nAction: Review contact record for recent support tickets, complaint notes, or fee disputes.\nIdentify exit reason BEFORE any win-back outreach.\nGoal: personalize the re-engagement if we attempt it.`,
        ghlNote: "GHL: Create Task simultaneously with Step 1. Assign to original rep or account manager.",
      },
      {
        num: 3, channel: "email", delay: "Day 14 — competitive offer",
        subject: "One thing before you're fully set up elsewhere, {{contact.firstName}}",
        copy: `Hi {{contact.firstName}},

I know you've moved on, and I respect that. But I'd feel like I wasn't doing my job if I didn't share one thing first.

We've recently renegotiated our interchange-plus pricing floor. The rate we can offer you today is lower than what we had you on when you left.

I'm not asking you to cancel your new setup. But if you haven't fully ported over yet, or if you want to run a quick side-by-side on what your statement would look like with our current pricing, I'm happy to do that — no obligation, takes 20 minutes.

If the answer is still no, I understand. I'll leave you alone after this.

But if there's any chance the numbers work: [Calendar Link]

— Scott Allen, Liberty Bancard`,
        ghlNote: "GHL: Day 14. If LB-WINBACK-REPLIED tag is already present (they responded to Step 1), replace this with a more personalized follow-up from the rep directly — not this automated email. Add If/Else check.",
      },
      {
        num: 4, channel: "sms", delay: "Day 30 — final touch",
        copy: `Hi {{contact.firstName}} — one last message from Liberty Bancard. If you ever want to revisit your processing costs, we're here. Our rates have improved since you left. No pressure — just keeping the door open. www.libertybancard.com. Reply STOP to opt out.`,
        ghlNote: "GHL: Day 30. This is the final automated touchpoint. After this: tag LB-WINBACK-EXHAUSTED. Remove from all active sequences. Note in contact record: win-back attempted, not recovered.",
      },
    ],
    exitConditions: [
      "Reply received → tag LB-WINBACK-REPLIED → rep handles manually → exit sequence",
      "Re-signs / reactivates → tag LB-MERCHANT-APPROVED → enroll in WF7 → exit",
      "STOP reply → tag LB-DNC → stop immediately",
      "No response after Day 30 → tag LB-WINBACK-EXHAUSTED → move to annual nurture",
    ],
    checklist: [
      "Create GHL Workflow — trigger: Contact Tag Added = LB-MERCHANT-CHURNED",
      "Step 1 email has a 3-day delay — do NOT fire immediately on churn tag",
      "Reply detection on Step 1: LB-WINBACK-REPLIED → create urgent rep task → stop automation",
      "Step 3 If/Else: if LB-WINBACK-REPLIED exists → skip automated email (rep handles manually)",
      "After Day 30 SMS: apply LB-WINBACK-EXHAUSTED → log outcome in contact record",
      "Churn reason tracking: ensure reps complete the exit reason field before closing account",
      "Register GHL Workflow ID in platform at /dashboard/ghl-workflows",
    ],
  },
];

// ─── GHL Build Checklist (global) ─────────────────────────────────────────────

const GLOBAL_CHECKLIST = [
  { section: "Voice AI Setup", items: [
    "Go to GHL → Settings → AI Employee → Create new employee",
    "Select Phone channel → paste the Voice AI script for each workflow",
    "Set business hours: Mon–Fri 9 AM–5 PM (use contact's local timezone)",
    "Connect GHL calendar for live appointment booking during calls",
    "Configure human handoff: phrases 'real person', 'manager', 'speak to someone', 'not interested', frustration detected",
    "Set call recording ON for compliance and coaching",
  ]},
  { section: "Voicemail Drops", items: [
    "Record 5 audio files (one per workflow) — keep each under 25 seconds",
    "Upload to GHL → Marketing → Files & Media",
    "In each workflow, add 'Send Voicemail' action and select the correct audio file",
    "Voicemail drop fires ONLY on the voicemail branch (not answered branch)",
  ]},
  { section: "AI SMS Agent (GHL AI Employee)", items: [
    "Go to GHL → Settings → AI Employee → Create new employee",
    "Select Text/SMS channel",
    "Paste the Liberty Bancard AI system prompt (available in platform at /dashboard/ghl-workflows → AI Prompts tab)",
    "Set human handoff: 'real person', 'agent', 'speak to someone', 'human', ready to apply",
    "Connect GHL calendar for live appointment booking via SMS",
    "Activate on Workflow 1 Day 3 AI Conversation step",
  ]},
  { section: "Smart Lists (GHL)", items: [
    "Hot Inbound (Today): Tag = LB-INBOUND-NEW, Tag added last 24h",
    "Replied — Needs Response: Tag = LB-SDR-REPLY-ENGAGED, last 48h",
    "Statement Pending: Tag = LB-SDR-STATEMENT-CHASE",
    "Proposal Out: Pipeline Stage = Proposal Sent",
    "Cold Active: Tag = LB-COLD-OUTBOUND, does NOT have LB-COLD-EXIT",
    "DNC: Tag = LB-DNC (remove from all active sequences)",
  ]},
  { section: "Platform Integration", items: [
    "Go to /dashboard/ghl-workflows in this platform",
    "Paste each GHL Workflow ID next to the matching sequence name",
    "This enables auto-enrollment: platform detects qualifying events → calls GHL API → GHL executes",
    "Test each workflow: add a test contact → manually apply trigger tag → verify steps fire in GHL",
  ]},
  { section: "Compliance", items: [
    "Confirm SMS opt-in language on all web forms before launching cold outbound",
    "Verify STOP/UNSUBSCRIBE handling is active in GHL (automatic in GHL SMS)",
    "Add compliance footer to all emails: 'Eligibility, underwriting, and card brand rules apply.'",
    "AI Voice calls must identify as AI if asked directly — verify this is in all voice scripts",
    "Respect quiet hours: no calls before 9 AM or after 5 PM in prospect's local timezone",
    "Do not call contacts tagged LB-DNC under any circumstance",
  ]},
];

// ─── Tag reference ─────────────────────────────────────────────────────────────

const TAG_TABLE = [
  { tag: "LB-INBOUND-NEW",           trigger: "Any form submission / chat inbound",              workflow: "Workflow 1 — Speed-to-Lead" },
  { tag: "LB-COLD-OUTBOUND",         trigger: "SDR enrichment / manual upload / bulk import",    workflow: "Workflow 2 — Cold Outbound" },
  { tag: "LB-SDR-REPLY-ENGAGED",     trigger: "Any inbound email or SMS reply",                  workflow: "Workflow 3 — Reply Engaged" },
  { tag: "LB-SDR-STATEMENT-CHASE",   trigger: "Prospect agreed to send statement",               workflow: "Workflow 4 — Statement Chase" },
  { tag: "LB-SDR-PROPOSAL",          trigger: "Analysis/proposal sent to prospect",              workflow: "Workflow 5 — Proposal Follow-Up" },
  { tag: "LB-BOOKING-READY",         trigger: "Appointment booked (any channel)",                workflow: "EXIT — stop all active sequences" },
  { tag: "LB-STATEMENT-RECEIVED",    trigger: "Statement uploaded to platform",                  workflow: "EXIT — trigger review workflow" },
  { tag: "LB-VERBAL-COMMIT",         trigger: "Prospect verbally agreed to proceed",             workflow: "EXIT — move to closing" },
  { tag: "LB-CLOSED-WON",            trigger: "Deal closed / approved",                         workflow: "Workflow 6 — Merchant Welcome" },
  { tag: "LB-CLOSED-LOST",           trigger: "Deal lost / not interested",                     workflow: "EXIT — long-term nurture" },
  { tag: "LB-APP-SUBMITTED",         trigger: "Merchant completes application form",             workflow: "EXIT WF6 → Workflow 7 — Go-Live" },
  { tag: "LB-ONBOARDING-STALLED",    trigger: "No app submitted after 7 days",                  workflow: "Alert — rep follow-up required" },
  { tag: "LB-MERCHANT-APPROVED",     trigger: "Underwriting approves merchant account",          workflow: "Workflow 7 — Approval & Go-Live" },
  { tag: "LB-FIRST-TXN",             trigger: "First live transaction processed",                workflow: "Onboarding milestone — log only" },
  { tag: "LB-GOLIVE-STALLED",        trigger: "No terminal activity 7 days post-approval",      workflow: "Alert — escalate to manager" },
  { tag: "LB-MERCHANT-ACTIVE",       trigger: "Day 32 post-go-live — first statement delivered", workflow: "Workflow 8 — Retention & NPS" },
  { tag: "LB-NPS-PROMOTER",          trigger: "NPS score 9–10",                                 workflow: "Referral outreach sequence" },
  { tag: "LB-NPS-PASSIVE",           trigger: "NPS score 7–8",                                  workflow: "Passive — continue nurture" },
  { tag: "LB-NPS-DETRACTOR",         trigger: "NPS score 0–6",                                  workflow: "URGENT — rep contacts within 24h" },
  { tag: "LB-REFERRAL-INTERESTED",   trigger: "Merchant replies REFER to SMS",                  workflow: "Rep sends referral program details" },
  { tag: "LB-MERCHANT-CHURNED",      trigger: "Account cancelled / ported away",                workflow: "Workflow 9 — Win-Back" },
  { tag: "LB-WINBACK-REPLIED",       trigger: "Churned merchant replies to win-back outreach",   workflow: "EXIT automation — rep handles" },
  { tag: "LB-WINBACK-EXHAUSTED",     trigger: "No response after Day 30 win-back",              workflow: "Annual nurture — no further outreach" },
  { tag: "LB-DNC",                   trigger: "STOP reply / manual DNC flag",                   workflow: "GLOBAL STOP — all sequences forever" },
];

// ─── CopyBlock ────────────────────────────────────────────────────────────────

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="relative group">
      {label && <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">{label}</p>}
      <pre className="bg-muted/60 border rounded-md p-3 text-xs whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-64 overflow-y-auto">
        {text}
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
        onClick={handleCopy}
        data-testid="btn-copy-block"
        aria-label="Copy to clipboard"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

// ─── Step Card ────────────────────────────────────────────────────────────────

function StepCard({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const meta = CHANNEL_META[step.channel];
  const Icon = meta.icon;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-start gap-3 p-4 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(!open)}
        data-testid={`btn-step-${step.num}`}
      >
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-muted border text-xs font-bold shrink-0 mt-0.5">
          {step.num}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${meta.color} gap-1 text-xs`}>
              <Icon className="h-3 w-3" /> {meta.label}
            </Badge>
            <span className="text-xs text-muted-foreground">{step.delay}</span>
          </div>
          {step.subject && (
            <p className="text-sm font-medium mt-1 truncate">Subject: {step.subject}</p>
          )}
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-1" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t bg-muted/20">
          <div className="pt-3">
            {step.subject && (
              <div className="mb-3">
                <CopyBlock text={step.subject} label="Subject Line" />
              </div>
            )}
            <CopyBlock text={step.copy} label={step.channel === "call" || step.channel === "voicemail" ? "Script" : "Message Copy"} />
          </div>

          {step.branch && (
            <div className="flex gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-0.5">Branch Logic</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">{step.branch}</p>
              </div>
            </div>
          )}

          {step.ghlNote && (
            <div className="flex gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-0.5">GHL Configuration</p>
                <p className="text-xs text-blue-700 dark:text-blue-400">{step.ghlNote}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Workflow Panel ────────────────────────────────────────────────────────────

function WorkflowPanel({ wf }: { wf: Workflow }) {
  const [checkState, setCheckState] = useState<Record<number, boolean>>({});

  function toggle(i: number) {
    setCheckState(prev => ({ ...prev, [i]: !prev[i] }));
  }

  const done = Object.values(checkState).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`border-l-4 ${wf.color} pl-4`}>
        <p className="text-sm text-muted-foreground font-medium">{wf.goal}</p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Badge variant="outline" className="gap-1 font-mono text-xs">
            <Tag className="h-3 w-3" /> Trigger Tag: {wf.triggerTag}
          </Badge>
          <span className="text-xs text-muted-foreground">{wf.trigger}</span>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4 text-yellow-500" /> Workflow Steps
          <span className="text-xs text-muted-foreground font-normal">(click any step to expand copy &amp; config)</span>
        </h3>
        <div className="space-y-2">
          {wf.steps.map(step => <StepCard key={step.num} step={step} />)}
        </div>
      </div>

      {/* Exit conditions */}
      <div className="border rounded-lg p-4 bg-muted/30">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500" /> Exit Conditions
        </h3>
        <ul className="space-y-1.5">
          {wf.exitConditions.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/60" />
              {c}
            </li>
          ))}
        </ul>
      </div>

      {/* Checklist */}
      <div className="border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-green-500" /> Build Checklist
          <Badge variant="secondary" className="ml-auto">{done}/{wf.checklist.length} done</Badge>
        </h3>
        <p className="text-xs text-muted-foreground mb-3">Check off each item as you configure it in GHL.</p>
        <ul className="space-y-2">
          {wf.checklist.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 cursor-pointer" onClick={() => toggle(i)} data-testid={`check-${wf.id}-${i}`}>
              <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${checkState[i] ? "bg-green-500 border-green-500" : "border-muted-foreground/40"}`}>
                {checkState[i] && <CheckCircle2 className="h-3 w-3 text-white" />}
              </div>
              <span className={`text-xs ${checkState[i] ? "line-through text-muted-foreground" : ""}`}>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Admin Setup checklist section ─────────────────────────────────────────────

function AdminCheckSection({ sectionIndex, title, color, items }: {
  sectionIndex: number;
  title: string;
  color: string;
  items: string[];
}) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const done = Object.values(checked).filter(Boolean).length;
  return (
    <Card className={`border-l-4 ${color}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span>{title}</span>
          <Badge variant="secondary">{done}/{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item, ii) => (
            <li
              key={ii}
              className="flex items-start gap-2.5 cursor-pointer"
              onClick={() => setChecked(prev => ({ ...prev, [ii]: !prev[ii] }))}
              data-testid={`admin-check-${sectionIndex}-${ii}`}
            >
              <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${checked[ii] ? "bg-green-500 border-green-500" : "border-muted-foreground/40"}`}>
                {checked[ii] && <CheckCircle2 className="h-3 w-3 text-white" />}
              </div>
              <span className={`text-xs leading-relaxed ${checked[ii] ? "line-through text-muted-foreground" : ""}`}>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function GhlSequenceGuide() {
  const [globalCheck, setGlobalCheck] = useState<Record<string, boolean>>({});

  function toggleGlobal(key: string) {
    setGlobalCheck(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">GHL Workflow Build Guide</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The complete customer journey — 9 workflows covering prospecting, qualifying, closing, onboarding, go-live, retention, and win-back.
            All execution happens natively in GHL — this platform handles enrollment triggers only.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild variant="outline" size="sm" data-testid="btn-ghl-manager-link">
            <Link href="/dashboard/ghl-workflows">
              <Settings className="h-4 w-4 mr-1.5" /> GHL Workflow IDs
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" data-testid="btn-ghl-external">
            <a href="https://app.gohighlevel.com" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" /> Open GHL
            </a>
          </Button>
        </div>
      </div>

      {/* Architecture callout */}
      <div className="flex gap-3 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
        <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm">
          <span className="font-semibold text-blue-700 dark:text-blue-300">How it works: </span>
          <span className="text-blue-700 dark:text-blue-400">
            This platform detects qualifying events (form submission, stage change, tag added), upserts the contact to GHL, and calls the GHL API to enroll the contact in the correct workflow. After enrollment, GHL owns 100% of execution — emails, SMS, AI voice calls, voicemail drops, timing, branching, and appointment booking.
          </span>
        </div>
      </div>

      {/* Flow diagram */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" /> How Leads Move Through the System
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Acquisition → Closing</p>
            <div className="flex items-center gap-1 flex-wrap text-xs">
              {[
                { label: "New Lead", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
                { label: "→ WF1 Inbound / WF2 Cold Outbound", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
                { label: "→ Reply → WF3", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
                { label: "→ Statement → WF4", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
                { label: "→ Proposal → WF5", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
                { label: "→ Closed Won", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
              ].map((node, i) => (
                <span key={i} className={`px-2 py-1 rounded-md font-medium ${node.color}`}>{node.label}</span>
              ))}
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-3">Onboarding → Retention → Win-Back</p>
            <div className="flex items-center gap-1 flex-wrap text-xs">
              {[
                { label: "Closed Won", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
                { label: "→ WF6 Welcome & App", color: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
                { label: "→ WF7 Approval & Go-Live", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
                { label: "→ WF8 Retention & NPS", color: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
                { label: "Churned? → WF9 Win-Back", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
                { label: "Re-engagement at 60/90/120 days", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
              ].map((node, i) => (
                <span key={i} className={`px-2 py-1 rounded-md font-medium ${node.color}`}>{node.label}</span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main tabs */}
      <Tabs defaultValue="wf1">
        <TabsList className="flex flex-wrap h-auto gap-1 mb-2">
          <TabsTrigger value="wf1" data-testid="tab-wf1">WF1 — Inbound</TabsTrigger>
          <TabsTrigger value="wf2" data-testid="tab-wf2">WF2 — Cold Outbound</TabsTrigger>
          <TabsTrigger value="wf3" data-testid="tab-wf3">WF3 — Reply Engaged</TabsTrigger>
          <TabsTrigger value="wf4" data-testid="tab-wf4">WF4 — Statement Chase</TabsTrigger>
          <TabsTrigger value="wf5" data-testid="tab-wf5">WF5 — Proposal</TabsTrigger>
          <TabsTrigger value="wf6" data-testid="tab-wf6">WF6 — Onboarding</TabsTrigger>
          <TabsTrigger value="wf7" data-testid="tab-wf7">WF7 — Go-Live</TabsTrigger>
          <TabsTrigger value="wf8" data-testid="tab-wf8">WF8 — Retention</TabsTrigger>
          <TabsTrigger value="wf9" data-testid="tab-wf9">WF9 — Win-Back</TabsTrigger>
          <TabsTrigger value="reengage" data-testid="tab-reengage">Re-engagement</TabsTrigger>
          <TabsTrigger value="tags" data-testid="tab-tags">Tag Reference</TabsTrigger>
          <TabsTrigger value="global" data-testid="tab-global">Global Setup</TabsTrigger>
          <TabsTrigger value="admin-setup" data-testid="tab-admin-setup">GHL Admin Setup</TabsTrigger>
        </TabsList>

        {WORKFLOWS.map(wf => (
          <TabsContent key={wf.id} value={`wf${WORKFLOWS.indexOf(wf) + 1}`} className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{wf.name}</CardTitle>
                <CardDescription className="font-mono text-xs">Trigger: Contact Tag Added = {wf.triggerTag}</CardDescription>
              </CardHeader>
              <CardContent>
                <WorkflowPanel wf={wf} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        {/* Re-engagement Sequences */}
        <TabsContent value="reengage" className="mt-4">
          <div className="space-y-4">
            {/* Overview callout */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-orange-500" />
                  Re-engagement Sequence — Cold Lead Revival
                </CardTitle>
                <CardDescription>
                  For contacts who submitted a form but never converted. Triggers at 60, 90, and 120 days of dormancy.
                  Run from the <strong>Cold Lead Re-engagement</strong> dashboard at{" "}
                  <Link href="/dashboard/cold-leads" className="underline text-primary">
                    /dashboard/cold-leads
                  </Link>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20">
                  <Info className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                  <div className="text-sm text-orange-700 dark:text-orange-300">
                    <strong>How it works:</strong> An admin reviews the Cold Lead Re-engagement dashboard, selects dormant contacts,
                    and clicks "Re-engage." The platform applies the tag{" "}
                    <code className="text-xs bg-orange-100 dark:bg-orange-900/40 px-1 rounded">COLD-NO-DEAL</code> and enrolls the
                    contact in GHL sequence <em>"19. Reactivation — Cold Lead Revival"</em>. No automatic enrollment — v1 is manual-trigger only.
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Touchpoint 1 — Day 60 */}
            <Card className="border-l-4 border-blue-500">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-sm">Day 60 Touchpoint</CardTitle>
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 gap-1 text-xs">
                    <Mail className="h-3 w-3" /> Email
                  </Badge>
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 gap-1 text-xs">
                    <MessageSquare className="h-3 w-3" /> SMS
                  </Badge>
                </div>
                <CardDescription>
                  Trigger tag: <code className="text-xs bg-muted px-1 rounded">RE-ENGAGE-60</code> — fires 60 days after
                  the original form submission date. "We updated our analysis" hook — low friction, high relevance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <CopyBlock
                  label="Email Subject"
                  text="Still thinking about it? We updated our analysis for {{contact.companyName}}."
                />
                <CopyBlock
                  label="Email Body"
                  text={`Hi {{contact.firstName}},

A few months ago you reached out about your merchant processing. We don't know if the timing was off, or if you found another solution — but we've been running more analyses lately and wanted to share what we're seeing.

The average merchant on legacy pricing is now paying 0.45–0.90% more than the current floor. On $80,000/month, that's $360–$720 going to your processor that should stay in your pocket.

If you're still open to a quick look, all we need is one statement. Takes us 24 hours to run it.

[Statement Upload Link]

No pressure — just didn't want you to miss the window.

— Scott Allen, Liberty Bancard
📞 (888) 555-0100 | www.libertybancard.com

Eligibility, underwriting, and card brand rules apply.`}
                />
                <CopyBlock
                  label="SMS (send same day as email, 2 hrs after)"
                  text={`Hi {{contact.firstName}} — Liberty Bancard checking in. We updated our statement analysis for merchants in your area. If you want a free look at your processing costs, reply YES and I'll send the link. Reply STOP to opt out.`}
                />
                <div className="flex gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-0.5">GHL Configuration — Day 60</p>
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      Trigger: Contact Tag Added = COLD-NO-DEAL. Wait 0 days (fire immediately on enrollment — the enrollment itself happens at the 60-day mark).
                      Send Email → use branded template. Then wait 2 hours → Send SMS. Enable reply detection on both → if reply received, stop sequence and tag RE-ENGAGE-REPLIED → enroll in Workflow 3 (Reply Engaged).
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Touchpoint 2 — Day 90 */}
            <Card className="border-l-4 border-purple-500">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-sm">Day 90 Touchpoint</CardTitle>
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 gap-1 text-xs">
                    <Mail className="h-3 w-3" /> Email
                  </Badge>
                </div>
                <CardDescription>
                  Trigger tag: <code className="text-xs bg-muted px-1 rounded">RE-ENGAGE-90</code> — fires 30 days after
                  Day 60. Industry-specific case study with personalization tokens. Demonstrate social proof relevant to their vertical.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <CopyBlock
                  label="Email Subject"
                  text="How a {{contact.vertical}} business saved ${{savings}}/month on processing (case study)"
                />
                <CopyBlock
                  label="Email Body (personalize with vertical before sending)"
                  text={`Hi {{contact.firstName}},

I wanted to share a quick story from one of our recent clients — I think it applies to what you're dealing with too.

They run a {{contact.vertical}} business similar to {{contact.companyName}}. Their monthly volume was around $120,000. Their processor had them on a tiered pricing plan with a 2.9% + $0.30 flat rate. Sounds fine — until we ran the statement.

What we found: the actual cost for most of their card types was 1.65% interchange + 0.40% markup. They were paying 0.85% extra on every dollar — about $1,020/month in excess fees.

We switched them to interchange-plus. First full month: $840 back in their pocket.

If you process credit cards, there's a good chance something similar is hiding in your statement. The only way to know is to look.

[Statement Upload Link] — 2 minutes to upload, 24 hours for your full breakdown.

— Scott Allen, Liberty Bancard

Eligibility, underwriting, and card brand rules apply. Individual results vary.`}
                />
                <div className="flex gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-0.5">GHL Configuration — Day 90</p>
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      In GHL workflow: after Day 60 step completes with no reply, wait 30 days → apply tag RE-ENGAGE-90 → Send Email.
                      Personalization: use the contact's vertical field for the industry reference. If vertical is blank, use "retail" as the default.
                      Add reply detection → stop sequence → tag RE-ENGAGE-REPLIED → enroll in Workflow 3.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Touchpoint 3 — Day 120 */}
            <Card className="border-l-4 border-orange-500">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-sm">Day 120 Touchpoint</CardTitle>
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 gap-1 text-xs">
                    <MessageSquare className="h-3 w-3" /> SMS
                  </Badge>
                </div>
                <CardDescription>
                  Final touchpoint — 30 days after Day 90. New offer or seasonal hook via SMS. Short, punchy, low pressure.
                  After this, tag <code className="text-xs bg-muted px-1 rounded">RE-ENGAGE-EXHAUSTED</code> and move to long-term nurture.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <CopyBlock
                  label="SMS (seasonal variant — swap hook as needed)"
                  text={`{{contact.firstName}} — one last check-in from Liberty Bancard. End-of-year is a great time to review processing costs before the busy season hits. Free analysis, no commitment: www.libertybancard.com/upload-statement — Takes 2 min. Reply STOP to opt out.`}
                />
                <CopyBlock
                  label="Alternative SMS (non-seasonal)"
                  text={`Hi {{contact.firstName}}, Scott at Liberty Bancard. We haven't connected yet — if you ever want a free look at your processing rates, just reply YES or visit www.libertybancard.com/upload-statement. No pressure, no spam after this. Reply STOP to opt out.`}
                />
                <div className="flex gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-0.5">After Day 120 — Exit Logic</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      If no reply after Day 120 SMS: apply tag RE-ENGAGE-EXHAUSTED. Remove RE-ENGAGE-60 / RE-ENGAGE-90 tags.
                      Enroll in Long-Term Nurture (quarterly educational content — no hard sales pitch). Do not re-run the re-engagement sequence for at least 180 days.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-0.5">GHL Configuration — Day 120</p>
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      After Day 90 step with no reply, wait 30 days → Send SMS (use seasonal variant if Q4, otherwise non-seasonal).
                      After SMS: wait 7 days → If/Else: reply received? Yes → stop + tag RE-ENGAGE-REPLIED. No → apply RE-ENGAGE-EXHAUSTED → Remove Trigger Tag → Enroll in Long-Term Nurture workflow.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* GHL Build Instructions */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-green-500" /> GHL Automation Setup — Re-engagement Workflow
                </CardTitle>
                <CardDescription>How to configure this sequence in GoHighLevel from scratch.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3 text-xs text-muted-foreground list-none">
                  {[
                    "Go to GHL → Automations → Create New Workflow → Name it: \"Liberty Bancard — Cold Lead Re-engagement\"",
                    "Trigger: Contact Tag Added → Tag = COLD-NO-DEAL. This fires when the platform applies the tag via the Re-engagement dashboard.",
                    "Step 1 (immediate): Send Email → Day 60 template (subject + body from above). Use branded Liberty Bancard email template.",
                    "Step 2 (2 hours later): Send SMS → Day 60 SMS copy from above. Ensure SMS opt-in compliance.",
                    "Add Reply Detection on both email and SMS steps: If reply received → Remove from workflow → Apply tag RE-ENGAGE-REPLIED → Enroll in Workflow 3 (Reply Engaged).",
                    "Wait 30 days → Apply tag RE-ENGAGE-90 → Step 3: Send Email → Day 90 case study email. Personalize {{contact.vertical}} before activating.",
                    "Add Reply Detection on Day 90 email → If reply → stop + RE-ENGAGE-REPLIED → Workflow 3.",
                    "Wait 30 days → Step 4: Send SMS → Day 120 SMS copy. Use seasonal variant if month is Oct/Nov/Dec, otherwise non-seasonal.",
                    "Wait 7 days → If/Else: Tag = RE-ENGAGE-REPLIED? No → Apply RE-ENGAGE-EXHAUSTED → Remove COLD-NO-DEAL tag → Enroll in Long-Term Nurture workflow.",
                    "Register the GHL Workflow ID in the platform at /dashboard/ghl-workflows under the sequence name \"19. Reactivation — Cold Lead Revival\".",
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/30 text-[10px] font-bold mt-0.5">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {/* Tag Reference for Re-engagement */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="h-4 w-4" /> Re-engagement Tag Reference
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Tag</th>
                        <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">When Applied</th>
                        <th className="text-left py-2 font-semibold text-muted-foreground">Effect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { tag: "COLD-NO-DEAL", when: "Admin clicks Re-engage on Cold Lead dashboard", effect: "Triggers the re-engagement GHL workflow immediately" },
                        { tag: "RE-ENGAGE-60", when: "Applied at enrollment (Day 60 touchpoint fires)", effect: "Marks contact as in active re-engagement" },
                        { tag: "RE-ENGAGE-90", when: "Applied 30 days after Day 60 step", effect: "Day 90 case study email fires" },
                        { tag: "RE-ENGAGE-REPLIED", when: "Any reply received on any touchpoint", effect: "Stop re-engagement sequence → enroll in Workflow 3 (Reply Engaged)" },
                        { tag: "RE-ENGAGE-EXHAUSTED", when: "No response after Day 120 + 7-day wait", effect: "Remove from sequence → enroll in Long-Term Nurture" },
                      ].map((row, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2.5 pr-4 font-mono font-medium">{row.tag}</td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{row.when}</td>
                          <td className="py-2.5 text-muted-foreground">{row.effect}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex items-start gap-2 p-3 rounded-md bg-muted/40 border text-xs text-muted-foreground">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>COLD-NO-DEAL tag automation (optional):</strong> To auto-tag contacts without manual review,
                    create a GHL Smart List filter: Contact has form submission tag (LB-INBOUND-NEW or LB-COLD-OUTBOUND) AND
                    does NOT have tag LB-ACTIVE-PIPELINE AND contact created date is older than 60 days.
                    Then create a workflow that fires on Smart List entry → applies COLD-NO-DEAL. This enables hands-off detection,
                    while the Re-engagement dashboard remains the human review layer before outreach begins.
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Platform link */}
            <Card className="border-dashed">
              <CardContent className="pt-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Cold Lead Re-engagement Dashboard</p>
                    <p className="text-xs text-muted-foreground">Review and manually trigger re-engagement for dormant leads.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm" data-testid="btn-cold-leads-link">
                    <Link href="/dashboard/cold-leads">
                      <ArrowRight className="h-4 w-4 mr-1.5" /> Open Cold Leads
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" data-testid="btn-ghl-external-reengage">
                    <a href="https://app.gohighlevel.com" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" /> Open GHL
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tag Reference */}
        <TabsContent value="tags" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="h-4 w-4" /> Tag Reference Table
              </CardTitle>
              <CardDescription>Every GHL tag used across the 5 workflows — what triggers it and what it does.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Tag</th>
                      <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">What Triggers It</th>
                      <th className="text-left py-2 font-semibold text-muted-foreground">Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TAG_TABLE.map((row, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2.5 pr-4 font-mono font-medium">{row.tag}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{row.trigger}</td>
                        <td className="py-2.5 text-muted-foreground">{row.workflow}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 p-3 rounded-md bg-muted/40 border text-xs text-muted-foreground">
                <strong>How tags work in GHL:</strong> Go to Workflows → Edit → Trigger → "Contact Tag Added" → select the tag. GHL watches for tag changes in real time. When the platform applies a tag via API, the matching workflow fires within seconds.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Global Setup */}
        <TabsContent value="global" className="mt-4">
          <div className="space-y-4">
            {GLOBAL_CHECKLIST.map((section, si) => {
              const sectionDone = section.items.filter((_, ii) => globalCheck[`${si}-${ii}`]).length;
              return (
                <Card key={si}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        {section.section}
                      </span>
                      <Badge variant="secondary">{sectionDone}/{section.items.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {section.items.map((item, ii) => {
                        const key = `${si}-${ii}`;
                        return (
                          <li
                            key={ii}
                            className="flex items-start gap-2.5 cursor-pointer"
                            onClick={() => toggleGlobal(key)}
                            data-testid={`global-check-${si}-${ii}`}
                          >
                            <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${globalCheck[key] ? "bg-green-500 border-green-500" : "border-muted-foreground/40"}`}>
                              {globalCheck[key] && <CheckCircle2 className="h-3 w-3 text-white" />}
                            </div>
                            <span className={`text-xs ${globalCheck[key] ? "line-through text-muted-foreground" : ""}`}>{item}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}

            {/* Platform link card */}
            <Card className="border-dashed">
              <CardContent className="pt-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <Calendar className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Register GHL Workflow IDs</p>
                    <p className="text-xs text-muted-foreground">After building each workflow in GHL, copy its ID and paste it into the platform.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm" data-testid="btn-workflow-manager">
                    <Link href="/dashboard/ghl-workflows">
                      <Settings className="h-4 w-4 mr-1.5" /> Open Workflow Manager
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" data-testid="btn-open-ghl-global">
                    <a href="https://app.gohighlevel.com" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" /> Open GHL
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* GHL Admin Setup */}
        <TabsContent value="admin-setup" className="mt-4">
          <div className="space-y-4">
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
              <CardContent className="pt-4 flex gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-700 dark:text-amber-300">
                  <strong>Do this first — before building any workflow.</strong> The steps below configure the GHL account foundation that all 9 workflows depend on. Complete them in order. Each section has a progress tracker — check items off as you go.
                </div>
              </CardContent>
            </Card>

            {[
              {
                title: "1. Account & Sub-Account Setup",
                color: "border-l-blue-500",
                items: [
                  "Log in to GHL Agency Dashboard → Sub-Accounts → Create or select the Liberty Bancard sub-account",
                  "Set sub-account name: 'Liberty Bancard' | Timezone: Eastern | Business hours: Mon–Fri 9 AM–5 PM",
                  "Upload Liberty Bancard logo (Settings → Business Profile)",
                  "Set company email: the from-address for all GHL emails (e.g. scott@libertybancard.com)",
                  "Configure company phone number (Twilio) — this is the SMS from-number for all outbound texts",
                  "Verify the from-domain is authenticated in Settings → Email Services → SMTP/Mailgun",
                ],
              },
              {
                title: "2. Pipeline Setup — Match Platform Stage Names",
                color: "border-l-green-500",
                items: [
                  "Go to GHL → Pipelines → Create New Pipeline: 'Liberty Bancard Sales'",
                  "Create stages IN ORDER: New Lead → Statement Received → Review In Progress → Call Booked → Proposal Sent → Negotiation / Follow-Up → Verbal Commit → Closed Won → Closed Lost",
                  "These stage names must match the platform exactly — the platform syncs deal stage changes to GHL by name",
                  "Create a second pipeline: 'Merchant Onboarding' with stages: App Sent → App Submitted → Under Review → Approved → Terminal Shipped → Live → Churned",
                  "Set pipeline currency to USD",
                ],
              },
              {
                title: "3. Custom Fields — Contact Record",
                color: "border-l-purple-500",
                items: [
                  "Go to Settings → Custom Fields → Contacts → Create the following fields:",
                  "Text field: 'Merchant ID' (key: merchantId) — populated on approval",
                  "Text field: 'Processing Volume' (key: processingVolume) — monthly card volume",
                  "Text field: 'Current Processor' (key: currentProcessor) — incumbent name",
                  "Number field: 'Current Effective Rate' (key: currentRate) — as decimal, e.g. 0.0285",
                  "Number field: 'LB Quoted Rate' (key: lbRate) — Liberty Bancard rate",
                  "Number field: 'Monthly Savings' (key: monthlySavings) — dollar amount",
                  "Number field: 'Annual Savings' (key: annualSavings) — dollar amount",
                  "Text field: 'Vertical' (key: vertical) — business type, e.g. Restaurant",
                  "Text field: 'Terminal Type' (key: terminalType) — physical or gateway",
                  "Text field: 'Lead Source' (key: leadSource) — inbound/cold/referral/partner",
                  "Text field: 'Referral Code' (key: referralCode) — affiliate/partner referral",
                  "Number field: 'Month 1 Volume' (key: month1Volume) — first statement volume",
                  "Number field: 'Month 1 Rate' (key: month1Rate) — first statement rate",
                  "Number field: 'Cumulative Savings' (key: cumulativeSavings) — running total",
                  "Number field: 'Referral Bonus' (key: referralBonus) — $ amount earned per referral",
                ],
              },
              {
                title: "4. Custom Values (Global Tokens for Emails/SMS)",
                color: "border-l-yellow-500",
                items: [
                  "Go to Settings → Custom Values → Create the following global values:",
                  "Application Link: [paste your merchant application URL]",
                  "Statement Upload Link: [paste your upload page URL, e.g. libertybancard.com/upload-statement]",
                  "Calendar Link: [paste your GHL calendar booking link]",
                  "Merchant Portal Link: [paste your merchant portal URL]",
                  "Support Phone: (888) 555-0100",
                  "Support Email: support@libertybancard.com",
                  "These appear as {{custom.applicationLink}}, etc. in all workflow templates",
                  "Test each custom value by previewing an email template before going live",
                ],
              },
              {
                title: "5. SMS / A2P 10DLC Registration",
                color: "border-l-red-500",
                items: [
                  "Go to Settings → Phone Numbers → A2P Registration — this is REQUIRED before sending any bulk SMS",
                  "Register Brand: Legal Business Name = Liberty Bancard LLC | EIN = [your EIN] | Type = LLC",
                  "Register Campaign: Use Case = Mixed | Description = 'Merchant services outreach, rate analysis follow-ups, and customer onboarding for payment processing business'",
                  "Sample Message 1: 'Hi [name], Scott with Liberty Bancard. Want a free review of your processing costs? Reply YES. Reply STOP to opt out.'",
                  "Sample Message 2: 'Your Liberty Bancard merchant account is approved. MID: [id]. Portal: [link]. Reply STOP to opt out.'",
                  "Add opt-in language to ALL web forms: 'By submitting, you consent to receive SMS messages from Liberty Bancard. Reply STOP to unsubscribe.'",
                  "A2P approval takes 2–5 business days — do not send bulk SMS before approval",
                  "After approval: verify in GHL → Phone Numbers → your number shows 'A2P Registered'",
                ],
              },
              {
                title: "6. Voice AI Employee Setup (Phone Channel)",
                color: "border-l-violet-500",
                items: [
                  "Go to Settings → AI Employee → Create New → Select 'Phone' channel",
                  "Name: 'Liberty Bancard AI — Voice'",
                  "Paste the Voice AI system prompt from /dashboard/ghl-workflows → AI Prompts tab",
                  "Set business hours: Mon–Fri 9 AM–5 PM (contact local timezone)",
                  "Connect GHL Calendar for live appointment booking during calls",
                  "Human handoff triggers: 'real person', 'speak to someone', 'manager', 'not interested', frustration detected",
                  "Create 4 call modes (GHL calls these 'Personas' or use If/Else routing): intro_qualification | cold_outbound | follow_up_callback | proposal_reminder | onboarding_assist | statement_chase",
                  "Enable call recording for all AI voice calls (compliance + coaching)",
                  "Test: call the GHL number and verify the AI introduces itself as Liberty Bancard — NOT as ChatGPT or 'an AI'",
                ],
              },
              {
                title: "7. AI SMS Employee Setup (Text Channel)",
                color: "border-l-fuchsia-500",
                items: [
                  "Go to Settings → AI Employee → Create New → Select 'SMS/Text' channel",
                  "Name: 'Liberty Bancard AI — SMS'",
                  "Paste the SMS AI system prompt from /dashboard/ghl-workflows → AI Prompts tab (Conversation AI System Prompt section)",
                  "Human handoff triggers: 'real person', 'agent', 'speak to someone', 'human', 'ready to apply'",
                  "Connect GHL Calendar for appointment booking via SMS",
                  "Set knowledge base: attach Liberty Bancard FAQ document (create in GHL → Documents)",
                  "Enable on Workflow 1 Step 9 (Day 3 AI Conversation) — not earlier",
                  "Test: send a test SMS with 'I want to lower my processing fees' — verify AI responds correctly",
                ],
              },
              {
                title: "8. Voicemail Drop Recording & Upload",
                color: "border-l-orange-500",
                items: [
                  "Record 6 short audio files (under 25 seconds each) — use a phone recording app or a studio mic:",
                  "VM-1 (Inbound): 'Hi [name], this is Scott with Liberty Bancard calling about the request you just submitted. Give me a call back at 888-555-0100 or reply to the text we just sent. Talk soon.'",
                  "VM-2 (Cold Outbound): 'Hi [name], Scott with Liberty Bancard. Sent you a couple emails about your merchant processing — just wanted to put a voice to the name. Call me at 888-555-0100 or reply to my email.'",
                  "VM-3 (Reply Engaged): 'Hi [name], Scott from Liberty Bancard. Just making sure you didn't fall through the cracks — you reached out and I want to take care of you. 888-555-0100 or grab a time on my calendar. Sending the link now.'",
                  "VM-4 (Statement Chase): 'Hi [name], Scott from Liberty Bancard. Following up on the statement review — if you want to send it, just reply to one of my texts with a photo or PDF. Hope to hear from you soon.'",
                  "VM-5 (Proposal): 'Hi [name], Scott from Liberty Bancard. Wanted to touch base on the analysis I sent — there's a real opportunity here and I don't want you to miss it. Call me at 888-555-0100 or grab a time on my calendar.'",
                  "VM-6 (Onboarding): 'Hi [name], Scott from Liberty Bancard checking in on your application — just want to make sure you don't hit any snags. Call me at 888-555-0100 or reply to any of my messages.'",
                  "Upload all files: GHL → Marketing → Files & Media → Upload Audio",
                  "In each workflow's voicemail step: Actions → Voicemail Drop → select the matching audio file",
                ],
              },
              {
                title: "9. GHL Calendar Configuration",
                color: "border-l-teal-500",
                items: [
                  "Go to Calendars → Create Calendar → 'Liberty Bancard — Statement Review Call'",
                  "Duration: 15 minutes | Buffer after: 5 minutes",
                  "Availability: Mon–Fri 9 AM–5 PM Eastern (or rep's local timezone)",
                  "Confirmation email: auto-send with GHL template; include statement upload link in confirmation",
                  "Reminder: SMS 1 hour before + email 24 hours before",
                  "No-show automation: if appointment no-show → apply tag LB-NO-SHOW → enroll in No-Show Recovery workflow",
                  "Connect to Voice AI Employee so AI can book appointments during calls",
                  "Paste calendar booking URL into the 'Calendar Link' custom value (Step 4 above)",
                  "Test: book a test appointment and verify all confirmation/reminder messages fire",
                ],
              },
              {
                title: "10. Smart Lists — Lead Prioritization Views",
                color: "border-l-sky-500",
                items: [
                  "Go to Contacts → Smart Lists → Create the following views:",
                  "🔥 Hot Inbound (Today): Tag = LB-INBOUND-NEW AND Tag added date = today",
                  "💬 Replied — Needs Response: Tag = LB-SDR-REPLY-ENGAGED AND Tag added = last 48h",
                  "📄 Statement Pending: Tag = LB-SDR-STATEMENT-CHASE (active, no LB-STATEMENT-RECEIVED)",
                  "📊 Proposal Out: Pipeline Stage = Proposal Sent",
                  "❄️ Cold Active: Tag = LB-COLD-OUTBOUND AND does NOT have tag LB-COLD-EXIT",
                  "🏗️ Onboarding Active: Tag = LB-CLOSED-WON AND does NOT have tag LB-MERCHANT-APPROVED",
                  "⚠️ Onboarding Stalled: Tag = LB-ONBOARDING-STALLED",
                  "📈 Active Merchants: Tag = LB-MERCHANT-ACTIVE",
                  "😞 At Risk (NPS Detractors): Tag = LB-NPS-DETRACTOR",
                  "🛑 DNC (Never Contact): Tag = LB-DNC — review this list periodically to confirm",
                ],
              },
              {
                title: "11. Register All Workflow IDs in the Platform",
                color: "border-l-emerald-500",
                items: [
                  "After building each workflow in GHL: go to Automations → your workflow → Settings → copy the Workflow ID",
                  "Go to /dashboard/ghl-workflows in this platform",
                  "Paste each workflow ID next to its sequence name:",
                  "WF1 (Speed-to-Lead) → sequence name: 'Inbound Confirmation'",
                  "WF2 (Cold Outbound) → sequence name: 'Switch & Save — Statement Audit'",
                  "WF3 (Reply Engaged) → sequence name: 'SDR: Reply Engaged'",
                  "WF4 (Statement Chase) → sequence name: 'SDR: Statement Chase'",
                  "WF5 (Proposal) → sequence name: 'SDR: Proposal Follow-Up'",
                  "WF6 (Merchant Welcome) → sequence name: '3. Fast Approval — Application Completion'",
                  "WF7 (Go-Live) → env var: GHL_WORKFLOW_MERCHANT_APPROVED (set in Replit Secrets)",
                  "WF8 (Retention) → create new sequence name: 'Merchant Retention — NPS'",
                  "WF9 (Win-Back) → create new sequence name: 'Merchant Win-Back'",
                  "Re-engagement → sequence name: '19. Reactivation — Cold Lead Revival'",
                  "Test each: manually apply trigger tag to a test contact → verify GHL fires the workflow within 30 seconds",
                ],
              },
              {
                title: "12. Go-Live Final Check",
                color: "border-l-rose-500",
                items: [
                  "A2P SMS registration approved ✓",
                  "All 9 workflows built and tested with a test contact ✓",
                  "All voicemail drop audio files uploaded ✓",
                  "Voice AI Employee tested — introduces as Liberty Bancard, not ChatGPT ✓",
                  "SMS AI Employee tested — handles objections, books appointments ✓",
                  "All custom values populated (application link, calendar, portal, upload links) ✓",
                  "All GHL Workflow IDs registered in the platform at /dashboard/ghl-workflows ✓",
                  "DNC handling tested — STOP reply stops all sequences immediately ✓",
                  "Go to /dashboard/activation → enable SDR sequences → flip SDR_ENABLED to ON ✓",
                  "Monitor /dashboard/operator for the first 48 hours — watch for bounce spikes or anomalies ✓",
                ],
              },
            ].map((section, si) => (
              <AdminCheckSection key={si} sectionIndex={si} title={section.title} color={section.color} items={section.items} />
            ))}

            <Card className="border-dashed">
              <CardContent className="pt-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <Zap className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Ready to activate?</p>
                    <p className="text-xs text-muted-foreground">Once all 12 sections are complete, flip the master switch in the Activation Panel.</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button asChild size="sm" data-testid="btn-activation-panel">
                    <Link href="/dashboard/activation">
                      <Zap className="h-4 w-4 mr-1.5" /> Activation Panel
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" data-testid="btn-ghl-admin-external">
                    <a href="https://app.gohighlevel.com" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" /> Open GHL
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
