export interface SequenceStep {
  stepNumber: number;
  channel: "email" | "sms" | "call" | "voicemail_drop" | "task" | "ai_conversation";
  delayDescription: string;
  subject?: string;
  body: string;
  callScript?: string;
  voicemailScript?: string;
  callMode?: string;
  ghlNote?: string;
}

export interface SequencePrompt {
  id: string;
  name: string;
  category: string;
  triggerConditions: string;
  usesConversationAI: boolean;
  steps: SequenceStep[];
}

export const CONVERSATION_AI_SYSTEM_PROMPT = `You are the Liberty Bancard AI Sales Assistant — a knowledgeable, direct representative for Liberty Bancard, a merchant services company that saves businesses money on payment processing.

IDENTITY & TONE
- You represent Liberty Bancard. Never identify yourself as ChatGPT, an OpenAI product, or a generic AI.
- Speak plainly. No corporate buzzwords, no filler phrases ("Absolutely!", "Great question!"), no emojis.
- Lead with numbers and specifics. If you don't have a specific number, say so honestly.
- You are helpful and direct, not pushy. Give the prospect what they need to make a decision.
- Never make promises you can't keep. Don't guarantee savings without reviewing a statement.

WHAT YOU CAN DO
- Answer general questions about merchant services, payment processing fees (interchange, assessments, processor markup), surcharge programs, cash discount programs, and payment terminals.
- Explain how Liberty Bancard's pricing model works (interchange-plus, flat rate comparisons).
- Walk a prospect through what happens on a statement review: what to send, what we look at, and what the analysis shows.
- Explain the fast approval process: application takes 5–10 minutes, funding in 1–2 business days for most merchants.
- Describe the Surcharge and Cash Discount programs, including legal compliance requirements.
- Address common objections: locked into a contract with current processor, happy with current rates, doesn't think they can save money.
- Schedule follow-up or connect the prospect to an SDR.

WHAT YOU MUST NEVER DO
- Never quote a specific rate or fee without a statement on file. Always say rates depend on the statement review.
- Never disparage a competitor by name.
- Never discuss a merchant's specific account details or current contract terms unless they have shared them in the conversation.
- Never give legal, tax, or compliance advice beyond explaining that Liberty Bancard follows card brand rules (Visa/Mastercard/Discover/Amex).
- Never impersonate a human. If asked directly "Are you a real person?", say: "I'm Liberty Bancard's AI assistant. I can answer most questions right now, or connect you with a team member."

HUMAN HANDOFF TRIGGERS
Transfer immediately to a human SDR when:
1. The prospect says any variation of: "speak to a person," "talk to someone," "real person," "agent," "human."
2. The prospect wants to negotiate pricing directly.
3. The prospect raises a compliance, legal, or regulatory question you can't fully answer.
4. The prospect expresses frustration or anger.
5. The prospect is ready to apply or sign.
When handing off, say: "Let me connect you with one of our account managers right now. They'll follow up within [timeframe]."

OBJECTION HANDLING
- "I'm locked in a contract": Ask when the contract ends. Explain Liberty Bancard can often cover early termination fees. Offer to review the statement and run the numbers now so they're ready when the time comes.
- "My rates are fine": Say: "Most merchants say that before they see a side-by-side comparison. The only way to know for sure is to send over a statement — takes us about 24 hours to run the analysis, no cost to you."
- "I'm not interested": Acknowledge it and offer one reason to reconsider. If they decline again, end politely: "Understood. I'll leave a note for our team. If anything changes, we're here."
- "How much can I save?": Say: "I can't give you a number without your statement. What I can tell you is our average analysis shows merchants are overpaying by 0.3–0.8% on processing volume. On $100K/month, that's $300–$800."

FALLBACK RESPONSES
If asked something outside your knowledge: "That's a question for one of our account managers. I'll flag it so they can get back to you directly."
If asked for information you don't have access to: "I don't have that detail in front of me. Your account manager can pull that up."
If the conversation goes off-topic: "Let me bring this back to what I can actually help with — your payment processing costs."`;

