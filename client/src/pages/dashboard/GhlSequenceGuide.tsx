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
• Estimated monthly savings: ${{custom.monthlySavings}}
• Annualized: ${{custom.annualSavings}}

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
  { tag: "LB-INBOUND-NEW",         trigger: "Any form submission / chat inbound",         workflow: "Workflow 1" },
  { tag: "LB-COLD-OUTBOUND",       trigger: "SDR enrichment / manual upload / bulk import", workflow: "Workflow 2" },
  { tag: "LB-SDR-REPLY-ENGAGED",   trigger: "Any inbound email or SMS reply",              workflow: "Workflow 3" },
  { tag: "LB-SDR-STATEMENT-CHASE", trigger: "Prospect agreed to send statement",           workflow: "Workflow 4" },
  { tag: "LB-SDR-PROPOSAL",        trigger: "Analysis/proposal sent to prospect",          workflow: "Workflow 5" },
  { tag: "LB-BOOKING-READY",       trigger: "Appointment booked (any channel)",            workflow: "EXIT — stop all sequences" },
  { tag: "LB-STATEMENT-RECEIVED",  trigger: "Statement uploaded to platform",              workflow: "EXIT — trigger review workflow" },
  { tag: "LB-VERBAL-COMMIT",       trigger: "Prospect verbally agreed to proceed",         workflow: "EXIT — move to closing" },
  { tag: "LB-CLOSED-WON",          trigger: "Deal closed / approved",                     workflow: "Enroll onboarding sequence" },
  { tag: "LB-CLOSED-LOST",         trigger: "Deal lost / not interested",                 workflow: "EXIT — long-term nurture" },
  { tag: "LB-DNC",                 trigger: "STOP reply / manual DNC",                   workflow: "GLOBAL STOP — all sequences" },
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
            Step-by-step instructions for building the 5 merchant acquisition workflows in GoHighLevel.
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
          <div className="flex items-center gap-1 flex-wrap text-xs">
            {[
              { label: "New Lead", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
              { label: "→ WF1 Inbound / WF2 Cold Outbound", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
              { label: "→ Reply?", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
              { label: "→ WF3 Reply Engaged", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
              { label: "→ Statement?", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
              { label: "→ WF4 Statement Chase", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
              { label: "→ Proposal Sent", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
              { label: "→ WF5 Proposal Follow-Up", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
              { label: "→ Closed Won 🎉", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
            ].map((node, i) => (
              <span key={i} className={`px-2 py-1 rounded-md font-medium ${node.color}`}>{node.label}</span>
            ))}
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
          <TabsTrigger value="tags" data-testid="tab-tags">Tag Reference</TabsTrigger>
          <TabsTrigger value="global" data-testid="tab-global">Global Setup</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
