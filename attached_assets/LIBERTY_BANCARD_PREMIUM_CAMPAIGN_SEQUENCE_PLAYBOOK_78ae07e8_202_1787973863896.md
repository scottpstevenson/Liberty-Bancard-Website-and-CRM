# Liberty Bancard Premium Campaign and Sequence Playbook

**Version:** 1.0 draft  
**Purpose:** Generate qualified merchant-processing conversations through small, evidence-backed email experiments.  
**Activation state:** Draft only. No content in this document authorizes a send.

## Commercial strategy

Liberty Bancard should not lead with a generic “we can save you money” pitch. The strongest low-friction offer is a **merchant statement and payment-flow review**: a short, specific comparison of visible fees, equipment/workflow friction, deposit timing, and chargeback exposure. Any savings or pricing conclusion must come after reviewing the merchant’s actual statement and needs.

The pilot tests three hypotheses, sequentially—not one blended list:

| Pilot | ICP | Payment hypothesis | Primary CTA |
|---|---|---|---|
| A | Florida owner-operated auto repair, 1–3 locations | Card-present tickets, deposits, mobile acceptance, equipment/deposit friction | “Worth a 10-minute statement review?” |
| B | Med spa or dental practice | Deposits, recurring/card-on-file, card-not-present disputes, front-desk workflow | “Want a second set of eyes on one statement?” |
| C | Home services/construction | Deposits, remote/mobile collection, payment links, cash-flow timing | “Open to a quick payment-flow comparison?” |

Do not run a lookalike model or declare a winning ICP until attributable production outcomes exist.

## Pilot qualification contract

Every recipient must have:

- `record_class=production`
- primary source and evidence record
- canonical business and resolved person identity
- named decision-maker role or reviewed high-confidence inference
- active business evidence and selected ICP version
- current positive email validation
- no DNC, opt-out, bounce, complaint, legal, incident, maintenance, or manual hold
- assigned rep and monitored reply inbox
- approved exact rendered message based only on retained evidence
- no concurrent enrollment or recent-contact conflict

## Sequence architecture

- Day 1: concise relevance + diagnostic offer
- Day 4: one operational angle, no pressure
- Day 8: useful checklist + manual call/research task
- Day 14: respectful close-the-loop message
- Stop immediately on any reply, bounce, unsubscribe, complaint, eligibility loss, ownership conflict, or pause.
- No automated SMS, voicemail drop, or social-channel automation in this pilot.
- Each email should be plain-text-forward, 60–120 words, one CTA, one signature, and one compliance footer.

## Evidence-based personalization slots

Allowed only when evidence exists and is current:

- `{{firstName}}`
- `{{companyName}}`
- `{{city}}`
- `{{verifiedService}}` — e.g., collision repair, dental implants, HVAC installation
- `{{verifiedOperationalSignal}}` — e.g., multiple locations, online booking, financing page, mobile service
- `{{decisionRole}}`
- `{{repFirstName}}`
- `{{calendarLink}}`

Never say “I noticed,” “I was researching you,” or imply firsthand familiarity unless the exact public evidence is retained and the wording is literally true. Do not insert review counts, transaction volume, current processor, fees, savings, or pain as fact unless verified.

## Pilot A — Florida auto repair

### Email 1 — Statement diagnostic

**Subject options:**

- A quick payment question for {{companyName}}
- Reviewing card costs at {{companyName}}
- Merchant statement second opinion

**Body:**

Hi {{firstName}},

I work with businesses on card-processing costs and payment flow. For an auto shop, the useful review usually is not just the quoted rate—it is the combination of statement fees, equipment, deposits, and how larger tickets are handled.

If you are open to it, I can compare one recent merchant statement and return a short, plain-English summary of anything worth questioning. No promise of savings and no obligation to switch.

Worth a 10-minute review next week?

— {{repFirstName}}

### Email 2 — Workflow angle

**Subject options:**

- Re: payment review for {{companyName}}
- One thing I would check

**Body:**

Hi {{firstName}},

One item I would check for {{companyName}} is whether the current setup fits the way you actually collect—at the counter, by phone, through deposits, or away from the shop. The cheapest-looking rate is not always the lowest total cost once the workflow and monthly fees are included.