export const SEQUENCE_PROMPTS: SequencePrompt[] = [
  // ─────────────────────────────────────────────────────────────
  // INBOUND & CONFIRMATION
  // ─────────────────────────────────────────────────────────────
  {
    id: "inbound-confirmation",
    name: "Inbound Confirmation",
    category: "inbound",
    triggerConditions: "Contact submits any inbound web form, chat widget, or calls in and leaves contact info. Fire immediately upon form submission or CRM contact creation.",
    usesConversationAI: true,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Immediately (within 5 minutes of form submission)",
        subject: "Got your request — here's what happens next",
        body: `Hi {{contact.firstName}},

We received your request. Here's what to expect:

One of our account managers will reach out within 1 business hour to discuss your payment processing situation.

In the meantime, if you have a recent merchant statement (even a PDF), you can reply to this email and attach it. That lets us run a full cost comparison before we even talk, so you're not starting from zero on the call.

No obligation. No pressure.

— The Liberty Bancard Team
www.libertybancard.com | (888) 888-8888`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "2 minutes after form submission",
        body: `Hi {{contact.firstName}}, it's Liberty Bancard. We got your request and an account manager will follow up shortly. Have a statement handy? Reply and we can run your free analysis now. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "task",
        delayDescription: "5 minutes after form submission",
        body: `PRIORITY: New inbound lead. {{contact.firstName}} {{contact.lastName}} submitted a form. Call within 1 hour. Check if statement was attached to confirmation email.`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "15 minutes after form submission (AI intro call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is Scott with Liberty Bancard — I'm following up on the request you just submitted. We specialize in reducing payment processing costs for businesses like yours and I'd love to get a quick sense of your setup. If you have your merchant statement available, we can actually start the analysis right now — takes about 15 minutes to go over the basics. What's a good time in the next hour? You can also book directly at [Calendar Link].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task → assign to SDR. Branch: Answered → continue to qualification. Voicemail → go to Step 5 voicemail drop. No answer → wait 2 hours, retry.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "15 minutes (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, this is Scott from Liberty Bancard. You just submitted a request — I'm calling to follow up. We help businesses cut payment processing costs and I'd love to talk through your situation. Call me back at [Phone] or book at [Calendar Link]. Talk soon.",
        ghlNote: "GHL Action: Voicemail Drop → inbound confirmation voicemail audio. Trigger follow-up SMS 5 minutes after drop.",
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "2 hours after form submission (retry call — no answer on step 4)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is Scott with Liberty Bancard again. I tried to reach you a bit ago about the request you submitted. I know timing can be tough — I just wanted to make sure you got our follow-up and answer any questions. We can run a full cost comparison on your statement in about 15 minutes when you're free. What's a good time today?",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Retry outbound call (If/Then: Answered → qualify, Voicemail → go to Step 7 voicemail drop, No Answer → continue to Day 1 email follow-up).",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "2 hours (if voicemail on step 6)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, Scott again from Liberty Bancard. Tried you one more time — we work with a lot of businesses in your space and the numbers usually surprise people in a good way. Book a 15-minute slot at [Calendar Link] or call me back at [Phone]. Hope to connect soon.",
        ghlNote: "GHL Action: Retry Voicemail Drop → second inbound voicemail audio. Follow-up SMS 5 min after drop. Then continue sequence to Day 1 email.",
      },
    ],
  },
  {
    id: "statement-audit",
    name: "1. Switch & Save — Statement Audit",
    category: "sales",
    triggerConditions: "Contact requests a statement review, or lead score >= 60 with pain point tagged as 'high_rates' or 'rate_increase'. Also fires when SDR manually enrolls after a cold call where the merchant agrees to send a statement.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Immediately upon enrollment",
        subject: "Your free statement analysis — what to send us",
        body: `Hi {{contact.firstName}},

To run your free cost comparison, we need one thing: your most recent merchant processing statement.

What to send:
- A PDF of your processor statement (most processors email these monthly)
- If you process with multiple processors, send the most recent from each

You can reply to this email with the attachment, or forward your processor's statement email directly to us.

What we'll show you:
- Your current effective rate (what you're actually paying, not what you were quoted)
- A line-by-line breakdown of fees
- What those same transactions would cost at Liberty Bancard
- Estimated monthly and annual savings

Most merchants are surprised by the gap between their quoted rate and their effective rate. We'll show you both.

Reply with your statement and we'll have the analysis back to you within 24 hours.

— [SDR Name]
Liberty Bancard
[Phone] | [Email]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Same day, 3 hours after step 1",
        body: `{{contact.firstName}} — this is [SDR Name] from Liberty Bancard. Just sent you an email about your free statement analysis. Takes 24 hours once we have the statement. Worth 5 minutes to see if you're overpaying. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 2 if no statement received",
        subject: "Quick follow-up on your statement analysis",
        body: `Hi {{contact.firstName}},

Following up on the statement analysis I mentioned yesterday.

If you're having trouble finding your statement, here's where to look:
- Square: Dashboard → Account → Invoices
- Stripe: Dashboard → Billing → Invoices
- Heartland, First Data, TSYS, WorldPay: Check your email for a monthly PDF from your processor
- Any processor: Call their merchant services number and ask them to email your most recent statement

If your processor doesn't send monthly statements, ask them for a "merchant activity report" for the last 30 days.

Once we have it, the analysis takes less than 24 hours.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 3",
        body: `{{contact.firstName}}, [SDR Name] here. Still happy to run that free analysis whenever you're ready. Takes 24 hrs once we have your statement. Any questions? Just reply. Reply STOP to opt out.`,
      },
      {
        stepNumber: 5,
        channel: "email",
        delayDescription: "Day 5 if no response",
        subject: "Last note on your statement analysis",
        body: `Hi {{contact.firstName}},

This is my last note on the statement analysis — I don't want to keep showing up in your inbox if the timing isn't right.

When you're ready to see what you're actually paying in processing fees and whether you can cut that number, reply here or call me directly at [Phone].

The analysis is free, takes 24 hours, and shows you the real numbers — no estimate, no guess, no commitment required.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "Day 7 (final qualification call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been following up about a free statement analysis. I just want to personally reach out before closing this out — if you can spare 5 minutes, I can tell you right now if it's worth sending the statement. Most merchants I talk to are overpaying by $300–$800/month and don't know it. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → close on statement request or book call. Voicemail → drop voicemail, exit sequence. No answer → exit sequence.",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "Day 7 (if voicemail on step 6)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Last follow-up from me on the statement analysis. When the timing is right, call me at [Phone]. The analysis is free and takes 24 hours — no commitment needed.",
        ghlNote: "GHL Action: Voicemail Drop → statement audit final voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "free-analysis-followup",
    name: "20. Free Analysis Follow-Up",
    category: "sales",
    triggerConditions: "Statement has been received and analysis is complete. SDR manually enrolls after sending the analysis document to the prospect. Fire the morning after the analysis is sent.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1 (morning after analysis was sent)",
        subject: "Your statement analysis — questions?",
        body: `Hi {{contact.firstName}},

Just checking in on the analysis I sent over yesterday.

The short version: you're paying [X]% effective rate. On $[volume]/month, that's $[current cost]. At Liberty Bancard, that same volume runs $[LB cost]. The difference is $[savings]/month — $[annual savings]/year.

Happy to walk through it line by line on a quick call, or answer questions by email if that's easier.

What would you like to do next?

— [SDR Name]
Liberty Bancard
[Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 1, afternoon (4–5 hours after email)",
        body: `{{contact.firstName}}, did you get a chance to look at the processing analysis? Happy to walk through it — takes 10 minutes. When works for you? Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 3 if no response",
        subject: "Re: Your statement analysis",
        body: `Hi {{contact.firstName}},

Following up on the analysis — still a good opportunity to cut your processing costs by $[savings]/month if the numbers make sense for you.

If you have questions or want to discuss, I'm available at [Phone] or reply here.

If the timing is off, no problem — just let me know and I'll follow up in a month or two.

— [SDR Name]`,
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 5",
        body: `{{contact.firstName}}, last check-in on your statement analysis. Happy to answer questions or schedule a call whenever you're ready. Reply STOP to opt out.`,
      },
      {
        stepNumber: 5,
        channel: "email",
        delayDescription: "Day 7",
        subject: "Closing the loop — your statement analysis",
        body: `Hi {{contact.firstName}},

Closing the loop on this one. The analysis showed $[savings]/month in potential savings. That offer stands whenever you're ready to talk.

Call me at [Phone] or reply here when the timing is right.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "Day 8 (analysis discussion call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I sent over the analysis on your processing statement — showing $[savings]/month in potential savings. I just wanted to personally call and walk you through the numbers, answer any questions, and talk about next steps if the numbers make sense for you. Even if you decide not to move forward, I want to make sure you understand what you're looking at. Call me at [Phone].",
        callMode: "proposal_followup",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → walk through analysis, close on application. Voicemail → drop voicemail. No answer → wait 3 days.",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "Day 8 (if voicemail on step 6)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Calling to walk through your processing analysis — $[savings]/month in potential savings. Happy to answer any questions. Call me at [Phone] when you have 10 minutes.",
        ghlNote: "GHL Action: Voicemail Drop → analysis discussion voicemail. Trigger SMS follow-up 5 minutes after drop.",
      },
    ],
  },
  {
    id: "fast-approval",
    name: "3. Fast Approval — Application Completion",
    category: "onboarding",
    triggerConditions: "Contact verbally commits or fills out first section of application but does not complete. Fires when deal stage = 'Application In Progress' for more than 24 hours, or SDR manually enrolls after a verbal yes.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "24 hours after enrollment (or immediately if verbal commit)",
        subject: "Finish your Liberty Bancard application — 5 minutes",
        body: `Hi {{contact.firstName}},

You're one short form away from getting set up. The application takes about 5–10 minutes and we need:

- Business legal name and address
- Bank routing and account number (for deposit setup)
- Federal Tax ID (EIN) or SSN (sole proprietors)
- A voided check or bank letter

Once submitted, most accounts are approved and active within 1–2 business days.

Complete your application here: [Application Link]

If you run into any issues, call me directly at [Phone].

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 1, 4 hours after email",
        body: `{{contact.firstName}}, this is [SDR Name] from Liberty Bancard. You're close — just need to finish your application. Takes 5 min: [Application Link]. Questions? Call me at [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 2 if not completed",
        subject: "Application still open — anything blocking you?",
        body: `Hi {{contact.firstName}},

Your application is still open. If something's holding you up — missing documents, questions about the process, anything — just let me know and I'll help you get past it.

Most common issue is not having the bank account info handy. If that's it, you can start the application and come back to that section.

[Application Link]

— [SDR Name]
Liberty Bancard
[Phone]`,
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 3",
        body: `{{contact.firstName}} — quick check: anything blocking your Liberty Bancard application? Happy to help. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 5,
        channel: "email",
        delayDescription: "Day 5",
        subject: "Last follow-up on your application",
        body: `Hi {{contact.firstName}},

This is my last follow-up on the application. If you're still interested, the link is still active: [Application Link]

If the timing changed or you went a different direction, no hard feelings — just reply and let me know and I'll close this out.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "Day 6 (application completion call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. You started your application but it's still open — I just wanted to personally reach out and see if anything was blocking you. Most people get stuck on the bank account info or the EIN. I can walk you through the whole thing right now in 10 minutes if you have time. Call me at [Phone].",
        callMode: "proposal_followup",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → walk through application together, unblock. Voicemail → drop voicemail. No answer → exit sequence.",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "Day 6 (if voicemail on step 6)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Your application is still open — if anything's blocking you, call me at [Phone] and I'll walk you through it in 10 minutes. The application link is in your email.",
        ghlNote: "GHL Action: Voicemail Drop → application completion voicemail. Exit sequence after this step.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // CORE SALES SEQUENCES
  // ─────────────────────────────────────────────────────────────
  {
    id: "switch-and-save",
    name: "Switch & Save (core sales)",
    category: "sales",
    triggerConditions: "Contact expresses dissatisfaction with current processor rates. Lead score >= 65. Pain points include high_rates or rate_increase.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "What switching processors actually looks like",
        body: `Hi {{contact.firstName}},

A lot of merchants are hesitant to switch processors because they assume it's a major project. In most cases it's not.

Here's what the switch typically looks like:
- Day 1: Application submitted
- Day 2–3: Approval and account setup
- Day 3–5: New terminal programmed and shipped (or software credentials sent)
- Week 2: First transactions running through Liberty Bancard

Your old account stays open until you're sure everything is working. You keep your existing equipment in many cases.

The two things that actually matter: what you're paying now, and what you'd pay with us. Send over a statement and we'll show you that number — no commitment required.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, [SDR Name] at Liberty Bancard. Quick question — are you on a month-to-month or annual contract with your current processor? That changes how and when you can switch. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 4",
        subject: "The real cost of staying with your current processor",
        body: `Hi {{contact.firstName}},

Every month you stay with a processor that's overcharging you is money left on the table. The average merchant in our analysis is overpaying by $300–$800/month on $100K in volume.

That's not a sales pitch. That's what the math shows, consistently, across hundreds of statements we've reviewed.

I'm not asking you to switch today. I'm asking you to know the real number. Send us a statement and we'll tell you what it is within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 6",
        body: `{{contact.firstName}}, one last try — if you want to know your real processing rate (not the one you were quoted), send me a statement and I'll run the numbers. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 5,
        channel: "call",
        delayDescription: "Day 8 (direct close call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been reaching out about what it looks like to switch processors — and I just want to make one direct call before I close this out. If you process $30K or more a month and you're not sure if you're overpaying, a 5-minute call could tell you that. No commitment. You can also just send a statement and I'll have numbers for you in 24 hours. [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → close on statement commitment. Voicemail → drop voicemail, exit sequence. No answer → exit sequence.",
      },
      {
        stepNumber: 6,
        channel: "voicemail_drop",
        delayDescription: "Day 8 (if voicemail on step 5)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Last outreach on switching processors — if you're not sure what you're paying and want to know the real number, call me at [Phone] or send your statement. No commitment required.",
        ghlNote: "GHL Action: Voicemail Drop → switch and save final voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "trust-builder",
    name: "4. Trust Builder — Authority Sequence",
    category: "sales",
    triggerConditions: "Contact is warm but non-committal. Lead score 45–69. No specific pain point identified. Used for mid-funnel nurture when the prospect is evaluating options.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "Why merchants switch to Liberty Bancard (and why some don't)",
        body: `Hi {{contact.firstName}},

I want to give you an honest picture of what Liberty Bancard is and isn't.

What we do well:
- Interchange-plus pricing, which means you see exactly what Visa/Mastercard charge and exactly what our markup is. No bundled rates that hide the real cost.
- Next-day funding for most transaction types.
- U.S.-based merchant support — not a call center overseas.
- No long-term contracts on most merchant accounts.

What we're not:
- The cheapest option if you do under $5,000/month in volume. Our model is better suited for merchants processing $20K+/month.
- A fit for high-risk industries like firearms, pharmaceuticals, or adult content.

If you process $20K+ and you're on a bundled rate plan with your current processor, it's worth a 10-minute conversation.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "Day 5",
        subject: "A real example: What one retail merchant saved",
        body: `Hi {{contact.firstName}},

Here's a real (anonymized) example from a recent statement review:

Merchant: Independent hardware store, $85,000/month in processing volume
Previous processor: Bundled rate of 2.6% + $0.10 per transaction
Effective rate with Liberty Bancard: 1.94% (interchange-plus)
Monthly savings: $561
Annual savings: $6,732

The only thing that changed was the processor. Same terminal, same software, same customer experience.

If you want to see what those numbers look like for your business, send us a statement.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 3,
        channel: "sms",
        delayDescription: "Day 7",
        body: `{{contact.firstName}}, [SDR Name] here. No pressure — just want to make sure you have what you need to make a good decision on your processing costs. Any questions I can answer? Reply STOP to opt out.`,
      },
      {
        stepNumber: 4,
        channel: "email",
        delayDescription: "Day 10",
        subject: "3 questions worth asking your current processor",
        body: `Hi {{contact.firstName}},

Before deciding to stay with your current processor or explore alternatives, these three questions are worth asking them:

1. What is my effective rate this month? (Total fees divided by total volume — not the rate they quoted you.)
2. Am I on interchange-plus or bundled/tiered pricing?
3. What are my PCI compliance fees, statement fees, and batch fees? (These add up.)

If you share those answers with me, I'll tell you whether what you're paying is reasonable for your volume and business type.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 5,
        channel: "email",
        delayDescription: "Day 15",
        subject: "Leaving this here for when the timing is right",
        body: `Hi {{contact.firstName}},

I'll stop filling up your inbox after this one.

If there's ever a moment where you're frustrated with your processor — a rate hike notice, a chargeback you're unhappy with how they handled, or just wondering if you're paying too much — reach out and we'll run the numbers.

That offer doesn't expire.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "Day 16 (final personal outreach)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. This is my final personal call. I've been sharing some information about what merchants in your situation typically save when they switch to interchange-plus pricing. Before I close this out — is there any specific concern or question that's kept you from wanting to take a closer look? I'd rather give you a real answer than let this sit. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → address specific objection, close on analysis. Voicemail → drop voicemail, exit sequence. No answer → exit sequence.",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "Day 16 (if voicemail on step 6)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Final outreach — if you ever want to know the real numbers on your processing costs, call me at [Phone]. That offer doesn't expire.",
        ghlNote: "GHL Action: Voicemail Drop → trust builder final voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "funding-speed",
    name: "6. Funding Speed & Reliability",
    category: "sales",
    triggerConditions: "Contact has tagged pain point: slow_funding. Or SDR conversation reveals merchant is waiting 2+ days for funds. Lead score >= 50.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "When does your money actually hit your account?",
        body: `Hi {{contact.firstName}},

Cash flow is everything when you're running a business. If your processor is holding your money for 2–3 days, that's a real problem — especially if you're paying staff or suppliers weekly.

Liberty Bancard's standard funding:
- Transactions settled by 5 PM EST fund the next business day
- Weekend batches fund Monday (for most card types)
- No holds on standard merchant accounts during normal operations

If your current processor is slow-funding you — or worse, placed a rolling reserve on your account without explanation — that's worth a conversation.

Send me a statement and tell me what your current funding terms are. We'll show you what's available.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, quick question: how many days does it take for your card sales to hit your bank account? If it's more than 2, that's something worth looking at. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 5",
        subject: "Funding delays cost more than you think",
        body: `Hi {{contact.firstName}},

Here's the math: If you process $50K/month and your processor holds funds for 3 days instead of 1, you have $5,000–$8,000 of your own money sitting in their system at any given time.

That's money you can't use to pay vendors, buy inventory, or cover payroll.

Next-day funding isn't a premium feature — it's standard with Liberty Bancard for most merchant categories. Let's talk about whether it applies to your business type.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 7 (funding concern close call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been reaching out about funding speeds — specifically, how many days it takes your card sales to hit your bank account. If it's more than 1–2 days, you may be carrying a significant cash float that Liberty Bancard would solve with next-day funding. Takes 10 minutes to talk through. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → close on funding pain, move to statement-audit. Voicemail → drop voicemail. No answer → exit sequence.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 7 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. If slow funding is a frustration for your business — money sitting in limbo for 2–3 days — we solve that with next-day funding. Call me at [Phone] to find out if you qualify.",
        ghlNote: "GHL Action: Voicemail Drop → funding speed voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "surcharge-cash-discount",
    name: "9. Surcharge & Cash Discount — Compliance",
    category: "sales",
    triggerConditions: "Contact expresses interest in reducing fees by passing costs to customers. Lead score >= 45. Business type: retail, restaurant, service, medical.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "Surcharge vs. cash discount — what's the difference and what's legal",
        body: `Hi {{contact.firstName}},

Two programs that can significantly reduce your processing costs — but they work very differently and have different legal requirements.

Cash Discount Program:
- You post a "regular price" and offer a discount to customers who pay cash
- Available in all 50 states
- Requires specific signage at entry and point of sale
- Typical result: processing cost drops to near zero on cash transactions, and you keep your existing pricing structure

Surcharge Program:
- You add a percentage (up to 3%) to card transactions
- Legal in most states (banned in CT, MA, and a few others — check yours)
- Requires enrollment through your processor
- Must be disclosed to customers before the transaction
- Applies only to credit cards, not debit

Both require proper setup to stay compliant with Visa/Mastercard rules. If set up wrong, you risk chargebacks and fines.

Liberty Bancard handles the compliance setup — signage, disclosure language, processor enrollment. We've done this hundreds of times.

Want to see which program makes more sense for your business? Reply or call [Phone].

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, this is [SDR Name] from Liberty Bancard. Did you get a chance to look at the surcharge/cash discount info I sent? Happy to walk through which works better for your setup. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 4",
        subject: "What your processing costs look like at near-zero",
        body: `Hi {{contact.firstName}},

If you process $60,000/month and your effective rate is 2.5%, you're paying $1,500/month in processing fees.

With a properly implemented cash discount or surcharge program, that number goes to near zero — or is offset by the customer fee.

The setup takes about 1–2 weeks (new signage, reprogramming your terminal, updating your customer-facing pricing). After that, the savings are permanent.

This is one of the faster-payoff changes a merchant can make. Let's run the numbers for your volume.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 7",
        body: `{{contact.firstName}}, last note on the cash discount/surcharge option. If you want to see what near-zero processing costs look like for your volume, just reply or call [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 5,
        channel: "call",
        delayDescription: "Day 9 (program close call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been emailing about surcharge and cash discount programs — they're the fastest way to get processing costs close to zero without raising your prices. I can walk you through the compliance requirements and show you the math for your volume in about 10 minutes. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → explain program, get statement. Voicemail → drop voicemail. No answer → exit sequence.",
      },
      {
        stepNumber: 6,
        channel: "voicemail_drop",
        delayDescription: "Day 9 (if voicemail on step 5)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on surcharge and cash discount programs — can reduce your processing cost to near zero. Happy to show you the setup in 10 minutes. Call me at [Phone].",
        ghlNote: "GHL Action: Voicemail Drop → surcharge program voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "objection-crusher",
    name: "18. Objection Crusher — Overcome Hesitation",
    category: "sales",
    triggerConditions: "Contact went cold after initial conversation. Lead replied with 'happy with current processor,' 'not interested right now,' or similar. SDR manually enrolls. Lead score 40–75.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "Fair — here's the one thing worth knowing",
        body: `Hi {{contact.firstName}},

I hear you — you're happy with your current setup. That's a reasonable place to be.

Here's the one thing I'd leave you with: most merchants who say that have never seen their actual effective rate — the real percentage they're paying once you add up all the fees on the statement.

It's almost always higher than the rate they were quoted when they signed up.

If you ever want to check that number — no commitment, no sales pitch, just the data — send me a statement and I'll calculate it for you. Takes us about 24 hours.

If the number's fine, you'll know for certain. If it's not, you'll know that too.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "Day 7",
        subject: "The contract question",
        body: `Hi {{contact.firstName}},

A lot of merchants we talk to are hesitant to explore options because they're locked into a contract with their current processor.

If that's part of what's holding you back, it's worth knowing: in many cases, Liberty Bancard can cover early termination fees — especially if the savings are significant enough to justify it.

We've helped merchants break contracts costing $500–$2,000 and still come out ahead within the first few months.

Worth a conversation if that's the situation? [Phone]

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 3,
        channel: "sms",
        delayDescription: "Day 10",
        body: `{{contact.firstName}}, last check-in from Liberty Bancard. If your situation changes — rate hike, contract renewal, frustration with support — we're a call away. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 12 (direct objection call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I know you mentioned you're happy with your current setup — and I respect that. I just want to ask one question directly: do you know your actual effective rate — not the rate you were quoted, but the real percentage after all fees? Most merchants I ask can't answer that, and when they find out, it's usually higher than expected. If you want to know the number, send a statement and I'll have it back to you in 24 hours. [Phone].",
        callMode: "reactivation",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → specific objection handling, close on analysis. Voicemail → drop voicemail, exit sequence. No answer → exit sequence.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 12 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I know you're happy with your current processor — just want to leave one question: do you know your real effective rate? Send a statement and I'll calculate it in 24 hours. Call me at [Phone].",
        ghlNote: "GHL Action: Voicemail Drop → objection crusher final voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "contract-escape",
    name: "17. Contract Escape — Switch Help",
    category: "sales",
    triggerConditions: "Contact is interested in switching but states they are locked in a contract with their current processor. SDR tags contact with 'locked_contract'. Lead score >= 55.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "Being locked in a contract — what your options actually are",
        body: `Hi {{contact.firstName}},

If you're under contract with your current processor, you typically have a few options:

1. Wait it out: Know exactly when your contract expires and plan the switch. We can prepare everything now so you're ready to flip the switch on day 1.

2. Early termination: Most contracts have a defined ETF (early termination fee). If your monthly savings at Liberty Bancard exceed the ETF over a reasonable period, switching early still makes financial sense.

3. ETF coverage: In cases where the savings justify it, Liberty Bancard will cover part or all of your ETF. This is assessed case by case based on your volume and the ETF amount.

First step: send me a copy of your current agreement (or just the termination terms) and your most recent statement. We'll run the math and tell you which option makes the most sense.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, [SDR Name] here. Know when your processor contract is up? Happy to help you plan the switch so you're ready. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 5",
        subject: "A contract exit example",
        body: `Hi {{contact.firstName}},

Real example (anonymized):

Merchant locked in a 3-year contract with 18 months remaining.
ETF: $1,200.
Monthly savings at Liberty Bancard: $490.
Payback period: 2.5 months.
Net benefit after covering ETF: $7,620 over remaining contract period.

The only way to know if your situation looks similar is to run the numbers. Send your statement and contract terms and I'll calculate it.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 10",
        body: `{{contact.firstName}}, still worth looking at your contract exit math when you're ready. We've helped a lot of merchants make the move early and come out ahead. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 5,
        channel: "call",
        delayDescription: "Day 12 (contract exit decision call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been sending some information about contract exit options. I just want to ask — do you know when your current contract expires and what the termination fee is? If you don't, I can help you figure that out. Once we have those two numbers, we can tell you in about 5 minutes whether breaking the contract makes financial sense or whether it's better to plan the switch at renewal. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → get contract terms, run ETF math, close. Voicemail → drop voicemail. No answer → exit sequence.",
      },
      {
        stepNumber: 6,
        channel: "voicemail_drop",
        delayDescription: "Day 12 (if voicemail on step 5)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Quick question — do you know when your processor contract expires? We've helped merchants break contracts and come out ahead. Call me at [Phone] for a 5-minute calculation.",
        ghlNote: "GHL Action: Voicemail Drop → contract escape voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "omnichannel",
    name: "15. Omnichannel — Online + In-Person",
    category: "sales",
    triggerConditions: "Contact processes both online (e-commerce) and in-person. Tagged with vertical = e-commerce or omnichannel. Lead score >= 45.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "One processing account for in-store and online",
        body: `Hi {{contact.firstName}},

If you're running both in-person and online sales, you've probably noticed that managing two separate payment systems is more complicated — and more expensive — than it needs to be.

Liberty Bancard supports true omnichannel processing:
- One merchant account, one monthly statement
- In-person terminals and online payment gateway on the same pricing structure
- Unified reporting so you can see all transactions in one place
- Same next-day funding for both channels

Running two accounts often means two sets of monthly fees, two statement fees, two PCI compliance fees. Consolidating saves both time and money.

If you're currently running separate accounts, send me your statements from both and I'll show you what consolidation looks like on your numbers.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 3",
        body: `{{contact.firstName}}, do you currently process in-store and online through the same company? If not, there may be a simpler and cheaper way to do both. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 6",
        subject: "Online gateway options with Liberty Bancard",
        body: `Hi {{contact.firstName}},

For online processing, Liberty Bancard works with the most common e-commerce platforms:

- Shopify, WooCommerce, BigCommerce, Magento
- Custom sites via API integration
- Virtual terminal for phone orders and invoicing
- Recurring billing for subscriptions

We can discuss which integration makes sense for your online setup. If you're currently on a separate gateway (Authorize.net, Stripe, Braintree), I can show you a cost comparison for those too.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 8 (omnichannel consolidation call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been reaching out about processing both online and in-person through one account. Quick question — are you currently on two separate systems for your in-store and online sales? If so, you're likely paying two sets of monthly fees. I can show you what unified processing looks like in about 10 minutes. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → identify current setup, close on consolidation. Voicemail → drop voicemail. No answer → exit sequence.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 8 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on consolidating your in-person and online processing — one account, one monthly statement, one set of fees. Call me at [Phone] for a 10-minute overview.",
        ghlNote: "GHL Action: Voicemail Drop → omnichannel voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "recurring-billing",
    name: "13. Recurring Billing — Subscription Merchants",
    category: "sales",
    triggerConditions: "Contact has recurring billing, membership, or subscription business model. Tagged vertical = subscription or recurring. Lead score >= 45.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "Subscription billing — what most merchants get wrong with processing",
        body: `Hi {{contact.firstName}},

For businesses that bill recurring charges — memberships, subscriptions, retainers — there are a few processing considerations that most merchants don't know until something goes wrong.

1. Card updater services: Visa and Mastercard offer automatic account updater services that update stored cards when they expire or get reissued. Without this, failed payments spike. Liberty Bancard includes account updater.

2. Dunning management: Automated retry logic on failed payments — not all processors handle this the same way. We'll walk you through what ours looks like.

3. Chargeback risk on recurring: Cardholders who forget they signed up dispute the charge. Proper authorization language at signup and clear descriptor names on the statement reduce this significantly.

4. Interchange optimization: Recurring transactions qualify for different interchange rates than one-time transactions. Proper flagging can lower your effective rate.

If you're processing recurring payments, it's worth a 15-minute call to make sure your setup is optimized.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, this is [SDR Name] from Liberty Bancard. How's your failed payment rate on subscription charges? If it's over 3%, there are specific things you can do. Happy to talk. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 5",
        subject: "Reducing failed payments on recurring charges",
        body: `Hi {{contact.firstName}},

For subscription businesses, a 1% improvement in payment success rate can mean significant revenue recovery.

Example: 500 subscribers at $99/month = $49,500/month. At a 5% failure rate, that's $2,475/month in lost revenue. Getting failure rate to 2% with better dunning and card updating recovers roughly $1,485/month.

Liberty Bancard's recurring billing setup includes account updater and configurable retry logic. Let's talk about what your current failure rate is and what we can do about it.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 7 (recurring billing close call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been reaching out about recurring billing optimization — specifically, failed payment rates, dunning logic, and card updating. Quick question: what percentage of your subscription charges fail on the first attempt? That number tells us a lot about whether your current setup is leaving money on the table. Takes 10 minutes to talk through. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → close on failed payment pain point. Voicemail → drop voicemail. No answer → exit sequence.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 7 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Quick question on your subscription billing — what's your failed payment rate? If it's over 3%, there are things we can do. Call me at [Phone] for a 10-minute conversation.",
        ghlNote: "GHL Action: Voicemail Drop → recurring billing voicemail. Exit sequence after this step.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL SDR OUTBOUND — RETAIL
  // ─────────────────────────────────────────────────────────────
  {
    id: "v-retail-sdr-outbound",
    name: "V-Retail: SDR Outbound Prospecting",
    category: "sdr",
    triggerConditions: "Cold outbound to retail merchant contacts (physical retail, boutiques, hardware stores, gift shops). No prior contact. SDR manually enrolls or bulk enrollment from imported list with vertical = retail.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1 (initial outreach)",
        subject: "Quick question about your card processing costs",
        body: `Hi {{contact.firstName}},

I work with retail merchants in [region] on payment processing costs. Most of the store owners I talk to are paying between 2.5–3.2% effective rates — often without realizing it because the processor quotes a lower "base rate."

We run free statement analyses for retail merchants. Takes about 24 hours and shows you exactly what you're paying versus what's available in the market.

Worth a look? Reply here or call me at [Phone].

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 2",
        body: `Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I help retail merchants cut processing costs. Do you know your current effective rate? Most don't — and it's usually higher than the rate you were quoted. Happy to check. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 4",
        subject: "Retail processing: what you should know about your statement",
        body: `Hi {{contact.firstName}},

For retail merchants, three fees on your statement are worth looking at closely:

1. Effective rate: Total fees divided by total volume. If it's over 2.2%, there's likely room to improve.
2. Non-qualified surcharges: If your processor charges extra for reward cards (which most customers carry), this adds up fast.
3. PCI compliance fees: Often $9–$29/month, sometimes bundled in quietly.

Send me your most recent statement and I'll run the breakdown. No cost, no commitment.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 7",
        body: `{{contact.firstName}}, last message from Liberty Bancard. If you ever want a free look at your processing costs, I'm one call away. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 5,
        channel: "call",
        delayDescription: "Day 8 (cold call attempt)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] from Liberty Bancard. I've been sending some emails about payment processing costs for retail businesses. I'd love to connect for just 5 minutes — I can give you a rough sense of whether you're overpaying without you having to send anything. Most retail merchants I talk to save $200–$600/month. Worth a quick conversation? Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → qualify and get statement commitment. Voicemail → drop voicemail. No answer → exit cold outbound sequence.",
      },
      {
        stepNumber: 6,
        channel: "voicemail_drop",
        delayDescription: "Day 8 (if voicemail on step 5)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been sending some emails about retail processing costs. Most retail merchants save $200–$600/month — love to show you how. Call me at [Phone] when you get a chance.",
        ghlNote: "GHL Action: Voicemail Drop → retail SDR outbound voicemail audio. Exit cold outbound sequence after this step.",
      },
    ],
  },
  {
    id: "v-retail-inbound-nurture",
    name: "V-Retail: Inbound Lead Nurture",
    category: "inbound",
    triggerConditions: "Retail merchant submits a form or responds to outbound. Has not yet sent a statement. Enrolled after initial inbound response.",
    usesConversationAI: true,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Immediately",
        subject: "Thanks — here's what we'll cover on your retail account review",
        body: `Hi {{contact.firstName}},

Thanks for reaching out. For retail merchants, here's exactly what we look at in a statement review:

- Effective rate vs. your quoted rate
- Reward card surcharges (these are often the biggest hidden cost for retail)
- Monthly fees: statement, PCI, batch, service fees
- Equipment costs if you're leasing a terminal

If you're a retail merchant processing $30K+/month, the analysis almost always finds meaningful savings.

Send your most recent statement to [email] or attach it to your reply. We'll have results within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "4 hours after step 1",
        body: `{{contact.firstName}}, got your inquiry. Send your statement when you're ready and we'll run the retail cost analysis. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 3 if no statement received",
        subject: "Still here whenever you're ready",
        body: `Hi {{contact.firstName}},

Just checking in — happy to run the statement analysis whenever you're ready to send it over.

If you'd rather just talk through your situation first, call me at [Phone] and we can cover the basics before you decide whether to send anything.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 5 (intro qualification call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] from Liberty Bancard. You reached out about your processing costs and I just wanted to personally follow up. Even if you haven't sent the statement yet, I can give you a rough sense of whether there's likely savings based on just a few questions about your volume and what you're currently paying. Takes about 5 minutes. Call me at [Phone] whenever you're free.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → walk through pre-qualification questions, get statement commitment. Voicemail → drop voicemail. No answer → wait 3 days.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on your inquiry. If you're ready to send your statement or just want to talk through your processing setup first, call me at [Phone]. Takes 5 minutes and could save you real money each month.",
        ghlNote: "GHL Action: Voicemail Drop → retail inbound nurture voicemail. Trigger SMS follow-up 5 minutes after drop.",
      },
    ],
  },
  {
    id: "v-retail-account-ops",
    name: "V-Retail: Account Management Ops",
    category: "operations",
    triggerConditions: "Active Liberty Bancard retail merchant account. Quarterly or annual account review touchpoint.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Quarterly (or at defined review date)",
        subject: "Your quarterly account review",
        body: `Hi {{contact.firstName}},

It's time for your quarterly account review. Here's what we'll go over:

- Processing volume trends
- Current effective rate and whether rate optimization opportunities exist
- Any new products or programs available (surcharge, cash discount, new terminal features)
- Support issues or questions

If you have questions or anything you want to address before the review, reply here. Otherwise, I'll reach out to schedule a 15-minute call.

— [Account Manager Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "3 days after email if no response",
        body: `{{contact.firstName}}, following up on your quarterly account review. Do you have 15 minutes this week to connect? [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "call",
        delayDescription: "Day 14 (human touch dial — nurture)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [Account Manager Name] with Liberty Bancard. Just wanted to personally reach out and check in on your retail account. I want to make sure rates are looking good and see if there's anything I can optimize for you this quarter. Give me a call back at [Phone] when you have 15 minutes — no agenda, just want to make sure everything's running well for you.",
        callMode: "appointment_reminder",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for ops/nurture sequences per cadence model. If answered → schedule account review call.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL SDR OUTBOUND — AUTO
  // ─────────────────────────────────────────────────────────────
  {
    id: "v-auto-sdr-outbound",
    name: "V-Auto: SDR Outbound Prospecting",
    category: "sdr",
    triggerConditions: "Cold outbound to automotive merchants: dealerships, auto repair shops, tire shops, body shops. No prior contact.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "Processing large repair tickets — what are you paying?",
        body: `Hi {{contact.firstName}},

Auto repair and dealership transactions tend to run $500–$5,000+. At a 2.5% effective rate, a $2,000 repair ticket costs $50 in processing. On $200K/month in volume, that's $5,000/month in fees.

Most automotive merchants don't realize how much interchange optimization can do for high-ticket transactions. We've helped shops drop their effective rate by 0.4–0.8 percentage points — which on $200K/month is $800–$1,600/month in savings.

Happy to run a free analysis if you can send a statement. Takes 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, [SDR Name] from Liberty Bancard. Auto businesses often overpay on processing because of high-ticket card-present transactions. Know your effective rate? Happy to check. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 5",
        subject: "Automotive processing: key fees to check on your statement",
        body: `Hi {{contact.firstName}},

For auto businesses specifically, these line items on your statement are worth understanding:

1. Card-present rate on large tickets: High-ticket transactions should qualify for lower interchange if keyed correctly. If your processor isn't flagging these, you're overpaying.
2. Keyed vs. card-present: Phone-in or online repair orders cost more to process. Are you structured correctly for each channel?
3. Commercial card surcharges: When fleet cards and business cards come through, interchange is higher. How is your processor handling those?

Send a statement and I'll show you exactly how each of these applies to your account.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 8 (cold call attempt)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been emailing about auto processing costs — high-ticket transactions, fleet cards, keyed vs. card-present rates. I know you're probably busy. But a 5-minute call could tell you if you're overpaying on those big repair tickets. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → qualify on volume and transaction types. Voicemail → drop voicemail. No answer → exit sequence.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 8 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Quick voicemail on automotive processing costs. High-ticket repair transactions should cost less than most processors charge. I'd love to show you — call me at [Phone].",
        ghlNote: "GHL Action: Voicemail Drop → auto SDR outbound voicemail. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "v-auto-inbound-nurture",
    name: "V-Auto: Inbound Lead Nurture",
    category: "inbound",
    triggerConditions: "Automotive merchant responds to outbound or fills out a form. Enrolled after first response.",
    usesConversationAI: true,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Immediately",
        subject: "Your auto business processing review — what to expect",
        body: `Hi {{contact.firstName}},

For auto businesses, our review covers:

- Effective rate on card-present vs. card-not-present transactions
- Fleet card and commercial card handling
- Large-ticket interchange optimization
- Monthly fees and any equipment lease costs

Send your most recent statement to get started. We'll have the full breakdown back within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "4 hours",
        body: `{{contact.firstName}}, ready to run your auto business statement analysis whenever you send it over. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 3 if no statement received",
        subject: "Check-in on your auto statement review",
        body: `Hi {{contact.firstName}},

Still happy to run your review whenever you're ready. If you'd rather talk first, call me at [Phone] and we can start with a few quick questions about your volume.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 5 (intro qualification call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. You showed interest in reviewing your automotive account processing costs and I wanted to personally follow up. Even without the statement I can ask a few quick questions and give you a ballpark of whether you're likely overpaying. Automotive merchants with high-ticket repair tickets and fleet cards often save $400–$800/month. Just 5 minutes — call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → pre-qualify on volume and transaction types. Voicemail → drop voicemail. No answer → wait 3 days, exit.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on your auto processing inquiry — I'd love to run a quick pre-qualification. Call me at [Phone] when you have 5 minutes.",
        ghlNote: "GHL Action: Voicemail Drop → auto inbound nurture voicemail. Trigger SMS follow-up after drop.",
      },
    ],
  },
  {
    id: "v-auto-account-ops",
    name: "V-Auto: Account Management Ops",
    category: "operations",
    triggerConditions: "Active Liberty Bancard automotive merchant. Quarterly review or triggered by volume change > 20%.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Quarterly",
        subject: "Quarterly review — your automotive account",
        body: `Hi {{contact.firstName}},

Time for your quarterly check-in. I want to look at your volume trends, effective rate, and whether any new programs (surcharge, fleet card optimization) make sense for your business this quarter.

Do you have 15 minutes this week? I'll reach out to schedule.

— [Account Manager Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "3 days",
        body: `{{contact.firstName}}, following up on your automotive account quarterly review. When's a good time to connect? [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "call",
        delayDescription: "Day 14 (human touch dial — nurture)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [Account Manager Name] here with Liberty Bancard. Calling on your automotive account quarterly review — want to go over your volume trends and see if there are any rate optimizations or fleet card programs that make sense for your business this quarter. Happy to schedule 15 minutes whenever works. Just call back at [Phone].",
        callMode: "appointment_reminder",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for ops/nurture sequences. If answered → schedule account review.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL SDR OUTBOUND — MEDICAL
  // ─────────────────────────────────────────────────────────────
  {
    id: "v-medical-sdr-outbound",
    name: "V-Medical: SDR Outbound Prospecting",
    category: "sdr",
    triggerConditions: "Cold outbound to medical merchants: physician offices, chiropractic, optometry, physical therapy. No prior contact.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "Payment processing for medical offices — a quick check-in",
        body: `Hi {{contact.firstName}},

Medical practices have specific payment processing considerations that most general processors don't handle well:

- Patient co-pay processing (often a mix of HSA, FSA, debit, and credit cards)
- HIPAA-compliant payment pages (required for online payments)
- Split-tender transactions (partial insurance, partial patient pay)
- High-value procedures often paid in installments

Liberty Bancard works with medical practices and understands these requirements. If you're currently with a general processor, there's a good chance your setup isn't optimized for the way medical billing actually works.

Want a free review? Send a statement and I'll take a look.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 3",
        body: `{{contact.firstName}}, [SDR Name] at Liberty Bancard. Medical offices often pay more than they should on patient payment processing. Know your current effective rate? Happy to review. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 6",
        subject: "HSA/FSA cards and your processing costs",
        body: `Hi {{contact.firstName}},

HSA and FSA cards often process at higher interchange rates than standard debit or credit cards. Most processors don't optimize for this — they just let those transactions go through at higher cost.

There are specific merchant category codes and transaction types that reduce the cost of HSA/FSA acceptance. Liberty Bancard sets these up correctly from day one.

If patient payment processing is a meaningful part of your revenue, this is worth a 15-minute conversation. [Phone]

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 9 (cold call attempt)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been reaching out about medical practice payment processing — specifically around HSA/FSA card rates and patient co-pay optimization. I know your schedule is tight. Just a 5-minute call — I can tell you quickly whether your current setup is costing you more than it should. [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → qualify on HSA/FSA volume and current processor. Voicemail → drop voicemail. No answer → exit sequence.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 9 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Quick note about medical office processing — HSA and FSA cards usually cost more than they should. We fix that. Call me at [Phone] when you have 5 minutes.",
        ghlNote: "GHL Action: Voicemail Drop → medical SDR outbound voicemail. Exit sequence after this step.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL SDR COLD — MED SPA
  // ─────────────────────────────────────────────────────────────
  {
    id: "cold-outbound-medspa",
    name: "SDR: Cold Outbound — Med Spa",
    category: "sdr_cold_outbound",
    triggerConditions: "Cold outbound to med spas, aesthetic clinics, laser clinics, cosmetic surgery practices. No prior contact. GHL trigger: Contact tag = LB-COLD-MEDSPA OR business_type = medspa.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1 AM",
        subject: "Processing for high-value bookings — are you protected?",
        body: `Hi {{contact.firstName}},

Med spas deal with something most retailers don't: high-value bookings that carry no-show risk. Botox, filler, laser, and body contouring appointments can run $500–$3,000+, and if a client no-shows, you've lost not just revenue but also supplies and staff time.

Two things worth knowing:
1. No-show deposits processed correctly can be held and applied to the booking — or forfeited per your cancellation policy. How you process and describe this transaction matters for chargeback protection.
2. Pre-authorization holds for deposits need to be set up correctly or they drop off before the appointment date.

Liberty Bancard has helped med spas structure their processing to reduce chargeback exposure on high-value bookings. Want to talk through your current setup?

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "call",
        delayDescription: "Day 1 +2h",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] with Liberty Bancard — I emailed you this morning about payment processing for your med spa. Specifically about chargeback protection on high-value bookings — Botox, filler, laser, body contouring — where a no-show or a results dispute can turn into a chargeback if your setup isn't airtight. We've worked with aesthetic clinics to structure their processing so they're protected. Happy to do a free review of your current setup — 15 minutes. Call or text me at [Phone] or book at [Calendar Link]. Thanks.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call. Branch: Answered → Inbound Nurture. Voicemail → Step 2b.",
      },
      {
        stepNumber: 3,
        channel: "voicemail_drop",
        delayDescription: "Day 1 +2h (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Called about chargeback protection for med spa bookings — no-show fees and pre-authorization deposits. Wrong setup creates real exposure. Free review, 15 minutes. [Phone] or [Calendar Link]. Thanks.",
        ghlNote: "Voicemail Drop → medspa voicemail 1 audio. Trigger Step 2c SMS immediately.",
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 1 +5min (if voicemail)",
        body: "{{contact.firstName}}, [SDR Name] from Liberty Bancard — just left a voicemail. We help med spas reduce chargeback risk on high-value bookings. No-show fees, pre-auth, deposit handling — all covered. Free review: [Calendar Link]. Reply STOP to opt out.",
      },
      {
        stepNumber: 5,
        channel: "email",
        delayDescription: "Day 3",
        subject: "The no-show deposit mistake most med spas make",
        body: `Hi {{contact.firstName}},

When a client no-shows a $600 filler appointment and disputes the deposit charge, here's what usually happens:

The card brand investigates. They look at: (1) whether the cancellation policy was clearly disclosed at booking, (2) whether the cardholder signed or clicked to confirm they understood the policy, and (3) whether the charge description matches the cancellation policy language.

Most med spas lose these disputes — not because their policy is wrong, but because their checkout flow doesn't capture the right documentation.

Liberty Bancard has helped aesthetic practices update their booking and payment flow to pass card brand scrutiny. It's a process fix, not a technology overhaul.

Want to walk through your current setup?

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "Day 5",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard again. Quick follow-up — I've sent a couple of emails about chargeback protection for your med spa. I'll be straight with you: most aesthetic practices we review have at least one gap in their booking deposit or cancellation documentation that creates chargeback exposure. The fix is usually pretty simple. Worth 15 minutes to check. Call me at [Phone] or book at [Calendar Link].",
        callMode: "statement_chase",
        ghlNote: "GHL Action: Outbound Call. Branch: Answered → Inbound Nurture. Voicemail → Step 4b.",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name], Liberty Bancard. Following up on medspa processing — specifically deposit and cancellation documentation for chargeback protection. Free 15-minute review. [Phone] or [Calendar Link]. Talk soon.",
        ghlNote: "Voicemail Drop → medspa voicemail 2. Trigger Step 4c SMS.",
      },
      {
        stepNumber: 8,
        channel: "sms",
        delayDescription: "Day 5 +5min (if voicemail)",
        body: "{{contact.firstName}}, [SDR Name] at Liberty Bancard. Med spa chargebacks on no-show fees are avoidable with the right setup. Free review: [Calendar Link]. Reply STOP to opt out.",
      },
      {
        stepNumber: 9,
        channel: "email",
        delayDescription: "Day 7",
        subject: "How a Miami med spa eliminated chargeback losses on aesthetic bookings",
        body: `Hi {{contact.firstName}},

A med spa in Miami was averaging 3–4 chargebacks per month on high-value bookings — mostly "services not as described" disputes on filler and laser treatments, plus no-show fee disputes.

After working with Liberty Bancard, two things changed:

1. Booking flow update: Added a compliant pre-authorization disclosure and a required checkbox confirmation at booking. Disputes dropped by 80% in the first quarter because the card brands couldn't rule in the cardholder's favor.

2. Transaction descriptions: Changed how the charge appeared on the cardholder's statement — from a generic practice name to a specific service + date description. Reduced "don't recognize this charge" disputes.

Total monthly chargeback loss before: ~$2,200. After: ~$400.

If you want to walk through your current setup, I can usually spot the gaps in 15 minutes.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 10,
        channel: "call",
        delayDescription: "Day 10",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name], Liberty Bancard. Last call from me. I know you've got a full schedule. If you ever want a free look at your chargeback exposure on aesthetic bookings — no cost, no pressure — I'm at [Phone]. Best of luck with the business.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Outbound Call. Branch: Answered → Inbound Nurture. Voicemail → Step 6b.",
      },
      {
        stepNumber: 11,
        channel: "voicemail_drop",
        delayDescription: "Day 10 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name], Liberty Bancard. Last message — if you ever want a free chargeback risk review for your med spa, call [Phone]. Take care.",
        ghlNote: "Voicemail Drop → medspa final voicemail. Trigger Step 6c SMS.",
      },
      {
        stepNumber: 12,
        channel: "sms",
        delayDescription: "Day 10 +5min (if voicemail)",
        body: "{{contact.firstName}}, last one from [SDR Name] at Liberty Bancard. Free medspa chargeback review whenever you need it. [Phone]. Reply STOP to opt out.",
      },
      {
        stepNumber: 13,
        channel: "email",
        delayDescription: "Day 14",
        subject: "Closing the loop — here when you need it",
        body: `Hi {{contact.firstName}},

I've reached out a few times about chargeback protection and processing setup for your med spa. I don't want to keep showing up in your inbox if the timing isn't right.

Closing this out. If anything changes — new processor questions, chargeback issues, looking to benchmark your rates — feel free to reach out directly.

Liberty Bancard | [Phone] | [Calendar Link]

— [SDR Name]`,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL SDR COLD — DENTAL
  // ─────────────────────────────────────────────────────────────
  {
    id: "cold-outbound-dental",
    name: "SDR: Cold Outbound — Dental",
    category: "sdr_cold_outbound",
    triggerConditions: "Cold outbound to dental offices, dental groups, orthodontic practices. No prior contact. GHL trigger: Contact tag = LB-COLD-DENTAL OR imported with business_type = dental.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1 AM",
        subject: "Payment processing for dental offices — three things worth checking",
        body: `Hi {{contact.firstName}},

Three things dental practices often don't realize about their payment processing:

1. In-house payment plans: If you offer payment plans for large procedures (Invisalign, implants, crowns), how you set up recurring billing affects both your compliance and your chargeback exposure.

2. HIPAA compliance on payment pages: If patients pay online, your payment gateway needs to be HIPAA-compliant. Not all are.

3. FSA/HSA card acceptance: Dental expenses are HSA/FSA-eligible. If your terminal isn't coded correctly, some transactions get declined — and the patient blames your office.

Liberty Bancard handles all three. Want a free review of your current setup?

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "call",
        delayDescription: "Day 1 +2h",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] with Liberty Bancard. I sent you an email this morning about payment processing for dental practices. Three things that dental offices often miss: HSA and FSA card acceptance coding, HIPAA-compliant online payment pages, and proper setup for in-house payment plans on larger procedures. Any one of those can cost you patients or expose you to chargebacks. I'd love to do a free review of your current setup — takes about 15 minutes. Give me a call at [Phone] or book at [Calendar Link]. Thanks.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → move to Inbound Nurture. Voicemail → Step 2b.",
      },
      {
        stepNumber: 3,
        channel: "voicemail_drop",
        delayDescription: "Day 1 +2h (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Calling about payment processing for your dental practice — specifically HSA/FSA card acceptance and HIPAA-compliant payment pages. Free 15-minute review. Call back at [Phone] or book at [Calendar Link]. Thanks.",
        ghlNote: "GHL Action: Voicemail Drop → dental voicemail 1 audio. Trigger Step 2c SMS.",
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 1 +5min (if voicemail)",
        body: "{{contact.firstName}}, [SDR Name] from Liberty Bancard — just left a voicemail. We help dental offices with HSA/FSA card acceptance, online payment compliance, and in-house plan setup. Free review. [Calendar Link]. Reply STOP to opt out.",
      },
      {
        stepNumber: 5,
        channel: "email",
        delayDescription: "Day 3",
        subject: "HSA/FSA card declines — is your terminal coded correctly?",
        body: `Hi {{contact.firstName}},

One of the most common complaints we hear from dental patients: their HSA or FSA card got declined at the office.

This almost always comes down to MCC (merchant category code) setup. If your terminal or payment gateway isn't coded as a dental or healthcare merchant, HSA/FSA cards decline even when the balance is there. The patient blames your staff. It creates friction at checkout and can cost you reviews.

Liberty Bancard verifies MCC coding as part of every dental account setup and reviews existing setups during our free analysis.

Want us to check yours? [Calendar Link] or reply to this email.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "Day 5",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Quick follow-up on the emails I sent about dental practice payment processing. I'll be direct — most dental offices we analyze find 2 or 3 things that are costing them money or creating compliance risk. It's a free 15-minute review. If there's nothing wrong, great — you'll know for sure. Call me at [Phone] or book at [Calendar Link].",
        callMode: "statement_chase",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → Inbound Nurture. Voicemail → Step 4b.",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name], Liberty Bancard. Following up on dental practice payment processing — just want to make sure your HSA/FSA setup and online payments are airtight. Free review. [Phone] or [Calendar Link]. Thanks.",
        ghlNote: "Voicemail Drop → dental voicemail 2. Trigger Step 4c SMS.",
      },
      {
        stepNumber: 8,
        channel: "sms",
        delayDescription: "Day 5 +5min (if voicemail)",
        body: "{{contact.firstName}}, [SDR Name] from Liberty Bancard. Dental practices lose patients when HSA/FSA cards decline at checkout. We fix that. Free review: [Calendar Link]. Reply STOP to opt out.",
      },
      {
        stepNumber: 9,
        channel: "email",
        delayDescription: "Day 7",
        subject: "In-house payment plans and chargeback risk — what dental offices need to know",
        body: `Hi {{contact.firstName}},

If your practice offers in-house payment plans for implants, Invisalign, or other large procedures, here's what matters for chargeback protection:

1. Authorization language at signing: Your payment plan agreement needs specific Visa/Mastercard-approved language or the recurring charges are disputable. Most dental offices don't know their agreement language is insufficient until they get their first chargeback.

2. Recurring billing setup: Charging a card on file requires specific cardholder consent documentation. If your front desk is manually running the card each month without a signed recurring authorization, you're exposed.

3. Returned payment handling: What happens when a payment plan installment fails? How you notify the patient and retry the charge matters for your chargeback ratio.

Liberty Bancard includes a dental-specific payment plan compliance review at no additional cost. If you offer in-house financing, it's worth 15 minutes.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 10,
        channel: "call",
        delayDescription: "Day 10",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name], Liberty Bancard. Last outreach from me for a while. I know you're busy running a practice — I just want to make sure you're not losing money on HSA card declines or sitting on any compliance risk with your payment setup. If you ever want the free review, I'm at [Phone]. Thanks for your time.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Outbound Call. Branch: Answered → Inbound Nurture. Voicemail → Step 6b.",
      },
      {
        stepNumber: 11,
        channel: "voicemail_drop",
        delayDescription: "Day 10 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name], Liberty Bancard. Last message — if you ever want a free review of your dental practice payment setup, I'm at [Phone]. Take care.",
        ghlNote: "Voicemail Drop → dental final voicemail. Trigger Step 6c SMS.",
      },
      {
        stepNumber: 12,
        channel: "sms",
        delayDescription: "Day 10 +5min (if voicemail)",
        body: "{{contact.firstName}}, last one from [SDR Name] at Liberty Bancard. Free dental payment processing review whenever you're ready. [Phone]. Reply STOP to opt out.",
      },
      {
        stepNumber: 13,
        channel: "email",
        delayDescription: "Day 14",
        subject: "Closing the loop on your practice's payment setup",
        body: `Hi {{contact.firstName}},

I've reached out several times — I don't want to keep cluttering your inbox if the timing isn't right.

Closing this one out. If you ever want a free review of your processing costs, HSA/FSA setup, or in-house payment plan compliance, feel free to reach out directly.

Liberty Bancard | [Phone] | [Calendar Link]

— [SDR Name]`,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL SDR COLD — AUTO REPAIR
  // ─────────────────────────────────────────────────────────────
  {
    id: "cold-outbound-auto-repair",
    name: "SDR: Cold Outbound — Auto Repair",
    category: "sdr_cold_outbound",
    triggerConditions: "Cold outbound to auto repair shops, tire shops, body shops, oil change shops. No prior contact. GHL trigger: Contact tag added = LB-COLD-AUTO-REPAIR OR contact enrolled via Sunbiz/Outscraper import with business_type = auto_repair.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1 AM",
        subject: "Auto repair processing — what's your effective rate on large tickets?",
        body: `Hi {{contact.firstName}},

For auto repair shops, the biggest processing cost driver is usually large tickets — $500–$3,000+ per job. At a 2.5% rate, a $1,500 repair nets you $37.50 in processing fees alone.

Two things most repair shops don't know:

1. Card-present optimization: If the card is tapped or swiped at your terminal, you qualify for lower interchange rates. If your setup isn't capturing this correctly, you're paying more than you should.

2. Commercial card handling: When a business owner brings in a fleet vehicle and uses a commercial card, those transactions cost more. There are ways to offset that cost through surcharging programs designed for auto shops.

Want a free look at your statement? We'll show you what you're actually paying and what's available.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "call",
        delayDescription: "Day 1 +2h",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] with Liberty Bancard — I sent you a quick email this morning about processing costs for auto repair shops. On large tickets — $500, $1,500, $2,500+ — most shops are paying more than they need to because of how interchange is set up. We do a free 24-hour analysis, just need a recent statement. Happy to walk through what we find. Give me a call back at [Phone] or book online at [Calendar Link]. Thanks.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task → assign to SDR. Branch: Answered → go to Step 3 email. Voicemail → go to Step 2b voicemail drop.",
      },
      {
        stepNumber: 3,
        channel: "voicemail_drop",
        delayDescription: "Day 1 +2h (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, this is [SDR Name] from Liberty Bancard. Just tried you — calling about your processing costs on large repair tickets. Most auto shops we analyze save $800–$1,600 a month. Free review, 24 hours, just need a statement. Call me back at [Phone] or book at [Calendar Link]. Thanks.",
        ghlNote: "GHL Action: Voicemail Drop → select pre-recorded auto repair voicemail audio. Immediately trigger Step 2c SMS.",
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 1 +5min (if voicemail)",
        body: "{{contact.firstName}}, just left you a voicemail — [SDR Name] from Liberty Bancard. We help auto shops cut processing costs on large-ticket repairs. Free analysis, 24 hrs. Book here: [Calendar Link]. Reply STOP to opt out.",
        ghlNote: "GHL Action: Send SMS. Set 5-minute wait after voicemail drop.",
      },
      {
        stepNumber: 5,
        channel: "email",
        delayDescription: "Day 3",
        subject: "The two processing costs hitting auto shops hardest right now",
        body: `Hi {{contact.firstName}},

Two line items that consistently cost auto shops the most:

1. Commercial card interchange — When a business owner or fleet account pays with a corporate card, interchange is higher (sometimes 0.5–0.8% more than a standard consumer card). Most processors don't tell you this. There are surcharging programs specifically designed for shops that handle fleet business.

2. Keyed transactions — Any repair order taken over the phone or billed remotely costs more to process than a card-present swipe. If you're doing $20–30K/month in keyed orders, that gap adds up.

Want to see exactly how these show up on your statement? I can turn a review around in 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "Day 5",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] again from Liberty Bancard — following up on the email I sent about your processing costs. I know you're busy, I'll keep it short — if you run $100K a month or more through your terminals, there's a real chance we can save you $1,000–$2,000 a month. Doesn't cost anything to find out. Call me at [Phone] or grab a time at [Calendar Link]. Thanks.",
        callMode: "statement_chase",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → remove from sequence, move to V-Auto Inbound Nurture. Voicemail → Step 4b.",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name], Liberty Bancard. Third try — I'll make this the last one for a bit. We help auto shops cut processing costs on large tickets and fleet cards. Free review. [Phone] or [Calendar Link]. Talk soon.",
        ghlNote: "GHL Action: Voicemail Drop → auto repair voicemail 2 audio. Trigger Step 4c SMS immediately.",
      },
      {
        stepNumber: 8,
        channel: "sms",
        delayDescription: "Day 5 +5min (if voicemail)",
        body: "{{contact.firstName}}, [SDR Name] from Liberty Bancard again. If your repair shop does $100K+/month in card volume, there's money being left on the table. Free analysis. [Calendar Link]. Reply STOP to opt out.",
      },
      {
        stepNumber: 9,
        channel: "email",
        delayDescription: "Day 7",
        subject: "How an Orlando auto shop dropped their effective rate from 2.8% to 1.9%",
        body: `Hi {{contact.firstName}},

Quick case example:

A 3-bay auto repair shop in Orlando was processing about $180K/month. Effective rate: 2.8%. After our review, we found they had two problems: all fleet card transactions were being processed at retail interchange (wrong MCC classification), and they were paying a monthly equipment lease fee on a terminal they owned outright.

After switching to Liberty Bancard: effective rate dropped to 1.9%. Fleet cards routed correctly. Equipment lease fee eliminated. Monthly savings: around $1,620.

If you want to see what's on your statement, I'm happy to run the same analysis for your shop. Just send it over and I'll have results in 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 10,
        channel: "call",
        delayDescription: "Day 10",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] from Liberty Bancard. Last call from me — I've reached out a few times about your processing costs. If the timing isn't right, no problem at all. If you do want to see what we find on a statement review — $0 cost, no obligation — I'm at [Phone]. Hope business is going well.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → move to Inbound Nurture. Voicemail → Step 6b.",
      },
      {
        stepNumber: 11,
        channel: "voicemail_drop",
        delayDescription: "Day 10 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name], Liberty Bancard. Last message — if the timing ever works out, we do free statement reviews for auto shops and have helped shops in your area save real money. [Phone]. Take care.",
        ghlNote: "GHL Action: Voicemail Drop → auto repair final voicemail audio. Trigger Step 6c SMS.",
      },
      {
        stepNumber: 12,
        channel: "sms",
        delayDescription: "Day 10 +5min (if voicemail)",
        body: "{{contact.firstName}}, last one from [SDR Name] at Liberty Bancard. If you ever want a free review of your processing costs, I'm here. [Phone]. Reply STOP to opt out.",
      },
      {
        stepNumber: 13,
        channel: "email",
        delayDescription: "Day 14",
        subject: "Closing the loop — free to reach out anytime",
        body: `Hi {{contact.firstName}},

I've reached out a few times about payment processing for your shop — I don't want to keep pinging you if the timing isn't right.

I'll close this one out. If you ever want a free statement review — no cost, no commitment — you know where to find me.

Liberty Bancard | [Phone] | [Calendar Link]

— [SDR Name]`,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL SDR COLD — CONSTRUCTION
  // ─────────────────────────────────────────────────────────────
  {
    id: "cold-outbound-construction",
    name: "SDR: Cold Outbound — Construction",
    category: "sdr_cold_outbound",
    triggerConditions: "Cold outbound to FL general contractors, remodelers, roofing, HVAC, plumbing, electrical, and specialty trades. No prior contact. GHL trigger: Contact tag = LB-COLD-CONSTRUCTION OR business_type = construction/contractor/trades.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 0 AM",
        subject: "Liberty Bancard × {{companyName}} — cut job-cost fees",
        body: `Hi {{contact.firstName}},

We work with Florida contractors and trades on card processing costs — especially on large job invoices and subcontractor payments.

3 things we typically find:
1. Overpriced processing on high-ticket project payments
2. No text-to-pay or virtual terminal for remote invoice collection
3. Hidden fees buried in monthly statements

Free 10-minute statement review — usually uncovers $300–$800/month for FL contractors.

— [SDR Name]
Liberty Bancard | [Phone] | [Calendar Link]`,
      },
      {
        stepNumber: 2,
        channel: "call",
        delayDescription: "Day 1 AM",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] with Liberty Bancard. We work with Florida contractors to reduce card processing costs on large job payments — do you have a couple minutes? I can send you a link to upload your latest statement and we'll have a full savings breakdown in 24 hours.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task → assign to SDR. Branch: Answered → Inbound Nurture. Voicemail → Step 2b voicemail drop.",
      },
      {
        stepNumber: 3,
        channel: "voicemail_drop",
        delayDescription: "Day 1 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] here with Liberty Bancard. We help Florida contractors cut card processing fees on big job payments — usually $300–$800 a month. I'll send you an email — or give me a ring back. Talk soon.",
        ghlNote: "Voicemail Drop → construction voicemail 1 audio. Trigger Step 3 SMS immediately.",
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 1 +5min (if voicemail)",
        body: "{{contact.firstName}}, [SDR Name] from Liberty Bancard — just left a voicemail. We help FL contractors cut processing fees on job payments. Free review: [Calendar Link]. Reply STOP to opt out.",
      },
      {
        stepNumber: 5,
        channel: "email",
        delayDescription: "Day 3",
        subject: "{{contact.firstName}}, how a similar contractor saved $600/month",
        body: `Hi {{contact.firstName}},

A Florida contractor came to us overpaying on processing. After switching:

- Effective rate dropped significantly on high-ticket project invoices
- Text-to-pay cut collection time from 14 days to under 3 days
- Chargebacks cut in half with improved deposit and lien waiver workflows

Want to see what your numbers look like?

— [SDR Name]
Liberty Bancard | [Phone] | [Calendar Link]`,
      },
      {
        stepNumber: 6,
        channel: "call",
        delayDescription: "Day 5",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on the free statement review — did you get my emails? Most FL contractors we review are overpaying on large job payments. Takes 10 minutes to find out. Call me at [Phone] or grab a time at [Calendar Link].",
        callMode: "statement_chase",
        ghlNote: "GHL Action: Outbound Call. Branch: Answered → Inbound Nurture. Voicemail → Step 5b.",
      },
      {
        stepNumber: 7,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] with Liberty Bancard — following up on reducing processing fees for your job payments. Free review, 10 minutes. [Phone] or [Calendar Link]. Thanks.",
        ghlNote: "Voicemail Drop → construction voicemail 2. Trigger Step 5c SMS.",
      },
      {
        stepNumber: 8,
        channel: "sms",
        delayDescription: "Day 5 +5min (if voicemail)",
        body: "{{contact.firstName}}, [SDR Name] at Liberty Bancard. FL surcharging can eliminate credit card processing costs on job invoices entirely. Free 10-min review: [Calendar Link]. Reply STOP to opt out.",
      },
      {
        stepNumber: 9,
        channel: "email",
        delayDescription: "Day 7",
        subject: "FL surcharging for contractors, {{contact.firstName}}",
        body: `Hi {{contact.firstName}},

Florida allows surcharging on credit cards (not debit). For contractors running high-ticket job invoices, this can eliminate processing costs entirely on credit transactions.

We set this up correctly — compliant signage, dual-pricing at the terminal, zero compliance risk.

Worth 10 minutes to find out what you could save?

— [SDR Name]
Liberty Bancard | [Phone] | [Calendar Link]`,
      },
      {
        stepNumber: 10,
        channel: "call",
        delayDescription: "Day 10",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard — last follow-up on the free statement review. If the timing's not right, no worries. But if you want to see if you're overpaying on job payments, give me a ring or check your email. Thanks.",
        callMode: "breakup",
        ghlNote: "GHL Action: Outbound Call. Branch: Answered → Inbound Nurture. Voicemail → Step 8b.",
      },
      {
        stepNumber: 11,
        channel: "voicemail_drop",
        delayDescription: "Day 10 (if voicemail)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, this is [SDR Name] with Liberty Bancard — one more check-in about the free processing review. If the timing's not right, no worries. But if you want to see if you're overpaying on job payments, give me a ring or check your email. Thanks.",
        ghlNote: "Final voicemail drop. Trigger break-up SMS.",
      },
      {
        stepNumber: 12,
        channel: "email",
        delayDescription: "Day 14",
        subject: "{{contact.firstName}} — closing the file on {{companyName}}",
        body: `Hi {{contact.firstName}},

I'll keep this short — this is my last outreach.

If you ever want a free review of your processing costs, we're here. Most FL contractors we work with save $300–$800/month on job-cost payments.

No pressure. If your setup is solid, we'll tell you that too.

Liberty Bancard | [Phone] | [Calendar Link]

— [SDR Name]`,
      },
      {
        stepNumber: 13,
        channel: "sms",
        delayDescription: "Day 14 +5min",
        body: "{{contact.firstName}}, last message from Liberty Bancard — no pressure at all. If you ever want that free review: [Calendar Link] — [SDR Name]. Reply STOP to opt out.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL — MEDICAL: INBOUND + OPS
  // ─────────────────────────────────────────────────────────────
  {
    id: "v-medical-inbound-nurture",
    name: "V-Medical: Inbound Lead Nurture",
    category: "inbound",
    triggerConditions: "Medical or healthcare merchant responds to outbound or submits a form. Enrolled after first response or form submission. Does not yet have a statement on file.",
    usesConversationAI: true,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Immediately upon enrollment",
        subject: "Your medical practice payment review — what we'll look at",
        body: `Hi {{contact.firstName}},

Thanks for reaching out. For medical practices, our review covers areas that most general processors don't address:

- Effective rate on patient payments vs. your quoted rate
- HSA/FSA card acceptance and proper coding
- HIPAA-compliant payment page setup (required for online payments)
- Recurring/installment billing for large procedures — authorization language and chargeback exposure
- Monthly fees: PCI, statement, batch fees

Send your most recent merchant statement to [email] and we'll have the full analysis back within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "4 hours after email",
        body: `{{contact.firstName}}, ready to run your medical practice processing review whenever you send the statement. Any questions in the meantime? [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 3 if no statement received",
        subject: "Still here when you're ready",
        body: `Hi {{contact.firstName}},

Just checking in — happy to run the statement analysis whenever you're ready to send it.

If you'd rather talk first, I'm at [Phone] and can walk through what we'd look at and whether it makes sense for your practice.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 5 (intro qualification call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. You inquired about reviewing your medical practice processing costs and I wanted to personally follow up. Even without the statement, I can ask a few quick questions — HSA/FSA volume, whether you're processing online patient payments, and what you're currently paying — to tell you quickly if there's likely savings here. Takes 5 minutes. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → pre-qualify on practice type and volume. Voicemail → drop voicemail. No answer → wait 3 days, exit.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on your medical practice processing review. Happy to do a quick pre-qualification call — 5 minutes — before you need to send anything. Call me at [Phone].",
        ghlNote: "GHL Action: Voicemail Drop → medical inbound nurture voicemail. Trigger SMS follow-up after drop.",
      },
    ],
  },
  {
    id: "v-medical-account-ops",
    name: "V-Medical: Account Management Ops",
    category: "operations",
    triggerConditions: "Active Liberty Bancard medical practice merchant. Quarterly account review touchpoint, or triggered when annual PCI assessment is due.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Quarterly (or at PCI renewal date)",
        subject: "Quarterly review — your medical practice account",
        body: `Hi {{contact.firstName}},

Time for your quarterly account review. For your practice, I'll be looking at:

- Processing volume trends and effective rate
- PCI compliance status (annual SAQ renewal)
- Any new programs relevant to medical billing (HSA/FSA updates, recurring billing improvements)
- Support issues or pending questions

I'll reach out to schedule 15 minutes. If you have anything specific you want to address, reply here.

— [Account Manager Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "3 days after email if no response",
        body: `{{contact.firstName}}, following up on your quarterly account review for your practice. When works for a quick 15-minute call? [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "call",
        delayDescription: "Day 14 (human touch dial — nurture)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [Account Manager Name] with Liberty Bancard. Doing your quarterly account touchpoint — want to check in on PCI compliance renewal, any HSA/FSA card acceptance issues, and whether your current effective rate is still where we want it. Just give me a call back at [Phone] when you have 15 minutes.",
        callMode: "appointment_reminder",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for ops/nurture sequences. If answered → schedule account review.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL — MED SPA: INBOUND + OPS
  // ─────────────────────────────────────────────────────────────
  {
    id: "v-medspa-inbound-nurture",
    name: "SDR: Cold Outbound — Med Spa (Inbound Lead Nurture)",
    category: "inbound",
    triggerConditions: "Med spa, aesthetic clinic, or cosmetic surgery merchant responds to outbound or submits a form. Enrolled after first response. No statement on file yet.",
    usesConversationAI: true,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Immediately upon enrollment",
        subject: "Your med spa processing review — what to expect",
        body: `Hi {{contact.firstName}},

Thanks for connecting. For med spas and aesthetic practices, our review specifically covers:

- Effective rate on high-value appointment payments
- No-show deposit processing — how you currently handle holds and forfeiture, and your chargeback exposure
- Recurring billing for treatment packages or memberships
- Pre-authorization setup for large bookings
- Monthly fees you may not have noticed (PCI, statement, batch)

Send your most recent merchant statement to [email] and we'll have the full analysis back within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "4 hours after email",
        body: `{{contact.firstName}}, ready to run your practice's processing review. Send the statement when ready or call me at [Phone] to talk through it first. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 3 if no statement received",
        subject: "Check-in on your statement review",
        body: `Hi {{contact.firstName}},

Following up — no statement needed right away if you'd prefer to talk through your current setup first. Happy to do that by phone.

[Phone] | [Email]

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 5 (intro qualification call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. You reached out about your practice's processing costs and I wanted to personally follow up. For med spas, the biggest areas we look at are high-value appointment payments, no-show deposit handling, and chargeback exposure on large bookings. Even without the statement, I can give you a sense of whether there's an issue in about 5 minutes. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → qualify on booking values and no-show deposit setup. Voicemail → drop voicemail. No answer → wait 3 days, exit.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on your med spa processing inquiry — high-value bookings, no-show deposits, chargeback exposure. Five minute call could save you real money. [Phone].",
        ghlNote: "GHL Action: Voicemail Drop → medspa inbound nurture voicemail. Trigger SMS follow-up after drop.",
      },
    ],
  },
  {
    id: "v-medspa-account-ops",
    name: "SDR: Cold Outbound — Med Spa (Account Management Ops)",
    category: "operations",
    triggerConditions: "Active Liberty Bancard med spa or aesthetic clinic merchant. Quarterly account review or triggered by a chargeback event.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Quarterly (or after chargeback notification)",
        subject: "Quarterly review — your aesthetic practice account",
        body: `Hi {{contact.firstName}},

Time for your quarterly check-in. For your practice I'll be reviewing:

- Processing volume and effective rate
- Chargeback rate and any open disputes
- No-show deposit and cancellation policy language (if anything changed)
- New program options relevant to your bookings

Let me know when you have 15 minutes and I'll schedule the call.

— [Account Manager Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "3 days after email if no response",
        body: `{{contact.firstName}}, following up on your quarterly account review. 15 minutes when works for you? [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "call",
        delayDescription: "Day 14 (human touch dial — nurture)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [Account Manager Name] with Liberty Bancard. Calling on your aesthetic practice quarterly review — specifically want to look at chargeback rate, any disputes on high-value bookings, and whether your no-show deposit documentation has been updated. Give me a callback at [Phone] when you have 15 minutes.",
        callMode: "appointment_reminder",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for ops/nurture sequences. If answered → schedule quarterly review.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL — DENTAL: INBOUND + OPS
  // ─────────────────────────────────────────────────────────────
  {
    id: "v-dental-inbound-nurture",
    name: "SDR: Cold Outbound — Dental (Inbound Lead Nurture)",
    category: "inbound",
    triggerConditions: "Dental office, orthodontic practice, or dental group responds to outbound or submits a form. Enrolled after first response. No statement on file yet.",
    usesConversationAI: true,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Immediately upon enrollment",
        subject: "Your dental practice processing review — what we'll cover",
        body: `Hi {{contact.firstName}},

Thanks for reaching out. For dental practices, our review covers:

- Effective rate on patient payments vs. your quoted rate
- HSA/FSA card acceptance and proper terminal coding
- In-house payment plan setup — authorization language and recurring billing configuration
- HIPAA-compliant online payment setup
- Monthly fees that often get missed: PCI, batch, statement fees

Send your most recent merchant statement to [email] and we'll have the analysis back within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "4 hours after email",
        body: `{{contact.firstName}}, send your statement when ready and we'll run the dental practice cost analysis. Happy to talk through it first at [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 3 if no statement received",
        subject: "Still available when you're ready",
        body: `Hi {{contact.firstName}},

No rush on the statement — if you want to talk first and decide whether it's worth running the analysis, I'm at [Phone].

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 5 (intro qualification call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. You showed interest in reviewing your dental practice processing and I just wanted to personally reach out. For dental offices, the areas we look at are HSA/FSA card rates, in-house payment plan setup, and HIPAA-compliant online billing. Even without the statement I can tell you in 5 minutes if there's likely savings. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → qualify on patient payment mix and current processor. Voicemail → drop voicemail. No answer → wait 3 days, exit.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on your dental practice processing review — HSA/FSA rates, payment plans, HIPAA-compliant billing. Five minutes could tell you if you're overpaying. Call me at [Phone].",
        ghlNote: "GHL Action: Voicemail Drop → dental inbound nurture voicemail. Trigger SMS follow-up after drop.",
      },
    ],
  },
  {
    id: "v-dental-account-ops",
    name: "SDR: Cold Outbound — Dental (Account Management Ops)",
    category: "operations",
    triggerConditions: "Active Liberty Bancard dental practice merchant. Quarterly account review or triggered when in-house payment plan volume changes significantly.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Quarterly",
        subject: "Quarterly review — your dental practice account",
        body: `Hi {{contact.firstName}},

Quarterly check-in time. For your practice, I'll review:

- Processing volume and effective rate
- PCI compliance status (annual SAQ)
- In-house payment plan performance — failed payment rate, retry success
- HSA/FSA card acceptance — any declines or coding issues reported
- New programs or terminal upgrades available

Reach out to schedule 15 minutes when convenient.

— [Account Manager Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "3 days after email if no response",
        body: `{{contact.firstName}}, following up on your dental practice quarterly review. 15 minutes this week? [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "call",
        delayDescription: "Day 14 (human touch dial — nurture)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [Account Manager Name] from Liberty Bancard. Touching base on your dental practice quarterly review — want to go over PCI status, any HSA/FSA card acceptance issues, and check in on your in-house payment plan performance. Fifteen minutes whenever you have them. Callback at [Phone].",
        callMode: "appointment_reminder",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for ops/nurture sequences. If answered → schedule quarterly review.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // VERTICAL — AUTO REPAIR: INBOUND + OPS
  // ─────────────────────────────────────────────────────────────
  {
    id: "v-autorepair-inbound-nurture",
    name: "SDR: Cold Outbound — Auto Repair (Inbound Lead Nurture)",
    category: "inbound",
    triggerConditions: "Auto repair shop, tire shop, or body shop responds to outbound or submits a form. Enrolled after first response. No statement on file yet.",
    usesConversationAI: true,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Immediately upon enrollment",
        subject: "Your shop's processing review — what we'll look at",
        body: `Hi {{contact.firstName}},

Thanks for reaching out. For auto repair shops, our analysis focuses on:

- Effective rate on card-present vs. keyed/phone-in transactions
- Large-ticket interchange optimization ($500+ repairs)
- Commercial and fleet card handling
- Cash discount program potential (near-zero processing costs)
- Monthly fees: PCI, statement, batch fees

Send your most recent merchant statement to [email] and we'll have the full analysis back within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "4 hours after email",
        body: `{{contact.firstName}}, ready to run your shop's cost analysis. Send the statement when ready or call [Phone] to talk first. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 3 if no statement received",
        subject: "Check-in on your shop's processing review",
        body: `Hi {{contact.firstName}},

Just following up — no statement needed right away if you'd prefer to talk first. Call [Phone] any time.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 5 (intro qualification call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. You reached out about your shop's processing costs and I'm calling to personally follow up. For auto repair, the biggest wins are usually on large-ticket repair transactions — $500 to $2,000+ jobs — and fleet and commercial card handling. I can give you a ballpark of whether you're likely overpaying in just 5 minutes without the statement. Call me at [Phone].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → qualify on repair ticket size and fleet card volume. Voicemail → drop voicemail. No answer → wait 3 days, exit.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on your shop's processing review — large-ticket repair transactions and fleet cards are where most auto shops overpay. Five minutes with me could be worth hundreds per month. Call me at [Phone].",
        ghlNote: "GHL Action: Voicemail Drop → auto repair inbound nurture voicemail. Trigger SMS follow-up after drop.",
      },
    ],
  },
  {
    id: "v-autorepair-account-ops",
    name: "SDR: Cold Outbound — Auto Repair (Account Management Ops)",
    category: "operations",
    triggerConditions: "Active Liberty Bancard auto repair merchant. Quarterly account review touchpoint.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Quarterly",
        subject: "Quarterly review — your shop account",
        body: `Hi {{contact.firstName}},

Time for your quarterly check-in. I'll review:

- Processing volume and effective rate
- Large-ticket interchange performance
- Cash discount or surcharge program performance (if active)
- Fleet/commercial card costs
- Any new terminal options or software updates

Let me know when you have 15 minutes.

— [Account Manager Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "3 days after email if no response",
        body: `{{contact.firstName}}, quick quarterly check-in on your shop account. 15 minutes this week? [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "call",
        delayDescription: "Day 14 (human touch dial — nurture)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [Account Manager Name] here with Liberty Bancard. Quarterly check-in on your shop account — want to look at large-ticket processing performance, any commercial or fleet card costs, and whether a cash discount program makes sense for your volume this quarter. Give me a callback at [Phone] when you have 15 minutes.",
        callMode: "appointment_reminder",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for ops/nurture sequences. If answered → schedule quarterly review.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // EDUCATION SEQUENCES
  // ─────────────────────────────────────────────────────────────
  {
    id: "payment-stack-101",
    name: "2. Payment Stack 101 — Education",
    category: "education",
    triggerConditions: "New contact who is unfamiliar with payment processing terminology. Lead score <= 44. No specific pain point. SDR manually enrolls to build rapport and educate before pitching.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "How payment processing actually works (plain language)",
        body: `Hi {{contact.firstName}},

Before we talk about rates, it helps to understand how payment processing actually works. Here's the short version:

When a customer pays with a card, four parties are involved:
1. Your customer (the cardholder)
2. Their bank (the issuing bank)
3. The card network (Visa, Mastercard, etc.)
4. Your processor (Liberty Bancard or whoever you use)

The card network sets the base rate — called interchange. This rate is fixed by Visa/Mastercard and is the same no matter who your processor is.

Your processor adds their own fee on top of interchange. That's the only part that varies between processors.

Most merchants are quoted a single bundled rate (like 2.6% + $0.10). That rate includes interchange plus the processor's markup, all blended together. The problem: you can't see what's interchange (non-negotiable) and what's processor margin (negotiable).

Liberty Bancard uses interchange-plus pricing: we show you both numbers separately.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "Day 4",
        subject: "Why your 'rate' is probably not your actual rate",
        body: `Hi {{contact.firstName}},

Following up on payment processing 101.

Your "effective rate" is the real number: total fees divided by total volume for the month.

Example:
- Total processing volume: $80,000
- Total fees paid: $2,160
- Effective rate: 2.7%

Most merchants are quoted something like "2.3%+ $0.10" but pay an effective rate that's 0.3–0.6% higher when you factor in non-qualified fees, monthly fees, statement fees, and PCI compliance.

To find your effective rate: look at the last line of your statement — total fees. Divide by total volume. That's your real number.

If you want us to do it for you, send your statement and we'll run the calculation and comparison within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 8",
        subject: "The three pricing models — which one are you on?",
        body: `Hi {{contact.firstName}},

Three common ways processors price their services:

1. Flat rate (Square, Stripe): 2.6% + $0.10 on everything. Simple, but expensive for higher-volume merchants. Rewards card transactions cost more at interchange but you pay the same flat rate — the processor keeps the difference.

2. Tiered pricing: Transactions sorted into "qualified," "mid-qualified," and "non-qualified" buckets at different rates. The most opaque model — most merchants don't know which bucket their transactions fall into.

3. Interchange-plus: Interchange (set by Visa/Mastercard) plus a fixed markup. Most transparent. You see exactly what you're paying and why.

Liberty Bancard uses interchange-plus. If you're on tiered pricing and processing $30K+/month, there's almost certainly money to save by switching models.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 14 (human touch dial — nurture/education)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] with Liberty Bancard. I sent you a few emails about how payment processing pricing works — interchange-plus versus tiered versus flat rate. I just want to check in and see if you had any questions, and whether it would make sense to run a free analysis on your statement to see what pricing model you're actually on. Fifteen minutes is all it takes. Call me back at [Phone] when you have a moment.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for education/nurture sequences per cadence model. If answered → move to statement-audit sequence.",
      },
    ],
  },
  {
    id: "pci-security",
    name: "16. Security & PCI Compliance — Made Easy",
    category: "education",
    triggerConditions: "Contact expresses concern about data security, has had a breach, or SDR identifies PCI non-compliance during discovery. Also fires quarterly for existing merchants approaching annual PCI assessment.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "PCI compliance — what you actually need to do",
        body: `Hi {{contact.firstName}},

PCI DSS (Payment Card Industry Data Security Standard) compliance is required of every merchant who accepts credit cards. Here's what it actually means for a typical small to mid-size business:

What you must do:
- Complete a Self-Assessment Questionnaire (SAQ) annually. For most in-person merchants, this is SAQ B or SAQ C — 30–40 yes/no questions.
- Pass a quarterly network scan if you have an internet-facing IP address.
- Use a PCI-compliant terminal or payment software.

What you do NOT need to do (common misconceptions):
- You don't need to store cardholder data. Most modern processors handle this via tokenization.
- You don't need a full security audit unless you process millions of transactions annually.

The PCI compliance fee your processor charges ($9–$29/month) is supposed to cover access to the SAQ portal and breach protection insurance. If you're paying it but haven't completed your SAQ in the last 12 months, you're out of compliance — and that fee isn't protecting you.

Liberty Bancard walks every new merchant through the SAQ process at onboarding.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 3",
        body: `{{contact.firstName}}, have you completed your PCI compliance questionnaire in the last 12 months? If not, your business may be exposed. Happy to walk through what's required. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 7",
        subject: "What happens if you're not PCI compliant",
        body: `Hi {{contact.firstName}},

Non-compliance with PCI DSS can result in:
- Fines from the card brands: $5,000–$100,000 per month for ongoing non-compliance
- Loss of the ability to accept credit cards
- Liability for fraud losses if a breach occurs while non-compliant

Most small merchants don't realize this because their processor doesn't tell them. The non-compliance fee ($19–$49/month) that shows up on some statements is the processor charging you because you haven't completed the SAQ — not protecting you.

Liberty Bancard includes PCI guidance at onboarding and annual reminders. If you want to talk through your compliance status, [Phone].

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 14 (human touch dial — nurture/education)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] with Liberty Bancard. I sent you some info about PCI compliance for merchants — specifically what's actually required and what that monthly compliance fee on your statement is supposed to cover. I'd be happy to walk through your current compliance status and make sure you're protected. Just call me back at [Phone] when you have 15 minutes.",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for education/nurture sequences per cadence model. If answered → move to statement-audit sequence.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // POST-SALE & RECOVERY SEQUENCES
  // ─────────────────────────────────────────────────────────────
  {
    id: "post-call-review",
    name: "Post-Call Review Follow-Up",
    category: "sales",
    triggerConditions: "SDR completes a discovery or demo call with a prospect. Fires automatically when call disposition = 'Follow-Up Needed' or 'Interested' in GHL.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Within 1 hour of call ending",
        subject: "Good talking — here's what I noted",
        body: `Hi {{contact.firstName}},

Thanks for taking the time today. Here's a quick summary of what we covered:

[SDR: Edit this section after the call]
- Current processor: [Name]
- Monthly volume: $[Amount]
- Main pain points discussed: [List]
- Next step: [Statement review / Application / Call back on date]

[If statement review was agreed:]
Send your most recent merchant statement to [email] and I'll have the analysis back within 24 hours.

[If application was agreed:]
Your application link: [Link]

[If callback:]
I'll follow up on [Date] at [Time].

Any questions in the meantime, call me at [Phone].

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "2 hours after email",
        body: `{{contact.firstName}}, good talking today. Just sent a follow-up email with our next steps. Let me know if you have questions. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "call",
        delayDescription: "Day 3 (if no next step taken)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] with Liberty Bancard — we spoke a few days ago. I wanted to follow up and make sure you got the summary email and see if you have any questions about the next step. Whether that's sending your statement, getting started on the application, or scheduling another call — I'm ready to move whenever you are. Call me at [Phone].",
        callMode: "proposal_followup",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → update deal stage and remove from sequence. Voicemail → drop voicemail. No answer → wait 2 days, retry.",
      },
      {
        stepNumber: 4,
        channel: "voicemail_drop",
        delayDescription: "Day 3 (if voicemail on step 3)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Great talking with you the other day — just following up on our next step. Call me back at [Phone] or reply to my email. Thanks.",
        ghlNote: "GHL Action: Voicemail Drop → post-call follow-up audio. Trigger follow-up SMS 5 minutes after drop.",
      },
    ],
  },
  {
    id: "proposal-followup",
    name: "Proposal Follow-Up",
    category: "sales",
    triggerConditions: "SDR has sent a formal proposal or savings summary. Deal stage = 'Proposal Sent'. Fires automatically.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "24 hours after proposal sent",
        subject: "Re: Your Liberty Bancard proposal — questions?",
        body: `Hi {{contact.firstName}},

Just following up on the proposal I sent yesterday. Happy to walk through the numbers, answer questions about the transition process, or address any concerns.

The main question most merchants have at this point is about timing — how long the switch takes and how to minimize disruption. The short answer: most merchants are processing on Liberty Bancard within 5–7 business days of application, with overlap from their current processor until they're confident.

What would be most helpful as a next step?

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, did you get a chance to look at the proposal? Happy to answer questions by text or call. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 4",
        subject: "Still available if you want to talk through the proposal",
        body: `Hi {{contact.firstName}},

Following up one more time on the proposal. If something in it is unclear, or if there's a concern I haven't addressed, I'd like to know.

If the timing just isn't right, that's fine too — just let me know and I'll check in when it makes more sense.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "sms",
        delayDescription: "Day 7",
        body: `{{contact.firstName}}, last follow-up on the proposal. Ready when you are — just reply or call [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 5,
        channel: "call",
        delayDescription: "Day 5",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been following up on the proposal I sent — I just want to make sure you had a chance to look at the numbers and that I answered any questions. If something in the proposal doesn't look right or you need me to adjust any of the assumptions, I can do that quickly. Just call me at [Phone].",
        callMode: "proposal_followup",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → update deal stage, remove from sequence. Voicemail → drop voicemail, wait for response.",
      },
      {
        stepNumber: 6,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 5)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on the proposal — I want to make sure the numbers make sense and answer any questions you have. Call me back at [Phone]. Thanks.",
        ghlNote: "GHL Action: Voicemail Drop → proposal follow-up audio. Trigger SMS follow-up 5 minutes after drop.",
      },
    ],
  },
  {
    id: "no-show-reschedule",
    name: "No-Show Reschedule",
    category: "sales",
    triggerConditions: "Contact misses a scheduled call or demo. CRM disposition = 'No Show'. Fires within 15 minutes of missed appointment.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "sms",
        delayDescription: "15 minutes after missed appointment",
        body: `{{contact.firstName}}, this is [SDR Name] from Liberty Bancard. We had a call scheduled — looks like we missed each other. Happy to find another time. [Calendar Link] or call me back at [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "30 minutes after missed appointment",
        subject: "Missed our call — let's reschedule",
        body: `Hi {{contact.firstName}},

We had a call scheduled today and I wasn't able to reach you — no problem, things come up.

When you have 15 minutes, use this link to pick a time that works: [Calendar Link]

Or if you have questions you'd rather handle by email, I'm here too.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 3,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, still happy to connect whenever works for you. Book here: [Calendar Link] or call [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 4,
        channel: "email",
        delayDescription: "Day 4",
        subject: "One more try to connect",
        body: `Hi {{contact.firstName}},

Making one more attempt to connect. If you're still interested in reviewing your processing costs, book a time here: [Calendar Link]

If this isn't the right time, just reply and let me know and I'll follow up when it makes more sense.

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 5,
        channel: "call",
        delayDescription: "Day 5 (final dial attempt)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] here from Liberty Bancard. We had a call scheduled that we missed and I've tried to reconnect a few times. I don't want to keep reaching out if the timing is off — just wanted to try one more time. If you're still interested in going over your processing costs, book at [Calendar Link] or call me at [Phone]. If not, no hard feelings at all.",
        callMode: "appointment_reminder",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → book reschedule, remove from sequence. Voicemail → drop voicemail + exit sequence. No answer → exit sequence.",
      },
      {
        stepNumber: 6,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 5)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Last attempt to reconnect on our missed call. When the timing is right, book at [Calendar Link] or call [Phone]. Take care.",
        ghlNote: "GHL Action: Voicemail Drop → no-show recovery audio. Exit sequence after this step.",
      },
    ],
  },
  {
    id: "long-term-nurture",
    name: "Long-Term Nurture",
    category: "nurture",
    triggerConditions: "Contact went cold but was not disqualified. Lead score < 45, or previously active lead who said 'not now' or 'check back in X months.' Monthly cadence.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1 (first month)",
        subject: "Checking in — anything changed with your processing situation?",
        body: `Hi {{contact.firstName}},

Just touching base. A few months ago we talked about your payment processing costs but the timing wasn't quite right.

Has anything changed? Rate hikes, contract renewal coming up, frustrations with support?

If so, happy to revisit. If not, I'll check in again in a few months.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "Day 30 (second month)",
        subject: "Market update: processing rates in 2025",
        body: `Hi {{contact.firstName}},

Quick note — Visa and Mastercard both adjusted interchange rates in April 2025 (as they do annually). For most merchants, the net impact is minimal, but for some categories and transaction types it's meaningful.

If you want to know whether the adjustment affects your category and current setup, I can run a quick check on your statement. Just send it over.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 60 (third month)",
        subject: "Is your contract coming up for renewal soon?",
        body: `Hi {{contact.firstName}},

Most processor contracts are 1–3 years. If yours is coming up for renewal in the next 6 months, now is the right time to get a comparison — renewal is the easiest moment to switch, and processors often sneak in rate increases at renewal.

If you want to know what Liberty Bancard offers before you sign anything, send a statement and I'll have numbers for you within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 90 (human touch dial — nurture check-in)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] with Liberty Bancard. I know it's been a while — I've been sending you some emails over the past few months. I just wanted to personally reach out and see if anything has changed with your payment processing situation — rate increases, contract renewal coming up, or any frustrations with your current provider. If the timing is finally right, I'm ready to run the analysis. Call me at [Phone].",
        callMode: "reactivation",
        ghlNote: "GHL Action: Create Task for SDR to make outbound call. No voicemail for nurture sequences per cadence model. If answered → re-qualify and move to statement-audit sequence.",
      },
    ],
  },
  {
    id: "reactivation",
    name: "19. Reactivation — Cold Lead Revival",
    category: "reactivation",
    triggerConditions: "Contact was active 90+ days ago, went completely cold, and has not been in any active sequence. Lead score reset or dropped below 30. Last contact date > 90 days.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "email",
        delayDescription: "Day 1",
        subject: "Been a while — still overpaying on processing?",
        body: `Hi {{contact.firstName}},

It's been a few months since we last talked. Circling back to see if anything has changed with your payment processing situation.

A lot can shift in a few months — rate increases, contract renewals, new equipment needs, frustrations with your current provider's support.

If any of that rings true, I'd like to take another look at your numbers. If not, no problem — just let me know and I'll leave you alone.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 2,
        channel: "sms",
        delayDescription: "Day 3",
        body: `{{contact.firstName}}, [SDR Name] from Liberty Bancard. Checking back in — has anything changed with your processing since we last talked? [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 7",
        subject: "One more check-in",
        body: `Hi {{contact.firstName}},

Last check-in before I close this out. If now is the right time to look at your processing costs — or if there's anything I can answer — reply here or call [Phone].

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 10",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I reached out a few times — it's been a while since we talked. I genuinely don't know if things have changed on your end, but I'd hate to just disappear without trying one more time. If your processing situation has shifted — rate increase, contract up for renewal, anything — I'm a quick call away. [Phone]. If the timing still isn't right, no hard feelings.",
        callMode: "reactivation",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → re-qualify, move to statement-audit or inbound nurture sequence. Voicemail → drop voicemail, exit sequence after.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 10 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Last outreach from me for a while — if anything's changed with your processing, rate increases, or contract renewal, call me at [Phone]. Happy to take another look.",
        ghlNote: "GHL Action: Voicemail Drop → reactivation audio. Exit sequence after this step.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // SDR-SPECIFIC SEQUENCES
  // ─────────────────────────────────────────────────────────────
  {
    id: "sdr-reply-engaged",
    name: "SDR: Reply Engaged",
    category: "sdr_reply_engaged",
    triggerConditions: "Contact replies to any outbound sequence. GHL detects reply and enrolls immediately. This sequence handles the warm response and moves toward booking a call.",
    usesConversationAI: true,
    steps: [
      {
        stepNumber: 1,
        channel: "task",
        delayDescription: "Immediately upon reply",
        body: `PRIORITY ACTION: {{contact.firstName}} replied to your outreach. Review their reply in GHL inbox and respond personally within 15 minutes. Goal: book a call or get them to send a statement. Check reply content before calling.`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "30 minutes if no personal response was sent",
        subject: "Re: Your message",
        body: `Hi {{contact.firstName}},

Thanks for getting back to me. I want to make sure I respond properly to what you shared — I'll follow up personally within the next hour.

In the meantime, if it's easier to pick a time now: [Calendar Link]

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 3,
        channel: "call",
        delayDescription: "2 hours after email (if no SDR personal response yet)",
        body: "",
        callScript: "Hi {{contact.firstName}}, this is [SDR Name] from Liberty Bancard. You replied to one of our outreach messages and I wanted to reach out personally to follow up on what you shared. I'd love to book a quick call — about 15 minutes to understand your current setup and whether there's a real opportunity here. Are you free in the next hour? You can also book at [Calendar Link].",
        callMode: "intro_qualification",
        ghlNote: "GHL Action: Create Outbound Call task → assign to SDR. Branch: Answered → move to statement-audit or proposal sequence. Voicemail → drop voicemail. No answer → wait 4 hours, SDR follow-up.",
      },
      {
        stepNumber: 4,
        channel: "voicemail_drop",
        delayDescription: "2 hours (if voicemail on step 3)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] here from Liberty Bancard. You reached out and I want to make sure I respond properly. I'll try you again — or book a time at [Calendar Link]. Looking forward to talking.",
        ghlNote: "GHL Action: Voicemail Drop → reply engaged warm voicemail audio. SDR should personally follow up via email or SMS within 30 minutes.",
      },
    ],
  },
  {
    id: "sdr-statement-chase",
    name: "SDR: Statement Chase",
    category: "sdr_statement_chase",
    triggerConditions: "Merchant verbally agreed to send a statement but has not sent it in 48+ hours. SDR manually enrolls or automation fires when tag 'statement_pending' is older than 48 hours.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "sms",
        delayDescription: "48 hours after agreement",
        body: `{{contact.firstName}}, [SDR Name] here. Just following up — were you able to find your processor statement? Happy to help you locate it if you're having trouble. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "Day 3",
        subject: "Still waiting on your statement — here's how to find it",
        body: `Hi {{contact.firstName}},

Just following up on your statement. If you're having trouble locating it:

- Square: squareup.com → Account → Documents
- Stripe: dashboard.stripe.com → Reports → Monthly summary
- First Data / Fiserv: Ask your rep or check the merchant portal
- TSYS / Global Payments: Check your email for a PDF from "Merchant Services"
- Any processor: Call their merchant support line and ask them to email your most recent statement

Takes about 5 minutes. Once you send it, we'll have your analysis back within 24 hours.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 3,
        channel: "sms",
        delayDescription: "Day 5",
        body: `{{contact.firstName}}, last check on the statement — no rush, just don't want it to fall through the cracks. When you're ready, just reply or email it to [email]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 7 (final chase call)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I know you agreed to send your statement a week or so ago — I just wanted to personally reach out before closing this out. If you ran into trouble finding it, I can walk you through where to locate it — takes about 5 minutes. If the timing changed, no problem. Just call me at [Phone] and let me know either way.",
        callMode: "statement_chase",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → coach on statement location, re-book. Voicemail → drop voicemail. No answer → exit sequence after 2 more days.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 7 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Last follow-up on your statement. If you're having trouble finding it or the timing changed, just call me at [Phone]. Otherwise I'll follow up again in a week.",
        ghlNote: "GHL Action: Voicemail Drop → statement chase voicemail audio. Trigger SMS follow-up immediately after drop.",
      },
    ],
  },
  {
    id: "sdr-proposal-followup",
    name: "SDR: Proposal Follow-Up",
    category: "sdr_proposal_followup",
    triggerConditions: "SDR has sent a formal proposal. Tag 'proposal_sent' applied. Fires 24 hours after proposal sent if no response.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "sms",
        delayDescription: "24 hours after proposal sent",
        body: `{{contact.firstName}}, [SDR Name] from Liberty Bancard. Did you get a chance to look at the proposal? Happy to answer any questions. [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "Day 2",
        subject: "Quick question on the proposal",
        body: `Hi {{contact.firstName}},

Following up on the proposal I sent. The numbers should be straightforward but I want to make sure nothing's unclear.

Two most common questions I get at this stage:
1. How long does the switch take? (5–7 business days from application to live processing)
2. What happens to my current account? (Stays open until you've confirmed the new one is working)

Anything you'd like me to clarify?

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 3,
        channel: "email",
        delayDescription: "Day 5",
        subject: "Closing the loop on the proposal",
        body: `Hi {{contact.firstName}},

Last follow-up on the proposal. If you're ready to move forward, the application takes 10 minutes: [Application Link]

If the timing is off or you have concerns I haven't addressed, just reply and let me know.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 4,
        channel: "call",
        delayDescription: "Day 6",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. I've been following up on the proposal I sent last week. I want to make sure everything was clear — the numbers, the switch timeline, what happens with your current account. If there's any concern I haven't addressed, I can talk through it now. If you're ready to move forward, the application takes about 10 minutes. Give me a call at [Phone].",
        callMode: "proposal_followup",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → address objections, move to close. Voicemail → drop voicemail. No answer → wait 3 days, consider exit.",
      },
      {
        stepNumber: 5,
        channel: "voicemail_drop",
        delayDescription: "Day 6 (if voicemail on step 4)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Following up on the proposal — if you're ready or have questions, call me at [Phone]. Application takes 10 minutes when you're set to go.",
        ghlNote: "GHL Action: Voicemail Drop → SDR proposal follow-up audio. Trigger SMS confirmation 5 minutes after drop.",
      },
    ],
  },
  {
    id: "sdr-noshow-recovery",
    name: "SDR: No-Show Recovery",
    category: "sdr_noshow_recovery",
    triggerConditions: "SDR scheduled a call that the prospect did not attend. CRM disposition = 'No Show'. Fires within 15 minutes of missed appointment.",
    usesConversationAI: false,
    steps: [
      {
        stepNumber: 1,
        channel: "sms",
        delayDescription: "15 minutes after missed appointment",
        body: `{{contact.firstName}}, [SDR Name] from Liberty Bancard. We had a call today — missed each other. No problem. Want to reschedule? [Calendar Link] or call [Phone]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 2,
        channel: "email",
        delayDescription: "1 hour after missed appointment",
        subject: "We missed each other — pick a new time",
        body: `Hi {{contact.firstName}},

We had a call scheduled today and weren't able to connect. Happens to everyone.

When you have 15–20 minutes, pick a new time here: [Calendar Link]

Or if something specific came up and you'd like to reschedule manually, call me at [Phone].

— [SDR Name]
Liberty Bancard`,
      },
      {
        stepNumber: 3,
        channel: "sms",
        delayDescription: "Day 2",
        body: `{{contact.firstName}}, still want to connect and run your processing review. Grab a time that works: [Calendar Link]. Reply STOP to opt out.`,
      },
      {
        stepNumber: 4,
        channel: "email",
        delayDescription: "Day 4",
        subject: "Last attempt to reconnect",
        body: `Hi {{contact.firstName}},

Making one final attempt to reschedule our conversation. If you're still interested in reviewing your processing costs, book a time: [Calendar Link]

If not, no problem — just let me know and I'll stop reaching out.

— [SDR Name]
Liberty Bancard | [Phone]`,
      },
      {
        stepNumber: 5,
        channel: "call",
        delayDescription: "Day 5 (final dial)",
        body: "",
        callScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. We had a call that we missed and I've been trying to reconnect. I'm making one last attempt before I close this out. If you're still interested in reviewing your processing costs, book at [Calendar Link] or call me directly at [Phone]. If not, no hard feelings — I understand.",
        callMode: "appointment_reminder",
        ghlNote: "GHL Action: Create Outbound Call task. Branch: Answered → book reschedule, remove from sequence. Voicemail → drop voicemail + exit sequence. No answer → exit sequence.",
      },
      {
        stepNumber: 6,
        channel: "voicemail_drop",
        delayDescription: "Day 5 (if voicemail on step 5)",
        body: "",
        voicemailScript: "Hi {{contact.firstName}}, [SDR Name] from Liberty Bancard. Making one last attempt to reconnect after our missed call. When the timing is right, book at [Calendar Link] or call [Phone]. Take care.",
        ghlNote: "GHL Action: Voicemail Drop → SDR no-show recovery voicemail. Exit sequence after this step.",
      },
    ],
  },
];

export const CATEGORY_LABELS: Record<string, string> = {
  inbound: "Inbound & Confirmation",
  sales: "Core Sales",
  education: "Education",
  onboarding: "Onboarding",
  sdr: "SDR Vertical",
  sdr_cold_outbound: "Cold Outbound",
  sdr_reply_engaged: "Reply Engaged",
  sdr_statement_chase: "Statement Chase",
  sdr_proposal_followup: "SDR Proposal",
  sdr_noshow_recovery: "SDR No-Show Recovery",
  nurture: "Nurture",
  reactivation: "Reactivation",
  operations: "Account Ops",
  risk: "Risk & Compliance",
};
