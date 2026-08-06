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
  thirdEmail?: {
    subject: string;
    body: string;
  };
  thirdSms?: string;
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

One quick question: do you know your current effective rate? That's the actual percentage you're paying after all fees — not the advertised rate. Most restaurant owners think they're around 2.5% when the true number is often 3.1–3.4%.

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
      subject: "On $80K/month in dental volume, 3% vs. 2% = $9,600/year — is your practice on the right side?",
      body: `Hi {{firstName}},

Dentrix and Eaglesoft are excellent practice management systems — but their built-in payment processors charge 2.5–3.5% flat rates while interchange-plus pricing delivers the same seamless integration at 1.8–2.1% for most dental card types.

On $80K/month in card transactions, the difference between 3% flat and 2% interchange-plus is $800/month — $9,600 a year back to your practice.

At Liberty Bancard, we integrate with Dentrix, Eaglesoft, and all major dental practice management platforms without changing your front-desk workflow:

✓ Interchange-plus pricing — no bundled flat rates, full transparency
✓ Drop-in integration with Dentrix, Eaglesoft, Carestream, and others
✓ Patient payment plan billing — recurring, built in, no extra cost
✓ HSA/FSA card support
✓ Same-day funding
✓ Free equipment and setup — no disruption to how you work today

I'd love to run a complimentary analysis on your current statement. Can we schedule 10 minutes this week?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. On $80K/mo in dental volume, 3% vs 2% = $800/mo difference. We integrate with Dentrix/Eaglesoft and cut fees without changing your workflow. Free analysis — worth a call?",
    followUpEmail: {
      subject: "Dentrix/Eaglesoft processing vs. interchange-plus — the $9,600 number",
      body: `Hi {{firstName}},

Quick number: on $80K/month in card volume, the difference between 3% flat (the rate most dental software processors charge) and 2% interchange-plus is $800/month — or $9,600 a year.

Most practices we work with were paying that gap without realizing it. The switch takes about a day and doesn't change your front-desk workflow in Dentrix or Eaglesoft — we integrate directly.