I can mark up a statement with the questions I would ask your current provider, even if you keep the account exactly where it is.

Should I send the secure upload link?

— {{repFirstName}}

### Email 3 — Useful checklist

**Subject:** Three lines worth checking

**Body:**

Hi {{firstName}},

If you review the account internally, I would start with three things:

1. effective cost across the full statement, not one advertised rate;
2. recurring monthly, equipment, and compliance fees;
3. how keyed, deposit, and higher-ticket transactions are priced.

I am happy to do that comparison with you and separate genuine issues from normal card costs.

Would a brief call or a statement upload be easier?

— {{repFirstName}}

### Email 4 — Close the loop

**Subject:** Close the loop?

**Body:**

Hi {{firstName}},

I do not want to crowd your inbox. Should I close this out, or would a no-pressure statement review be useful later?

If the timing is wrong, “not now” is completely fine and I will update my notes.

— {{repFirstName}}

## Pilot B — Med spa and dental

### Email 1 — Patient-payment workflow

**Subject options:**

- A payment-flow question for {{companyName}}
- Statement review for {{companyName}}
- Deposits, card-on-file, and processing costs

**Body:**

Hi {{firstName}},

I help practices review merchant statements and patient-payment workflows. For appointment-based businesses, the useful questions often include deposits, card-on-file transactions, front-desk checkout, and how disputes are documented—not only the headline processing rate.

If you share one recent statement, I can return a concise comparison and identify which questions are actually worth taking back to your provider.

Would a short review be useful?

— {{repFirstName}}

### Email 2 — Total-cost angle

**Subject options:**

- Re: {{companyName}} payment costs
- Looking beyond the quoted rate

**Body:**

Hi {{firstName}},

The reason I suggested a statement review is that two accounts with the same quoted rate can have very different total cost once monthly fees, keyed transactions, card mix, equipment, and dispute workflow are included.

I will not claim a result before seeing the numbers. I can simply show the effective cost and any operational tradeoffs in one page.

Want the secure upload link?

— {{repFirstName}}

### Email 3 — Review framework

**Subject:** A simple payment review framework

**Body:**

Hi {{firstName}},

My review for a practice is usually four columns: what you pay, what drives it, what is negotiable, and what would change operationally. That keeps the conversation grounded and avoids a low-rate quote that does not match the actual workflow.

If {{companyName}} is reviewing vendors this quarter, I would be glad to prepare that comparison.

Is there a better person to coordinate with?

— {{repFirstName}}

### Email 4 — Permission to close

**Subject:** Should I close this out?

**Body:**

Hi {{firstName}},

I have not heard back, so I will close the loop after this. If a statement or patient-payment review becomes useful, reply with “review” and I will send the secure next step.

Otherwise, no action needed.

— {{repFirstName}}

## Pilot C — Home services and construction

### Email 1 — Getting paid in the field

**Subject options:**

- A payment-flow question for {{companyName}}
- Reviewing deposits and card costs
- Quick statement comparison

**Body:**

Hi {{firstName}},

I work with businesses on card-processing cost and collection workflow. For home services and project work, the useful review often includes deposits, payment links, mobile acceptance, larger invoices, and how quickly funds arrive.

I can compare one recent merchant statement and map the cost to the way {{companyName}} actually gets paid. The result is a short list of questions—not a promised savings number.

Open to a 10-minute comparison?

— {{repFirstName}}

### Email 2 — Deposit and remote-payment angle

**Subject options:**

- Re: payment flow at {{companyName}}
- Deposits and remote payments

**Body:**

Hi {{firstName}},

One issue I would look for is whether deposits and remote payments are being handled through the best channel for the job. Keyed transactions, links, mobile terminals, and larger tickets can carry different costs and operational tradeoffs.

If you send a statement, I can separate the unavoidable card costs from the items worth reviewing.

Should I send the secure upload link?

— {{repFirstName}}

### Email 3 — Cash-flow checklist

**Subject:** Three payment questions

**Body:**

Hi {{firstName}},

Three questions I would use in a payment review:

