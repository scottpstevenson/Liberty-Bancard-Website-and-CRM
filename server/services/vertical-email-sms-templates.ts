export interface VerticalTemplate {
  email: {
    subject: string;
    body: string;
  };
  sms: string;
  followUpEmail: {
    subject: string;
    body: string;
  };
  followUpSms: string;
}

export const VERTICAL_OUTREACH_TEMPLATES: Record<string, VerticalTemplate> = {
  Restaurant: {
    email: {
      subject: "Cut your restaurant's processing fees by 25–35%",
      body: `Hi {{firstName}},

Running a restaurant is already one of the hardest things in business — thin margins, long hours, and costs that never seem to stop climbing.

One cost a lot of restaurant owners overlook: payment processing fees. If you're on a flat-rate processor like Square or Toast Payments, you could be paying 2.6–2.9% on every card swipe when the real interchange cost is often under 1.5%.

At Liberty Bancard, we specialize in restaurant payment processing. We've helped restaurants in your area reduce their monthly processing bill by 25–35% — often $600–$1,500 back per month.

What we offer:
✓ Interchange-plus pricing (the most transparent model in the industry)
✓ Free terminal or POS integration
✓ Same-day funding — no waiting 2 days for your money
✓ No long-term contract required

It takes 10 minutes to review your statement and see if we can beat your current rate. If we can't, I'll tell you straight up.

Would you be open to a quick call this week?

Best,
{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We help restaurants cut processing fees by 25–35%. Takes 10 min to compare — can I send you a free analysis? Reply YES or just text back. No pressure!",
    followUpEmail: {
      subject: "Re: Your restaurant's processing statement",
      body: `Hi {{firstName}},

Just following up on my previous note — I know running a restaurant doesn't leave much time in the day.

Quick question: do you know your current effective rate? (That's the actual percentage you're paying after all fees are factored in.) Most restaurant owners I talk to think they're paying around 2.5% — when the true number is often 3.1–3.4%.

I can calculate yours from your last statement in about 5 minutes and tell you exactly what you'd save. No obligation, no commitment.

Just forward your latest processing statement to {{agentEmail}} and I'll have a full breakdown back to you within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, following up from my email! Happy to run a free processing analysis for your restaurant — just forward your last statement to {{agentEmail}}. Takes 2 min and could save you $1K+/month. 🍽️",
  },

  Retail: {
    email: {
      subject: "Are you overpaying on retail card processing?",
      body: `Hi {{firstName}},

If you're running a retail store and using a flat-rate processor like Square, PayPal, or Stripe, there's a good chance you're overpaying on every transaction.

Flat-rate processors are easy to set up, but they charge one rate for everything — which means you're paying the same high rate on low-cost debit cards as you are on premium rewards credit cards.

At Liberty Bancard, we put retail businesses on interchange-plus pricing — the same model used by Fortune 500 retailers. Most clients see a 20–30% reduction in their monthly processing bill.

Here's what we bring to the table:
✓ True interchange-plus pricing — no bundled flat rates
✓ Free equipment upgrade (keep your current setup or upgrade)
✓ Next-day or same-day funding
✓ Month-to-month — no long-term lock-in

If you're doing $30K+ a month in card volume, a quick review of your statement could uncover $300–$800/month in savings.

Worth 10 minutes of your time?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help retail stores reduce processing fees by 20–30%. Free statement analysis — no commitment. Interested? Just reply and I'll send details.",
    followUpEmail: {
      subject: "Quick question about your processing rates",
      body: `Hi {{firstName}},

I know you're busy running the store, so I'll keep this short.

One question: when's the last time you actually reviewed your processing statement line by line?

Most retail owners haven't done it in over a year — and when we dig in, we typically find $300–$700/month in fees that could be eliminated.

If you can forward me your most recent statement, I'll do the entire analysis for free and have results back to you within 24 hours.

No sales pressure. If the numbers don't work, I'll tell you.

{{agentName}}
Liberty Bancard
{{agentEmail}}`,
    },
    followUpSms: "Hey {{firstName}}, quick follow-up from Liberty Bancard! Can you forward your last processing statement to {{agentEmail}}? I'll run a free analysis and send you back exactly what you'd save. Takes 2 min on your end.",
  },

  Healthcare: {
    email: {
      subject: "Reduce your practice's processing costs — HIPAA-aware solution",
      body: `Hi {{firstName}},

Running a medical practice comes with enough overhead — malpractice insurance, staffing, EHR fees, and more. Payment processing shouldn't be adding unnecessary cost on top of that.

At Liberty Bancard, we specialize in healthcare payment processing with a focus on:

✓ Interchange-plus pricing — transparent, no hidden fees
✓ Patient payment plan support — recurring billing built in
✓ PCI-compliant workflow — no liability exposure from improper setup
✓ Integration with major EHR/practice management systems
✓ Same-day funding to improve cash flow

Most practices we work with save $500–$1,500 a month compared to what they're currently paying — especially those processing through their EHR's built-in payment system.

I'd love to run a free analysis of your current statement. No commitment, no obligation. If we can't save you money, I'll tell you upfront.

Would you be available for a brief call this week?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help medical practices reduce processing costs 20–40% with HIPAA-aware, PCI-compliant solutions. Free analysis — no commitment. Open to a quick call?",
    followUpEmail: {
      subject: "Free processing analysis for your practice",
      body: `Hi {{firstName}},

Following up on my earlier note — wanted to make sure this didn't get lost in the inbox.

For a practice doing $60K/month in patient card payments, even moving from a 2.8% effective rate to 2.0% saves $480/month or $5,760/year.

That's enough to cover a part-time MA's monthly wages, fund a new piece of diagnostic equipment, or simply improve your bottom line.

I can calculate your exact savings from your last processing statement — it takes me under 24 hours. Would you be willing to forward it to {{agentEmail}}?

No obligation, no pitch — just the numbers.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hi {{firstName}}, following up from Liberty Bancard. Sending your last processing statement to {{agentEmail}} takes 2 min and shows your exact savings. Most practices save $500–$1,500/mo. Worth a look?",
  },

  Dental: {
    email: {
      subject: "Are dental software payment fees costing your practice thousands?",
      body: `Hi {{firstName}},

If you're processing payments through Dentrix, Eaglesoft, or another dental management system, there's a good chance you're paying a premium for that convenience.

Built-in dental software processors typically charge flat rates of 2.5–3.5% — while the actual interchange cost on most patient payments is significantly lower.

At Liberty Bancard, we work exclusively with healthcare and dental practices. We offer:

✓ Interchange-plus pricing — the lowest transparent option in the industry
✓ Integration with all major dental software (no workflow changes)
✓ Patient payment plan billing — built in, at no extra cost
✓ Same-day funding
✓ Free equipment and setup

For a dental practice doing $80K/month in card transactions, moving from 3% to 2% effective rate saves $800/month — that's $9,600 a year back to the practice.

I'd love to run a complimentary analysis on your current statement. Can we schedule 10 minutes this week?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help dental practices cut processing fees and integrate with Dentrix/Eaglesoft. Free analysis — could be $800+/mo in savings. Worth a quick call?",
    followUpEmail: {
      subject: "Your dental practice processing — quick follow-up",
      body: `Hi {{firstName}},

Just checking back in — I know how busy a dental practice can be between procedures and admin.

Quick thought: many of the practices we work with were unknowingly paying an extra $500–$1,200/month through their dental software's payment processing. It's one of those things nobody looks at closely until they see the comparison.

All I'd need is your last month's processing statement to run the analysis. I'll handle everything else and have a full report back to you within 24 hours.

Forward it to {{agentEmail}} whenever you get a chance.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, following up! Forwarding your last processing statement to {{agentEmail}} could reveal $500–$1,200/mo in savings for your practice. Takes 2 min — worth it?",
  },

  "Med Spa": {
    email: {
      subject: "Payment processing built for med spas — save $700–$2,500/month",
      body: `Hi {{firstName}},

Running a med spa means managing high-dollar treatments, package sales, recurring memberships, and clients who expect a seamless experience — including at checkout.

Most med spas are processing through Square, Vagaro, or Jane at flat rates of 2.5–3%+. When your average ticket is $400–$1,200, those rates add up fast.

At Liberty Bancard, we specialize in aesthetic and med spa payment processing:

✓ Interchange-plus pricing — dramatically lower on high-ticket transactions
✓ Package and membership recurring billing
✓ Chargeback protection for prepaid treatment packages
✓ Integration with Jane, Vagaro, Mindbody, and Zenoti
✓ Same-day funding

Med spas doing $80K–$150K/month in card volume typically save $700–$2,500/month after switching. That's real money you can reinvest in staff, equipment, or marketing.

Can I run a free analysis on your current statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help med spas reduce processing fees on high-ticket treatments and memberships. Most save $700–$2,500/mo. Free analysis — interested?",
    followUpEmail: {
      subject: "Your med spa processing — free savings analysis",
      body: `Hi {{firstName}},

Following up from my earlier email — I wanted to make sure you had all the information.

Quick example: a med spa doing 200 treatments at an average $600 ticket is running $120K/month through their processor. At 2.7% flat, that's $3,240/month in fees. With interchange-plus, the same volume typically costs $1,800–$2,200.

That $1,000–$1,400/month difference is real money — it could fund a new laser treatment head, cover a full-time esthetician, or simply improve margins.

Can you send your most recent processing statement to {{agentEmail}}? I'll have a complete med spa analysis back to you within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hi {{firstName}}, quick follow-up from Liberty Bancard! A free processing review of your med spa could show $1K+/mo in savings. Just forward your statement to {{agentEmail}}. No commitment! 💆",
  },

  "Auto Repair": {
    email: {
      subject: "Reduce your shop's processing fees on large repair invoices",
      body: `Hi {{firstName}},

Auto repair shops deal with a unique payment challenge: high-ticket invoices on jobs that can run $500–$5,000+, and flat-rate processing fees that can take a significant bite out of each one.

If you're on a flat-rate processor at 2.6–2.9%, you're paying $26–$87 in processing fees on a $3,000 repair job. Interchange-plus pricing can cut that significantly.

At Liberty Bancard, we work with auto repair shops and dealerships to:

✓ Lower effective rates with interchange-plus pricing
✓ Set up a compliant cash-discount or surcharge program (eliminate your fees entirely)
✓ Provide free, modern terminal equipment
✓ Ensure same-day or next-day funding — critical for parts purchasing

For a shop doing $60K/month in card volume, saving just 0.7% on effective rate puts $420/month back in the business.

Want me to run a free comparison on your statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help auto repair shops cut processing fees on big repair invoices — often $400–$1,200/mo in savings. Free analysis, no obligation. Interested?",
    followUpEmail: {
      subject: "Free statement analysis for your auto shop",
      body: `Hi {{firstName}},

Following up on my earlier message. I'll keep it simple:

If your shop is doing $50K+/month in card volume, there's almost certainly $300–$700/month in processing savings on the table.

All I need is your most recent statement to prove it. Forward it to {{agentEmail}} and I'll have a complete analysis back to you within 24 hours — showing your current effective rate vs. what you'd pay with us, line by line.

If we can't save you money, I'll tell you — and you'll at least know exactly what you're paying.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, quick check-in from Liberty Bancard. If your shop processes $50K+/mo in cards, you likely have $300–$700 in monthly savings available. Send your statement to {{agentEmail}} for a free look!",
  },

  "Salon/Beauty": {
    email: {
      subject: "Lower your salon's processing fees — free terminal included",
      body: `Hi {{firstName}},

Running a salon or beauty business means you're handling a high volume of smaller transactions — plus tips — and those fees add up fast on a flat-rate pricing model.

At 2.6% flat, a $60 haircut with a $12 tip costs you about $1.87 in processing fees. Multiply that across 30–50 transactions a day, and you're looking at real money leaving your business every week.

At Liberty Bancard, we help salons and beauty professionals:

✓ Move to interchange-plus pricing — significantly cheaper on most everyday transactions
✓ Get a free tip-enabled terminal or integrate with your booking software
✓ Same-day funding — money in your account faster
✓ Month-to-month — no long-term commitment

Most salon clients save $200–$700/month. Not life-changing, but enough to cover a supply order or extra marketing every single month.

Can I send you a free analysis?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help salons reduce processing fees — free tip-enabled terminal + interchange-plus pricing. Most save $200–$700/mo. Free analysis, no strings!",
    followUpEmail: {
      subject: "Quick note about your salon's processing",
      body: `Hi {{firstName}},

Just a quick follow-up — I promise I won't take much of your time.

One thing I've seen a lot with salons: they're paying $300–$600/month more than they need to on processing fees, often through their booking platform's built-in payments (Vagaro, StyleSeat, Square Appointments, etc.).

The booking software is great — I'm not suggesting you change it. But you often don't have to use their payment processor, and the savings from switching can be significant.

Forward your last processing statement to {{agentEmail}} and I'll have a full breakdown within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, following up from Liberty Bancard! Even if you love your booking app, you may be overpaying on payments. Quick free analysis — just email your statement to {{agentEmail}}. 💇",
  },

  "Gym/Fitness": {
    email: {
      subject: "Reduce your gym's recurring membership processing fees",
      body: `Hi {{firstName}},

If you're running a gym, fitness studio, or CrossFit box, you know that recurring membership billing is the backbone of your revenue — and processing fees on that recurring volume add up every single month.

At a flat rate of 2.5%, a gym with 300 members paying $60/month is spending $450/month just in processing fees. Interchange-plus pricing can cut that to $250–$300.

At Liberty Bancard, we specialize in fitness business payment processing:

✓ Interchange-plus pricing on all recurring membership transactions
✓ Dunning management for failed recurring payments (reduce churn)
✓ Chargeback protection for canceled membership disputes
✓ Integration with ABC Fitness, Mindbody, Pike13, and other gym platforms
✓ Day pass and retail point-of-sale support

For most gyms and studios, we save $200–$800/month. That's extra revenue that can go toward equipment, marketing, or bringing on another trainer.

Want me to run a free comparison?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help gyms cut fees on recurring memberships — most save $200–$800/mo. Free analysis + Mindbody/ABC Fitness integration. Interested?",
    followUpEmail: {
      subject: "Your gym's membership billing — quick follow-up",
      body: `Hi {{firstName}},

Just circling back — wanted to make sure this didn't get buried.

For gyms running recurring billing, there are two things we consistently help with: (1) reducing the per-transaction cost on membership charges, and (2) reducing failed payment churn with better dunning tools.

Most gyms find at least one of these is worth a deeper look. Forward your last processing statement to {{agentEmail}} and I'll have a full analysis back to you in 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, quick follow-up from Liberty Bancard! Membership billing savings + chargeback protection = big wins for gyms. Free analysis at {{agentEmail}} — takes 2 min to send! 💪",
  },

  "Hotel/Lodging": {
    email: {
      subject: "Hospitality-specific payment processing — reduce your hotel's fees",
      body: `Hi {{firstName}},

Hotels and lodging properties face unique payment processing challenges: card-not-present reservations, deposit holds, cancellation chargebacks, and high-ticket nightly rates that amplify every basis point of your processing fee.

At Liberty Bancard, we offer hospitality-specific payment processing designed for properties like yours:

✓ Interchange-plus pricing — optimized for hospitality transaction types
✓ Card-on-file and authorization hold support
✓ No-show charge management
✓ PMS integration (Opera, Cloudbeds, Lodgify, and more)
✓ Same-day settlement — improve cash flow for daily operations

A hotel doing $100K/month in card transactions at 2.8% effective rate is spending $2,800/month in processing fees. Interchange-plus can bring that to $1,700–$2,000 — a savings of $800–$1,100/month.

I'd love to run a complimentary analysis on your processing statement. No commitment, no obligation.

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help hotels reduce processing fees on reservations and nightly rates. Free hospitality-specific analysis — most properties save $800–$2,000/mo.",
    followUpEmail: {
      subject: "Your hotel's processing costs — free analysis offer",
      body: `Hi {{firstName}},

Following up on my earlier message about your property's payment processing.

Hotels have some of the highest processing costs in any industry — not because of the rates, but because of the transaction types: card-not-present, high-ticket, and manual-entry reservations all carry premium interchange rates that a properly optimized setup can reduce.

Forward your last processing statement to {{agentEmail}} and I'll have a hospitality-specific analysis within 24 hours — including what you'd save per month with our program.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, following up from Liberty Bancard. Hotels often overpay on card-not-present reservation fees. Free hospitality analysis at {{agentEmail}} — could save your property $800–$2K/mo! 🏨",
  },

  Landscaping: {
    email: {
      subject: "Reduce invoice processing fees for your landscaping business",
      body: `Hi {{firstName}},

Landscaping and lawn care businesses deal with a mix of residential invoices and larger commercial contracts — and how you accept payment can significantly affect your bottom line.

If you're invoicing commercial clients and accepting business cards, there's an opportunity most landscaping owners miss: Level 2/3 data capture. This data optimization can drop your effective rate on commercial card payments by 0.4–0.8%, which adds up significantly on large contracts.

At Liberty Bancard, we help landscaping businesses:

✓ Optimize commercial B2B payments with Level 2/3 data
✓ Move to interchange-plus pricing — lower than flat-rate invoicing tools
✓ Accept payments via virtual terminal, invoice link, or in person
✓ Integrate with Jobber, ServiceTitan, and QuickBooks
✓ Same-day funding for crew payroll and supply purchasing

For a landscaping company doing $60K/month in card volume, we typically save $300–$700/month. Can I run a free analysis?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help landscaping businesses cut processing fees on commercial invoices — Level 2/3 data + interchange-plus. Most save $300–$700/mo. Free look?",
    followUpEmail: {
      subject: "Processing fees on your commercial landscaping accounts",
      body: `Hi {{firstName}},

Just following up — one thing I didn't mention in my first email:

If you have commercial clients paying large invoices by business credit card, you may be paying an extra 0.5–1.5% in fees that proper Level 2/3 data capture could eliminate. That's not a small number on $20K–$50K commercial jobs.

Forward your last processing statement to {{agentEmail}} and I'll show you exactly what optimization is available for your specific client mix.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hi {{firstName}}, quick follow-up from Liberty Bancard! Commercial invoice payments may be costing you extra. Free analysis at {{agentEmail}} — your statement, 24hr turnaround, no pressure. 🌿",
  },

  Construction: {
    email: {
      subject: "Cut payment processing costs on your construction invoices",
      body: `Hi {{firstName}},

Construction companies often don't think about payment processing as a major cost driver — but when you're running $200K–$500K/month through a flat-rate processor, those fees are a real number on the P&L.

More importantly, contractors doing large commercial jobs with business card clients are leaving significant money on the table without Level 2/3 data processing optimization.

At Liberty Bancard, we specialize in B2B construction payment processing:

✓ Level 2/3 data capture for commercial card transactions
✓ Interchange-plus pricing — dramatically lower than flat-rate on large invoices
✓ Progress billing and milestone payment support
✓ Virtual terminal for invoice-based payments
✓ Integration with QuickBooks, BuilderTrend, Procore, and CoConstruct
✓ Same-day funding — critical for payroll and materials

For a contractor doing $150K/month in card volume, Level 2/3 optimization alone can save $900–$1,800/month. That's money you can reinvest in equipment or crew.

Can I run a free analysis on your statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We help contractors reduce processing fees on large commercial invoices — Level 2/3 data + interchange-plus. Most save $600–$2,000/mo. Free analysis?",
    followUpEmail: {
      subject: "Your construction business processing — free analysis",
      body: `Hi {{firstName}},

Following up on my earlier note about payment processing for your contracting business.

The short version: if you have commercial clients paying invoices by business card, and you're not using Level 2/3 data capture, you're very likely overpaying. The savings on a $50K commercial invoice can be hundreds of dollars in a single transaction.

Send your last processing statement to {{agentEmail}} and I'll run a complete analysis — including what Level 2/3 would mean for your specific commercial volume.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hi {{firstName}}, Liberty Bancard follow-up. Processing optimization on commercial invoices could save you $600–$2,000/mo. Send your statement to {{agentEmail}} for a free review. 🔨",
  },

  Legal: {
    email: {
      subject: "Law firm payment processing — IOLTA-compliant with lower fees",
      body: `Hi {{firstName}},

Payment processing for law firms isn't like payment processing for other businesses. Between IOLTA trust account compliance, client retainer billing, and large case-fee transactions, there are meaningful risks and costs that a generic processor doesn't handle well.

At Liberty Bancard, we work specifically with law firms to offer:

✓ IOLTA-safe processing — fees never deducted from trust accounts
✓ Interchange-plus pricing — lower than LawPay flat rates for many firms
✓ Client payment plan support (installment fee agreements)
✓ Integration with Clio, MyCase, PracticePanther, and other legal platforms
✓ Large retainer and case-fee transaction optimization

Most firms we work with save $400–$1,200/month compared to their current processor — while remaining fully compliant with bar association payment guidelines.

Can I run a free, no-obligation analysis on your current processing statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. We offer IOLTA-compliant payment processing for law firms with lower fees than LawPay. Free analysis — most firms save $400–$1,200/mo. Interested?",
    followUpEmail: {
      subject: "Law firm processing — quick follow-up",
      body: `Hi {{firstName}},

Just circling back on my earlier message about your firm's payment processing.

One thing that often surprises attorneys: even firms using LawPay — which is excellent for IOLTA compliance — are typically paying 2.9–3.5% on credit card transactions. Our law-firm program offers the same IOLTA-safe compliance at 1.9–2.3% for most transaction types.

The compliance framework is the same. The cost is lower.

Forward your last statement to {{agentEmail}} and I'll put together a comparison. No sales pressure — just the numbers.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hi {{firstName}}, following up from Liberty Bancard. IOLTA-compliant processing at lower rates than LawPay — most firms save $400–$1,200/mo. Free analysis at {{agentEmail}} — worth a look! ⚖️",
  },
};

export function getVerticalTemplate(vertical: string): VerticalTemplate | null {
  const key = Object.keys(VERTICAL_OUTREACH_TEMPLATES).find(
    k => k.toLowerCase() === vertical.toLowerCase() ||
         k.toLowerCase().replace(/[^a-z]/g, "") === vertical.toLowerCase().replace(/[^a-z]/g, "")
  );
  return key ? VERTICAL_OUTREACH_TEMPLATES[key] : null;
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return Object.entries(variables).reduce(
    (text, [key, value]) => text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value),
    template
  );
}