Forward your last processing statement to {{agentEmail}} and I'll have a line-by-line breakdown back within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, following up! Forwarding your last processing statement to {{agentEmail}} could reveal $800+/mo in savings for your practice. We integrate with Dentrix/Eaglesoft — no workflow changes. Takes 2 min!",
    thirdEmail: {
      subject: "Last note — your Dentrix/Eaglesoft processing cost",
      body: `Hi {{firstName}},

I'll keep this short — this is my last note on the subject.

If your practice is processing $60K–$100K/month through your dental software's built-in payment system, there's a very good chance you're paying $600–$1,000/month more than you need to.

The math is simple, the switch is painless (we integrate with your PMS directly), and the analysis is completely free.

If you ever want to know where you stand: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    thirdSms: "Hi {{firstName}}, last check-in from Liberty Bancard. If you ever want a free look at your dental processing costs vs. what you could pay, just email your statement to {{agentEmail}}. No pressure — we're here when it makes sense.",
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
      subject: "Your gym's membership billing — the two numbers that matter",
      body: `Hi {{firstName}},

For a gym with 200+ members on recurring billing, every 0.5% you overpay on interchange costs roughly $120/month. That's $1,440 a year — before counting failed-payment churn.

Two things we consistently fix for fitness businesses: the per-charge cost on membership transactions, and the dunning setup that recovers failed payments before members cancel.

Forward your last processing statement to {{agentEmail}} and I'll have a full analysis back to you in 24 hours.

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

One thing I didn't cover in my first email:

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
      subject: "LawPay compliance at a lower rate — the comparison",
      body: `Hi {{firstName}},

One thing that surprises most attorneys: firms using LawPay are typically paying 2.9–3.5% on credit card retainers. Our IOLTA-compliant program delivers the same trust-account protection at 1.9–2.3% for most transaction types.

Same compliance framework. Lower cost.

Forward your last processing statement to {{agentEmail}} and I'll put together a side-by-side comparison within 24 hours. No pressure — just the numbers.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hi {{firstName}}, following up from Liberty Bancard. IOLTA-compliant processing at lower rates than LawPay — most firms save $400–$1,200/mo. Free analysis at {{agentEmail}} — worth a look! ⚖️",
  },

  "Auto Shop": {
    email: {
      subject: "Auto shops on Square or Clover are overpaying — here's the math",
      body: `Hi {{firstName}},

If your auto shop is running on Square or Clover, you're likely paying 2.6–2.75% on every transaction — including your biggest repair invoices.

On a $2,500 transmission job, that's $65 in processing fees. On a $4,000 brake and suspension job, it's $110. Multiply that across your monthly volume and it's a significant line item on your P&L.

At Liberty Bancard, we've helped dozens of independent auto shops and service centers cut that cost:

✓ Interchange-plus pricing — dramatically lower on large, high-ticket invoices
✓ Cash discount / dual-pricing program — eliminate your processing fees entirely (compliant, card-brand-approved)
✓ Free modern terminal or integration with your shop management software
✓ Same-day or next-day funding — critical when you're fronting parts costs
✓ No long-term contract required

For a shop doing $70K/month in card volume, switching from 2.65% flat to interchange-plus saves $400–$700/month. The cash discount option can push that to $1,500+/month.

Can I run a free comparison on your statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. Auto shops on Square or Clover usually overpay on big repair invoices. We offer interchange-plus + cash discount programs — most shops save $400–$1,000/mo. Free analysis, no obligation?",
    followUpEmail: {
      subject: "Auto shop processing — the cash discount angle",
      body: `Hi {{firstName}},

One thing I didn't highlight in my first email: for auto shops, the cash discount program is often the biggest win.

Here's how it works: customers paying by credit card see a price that includes the processing cost built in. Customers paying cash get a discount (typically 3–4%). The net result is that your processing cost drops to near zero — legally, and with full card-brand approval.

Many shops we work with eliminate $1,000–$2,500/month in processing fees with this structure. The customer experience is clean, the signage is simple, and the ROI shows up on day one.

Forward your last processing statement to {{agentEmail}} and I'll show you exactly what both options — interchange-plus and cash discount — would look like for your volume.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, quick follow-up from Liberty Bancard! For auto shops, our cash discount program can eliminate processing fees almost entirely. Free analysis at {{agentEmail}} — your statement, 24hr turnaround. Worth a look?",
    thirdEmail: {
      subject: "Last note for {{businessName}} — processing cost review",
      body: `Hi {{firstName}},

I'll wrap up here — I know you're busy running the shop.

Quick summary of what I've been trying to say: most independent auto shops are paying $500–$1,500/month more than they need to in processing fees, primarily because Square and Clover use flat-rate pricing that isn't optimized for large repair invoices.

If that number sounds meaningful to your business, I'm happy to run the comparison for free: {{agentEmail}}

No commitment, no obligation — just the numbers.

{{agentName}}
Liberty Bancard`,
    },
    thirdSms: "Hi {{firstName}}, last message from Liberty Bancard. If your shop ever wants a free processing cost review, send your last statement to {{agentEmail}}. Most auto shops find $400–$1,000/mo in savings. No pressure — take care!",
  },

  Jewelry: {
    email: {
      subject: "Jewelry retailers: First Data and Fiserv are expensive — there's a better option",
      body: `Hi {{firstName}},

Jewelry stores have some of the highest average transaction values in retail — and that makes your choice of payment processor a high-stakes decision. If you're on First Data, Fiserv, or a similar legacy processor, you're likely paying bundled or tiered rates that don't reflect the true interchange cost on your high-value sales.

Here's the opportunity: interchange-plus pricing, combined with a cash discount or dual-pricing program, can dramatically reduce what you're paying on every sale.

At Liberty Bancard, we specialize in high-ticket retail:

✓ Interchange-plus pricing — transparent, no hidden markups on premium cards
✓ Cash discount / dual-pricing program — shift processing cost to card-paying customers (legal, compliant)
✓ High-limit authorization support for large purchases ($5K–$50K)
✓ Layaway and installment billing support
✓ Chargeback protection — critical for high-value item disputes
✓ Same-day funding so your cash flow matches your sales pace

For a jewelry retailer doing $120K/month in card volume, the difference between 2.8% bundled and interchange-plus can be $800–$1,400/month. The cash discount option can add another $1,500–$2,500/month back to the business.

Can I run a free analysis on your current statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. Jewelry retailers on First Data/Fiserv typically overpay on high-ticket sales. We offer interchange-plus + cash discount programs built for luxury retail — most save $800–$2,000/mo. Free analysis?",
    followUpEmail: {
      subject: "Jewelry retail processing — cash discount + high-ticket auth",
      body: `Hi {{firstName}},

Following up on my earlier note. Two things I wanted to highlight specifically for jewelry retail:

1. Cash discount program: On a $3,000 diamond ring, a 3.5% processing fee is $105. A properly structured cash discount program shifts that cost to card-paying customers — entirely legally. Most jewelry stores implementing this recover $1,500–$3,000/month in what were previously processing fees.

2. High-ticket authorization support: Sales over $5K require specific authorization handling to minimize declines and downgrade risks. We configure this correctly from day one.

Send your last processing statement to {{agentEmail}} and I'll put together a full comparison within 24 hours — including what the cash discount program would look like for your volume.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hi {{firstName}}, quick follow-up from Liberty Bancard! Cash discount + interchange-plus is a powerful combo for jewelry retail. Most stores recover $1,500–$3,000/mo in fees. Free analysis at {{agentEmail}} — takes 2 min!",
    thirdEmail: {
      subject: "Final note — jewelry processing cost review",
      body: `Hi {{firstName}},

This is my last note — I don't want to be a nuisance.

The short version: if your jewelry store is doing $80K+/month in card volume on First Data, Fiserv, or a similar legacy processor, there is almost certainly $800–$2,000/month in savings available — either through better pricing, a cash discount program, or both.

If the timing is ever right: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    thirdSms: "Hi {{firstName}}, last message from Liberty Bancard. Whenever you're ready to review your jewelry store's processing costs, send your statement to {{agentEmail}}. Most clients we work with save $800–$2,000/mo. No pressure!",
  },

  Veterinary: {
    email: {
      subject: "Vet practices on VetPay or Square are usually overpaying — here's the math",
      body: `Hi {{firstName}},

Veterinary practices deal with a unique payment mix: emergency visits with large, unexpected invoices, routine care, pet insurance reimbursements, and an increasing share of premium rewards credit cards — which carry some of the highest interchange rates in the industry.

If you're processing through VetPay, Square, or your practice management software's built-in payments, you're likely on a flat rate of 2.6–3.2% that doesn't account for this mix.

At Liberty Bancard, we work with independent vet practices and specialty animal hospitals:

✓ Interchange-plus pricing — optimized for your specific transaction mix
✓ Large emergency invoice support — high-ticket authorizations handled correctly
✓ Care credit / payment plan integration support
✓ Integration with Avimark, eVetPractice, Cornerstone, and other vet PMS platforms
✓ Same-day funding — critical when you're managing supply and medication costs
✓ No long-term contract required

For a vet practice doing $80K/month in card volume, moving from 2.9% flat to interchange-plus typically saves $500–$900/month. That's money that can go toward equipment, staffing, or simply improving margin.

Can I run a free analysis on your current processing statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. Vet practices on VetPay or Square typically overpay on large emergency invoices and premium reward cards. We offer interchange-plus tailored for veterinary — most save $500–$900/mo. Free analysis?",
    followUpEmail: {
      subject: "Veterinary practice processing — the premium card problem",
      body: `Hi {{firstName}},

Following up on my earlier message — one thing worth highlighting for vet practices specifically:

Your clients are increasingly paying with premium rewards credit cards (Chase Sapphire, Amex Platinum, etc.). These cards carry some of the highest interchange rates in the system — often 2.3–2.5% just for interchange before processor markup.

On a flat-rate processor at 2.75%, you're paying about the same whether the card is a basic debit card or an Amex Gold. With interchange-plus, your debit and standard cards come in significantly cheaper, which brings your blended effective rate down.

For a practice doing $80K/month in cards, that optimization alone is often $400–$700/month.

Forward your last processing statement to {{agentEmail}} and I'll show you exactly where the savings are for your specific card mix.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hey {{firstName}}, following up from Liberty Bancard! Premium reward cards cost vet practices extra on flat-rate processors. Interchange-plus fixes that — most practices save $500–$900/mo. Free analysis at {{agentEmail}}. Worth a look?",
    thirdEmail: {
      subject: "Last note — processing cost review for your practice",
      body: `Hi {{firstName}},

Last note from me — I don't want to overstay my welcome.

If your veterinary practice ever wants an independent look at what you're paying in processing fees vs. what you should be paying, I'm here: {{agentEmail}}

Most vet practices we work with save $500–$900/month. The analysis is free, takes 24 hours, and comes with no obligation.

{{agentName}}
Liberty Bancard`,
    },
    thirdSms: "Hi {{firstName}}, last message from Liberty Bancard. If you ever want a free processing review for your vet practice, email your statement to {{agentEmail}}. Most practices find $500–$900/mo in savings. Take care!",
  },

  MedSpa: {
    email: {
      subject: "Med spas on Square or Stripe are losing $700–$2,500/month — here's why",
      body: `Hi {{firstName}},

Med spas run some of the highest average ticket sizes in the service industry — Botox, filler, laser treatments, and membership packages at $300–$1,500 per visit. That makes your payment processor choice one of the highest-impact financial decisions in your business.

If you're using Square or Stripe at 2.6–2.9% flat, you're paying the same rate on a $1,200 Sculptra appointment as you would on a $10 coffee. That flat-rate math doesn't work in your favor.

At Liberty Bancard, we build payment programs specifically for med spas and aesthetic practices:

✓ Interchange-plus pricing — lower effective rate on high-ticket treatments
✓ Cash discount program — shift processing cost to card-paying clients (primary hook for high-AOV practices)
✓ Membership and package recurring billing — tokenized, PCI-compliant
✓ Chargeback protection for prepaid treatment packages
✓ Integration with Jane, Vagaro, Mindbody, Zenoti, and Aesthetic Record
✓ Same-day funding

Med spas doing $80K–$150K/month typically save $700–$2,500/month after switching. The cash discount option alone can add $2,000–$4,000/month back to the business.

Can I run a free analysis on your current statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    sms: "Hi {{firstName}}, {{agentName}} from Liberty Bancard. Med spas on Square or Stripe typically overpay on high-ticket treatments. Cash discount + interchange-plus can save $700–$2,500/mo. Free analysis — interested?",
    followUpEmail: {
      subject: "Med spa cash discount — the $2,000/month opportunity",
      body: `Hi {{firstName}},

Following up on my earlier email. For med spas specifically, the cash discount program is often the highest-ROI move.

Here's the math: a practice doing 150 treatments at an average $700 ticket runs $105K/month through their processor. At 2.7% flat, that's $2,835/month in fees. With a properly structured cash discount program, that cost shifts to card-paying clients — your effective cost drops to near zero.

That $2,835/month could fund a new laser head, cover a part-time esthetician's salary, or simply improve your margin on every appointment.

Send your last processing statement to {{agentEmail}} and I'll put together a complete side-by-side within 24 hours — showing both the interchange-plus savings and the full cash discount scenario.

{{agentName}}
Liberty Bancard`,
    },
    followUpSms: "Hi {{firstName}}, quick follow-up from Liberty Bancard! Cash discount programs for med spas can recover $2,000+/mo in processing fees. Free analysis at {{agentEmail}} — your statement, 24hr turnaround, no commitment. 💆",
    thirdEmail: {
      subject: "Last note — med spa processing cost",
      body: `Hi {{firstName}},

Wrapping up here — I know your inbox is full.

The short version: if your med spa is doing $80K+/month in card volume on Square or Stripe, there's likely $700–$2,500/month in savings available through better pricing or a cash discount program.

Whenever it makes sense: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    thirdSms: "Hi {{firstName}}, last message from Liberty Bancard. Whenever you're ready to review your med spa's processing costs, send your statement to {{agentEmail}}. Most practices find $700–$2,500/mo in savings. No pressure — we're here!",
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
  const result = Object.entries(variables).reduce(
    (text, [key, value]) => text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value),
    template
  );
  // Safety net: warn if any raw {{...}} placeholder survived substitution
  const remaining = result.match(/\{\{[^}]+\}\}/g);
  if (remaining) {
    console.warn(
      `[renderTemplate] Unresolved template placeholders: ${remaining.join(", ")}. ` +
      `Provided keys: ${Object.keys(variables).join(", ")}`
    );
  }
  return result;
}