1. Are deposits and final balances collected through the right channel?
2. Are monthly and equipment fees visible in the quoted cost?
3. Does funding timing match payroll and material purchases?

If those are already in good shape, I will say so. If not, I can show the alternatives clearly.

Worth reviewing together?

— {{repFirstName}}

### Email 4 — Final note

**Subject:** Final note from me

**Body:**

Hi {{firstName}},

This is my final note. If a payment-cost or deposit-flow review would be useful later, reply whenever the timing is right.

If someone else owns merchant services at {{companyName}}, I am happy to update the contact—or close the record entirely.

— {{repFirstName}}

## Manual call/research task

After email two, create a task for the assigned rep—never an automated voicemail—to:

1. Recheck public business status and decision-maker evidence.
2. Review all opens/clicks only as diagnostic signals; do not claim they indicate intent.
3. Call only if the number’s source and channel policy permit it.
4. Ask whether the person owns merchant services and whether a statement review is relevant.
5. Record `wrong_person`, `not_interested`, `timing`, `provider_contract`, `statement_requested`, or `qualified_conversation` as structured outcomes.

## AI personalization specification

**System objective:** Write one optional opening sentence that makes the message more relevant without pretending to know the merchant’s costs or problems.

**Inputs:** Approved template version, ICP version, offer, evidence IDs and evidence text, safe fields, prohibited-claim policy.

**Rules:**

- Use only supplied evidence.
- State observable facts, not inferred financial pain.
- Do not mention review ratings/counts unless current and approved.
- Do not claim savings, lower rates, guaranteed approvals, or an existing relationship.
- Do not manufacture compliments.
- Produce zero or one sentence, maximum 24 words.
- If evidence is insufficient, return `NO_PERSONALIZATION`.

**Required storage:** model, prompt version, evidence IDs, output, risk flags, generated timestamp, reviewer, approval timestamp, and content hash.

## Content QA checklist

- Correct person, company, vertical, and offer
- Personalization supported by retained evidence
- No unresolved token or grammar artifact
- No fake familiarity, urgency, scarcity, or social proof
- No guaranteed savings or unsupported percentage
- One clear CTA and secure statement-upload path
- Correct monitored reply-to
- Exactly one compliance footer and unsubscribe mechanism
- Mobile and desktop rendering checked
- Plain-text part readable
- Reply, bounce, unsubscribe, and complaint suppress subsequent touches
- Exact recipient copy included in the frozen approval record

## Experiment design

Run one ICP at a time with a maximum 250-member pilot. Within the pilot, randomize only one variable at a time—usually subject line or first-message framing. Predeclare variants and sample size; do not keep changing copy mid-cohort and then claim a winner.

### Funnel definitions

| Event | Definition |
|---|---|
| Delivered | Provider-confirmed delivery/accepted state under the chosen truth policy |
| Human reply | Canonical inbound message, excluding auto-replies |
| Positive reply | Human-reviewed interest or referral to the responsible person |
| Qualified conversation | Verified merchant-processing need/timing and decision process |
| Statement received | Securely received statement linked to the campaign/contact |
| Proposal | Durable proposal transition, not current-stage inference |
| Application | Canonical application created from the opportunity |
| Activation | Verified live merchant account/MID state |
| Revenue | Reconciled 30/60/90-day production gross profit |

Report denominators at every step. Preserve `unattributed` instead of allocating outcomes proportionally.

## Operating thresholds

- Start with controlled inboxes, then 10 canary recipients, then 25/day.
- Hard bounces ≥2%: pause.
- Complaints ≥0.1%: stop immediately.
- Any suppressed/wrong-person/duplicate send: stop immediately.
- Every reply must have an owner and same-business-day response target.
- Keep SMS paused.
- Do not scale because open rate is high. Scale only from qualified conversations, statements, applications, activations, and reconciled economics.

## Pilot review

At completion, publish:

- exact cohort and eligibility policy version
- sources, enrichment providers, validation ages, and total cost
- delivery/bounce/complaint/unsubscribe counts
- reply classification and SLA
- statement/proposal/application/activation/revenue events
- result by content version and ICP factor
- data-quality and wrong-person findings
- continue/iterate/stop decision with the next predeclared hypothesis

