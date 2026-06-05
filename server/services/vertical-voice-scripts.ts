export interface VoiceScript {
  opening: string;
  valueProposition: string;
  painPoints: string[];
  questions: string[];
  objectionHandlers: Record<string, string>;
  closingStatement: string;
  followUpHook: string;
}

export const VERTICAL_VOICE_SCRIPTS: Record<string, VoiceScript> = {
  Restaurant: {
    opening: "Hi {{firstName}}, this is {{agentName}} calling from Liberty Bancard. I work with a lot of restaurants in the area, and I noticed you're processing payments — I'd love to show you how we've helped similar restaurants keep more of what they earn on every transaction.",
    valueProposition: "We specialize in restaurant payment processing and have helped our clients reduce processing costs by an average of 25–35%. For a restaurant doing $50K a month in cards, that's often $800–$1,200 back in your pocket every month.",
    painPoints: [
      "High swipe fees eating into already-thin restaurant margins",
      "Weekend and holiday surcharges from current processor",
      "POS system locked into expensive equipment leases",
      "Chargebacks from disputed tabs or delivery orders",
    ],
    questions: [
      "Are you currently on a flat-rate or interchange-plus pricing model?",
      "What POS system are you using — Toast, Square, Clover, something else?",
      "Do you offer delivery or third-party ordering platforms?",
      "About how many card transactions does the restaurant run per month?",
    ],
    objectionHandlers: {
      "happy with current processor": "I understand — most restaurant owners I talk to are 'fine' with their current processor until they see a side-by-side comparison. It takes about 10 minutes to analyze your statement, and there's zero obligation. If we can't beat what you're paying, I'll tell you straight up.",
      "too busy": "Absolutely — I know how hectic the restaurant business is. Can I email you a quick overview and schedule a 10-minute call later this week? I promise to respect your time.",
      "locked in a contract": "We handle buyouts all the time. Let me take a look at your current agreement and see if the savings we can offer outweigh the exit cost — in most cases they do. Can you send over your latest statement?",
    },
    closingStatement: "Let me send you a free statement analysis right now. All you need to do is forward me your last month's processing statement — takes two minutes. I'll have a full breakdown back to you within 24 hours showing exactly how much you'd save.",
    followUpHook: "I'll circle back with your personalized savings report. Even $400 a month in savings could cover a new kitchen appliance or cover an extra shift — real money for a restaurant.",
  },

  Retail: {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with retail stores across the area on payment processing, and I'm reaching out because we've been able to significantly lower costs for shops like yours.",
    valueProposition: "We offer retail-specific interchange-plus pricing with no junk fees, same-day funding, and free equipment. Most retail clients see a 20–30% reduction in their monthly processing bill within 30 days of switching.",
    painPoints: [
      "Flat-rate pricing costing extra on debit and smaller transactions",
      "Long waits for next-day or 2-day funding",
      "Hidden monthly and annual fees from current processor",
      "Equipment lease payments for outdated terminals",
    ],
    questions: [
      "What's your approximate monthly card volume?",
      "Are you currently on a month-to-month contract or locked in?",
      "Do you sell online as well, or primarily in-store?",
      "What terminal or POS are you using?",
    ],
    objectionHandlers: {
      "happy with current processor": "Great — I'd just ask you this: when's the last time you actually shopped your rates? Most retail owners I talk to haven't compared in 2+ years. We can run a free analysis against your current statement in under a day, no commitment needed.",
      "no time": "I completely respect that. Can I just get your statement emailed to me? I'll do all the legwork and send you back a savings report — you review it on your own time.",
      "rates are fine": "Fair enough. Out of curiosity, do you know your effective rate? Most retail owners guess around 2.5% — when we dig into the statement it's often 3.1–3.4%. If it turns out yours really is low, we'll confirm that for you at no charge.",
    },
    closingStatement: "Let me put a free analysis together for you — just forward your latest processing statement and I'll have a full savings breakdown within 24 hours with zero pressure attached.",
    followUpHook: "The savings analysis will show your current effective rate vs. what we'd offer, line by line. Most retail owners find at least $300–$700/month in immediate savings.",
  },

  Healthcare: {
    opening: "Hi {{firstName}}, this is {{agentName}} with Liberty Bancard. We work with medical practices on their payment processing, and given the compliance requirements in healthcare, I wanted to reach out and see if we could save your practice some money while also ensuring you're fully PCI-compliant.",
    valueProposition: "We specialize in healthcare payment processing — HIPAA-aware workflows, patient payment plans, and interchange-plus pricing that can save most practices $500–$1,500 a month compared to flat-rate processors like Square or Stripe.",
    painPoints: [
      "High flat rates on insurance copays and patient self-pay",
      "Lack of patient payment plan / recurring billing support",
      "PCI compliance uncertainty with current setup",
      "Chargebacks from patient billing disputes",
    ],
    questions: [
      "Do you primarily process in-office copays, or do you also bill patients directly?",
      "Are you using a practice management system like Kareo, Athena, or AdvancedMD?",
      "Do you offer payment plans for larger patient balances?",
      "What's your approximate monthly card volume across all payment types?",
    ],
    objectionHandlers: {
      "we use our EHR billing": "Understood — many practices use their EHR's built-in billing. The problem is those are often passing through a third-party processor at flat-rate fees. We can integrate with most EHR systems and typically cut the processing cost significantly.",
      "too complex to switch": "We handle the entire transition and work directly with your practice manager. Most healthcare practices are fully live in 3–5 business days with zero downtime.",
      "not interested": "I understand — can I ask, do you know what your current effective rate is? If you're over 2.5% on card transactions, there's almost certainly room to save. A 10-minute call could be worth $12,000 a year to your practice.",
    },
    closingStatement: "Send me your last statement and I'll put together a healthcare-specific savings analysis — including how we handle patient payment plans and any compliance considerations for your practice type.",
    followUpHook: "Practices that switch to our healthcare solution typically recover the cost of any transition within the first billing cycle. Let me show you the numbers specific to your practice.",
  },

  Dental: {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with dental practices specifically on payment processing, and I wanted to reach out because we've been able to help a lot of dentists reduce what they're paying per transaction — especially on larger cosmetic and restorative cases.",
    valueProposition: "Dental practices are uniquely positioned to save on processing because of the higher average ticket size. We've helped dental offices save $600–$2,000 a month by moving to interchange-plus and adding patient financing options at no extra cost to the practice.",
    painPoints: [
      "High flat-rate fees on large cosmetic/restorative procedures",
      "Limited patient financing or payment plan options",
      "Processing through the dental software at inflated rates",
      "No next-day funding — cash flow delays",
    ],
    questions: [
      "Are you currently using Dentrix, Eaglesoft, or another dental management system?",
      "Do you process patient financing in-house or through a third party like CareCredit?",
      "What's your average ticket size for a typical restorative or cosmetic case?",
      "Roughly how much card volume does the practice run per month?",
    ],
    objectionHandlers: {
      "we use our dental software's payment": "That's very common — dental software processors are almost always flat-rate and typically the most expensive option. We integrate with most dental software systems and can cut that cost substantially.",
      "we offer carecredit": "CareCredit is great for patients, but you're paying 4–8% for that convenience. We can offer patient payment plans directly through your processing setup at your standard rate, keeping more margin in the practice.",
      "not looking to change": "Totally fair — I just want to make sure you have the information to make that decision knowingly. Would you be open to a 10-minute comparison? If we can't show you at least $400/month in savings, I'll leave you alone.",
    },
    closingStatement: "Let me run a complimentary analysis on your statement — no commitment, no obligation. I'll have a dental-specific report back to you within 24 hours.",
    followUpHook: "Most dental practices that switch save enough in the first year to fund a new piece of equipment. Let me show you what that looks like for your specific volume.",
  },

  "Med Spa": {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. I work with med spas and aesthetic practices on their payment processing, and I noticed you're doing some great things — I wanted to reach out about some significant savings opportunities we've found for practices like yours.",
    valueProposition: "Med spas have a unique mix of cash-pay services, high ticket items, and package sales that can be very expensive to process at flat rates. We've helped med spas save $700–$2,500 a month with interchange-plus pricing and built-in package/subscription billing.",
    painPoints: [
      "Flat-rate fees on high-dollar treatments like injectables and laser",
      "Package and membership billing that requires recurring payment support",
      "Chargebacks on prepaid treatment packages",
      "No flexible payment plan options for clients investing in multi-session treatments",
    ],
    questions: [
      "Do you sell treatment packages or memberships that require recurring billing?",
      "What's your average ticket for a typical visit — are you seeing a lot of $500+ transactions?",
      "Are you currently using any aesthetic management software like Jane, Vagaro, or Zenoti?",
      "Do you process any online payments or deposits for appointments?",
    ],
    objectionHandlers: {
      "square works fine for us": "Square is easy to set up, but at 2.6% flat you're probably leaving $1,000–$2,000 a month on the table. For a med spa doing $80K/month, that's over $20K a year. Can I at least show you what interchange-plus would cost you instead?",
      "we have a contract": "Let's look at the buyout terms — we often cover early termination fees when the savings make sense. Many of our med spa clients paid nothing to switch.",
      "too busy to deal with this": "I understand — running a med spa is demanding. Can I email you a one-page analysis? You can review it between clients and respond whenever it's convenient.",
    },
    closingStatement: "Forward me your last statement and I'll build you a complete med spa processing analysis — including recurring billing options and what you'd save per month starting on day one.",
    followUpHook: "The analysis is free, takes you two minutes to request, and typically shows $8,000–$20,000 in annual savings. That's real money for growing your practice.",
  },

  "Auto Repair": {
    opening: "Hi {{firstName}}, this is {{agentName}} calling from Liberty Bancard. We work with auto repair shops and dealerships on their payment processing, and I wanted to reach out because we've helped a lot of shops in this area lower their monthly costs significantly.",
    valueProposition: "Auto repair shops often have high ticket sizes — oil changes to major engine work — and flat-rate processing is brutally expensive at that volume. We've helped shops save $400–$1,200 a month with interchange-plus pricing and free equipment upgrades.",
    painPoints: [
      "High flat-rate fees on large repair invoices ($800–$3,000+)",
      "Paying for outdated terminal equipment via lease",
      "No option to pass a convenience fee to customers",
      "Delayed funding affecting parts purchasing cash flow",
    ],
    questions: [
      "What's your typical repair invoice average — are you seeing mostly under $500 or larger jobs regularly?",
      "Are you currently leasing your equipment or own it outright?",
      "Do you do any fleet accounts or commercial billing?",
      "How many card transactions would you say you process on a busy day?",
    ],
    objectionHandlers: {
      "we pass the fee to the customer": "Smart move — are you doing that through a formal surcharging program, or just informally? We can set up a compliant cash-discount or surcharge program that covers your entire processing cost legally.",
      "my accountant handles this": "Totally fine — would it make sense to loop them in? We can send a summary report directly to your accountant showing the comparison, and they can advise from there.",
      "just switched": "Got it — when does your current agreement expire? If it's within the next 6 months, let's stay in touch. Most shops find significant savings when they can compare at renewal.",
    },
    closingStatement: "Let me put together a free statement analysis for you — send over your last month's processing statement and I'll have a breakdown back to you within 24 hours showing exactly how much you'd save.",
    followUpHook: "For an auto shop doing $100K/month in cards, every 0.5% reduction in your effective rate is $500/month — that's money that goes straight to the bottom line.",
  },

  "Salon/Beauty": {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with salons and beauty businesses on their payment processing, and I wanted to reach out because we've been able to really move the needle for businesses like yours.",
    valueProposition: "Salons often process a high volume of smaller transactions plus tips — and flat-rate processors can be very costly on that mix. We've helped salons save $200–$700 a month and offer free tip-enabled terminals with same-day funding.",
    painPoints: [
      "High fees on small ticket transactions (blowouts, waxing, nails)",
      "Tip processing that adds to the fee basis",
      "Monthly and annual fees from current processor",
      "Square or Stripe at 2.6–2.9% when interchange would be much cheaper",
    ],
    questions: [
      "What's your approximate monthly card volume between all your stylists or chairs?",
      "Are you using a booking platform like Vagaro, Fresha, or StyleSeat that also processes payments?",
      "Do your clients regularly tip on card?",
      "Are you on a booth-rental model, or do you pay your stylists as employees?",
    ],
    objectionHandlers: {
      "we use vagaro/fresha": "Those platforms are great for booking — but their built-in processing is typically 2.5–2.9% flat. We can connect you to lower-cost processing while you keep using the booking software you love.",
      "too small to matter": "I hear that — but let's do the math: if you're doing $25K/month in cards at 2.7%, that's $675/month. We could get that to $400 or less. That $275 difference pays for a supply order or an extra booth every single month.",
      "happy with my current setup": "Totally understand — can I send you a quick comparison anyway? Takes me 24 hours and costs you nothing. If the numbers don't work, you'll know you're already getting a good deal.",
    },
    closingStatement: "Send me your latest statement and I'll have a salon-specific analysis back to you within a day — including what your per-transaction cost would be under our program.",
    followUpHook: "Many salon owners we work with reinvest those savings into retail product inventory or equipment upgrades. Let me show you what that looks like for your volume.",
  },

  "Gym/Fitness": {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with gyms and fitness studios on their payment processing, and I wanted to reach out — especially because membership-based businesses have some unique opportunities to save.",
    valueProposition: "Gyms and studios that process recurring memberships can dramatically reduce costs with interchange-plus pricing, especially on card-on-file recurring billing. We've helped fitness businesses save $300–$1,000 a month and handle membership billing seamlessly.",
    painPoints: [
      "High fees on recurring membership charges processed monthly",
      "Chargeback exposure from canceled memberships",
      "Processing through ABC Fitness or Mindbody at elevated rates",
      "No built-in dunning management for failed recurring payments",
    ],
    questions: [
      "Roughly how many active memberships do you have, and what's the average monthly charge?",
      "Are you processing memberships through your gym management software or a standalone processor?",
      "Do you sell class packages, personal training, or retail on top of memberships?",
      "What's your chargeback rate been like — any issues with disputed charges?",
    ],
    objectionHandlers: {
      "we use abc fitness/mindbody": "Those platforms are excellent for gym management — but their payment processing is typically more expensive than using a standalone processor. We integrate with both and can cut your per-transaction cost significantly.",
      "we have chargebacks sometimes": "That's actually something we can help with directly — we offer chargeback protection tools and clear member authorization workflows that reduce disputes. That alone often pays for the switch.",
      "locked in a contract": "Let's review your exit terms — if the math works, we often cover buyout costs when the savings are clear. What's your monthly volume? I can tell you in about 60 seconds if it makes sense.",
    },
    closingStatement: "Share your latest processing statement and I'll build out a gym-specific analysis — including what you'd save on recurring billing and any package or retail transactions.",
    followUpHook: "For a gym with 300 members paying $50/month, saving even 1% on card processing saves $1,800 a year automatically. Let me show you your actual number.",
  },

  "Hotel/Lodging": {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with hotels and lodging properties on their payment processing, and I wanted to reach out — hospitality is a category where we've been able to generate really meaningful savings.",
    valueProposition: "Hotels deal with card-not-present reservations, deposit holds, and high ticket nightly rates — all of which are expensive on flat-rate pricing. We offer hospitality-specific interchange-plus pricing with support for card-on-file, no-show charges, and same-day settlement.",
    painPoints: [
      "Card-not-present rates on reservation bookings",
      "High-ticket nightly rates processed at flat 2.9% or more",
      "Chargebacks from cancellation disputes",
      "No-show and deposit hold management",
    ],
    questions: [
      "What's your average nightly rate, and how many rooms are you running?",
      "Are you processing reservations through a PMS like Opera, Cloudbeds, or a similar system?",
      "Do you process deposits or card-on-file holds separately from final payment?",
      "Are you working with any OTAs like Expedia or Booking.com, and how does that affect your card volume?",
    ],
    objectionHandlers: {
      "we use our pms": "That's common — most PMS systems pass transactions through a built-in processor at elevated rates. We integrate with most major PMS platforms and can reduce the cost on every booking significantly.",
      "our volume is too low": "Even a 15-room property doing $30K/month in cards can save $300–$500 a month with the right pricing. That's real money — can I at least show you the analysis?",
      "too complicated to switch": "We handle the entire integration with your PMS, and most properties are fully transitioned in 3–5 business days with zero front-desk downtime. Our hospitality team has done this hundreds of times.",
    },
    closingStatement: "Send me your most recent processing statement and I'll have a hospitality-specific analysis back to you within 24 hours — including card-not-present optimization and deposit handling.",
    followUpHook: "Hotels that move to interchange-plus often save 0.6–1.2% on their effective rate. On $50K/month, that's $3,600–$7,200 back per year.",
  },

  Landscaping: {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with landscaping and lawn care businesses on their payment processing — I wanted to reach out because this industry has some specific opportunities to save that a lot of business owners aren't aware of.",
    valueProposition: "Landscaping businesses often invoice large commercial jobs alongside residential services. We offer interchange-plus pricing with Level 2/3 data for B2B payments, which can dramatically reduce the cost of commercial client transactions.",
    painPoints: [
      "High fees on large commercial landscaping invoices",
      "Square or QuickBooks payments at flat rates on job invoices",
      "Delayed funding affecting crew payroll and supply purchasing",
      "No business card interchange optimization (Level 2/3)",
    ],
    questions: [
      "Do you work with commercial accounts, HOAs, or primarily residential?",
      "How are clients typically paying — via invoice, in person, or online portal?",
      "What's your average job invoice — are you seeing mostly under $1,000 or larger commercial contracts?",
      "What software do you use for invoicing — QuickBooks, ServiceTitan, Jobber?",
    ],
    objectionHandlers: {
      "we take mostly checks": "Understood — but a lot of commercial clients and HOAs now prefer to pay by card. We can set you up with a virtual terminal and invoice link that makes it easy for clients to pay by card while keeping your cost per transaction low.",
      "we use quickbooks": "QuickBooks Payments charges 2.5–3.5% depending on how you accept the card. We can integrate directly with QuickBooks and drop that effective rate by a significant margin.",
      "not right now": "No problem at all — can I send you a quick overview so you have it when you're ready? Most landscaping businesses we talk to are surprised how much they're leaving on the table.",
    },
    closingStatement: "Let me put together a free analysis based on your statement — I'll look at your commercial vs. residential mix and calculate exactly where the biggest savings opportunities are.",
    followUpHook: "For a landscaping company doing $60K/month, even moving from 2.8% to 1.9% effective rate saves $540 a month. That covers a crew member's wages.",
  },

  Construction: {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with contractors and construction businesses on their payment processing — and I wanted to reach out because construction is actually one of the best industries to save on processing costs.",
    valueProposition: "Construction businesses often have high-ticket invoices and lots of commercial/B2B clients. With Level 2/3 data capture on business card transactions, we can reduce your effective rate by 30–50% on those payments. We've helped contractors save $600–$2,000 a month.",
    painPoints: [
      "High flat-rate fees on large project invoices ($10K–$100K+)",
      "Business card surcharges from current processor",
      "No Level 2/3 data optimization for commercial payments",
      "Slow funding when cash flow is critical for materials and payroll",
    ],
    questions: [
      "Are your clients primarily homeowners, commercial property owners, or other contractors?",
      "What's your average project invoice — under $10K, or do you regularly close larger jobs?",
      "Do you use progress billing or milestone payments on larger projects?",
      "What are you using for invoicing — QuickBooks, Builder Trend, CoConstruct?",
    ],
    objectionHandlers: {
      "clients pay by check": "That's common in construction — but more commercial clients are moving to card pay. When they do, you want to make sure you're optimized for it. We can have you set up with virtual terminal and ACH as well so you can accept any payment type at the best possible cost.",
      "margins are tight, can't add costs": "That's exactly why we're calling — we're going to reduce your costs, not add to them. If we can't save you money, we won't ask for your business. Let me prove it with a free statement review.",
      "i have a good accountant": "Smart — can we loop your accountant in? We can send them a comparison document that shows the fee structure side by side. Most accountants immediately see the opportunity.",
    },
    closingStatement: "Send over your latest processing statement and I'll put together a construction-specific analysis — including what Level 2/3 data capture would save you on your commercial client payments.",
    followUpHook: "A general contractor doing $150K/month in commercial card payments can save $1,500–$3,000/month just from Level 2/3 data optimization. Let me run your actual numbers.",
  },

  Legal: {
    opening: "Hi {{firstName}}, this is {{agentName}} from Liberty Bancard. We work with law firms on their payment processing — and I wanted to reach out because there are some compliance-critical aspects of legal payment processing that many firms aren't handling optimally.",
    valueProposition: "Law firms have unique payment processing needs — IOLTA trust account compliance, client retainer billing, and large case-fee transactions. We offer law-firm-specific processing with built-in IOLTA separation, and most firms save $400–$1,200 a month while staying fully compliant.",
    painPoints: [
      "IOLTA compliance risk with improperly configured payment processing",
      "High flat-rate fees on large retainer and settlement payments",
      "Commingling risk when credit card fees are deducted from trust accounts",
      "No recurring billing support for installment fee agreements",
    ],
    questions: [
      "Are you processing any payments into IOLTA trust accounts, or primarily into operating accounts?",
      "What's your typical retainer size, and do you bill against it monthly or case-by-case?",
      "Are you using practice management software like Clio, MyCase, or LawPay?",
      "How do you currently handle client payment plans for contingency or larger matters?",
    ],
    objectionHandlers: {
      "we use lawpay": "LawPay is excellent for IOLTA compliance — and we're fully compatible with their compliance framework as well. The difference is typically in the per-transaction cost. Most firms paying 2.9% with LawPay could be at 1.9–2.1% with us. Can I run a comparison?",
      "our bar association recommends lawpay": "Absolutely — and we support the same IOLTA-safe processing model they recommend. Our platform is designed for law firm compliance. I'd just like to show you what you'd save on a monthly basis.",
      "not looking to change right now": "Understood — would it be okay if I sent you our law firm processing overview and we reconnected at your next renewal? Changes like this are worth planning ahead.",
    },
    closingStatement: "Send me your latest processing statement and I'll put together a law-firm-specific analysis — including how we handle IOLTA trust vs. operating separation and what your savings would look like.",
    followUpHook: "For a mid-size firm doing $80K/month in client payments, our law-firm program typically saves $600–$1,200/month while keeping every transaction fully compliant.",
  },
};

export function getVoiceScript(vertical: string): VoiceScript | null {
  const key = Object.keys(VERTICAL_VOICE_SCRIPTS).find(
    k => k.toLowerCase() === vertical.toLowerCase() ||
         k.toLowerCase().replace(/[^a-z]/g, "") === vertical.toLowerCase().replace(/[^a-z]/g, "")
  );
  return key ? VERTICAL_VOICE_SCRIPTS[key] : null;
}
