# GHL Voice, Voicemail Drop & Auto-Dial Setup Guide
**Liberty Bancard AI Business Operating System**

This document covers every step to configure GoHighLevel for voice calls, voicemail drops, and auto-dial campaigns — fully aligned with the platform's AI SDR, vertical scripts, and compliance engine.

---

## TABLE OF CONTENTS

1. [Phone Number Setup](#1-phone-number-setup)
2. [Call Recording & Compliance](#2-call-recording--compliance)
3. [Inbound Call Flow (IVR)](#3-inbound-call-flow-ivr)
4. [Voicemail Drop Setup](#4-voicemail-drop-setup)
5. [Power Dialer (Manual Call Queue)](#5-power-dialer-manual-call-queue)
6. [Auto-Dial Workflows](#6-auto-dial-workflows)
7. [Voice AI / AI SDR Calling](#7-voice-ai--ai-sdr-calling)
8. [Call Scripts — Per Vertical](#8-call-scripts--per-vertical)
9. [Objection Handlers (Universal)](#9-objection-handlers-universal)
10. [Env Vars Required](#10-env-vars-required)

---

## 1. Phone Number Setup

### Step-by-Step

1. Go to **GHL → Settings → Phone Numbers → Add Number**
2. Choose **Local Number** — pick an area code that matches your primary market (South Florida = 305, 561, 786, 954)
3. Select **Voice + SMS** capability
4. Assign to your sub-account
5. Under **Number Settings**:
   - Enable **Incoming Calls**
   - Enable **Outgoing Calls**
   - Set **Missed Call Behavior** → Forward to voicemail or agent cell
   - Enable **Call Recording** (see Section 2)
6. Copy the number — this is your **outbound caller ID**

### Recommended Number Strategy

| Number | Purpose | Area Code |
|--------|---------|-----------|
| Primary sales line | Outbound SDR calls, voicemail drops | 305 or 954 |
| Support line | Inbound support tickets | 561 or 786 |
| Booking confirmation SMS | Appointment reminders only | Any |

> **Note:** A10DLC registration is required for SMS at scale. Go to **GHL → Settings → Phone Numbers → A10DLC** and register your brand before sending bulk SMS.

---

## 2. Call Recording & Compliance

### Florida Law (1-Party Consent State)
Florida is a **1-party consent** state — you can legally record calls as long as one party (you) consents. No disclosure is required by Florida law.

However, **best practice for B2B outbound** is to announce recording at the start of every call:

> *"Just so you know, this call may be recorded for quality and training purposes."*

### Enable Recording in GHL

1. **GHL → Settings → Phone Numbers → [Your Number] → Edit**
2. Toggle **Call Recording → ON**
3. Set **Recording Storage** → GHL Cloud (default)
4. Optionally set a **recording announcement message** that plays automatically

### Compliance Notes
- Always honor **Do Not Call (DNC)** requests — the platform sets `lb_do_not_sdr = true` automatically when a contact opts out
- For calls into other states: CA, IL, FL (interstate), WA are all-party consent — always announce recording
- TCPA applies to **mobile numbers** — ensure you have written consent before dialing cell phones for marketing purposes
- Your compliance engine (`/dashboard/compliance`) already handles GHL-side opt-outs

---

## 3. Inbound Call Flow (IVR)

### Setup in GHL

1. Go to **GHL → Settings → Phone Numbers → [Your Number] → Call Flows**
2. Click **Create Call Flow**
3. Build this structure:

```
Inbound Call
    │
    ├─ Business Hours? → YES → Ring Agent (round-robin, 15s)
    │                              │
    │                              └─ No Answer → Voicemail Drop (record: "Liberty Bancard Sales")
    │
    └─ NO (after hours) → Play Message → "Thanks for calling Liberty Bancard.
                                          Our team is available Mon–Fri 9am–6pm Eastern.
                                          Please leave a message and we'll call you back
                                          within one business day."
                                         → Voicemail Box → Send SMS auto-reply
```

### After-Hours SMS Auto-Reply (set in GHL Workflow)
```
Hi {{contact.first_name}}! Thanks for reaching out to Liberty Bancard. Our team will 
contact you on the next business day. In the meantime, visit libertybancard.com or 
reply with any questions. — Liberty Bancard Team
```

### Call Flow Routing by Type
- **Inbound SDR-originated calls** (prospect calls back from a VM drop): Route to the agent who owns the contact in GHL, with fallback to round-robin
- **Inbound from website** (click-to-call): Route to first available sales agent
- **Merchant support**: Route to `GHL_SUPPORT_TEAM_USER_ID` agent

---

## 4. Voicemail Drop Setup

Voicemail drops let you leave a pre-recorded message without the phone ringing. Set these up once and reuse across all dial sessions.

### Step-by-Step

1. **GHL → Settings → Phone Numbers → Voicemail Drops → Add New**
2. Record or upload MP3/WAV files (max 60 seconds, mono, 8kHz–44kHz)
3. Name each drop clearly (e.g., "VM Drop — Restaurant — Intro")
4. Assign to workflows (see Section 6)

### Voicemail Drop Scripts — Per Vertical

Record one voicemail drop per vertical. Keep each under 30 seconds.

---

#### 🍽️ Restaurant
> *"Hi {{firstName}}, this is [Agent Name] calling from Liberty Bancard. I work with restaurants just like yours on payment processing, and I've helped similar spots save $800 to $1,200 a month on processing fees. I'd love to put together a free statement analysis for you — no commitment, takes about 10 minutes. Give me a call back at [Number] or I'll try you again tomorrow. Have a great day!"*

---

#### 🛍️ Retail
> *"Hi {{firstName}}, this is [Agent Name] from Liberty Bancard. I'm reaching out because we specialize in retail payment processing — free equipment upgrades, same-day funding, and we typically cut monthly processing costs by 20 to 30 percent. I'd love to do a free comparison on your current statement. Call me back at [Number] — I'll keep it short. Thanks!"*

---

#### 🔧 Auto Repair
> *"Hey {{firstName}}, [Agent Name] here from Liberty Bancard. I work with a lot of auto shops in the area and we've been saving them real money on payment processing — free terminal upgrades included. If you're doing any volume on card payments, I'd love to run a quick comparison on your statement. Call me back at [Number] or I'll follow up tomorrow. Thanks!"*

---

#### 💆 Med Spa
> *"Hi {{firstName}}, this is [Agent Name] from Liberty Bancard. I work with med spas and aesthetic practices on their payment processing. Between the high-ticket services and membership billing, there's usually a lot of room to save — we've helped similar practices save $1,000 to $2,500 a month. Love to put together a free analysis. Call me at [Number] — no obligation at all. Thanks!"*

---

#### 🦷 Dental
> *"Hi {{firstName}}, [Agent Name] calling from Liberty Bancard. We work specifically with dental practices on processing, and given your average ticket size for restorative and cosmetic work, there's often a significant savings opportunity. Most practices save $600 to $2,000 a month when they switch to interchange-plus. Free analysis — call me back at [Number]. Thanks so much!"*

---

#### 🏥 Medical / Healthcare
> *"Hi {{firstName}}, this is [Agent Name] from Liberty Bancard. We work with medical practices on payment processing, and with the compliance requirements in healthcare, I wanted to reach out about some savings opportunities specific to your practice type. We typically save practices $500 to $1,500 a month. Give me a call back at [Number] — no pressure at all. Thanks!"*

---

#### 💪 Gym / Fitness
> *"Hi {{firstName}}, [Agent Name] calling from Liberty Bancard. We work with gyms and fitness studios specifically — especially those with recurring memberships. We typically cut membership billing costs by 25 to 35 percent, and we've got great chargeback protection too. Free analysis — just call me back at [Number] whenever is good. Thanks!"*

---

#### ✂️ Salon / Beauty
> *"Hi {{firstName}}, this is [Agent Name] from Liberty Bancard. I work with salons and beauty businesses on their payment processing. Between tips, high transaction volume, and monthly fees, there's usually a lot of room to save. We offer free terminal upgrades and same-day funding too. Call me back at [Number] — happy to put a free comparison together. Thanks!"*

---

#### 🏗️ Construction
> *"Hi {{firstName}}, [Agent Name] here from Liberty Bancard. We work with contractors and construction businesses on payment processing, and with the large invoice sizes you're dealing with, there are some significant savings opportunities — especially on commercial client payments. Call me back at [Number] and I'll put together a free analysis. Thanks!"*

---

#### 🌿 Landscaping
> *"Hi {{firstName}}, this is [Agent Name] from Liberty Bancard. I reach out to landscaping and lawn care businesses because a lot of owners don't realize how much they're leaving on the table with flat-rate processors. We do a free statement analysis with no commitment — most clients save $400 to $800 a month. Call me at [Number]. Thanks!"*

---

#### 🏨 Hotel / Lodging
> *"Hi {{firstName}}, [Agent Name] calling from Liberty Bancard. We work with hotels and lodging properties on their payment processing — and with card-not-present reservations and nightly rates, the savings opportunity is usually really meaningful. Free analysis, no commitment. Call me back at [Number] whenever works. Thanks!"*

---

#### ⚖️ Legal
> *"Hi {{firstName}}, this is [Agent Name] from Liberty Bancard. We work specifically with law firms on payment processing — including IOLTA-compliant trust account handling and retainer billing. Most firms save $400 to $1,200 a month. I'd love to put a firm-specific analysis together. Call me back at [Number]. No pressure. Thanks!"*

---

### Default / Cold Outreach VM
> *"Hi {{firstName}}, this is [Agent Name] from Liberty Bancard. I help local businesses lower their payment processing costs — we do a free statement analysis with no commitment, and most businesses save $300 to $1,000 a month. Give me a call back at [Number] or I'll try you again tomorrow. Thanks!"*

---

## 5. Power Dialer (Manual Call Queue)

GHL's Power Dialer lets reps work through a call list efficiently with one-click dialing and automated disposition logging.

### Setup

1. **GHL → Contacts → (filter your list) → Select All → Actions → Add to Power Dialer**
2. Or from **GHL → Conversations → Power Dialer → Create New Session**
3. Configure:
   - **Caller ID**: Your outbound number
   - **Call Recording**: ON
   - **Auto-advance**: ON (auto-dials next contact after disposition)
   - **Voicemail Drop**: Select per-vertical drop (see Section 4)
   - **Wrap-up time**: 30 seconds (enough time to leave notes)

### Disposition Options to Configure
Create these dispositions in **GHL → Settings → Call Dispositions**:

| Disposition | Next Action |
|-------------|-------------|
| Interested — Sending Statement | Add tag: `statement-requested`, enroll in `Statement Review` workflow |
| Callback Requested | Create task: Call back at specified time |
| Not Interested | Add tag: `not-interested`, pause SDR outreach |
| Left Voicemail | Add tag: `vm-left`, enroll in VM follow-up sequence |
| Wrong Number | Mark contact DNC |
| No Answer | Attempt again in 24h (auto-task) |
| Gatekeeper — Will Try Direct | Update contact notes |
| Disconnected | Mark phone invalid |

### Best Practices for Reps
- Work in blocks of **90 minutes max** — dialer fatigue is real
- Use vertical filter to batch by industry — voice gets more natural
- Always check the contact's **vertical tag** before dialing — select the matching VM drop
- Log every call with a disposition — never leave it blank

---

## 6. Auto-Dial Workflows

These GHL workflows trigger call tasks and voicemail drops automatically.

### Workflow: SDR Day-1 Outreach Call Task

**Trigger**: Contact added to SDR sequence (tag added: `sdr-enrolled`)

**Actions**:
1. Wait 0 minutes
2. **Create Task**: "Day 1 Call — [Contact Name]" → Assigned to contact owner
3. **Send Internal Notification** to agent: "New SDR lead ready to call: {{contact.name}} | {{contact.company}} | Vertical: {{contact.customField.vertical}}"
4. Wait 1 hour
5. If task not completed → Send reminder notification
6. If task not completed after 4 hours → Escalate to manager

---

### Workflow: Voicemail Drop Sequence (Days 1/3/5)

**Trigger**: Tag added: `vm-sequence-start`

**Actions**:
1. Day 0: **Voicemail Drop** → Select matching vertical drop
2. Day 0 + 2 hours: **Send SMS** → (see SMS templates in email-sms-templates service)
3. Day 3: **Voicemail Drop** → Second attempt
4. Day 3 + 1 hour: **Send Email** → Personalized follow-up
5. Day 5: **Voicemail Drop** → Final attempt ("last try" tone)
6. Day 5 + 30 min: **Add Tag**: `cold-sequence-complete`
7. If replied at any point → **Remove from sequence**, notify agent

---

### Workflow: Missed Appointment — Auto-Redial

**Trigger**: Appointment status = No Show

**Actions**:
1. Immediately: **Send SMS** → "Hey {{first_name}}, we missed you at your appointment! Want to reschedule? [booking link]"
2. 30 minutes: **Create Call Task** → "Missed appt follow-up call"
3. 4 hours: **Send Email** → No-show reschedule template
4. Day 2: **Voicemail Drop** → Default reschedule VM
5. Day 5: **Add Tag**: `no-show-unrecovered`, remove from active pipeline

---

### Workflow: Post-Call Follow-Up

**Trigger**: Call disposition = "Interested — Sending Statement" OR tag: `statement-requested`

**Actions**:
1. Immediately: **Send Email** → Statement upload link + vertical-specific intro
2. Immediately: **Send SMS** → "Hi {{first_name}}, great talking! Here's the link to upload your statement: [link]. Takes 2 min. — [Agent Name]"
3. Day 2 (if no statement received): **Create Task** → "Follow-up: Statement not received"
4. Day 2: **Send SMS** → "Hey {{first_name}}, just wanted to make sure you got my email with the statement upload link. Any questions?"
5. Day 5 (if still no statement): **Voicemail Drop** → Default follow-up VM
6. Statement uploaded → **Trigger**: Statement Review workflow (auto-removes from this sequence)

---

## 7. Voice AI / AI SDR Calling

The platform includes a Voice AI orchestrator (`server/services/sdr/voice-orchestrator.ts`) that can initiate and manage AI-powered outbound calls via GHL.

### How It Works
1. The AI SDR pipeline identifies a contact for voice outreach
2. The orchestrator selects the matching vertical script and call mode
3. A GHL call is initiated via the Voice AI integration
4. Post-call: disposition is logged, CRM is updated, follow-up is triggered

### Activation
Voice AI is controlled by the `ORCHESTRATOR_ENABLED` runtime flag.
- Enable it from **Admin Activation Panel → `/dashboard/activation`**
- Start with a small batch (50 contacts max) to validate call quality before full deployment

### Call Modes
| Mode | Description |
|------|-------------|
| `warm_intro` | AI introduces itself and immediately offers to transfer to a human rep |
| `statement_request` | AI asks for a statement upload only — no hard close |
| `booking_only` | AI's only goal is to book a 10-minute call |
| `full_pitch` | Full AI-driven pitch with objection handling |

> **Recommended start**: Use `statement_request` or `booking_only` mode first — they have the highest compliance safety and lowest drop rate.

---

## 8. Call Scripts — Per Vertical

Full scripts are stored in `server/services/vertical-voice-scripts.ts` and served to the platform's AI advisors and compose-email endpoints. Use these verbatim for rep training or Voice AI prompt building.

---

### 🍽️ Restaurant

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} calling from Liberty Bancard. I work with a lot of restaurants in the area, and I noticed you're processing payments — I'd love to show you how we've helped similar restaurants keep more of what they earn on every transaction."

**Value Prop:**
> "We specialize in restaurant payment processing and have helped our clients reduce processing costs by an average of 25–35%. For a restaurant doing $50K a month in cards, that's often $800–$1,200 back in your pocket every month."

**Discovery Questions:**
1. Are you currently on a flat-rate or interchange-plus pricing model?
2. What POS system are you using — Toast, Square, Clover, something else?
3. Do you offer delivery or third-party ordering platforms?
4. About how many card transactions does the restaurant run per month?

**Objection Handlers:**
- *"Happy with current processor"* → "I understand — most restaurant owners I talk to are 'fine' with their current processor until they see a side-by-side comparison. It takes about 10 minutes to analyze your statement, and there's zero obligation. If we can't beat what you're paying, I'll tell you straight up."
- *"Too busy"* → "Absolutely — I know how hectic the restaurant business is. Can I email you a quick overview and schedule a 10-minute call later this week? I promise to respect your time."
- *"Locked in a contract"* → "We handle buyouts all the time. Let me take a look at your current agreement and see if the savings we can offer outweigh the exit cost — in most cases they do. Can you send over your latest statement?"

**Close:**
> "Let me send you a free statement analysis right now. All you need to do is forward me your last month's processing statement — takes two minutes. I'll have a full breakdown back to you within 24 hours showing exactly how much you'd save."

---

### 🛍️ Retail

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with retail stores across the area on payment processing, and I'm reaching out because we've been able to significantly lower costs for shops like yours."

**Value Prop:**
> "We offer retail-specific interchange-plus pricing with no junk fees, same-day funding, and free equipment. Most retail clients see a 20–30% reduction in their monthly processing bill within 30 days of switching."

**Discovery Questions:**
1. What's your approximate monthly card volume?
2. Are you currently on a month-to-month contract or locked in?
3. Do you sell online as well, or primarily in-store?
4. What terminal or POS are you using?

**Objection Handlers:**
- *"Happy with current processor"* → "Great — I'd just ask you this: when's the last time you actually shopped your rates? Most retail owners I talk to haven't compared in 2+ years. We can run a free analysis against your current statement in under a day, no commitment needed."
- *"No time"* → "I completely respect that. Can I just get your statement emailed to me? I'll do all the legwork and send you back a savings report — you review it on your own time."
- *"Rates are fine"* → "Fair enough. Out of curiosity, do you know your effective rate? Most retail owners guess around 2.5% — when we dig into the statement it's often 3.1–3.4%. If it turns out yours really is low, we'll confirm that for you at no charge."

**Close:**
> "Let me put a free analysis together for you — just forward your latest processing statement and I'll have a full savings breakdown within 24 hours with zero pressure attached."

---

### 🔧 Auto Repair

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} calling from Liberty Bancard. We work with auto repair shops and dealerships on their payment processing, and I wanted to reach out because we've helped a lot of shops in this area lower their monthly costs significantly."

**Value Prop:**
> "Auto repair shops often have high ticket sizes — oil changes to major engine work — and flat-rate processing is brutally expensive at that volume. We've helped shops save $400–$1,200 a month with interchange-plus pricing and free equipment upgrades."

**Discovery Questions:**
1. What's your typical repair invoice average — mostly under $500 or larger jobs regularly?
2. Are you currently leasing your equipment or own it outright?
3. Do you do any fleet accounts or commercial billing?
4. How many card transactions do you process on a busy day?

**Objection Handlers:**
- *"We pass the fee to the customer"* → "Smart move — are you doing that through a formal surcharging program, or just informally? We can set up a compliant cash-discount or surcharge program that covers your entire processing cost legally."
- *"My accountant handles this"* → "Totally fine — would it make sense to loop them in? We can send a summary report directly to your accountant showing the comparison, and they can advise from there."
- *"Just switched"* → "Got it — when does your current agreement expire? If it's within the next 6 months, let's stay in touch. Most shops find significant savings when they can compare at renewal."

**Close:**
> "Let me put together a free statement analysis for you — send over your last month's processing statement and I'll have a breakdown back to you within 24 hours showing exactly how much you'd save."

---

### 💆 Med Spa

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. I work with med spas and aesthetic practices on their payment processing, and I noticed you're doing some great things — I wanted to reach out about some significant savings opportunities we've found for practices like yours."

**Value Prop:**
> "Med spas have a unique mix of cash-pay services, high ticket items, and package sales that can be very expensive to process at flat rates. We've helped med spas save $700–$2,500 a month with interchange-plus pricing and built-in package/subscription billing."

**Discovery Questions:**
1. Do you sell treatment packages or memberships that require recurring billing?
2. What's your average ticket for a typical visit — are you seeing a lot of $500+ transactions?
3. Are you currently using any aesthetic management software like Jane, Vagaro, or Zenoti?
4. Do you process any online payments or deposits for appointments?

**Objection Handlers:**
- *"Square works fine for us"* → "Square is easy to set up, but at 2.6% flat you're probably leaving $1,000–$2,000 a month on the table. For a med spa doing $80K/month, that's over $20K a year. Can I at least show you what interchange-plus would cost you instead?"
- *"We have a contract"* → "Let's look at the buyout terms — we often cover early termination fees when the savings make sense. Many of our med spa clients paid nothing to switch."
- *"Too busy"* → "I understand — running a med spa is demanding. Can I email you a one-page analysis? You can review it between clients and respond whenever it's convenient."

**Close:**
> "Forward me your last statement and I'll build you a complete med spa processing analysis — including recurring billing options and what you'd save per month starting on day one."

---

### 🦷 Dental

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with dental practices specifically on payment processing, and I wanted to reach out because we've been able to help a lot of dentists reduce what they're paying per transaction — especially on larger cosmetic and restorative cases."

**Value Prop:**
> "Dental practices are uniquely positioned to save on processing because of the higher average ticket size. We've helped dental offices save $600–$2,000 a month by moving to interchange-plus and adding patient financing options at no extra cost to the practice."

**Discovery Questions:**
1. Are you currently using Dentrix, Eaglesoft, or another dental management system?
2. Do you process patient financing in-house or through a third party like CareCredit?
3. What's your average ticket size for a typical restorative or cosmetic case?
4. Roughly how much card volume does the practice run per month?

**Objection Handlers:**
- *"We use our dental software's payment"* → "That's very common — dental software processors are almost always flat-rate and typically the most expensive option. We integrate with most dental software systems and can cut that cost substantially."
- *"We offer CareCredit"* → "CareCredit is great for patients, but you're paying 4–8% for that convenience. We can offer patient payment plans directly through your processing setup at your standard rate, keeping more margin in the practice."
- *"Not looking to change"* → "Totally fair — I just want to make sure you have the information to make that decision knowingly. Would you be open to a 10-minute comparison? If we can't show you at least $400/month in savings, I'll leave you alone."

**Close:**
> "Let me run a complimentary analysis on your statement — no commitment, no obligation. I'll have a dental-specific report back to you within 24 hours."

---

### 🏥 Medical / Healthcare

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} with Liberty Bancard. We work with medical practices on their payment processing, and given the compliance requirements in healthcare, I wanted to reach out and see if we could save your practice some money while also ensuring you're fully PCI-compliant."

**Value Prop:**
> "We specialize in healthcare payment processing — HIPAA-aware workflows, patient payment plans, and interchange-plus pricing that can save most practices $500–$1,500 a month compared to flat-rate processors like Square or Stripe."

**Discovery Questions:**
1. Do you primarily process in-office copays, or do you also bill patients directly?
2. Are you using a practice management system like Kareo, Athena, or AdvancedMD?
3. Do you offer payment plans for larger patient balances?
4. What's your approximate monthly card volume across all payment types?

**Objection Handlers:**
- *"We use our EHR billing"* → "Understood — many practices use their EHR's built-in billing. The problem is those are often passing through a third-party processor at flat-rate fees. We can integrate with most EHR systems and typically cut the processing cost significantly."
- *"Too complex to switch"* → "We handle the entire transition and work directly with your practice manager. Most healthcare practices are fully live in 3–5 business days with zero downtime."
- *"Not interested"* → "I understand — can I ask, do you know what your current effective rate is? If you're over 2.5% on card transactions, there's almost certainly room to save. A 10-minute call could be worth $12,000 a year to your practice."

**Close:**
> "Send me your last statement and I'll put together a healthcare-specific savings analysis — including how we handle patient payment plans and any compliance considerations for your practice type."

---

### 💪 Gym / Fitness

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with gyms and fitness studios on their payment processing, and I wanted to reach out — especially because membership-based businesses have some unique opportunities to save."

**Value Prop:**
> "Gyms and studios that process recurring memberships can dramatically reduce costs with interchange-plus pricing, especially on card-on-file recurring billing. We've helped fitness businesses save $300–$1,000 a month and handle membership billing seamlessly."

**Discovery Questions:**
1. Roughly how many active memberships do you have, and what's the average monthly charge?
2. Are you processing memberships through your gym management software or a standalone processor?
3. Do you sell class packages, personal training, or retail on top of memberships?
4. What's your chargeback rate been like — any issues with disputed charges?

**Objection Handlers:**
- *"We use ABC Fitness / Mindbody"* → "Those platforms are excellent for gym management — but their payment processing is typically more expensive than using a standalone processor. We integrate with both and can cut your per-transaction cost significantly."
- *"We have chargebacks sometimes"* → "That's actually something we can help with directly — we offer chargeback protection tools and clear member authorization workflows that reduce disputes. That alone often pays for the switch."
- *"Locked in a contract"* → "Let's review your exit terms — if the math works, we often cover buyout costs when the savings are clear. What's your monthly volume? I can tell you in about 60 seconds if it makes sense."

**Close:**
> "Share your latest processing statement and I'll build out a gym-specific analysis — including what you'd save on recurring billing and any package or retail transactions."

---

### ✂️ Salon / Beauty

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with salons and beauty businesses on their payment processing, and I wanted to reach out because we've been able to really move the needle for businesses like yours."

**Value Prop:**
> "Salons often process a high volume of smaller transactions plus tips — and flat-rate processors can be very costly on that mix. We've helped salons save $200–$700 a month and offer free tip-enabled terminals with same-day funding."

**Discovery Questions:**
1. What's your approximate monthly card volume between all your stylists or chairs?
2. Are you using a booking platform like Vagaro, Fresha, or StyleSeat that also processes payments?
3. Do your clients regularly tip on card?
4. Are you on a booth-rental model, or do you pay your stylists as employees?

**Objection Handlers:**
- *"We use Vagaro / Fresha"* → "Those platforms are great for booking — but their built-in processing is typically 2.5–2.9% flat. We can connect you to lower-cost processing while you keep using the booking software you love."
- *"Too small to matter"* → "I hear that — but let's do the math: if you're doing $25K/month in cards at 2.7%, that's $675/month. We could get that to $400 or less. That $275 difference pays for a supply order or an extra booth every single month."
- *"Happy with my current setup"* → "Totally understand — can I send you a quick comparison anyway? Takes me 24 hours and costs you nothing. If the numbers don't work, you'll know you're already getting a good deal."

**Close:**
> "Send me your latest statement and I'll have a salon-specific analysis back to you within a day — including what your per-transaction cost would be under our program."

---

### 🏗️ Construction

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with contractors and construction businesses on their payment processing — and I wanted to reach out because construction is actually one of the best industries to save on processing costs."

**Value Prop:**
> "Construction businesses often have high-ticket invoices and lots of commercial/B2B clients. With Level 2/3 data capture on business card transactions, we can reduce your effective rate by 30–50% on those payments. We've helped contractors save $600–$2,000 a month."

**Discovery Questions:**
1. Are your clients primarily homeowners, commercial property owners, or other contractors?
2. What's your average project invoice — under $10K, or do you regularly close larger jobs?
3. Do you use progress billing or milestone payments on larger projects?
4. What are you using for invoicing — QuickBooks, BuilderTrend, CoConstruct?

**Objection Handlers:**
- *"Clients pay by check"* → "That's common in construction — but more commercial clients are moving to card pay. When they do, you want to make sure you're optimized for it. We can have you set up with virtual terminal and ACH as well so you can accept any payment type at the best possible cost."
- *"Margins are tight"* → "That's exactly why we're calling — we're going to reduce your costs, not add to them. If we can't save you money, we won't ask for your business. Let me prove it with a free statement review."
- *"I have a good accountant"* → "Smart — can we loop your accountant in? We can send them a comparison document that shows the fee structure side by side. Most accountants immediately see the opportunity."

**Close:**
> "Send over your latest processing statement and I'll put together a construction-specific analysis — including what Level 2/3 data capture would save you on your commercial client payments."

---

### 🌿 Landscaping

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with landscaping and lawn care businesses on their payment processing — I wanted to reach out because this industry has some specific opportunities to save that a lot of business owners aren't aware of."

**Value Prop:**
> "Landscaping businesses often invoice large commercial jobs alongside residential services. We offer interchange-plus pricing with Level 2/3 data for B2B payments, which can dramatically reduce the cost of commercial client transactions."

**Discovery Questions:**
1. Do you work with commercial accounts, HOAs, or primarily residential?
2. How are clients typically paying — via invoice, in person, or online portal?
3. What's your average job invoice — under $1,000 or larger commercial contracts?
4. What software do you use for invoicing — QuickBooks, ServiceTitan, Jobber?

**Objection Handlers:**
- *"We take mostly checks"* → "Understood — but a lot of commercial clients and HOAs now prefer to pay by card. We can set you up with a virtual terminal and invoice link that makes it easy for clients to pay by card while keeping your cost per transaction low."
- *"We use QuickBooks"* → "QuickBooks Payments charges 2.5–3.5% depending on how you accept the card. We can integrate directly with QuickBooks and drop that effective rate by a significant margin."
- *"Not right now"* → "No problem at all — can I send you a quick overview so you have it when you're ready? Most landscaping businesses we talk to are surprised how much they're leaving on the table."

**Close:**
> "Let me put together a free analysis based on your statement — I'll look at your commercial vs. residential mix and calculate exactly where the biggest savings opportunities are."

---

### 🏨 Hotel / Lodging

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with hotels and lodging properties on their payment processing, and I wanted to reach out — hospitality is a category where we've been able to generate really meaningful savings."

**Value Prop:**
> "Hotels deal with card-not-present reservations, deposit holds, and high ticket nightly rates — all of which are expensive on flat-rate pricing. We offer hospitality-specific interchange-plus pricing with support for card-on-file, no-show charges, and same-day settlement."

**Discovery Questions:**
1. What's your average nightly rate, and how many rooms are you running?
2. Are you processing reservations through a PMS like Opera, Cloudbeds, or a similar system?
3. Do you process deposits or card-on-file holds separately from final payment?
4. Are you working with any OTAs like Expedia or Booking.com?

**Objection Handlers:**
- *"We use our PMS"* → "That's common — most PMS systems pass transactions through a built-in processor at elevated rates. We integrate with most major PMS platforms and can reduce the cost on every booking significantly."
- *"Our volume is too low"* → "Even a 15-room property doing $30K/month in cards can save $300–$500 a month with the right pricing. That's real money — can I at least show you the analysis?"
- *"Too complicated to switch"* → "We handle the entire integration with your PMS, and most properties are fully transitioned in 3–5 business days with zero front-desk downtime. Our hospitality team has done this hundreds of times."

**Close:**
> "Send me your most recent processing statement and I'll have a hospitality-specific analysis back to you within 24 hours — including card-not-present optimization and deposit handling."

---

### ⚖️ Legal

**Opening:**
> "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with law firms on their payment processing — and I wanted to reach out because there are some compliance-critical aspects of legal payment processing that many firms aren't handling optimally."

**Value Prop:**
> "Law firms have unique payment processing needs — IOLTA trust account compliance, client retainer billing, and large case-fee transactions. We offer law-firm-specific processing with built-in IOLTA separation, and most firms save $400–$1,200 a month while staying fully compliant."

**Discovery Questions:**
1. Are you processing any payments into IOLTA trust accounts, or primarily into operating accounts?
2. What's your typical retainer size, and do you bill against it monthly or case-by-case?
3. Are you using practice management software like Clio, MyCase, or LawPay?
4. How do you currently handle client payment plans for contingency or larger matters?

**Objection Handlers:**
- *"We use LawPay"* → "LawPay is excellent for IOLTA compliance — and we're fully compatible with their compliance framework as well. The difference is typically in the per-transaction cost. Most firms paying 2.9% with LawPay could be at 1.9–2.1% with us. Can I run a comparison?"
- *"Our bar association recommends LawPay"* → "Absolutely — and we support the same IOLTA-safe processing model they recommend. Our platform is designed for law firm compliance. I'd just like to show you what you'd save on a monthly basis."
- *"Not looking to change right now"* → "Understood — would it be okay if I sent you our law firm processing overview and we reconnected at your next renewal? Changes like this are worth planning ahead."

**Close:**
> "Send me your latest processing statement and I'll put together a law-firm-specific analysis — including how we handle IOLTA trust vs. operating separation and what your savings would look like."

---

## 9. Objection Handlers (Universal)

Use these when the vertical-specific handler doesn't apply:

| Objection | Response |
|-----------|---------|
| *"I'm not the decision maker"* | "Totally understood — who would I best reach out to regarding processing? Would you mind connecting me, or sharing their email so I can send them the analysis directly?" |
| *"We just signed a new contract"* | "No problem at all — when does it expire? I'll make a note and reach back out at the right time. Worst case you have a comparison ready for your renewal." |
| *"We don't accept cards"* | "That's actually becoming rarer — are you finding that clients are asking to pay by card? We can help you add card acceptance at very competitive rates if it makes sense." |
| *"Email me something"* | "Absolutely — what's the best email? And should I address it to you or someone else on the team? I'll send a one-page overview today." |
| *"How'd you get my number?"* | "Public business records — we reach out to local businesses in our area. Happy to remove you from our list if you'd prefer. No hard feelings at all." |
| *"We use our bank for processing"* | "Bank processing programs are almost always the most expensive option — banks aren't processors, they re-sell at a markup. Can I show you a comparison? You may be surprised." |
| *"We're too small"* | "There's no volume too small — even a business doing $8K/month can save $80–$150 a month. Over a year that's real money. Takes me 24 hours to show you exactly." |

---

## 10. Env Vars Required

| Variable | Source | Notes |
|----------|--------|-------|
| `GHL_PRIVATE_INTEGRATION_TOKEN` | GHL → Settings → Integrations → Private Integrations | ✅ Already set |
| `GHL_LOCATION_ID` | GHL → Settings → Business Info | ✅ Already set |
| `GHL_PIPELINE_ID` | Output of `npx tsx scripts/ghl-setup.ts` | Set after running setup |
| `GHL_ONBOARDING_PIPELINE_ID` | Output of setup script | Set after running setup |
| `GHL_CALENDAR_ID` | Output of setup script | Set after running setup |
| `GHL_DEFAULT_BOOKING_LINK` | `https://api.leadconnectorhq.com/widget/booking/{GHL_CALENDAR_ID}` | Set after calendar created |
| `GHL_ONBOARDING_STAGE_NEW` | GHL → Pipelines → Onboarding → "Contract Sent" stage ID | Copy from pipeline settings URL |
| `GHL_SUPPORT_TEAM_USER_ID` | GHL → Settings → Team → click user → copy ID from URL | Required for ticket routing |
| `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID` | GHL → Documents → create template → copy ID | Required for e-sign flow |

---

*Last updated: 2026 — Liberty Bancard AI Business Operating System*
