export interface GlossaryFAQ {
  question: string;
  answer: string;
}

export interface GlossaryTerm {
  slug: string;
  name: string;
  shortDefinition: string;
  category: string;
  searchVolume: string;
  fullDefinition: string;
  merchantImpact: string;
  example: string;
  faqs: GlossaryFAQ[];
  relatedTerms: string[];
  commercialLinks: { label: string; href: string }[];
  libertySection: string;
}

export const glossaryCategories = [
  "Core Fee & Pricing Terms",
  "Transaction Flow Terms",
  "Account & Business Terms",
  "Risk & Compliance Terms",
  "Equipment & Technology Terms",
  "Interchange Categories",
  "Industry-Specific Terms",
];

export const glossaryTerms: GlossaryTerm[] = [
  {
    slug: "interchange-plus-pricing",
    name: "Interchange Plus Pricing",
    shortDefinition: "A transparent pricing model where merchants pay the card network's actual interchange fee plus a fixed processor markup.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "1,900/mo",
    fullDefinition: `Interchange plus pricing (also called "cost plus" or "pass-through pricing") is the most transparent pricing model in payment processing. Under this model, merchants pay two separate components: the actual interchange fee set by Visa or Mastercard, plus a fixed markup charged by their payment processor.

For example, if Visa's interchange rate on a particular card is 1.65% + $0.10, and your processor charges a 0.30% + $0.10 markup, your total cost is 1.95% + $0.20 per transaction. Every line on your statement clearly shows what went to the card network versus what went to your processor.

This stands in sharp contrast to flat-rate pricing (used by Square and Stripe) or tiered pricing, where the processor bundles all fees into a single opaque rate. With interchange plus, merchants can see exactly what they're paying and why — making it the preferred choice for businesses processing more than $10,000 per month.

Interchange plus pricing became widely available to small and mid-sized businesses starting in the 2010s as processor competition intensified. Today, it is considered the gold standard for cost-effective payment processing. Businesses with a mix of credit card types (rewards cards, corporate cards, debit cards) typically benefit most from interchange plus because they naturally receive lower rates on lower-cost card types — something flat-rate pricing completely ignores.

To get the best interchange plus rates, merchants should: (1) accept cards correctly to avoid downgrades, (2) batch transactions daily, (3) provide level 2/3 data for B2B transactions, and (4) understand which card types their customers use most.`,
    merchantImpact: `Interchange plus pricing directly affects how much of every dollar you keep. A restaurant processing $80,000/month that switches from a 2.6% flat rate to interchange plus at actual cost (averaging 1.8%) plus a 0.25% markup saves approximately $440 per month — over $5,000 per year.

The key merchant advantage is predictability. When card network fees change (which happens twice per year, in April and October), you see exactly what changed. With flat-rate pricing, you'd never know if your processor passed savings along or kept them.

Merchants with high average ticket sizes (over $50) and a mix of card types see the biggest savings. Those with primarily debit card customers may find the difference smaller, since debit interchange is regulated and already low.`,
    example: `A retail shop processes a $200 purchase on a Visa Signature Rewards card. Under interchange plus:
- Visa interchange rate: 1.65% + $0.10 = $3.40
- Processor markup: 0.25% + $0.10 = $0.60
- Total processing cost: $4.00 (2.00% effective rate)

Under flat-rate pricing at 2.6%:
- Total cost: $5.20

Savings on this single transaction: $1.20. Over a month of similar transactions, the savings compound significantly.`,
    faqs: [
      {
        question: "Is interchange plus pricing better than flat rate?",
        answer: "For most businesses processing over $5,000-$10,000 per month, yes. Interchange plus gives you visibility into your actual costs and typically results in lower effective rates. Flat rate is simpler but you pay a premium for that simplicity, and the processor keeps the difference.",
      },
      {
        question: "How do I know if I'm getting a good interchange plus rate?",
        answer: "Request a free statement analysis. A reputable processor should show you your current effective rate and what you'd pay under their interchange plus model. The markup (the processor's portion) should typically be between 0.10%–0.50% depending on your volume.",
      },
      {
        question: "What is a typical interchange plus markup?",
        answer: "Legitimate interchange plus markups range from 0.10% + $0.05 for high-volume merchants (over $1M/year) to 0.50% + $0.15 for smaller merchants. If a processor quotes you more than 0.75%, negotiate or shop around.",
      },
      {
        question: "Can I switch from flat rate to interchange plus without changing processors?",
        answer: "Sometimes. Square and Stripe do not offer interchange plus. If you're with a traditional ISO or bank-referred processor, ask to reprice to interchange plus — many will accommodate this to retain your business.",
      },
    ],
    relatedTerms: ["merchant-discount-rate", "interchange-fees", "flat-rate-pricing", "tiered-pricing", "effective-rate", "processor-markup", "passthrough-pricing"],
    commercialLinks: [
      { label: "Compare Your Current Rate", href: "/compare-rates" },
      { label: "Upload Your Statement for a Free Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard exclusively offers interchange plus pricing to all merchants — no tiered pricing, no flat-rate bundles, no surprises. We show you a line-by-line breakdown of what you're paying today and what you'd pay with us before you sign anything.

Our typical markup is 0.20%–0.35% depending on volume, well below industry averages. And because we're an ISO with direct access to wholesale rates, we can pass savings along that bank-referred processors can't.

Upload your most recent processing statement and we'll show you your exact interchange plus savings in 24 hours — no obligation.`,
  },
  {
    slug: "merchant-discount-rate",
    name: "Merchant Discount Rate",
    shortDefinition: "The total percentage fee a merchant pays per transaction, covering interchange, assessments, and processor markup.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "1,300/mo",
    fullDefinition: `The merchant discount rate (MDR) is the total cost a merchant pays to accept credit and debit card payments, expressed as a percentage of each transaction. It is called a "discount" because the payment processor discounts (deducts) this fee from the transaction amount before depositing funds into the merchant's bank account.

The MDR is not a single fee — it's a bundle of three cost components: interchange fees (paid to the card-issuing bank), assessment fees (paid to the card networks like Visa and Mastercard), and the processor's markup (the profit for your payment processor or ISO).

For example, if your MDR is 2.2%, a $100 sale results in $97.80 deposited to your account. The remaining $2.20 is split among the issuing bank, the card network, and your processor.

The MDR varies significantly based on your pricing model. Under tiered pricing, you get a single bundled rate for "qualified" transactions. Under interchange plus, the interchange component fluctuates with each card type while the markup remains fixed. Under flat-rate pricing, you pay the same percentage regardless of card type.

Your effective rate — the MDR you actually pay across all transactions — is the best metric for comparing processors. Calculate it by dividing total monthly fees by total monthly volume.`,
    merchantImpact: `The merchant discount rate is your single biggest operational cost after labor and cost of goods. Even a 0.50% difference in your MDR can translate to thousands of dollars annually.

A restaurant with $100,000 monthly volume paying 2.8% MDR versus 2.3% MDR pays $500 more per month — $6,000 per year. That's a part-time employee, equipment upgrades, or pure profit.

The MDR also affects your cash flow: some processors quote low MDRs but charge high statement fees, monthly minimums, or PCI fees. Always evaluate the all-in effective rate, not just the headline discount rate.`,
    example: `A dental practice processes $25,000 in credit card payments this month. Their MDR averages 2.4%:
- Interchange portion: ~1.8% = $450 to issuing banks
- Assessment portion: ~0.14% = $35 to Visa/Mastercard
- Processor markup: ~0.46% = $115 to their processor
- Total MDR cost: $600 for the month
- Deposited to their account: $24,400`,
    faqs: [
      {
        question: "What is a good merchant discount rate?",
        answer: "A good effective MDR for most businesses is between 1.7%–2.3% on credit cards. Businesses processing primarily debit cards can achieve lower rates. Anything above 2.8% warrants a competitive analysis — you're likely overpaying.",
      },
      {
        question: "Is the merchant discount rate negotiable?",
        answer: "Yes, especially if you process over $10,000/month. The interchange portion is fixed by card networks, but the processor markup is fully negotiable. Volume, industry type, and chargeback history all affect what rate you can negotiate.",
      },
      {
        question: "Why does my MDR change month to month?",
        answer: "Under interchange plus pricing, your MDR fluctuates because different card types carry different interchange rates. A month with more rewards card transactions will have a higher MDR than one with mostly debit cards. This is normal and expected.",
      },
      {
        question: "How is merchant discount rate different from effective rate?",
        answer: "The MDR is the stated rate; the effective rate is what you actually pay after all fees. Your effective rate includes monthly fees, PCI fees, statement fees, and other charges divided by your total volume. Always compare effective rates, not quoted MDRs.",
      },
    ],
    relatedTerms: ["interchange-fees", "assessment-fees", "processor-markup", "effective-rate", "interchange-plus-pricing", "flat-rate-pricing"],
    commercialLinks: [
      { label: "See What Your Real Rate Is", href: "/upload-statement" },
      { label: "Compare Processing Rates", href: "/compare-rates" },
    ],
    libertySection: `At Liberty Bancard, we don't just quote you a merchant discount rate — we show you every component. When you upload your current statement, we break down your interchange costs, assessment fees, and processor markup separately so you know exactly where your money goes.

Our merchants typically see their effective MDR drop 0.40%–0.80% after switching. Get a free statement analysis to see your real savings potential.`,
  },
  {
    slug: "interchange-fees",
    name: "Interchange Fees",
    shortDefinition: "Fees paid to the card-issuing bank on every transaction, set by Visa and Mastercard — the largest component of processing costs.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "2,400/mo",
    fullDefinition: `Interchange fees are the fees paid by the merchant's acquiring bank to the customer's issuing bank on every card transaction. They are set by the card networks (Visa, Mastercard, Discover, and American Express) and represent the largest single cost in payment processing — typically 70–85% of total processing fees.

Interchange rates are not negotiable by merchants or processors. They are published twice yearly (in April and October) by each card network and vary based on dozens of factors including: card type (debit vs. credit, rewards vs. basic, business vs. consumer), transaction type (card-present vs. card-not-present), merchant category code (MCC), and transaction size.

The rationale for interchange is that the issuing bank bears the risk of extending credit and the cost of rewards programs. Rewards cards (like travel miles and cash back cards) carry higher interchange rates than basic cards because the issuing bank uses interchange revenue to fund those rewards.

There are over 300 different interchange categories in the Visa and Mastercard rate tables. Under interchange plus pricing, merchants see exactly which category each transaction falls into and what rate applied. Under tiered pricing, these categories are hidden behind "qualified," "mid-qualified," and "non-qualified" buckets.

The Durbin Amendment (2011) capped debit card interchange for large banks at $0.21 + 0.05% per transaction — much lower than credit card rates. This is why debit card processing is significantly cheaper than credit card processing.`,
    merchantImpact: `Interchange fees are the floor cost of card acceptance — you cannot negotiate them away. What you can do is minimize them by: (1) accepting cards in the most favorable environment (card-present is cheaper than card-not-present), (2) providing complete transaction data to avoid downgrades, (3) batching daily, and (4) accepting debit when possible.

Understanding which interchange categories your transactions land in helps you identify where you're losing money to unnecessary downgrades. A B2B company that doesn't provide level 2 data may be paying commercial card rates of 2.65% instead of the level 2 rate of 1.90%.`,
    example: `A retail merchant processes a $500 corporate Visa card purchase:
- Standard corporate interchange rate: 2.65% + $0.10 = $13.35
- With level 2 data provided: 1.90% + $0.10 = $9.60
- Savings from providing level 2 data: $3.75 on this single transaction

Across dozens of corporate card transactions monthly, these savings add up quickly.`,
    faqs: [
      {
        question: "Who receives the interchange fee?",
        answer: "The customer's issuing bank (the bank that issued their credit or debit card) receives the interchange fee. Visa and Mastercard set the rates but do not keep the interchange — they collect separate assessment fees.",
      },
      {
        question: "Why are interchange rates so complex?",
        answer: "Interchange rates are complex because risk and cost vary enormously across transaction types. A card-present debit transaction has very little fraud risk; a card-not-present corporate rewards card has significant fraud risk and high reward funding costs. The 300+ rate categories reflect these differences.",
      },
      {
        question: "Can I see my interchange rates?",
        answer: "Yes. Visa and Mastercard publish their interchange tables publicly on their websites. Under interchange plus pricing, your statement shows which rate category each transaction fell into. Under tiered pricing, this information is hidden.",
      },
      {
        question: "Do interchange rates change?",
        answer: "Yes, card networks update interchange rates twice per year — in April and October. These changes are announced in advance. Under interchange plus pricing, your rates adjust automatically; under flat-rate pricing, your processor may or may not pass changes along.",
      },
    ],
    relatedTerms: ["assessment-fees", "merchant-discount-rate", "interchange-plus-pricing", "interchange-downgrade", "qualified-rate", "card-present", "card-not-present"],
    commercialLinks: [
      { label: "Get Interchange-Transparent Pricing", href: "/compare-rates" },
      { label: "Upload Statement for Free Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard passes interchange fees directly to you at cost — no markup on the interchange itself. Our only compensation is our fixed processor markup, which we disclose on every statement. This interchange transparency is what saves our merchants an average of $300–$800/month.

See your current interchange costs broken down in our free statement analysis.`,
  },
  {
    slug: "flat-rate-pricing",
    name: "Flat Rate Pricing",
    shortDefinition: "A simplified pricing model charging the same percentage on all transactions, regardless of card type or transaction method.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "880/mo",
    fullDefinition: `Flat rate pricing is a payment processing model where merchants pay the same percentage fee on every transaction, regardless of the card type used. Square charges 2.6% + $0.10 for in-person swipes; Stripe charges 2.9% + $0.30 for online transactions. These rates don't change whether a customer uses a basic debit card or a premium travel rewards card.

The appeal of flat rate pricing is simplicity. You know exactly what you'll pay per transaction. There are no surprises from interchange categories, no qualification tiers, and no complex statements. This makes flat rate ideal for new, very small, or low-volume businesses that value predictability over optimization.

The significant downside is cost. Flat rate processors set their rates above the average interchange cost so they profit on every transaction type. When a customer pays with a basic debit card (interchange ~0.05% + $0.22), the processor captures nearly the entire flat rate as profit. Merchants pay the same rate on low-cost transactions as on high-cost ones, which means they're subsidizing the processor's margin on cheap card types.

For businesses processing over $10,000-$15,000 per month with a diverse card mix, interchange plus pricing almost always saves money. The crossover point depends on your transaction mix and average ticket size.

Major flat rate providers include Square, Stripe, PayPal, and Shopify Payments. These companies built their businesses on ease of use and are excellent for startups, but become expensive as volume grows.`,
    merchantImpact: `Flat rate pricing is rarely the cheapest option for established businesses. A restaurant processing $60,000/month on Square (2.6%) pays $1,560 in fees. The same volume under interchange plus pricing at an effective rate of 1.9% costs $1,140 — saving $420/month or $5,040/year.

The key question: how much do you value simplicity over savings? For very small businesses, the management overhead of understanding interchange may not be worth the savings. For businesses grossing over $500,000/year, optimizing your payment processing is a meaningful financial lever.`,
    example: `A coffee shop processes $25,000/month. Customer mix: 40% debit cards, 60% credit cards.
- Under flat rate (2.6%): $650/month
- Under interchange plus (actual costs + 0.25% markup):
  - Debit cards: ~0.5% effective = $50
  - Credit cards: ~2.0% effective = $300
  - Total: $350/month
- Monthly savings: $300
- Annual savings: $3,600`,
    faqs: [
      {
        question: "Is flat rate pricing good for small businesses?",
        answer: "Flat rate pricing is excellent for businesses just starting out or processing under $5,000/month. The simplicity and no monthly fees make it accessible. As volume grows, the math favors switching to interchange plus pricing.",
      },
      {
        question: "Why does Square charge 2.6% when interchange is often lower?",
        answer: "Square charges a premium for simplicity, instant setup, no monthly fees, and no merchant account underwriting. They profit on the difference between actual interchange costs (which average around 1.7-1.9% for credit) and their flat rate. For high-volume merchants, this premium becomes significant.",
      },
      {
        question: "Can I negotiate my flat rate with Square or Stripe?",
        answer: "Large-volume merchants (over $250,000/year) may be able to negotiate custom rates with Square or Stripe. However, these platforms are not designed for custom interchange plus pricing, so negotiations are limited.",
      },
      {
        question: "When should I switch from flat rate to interchange plus?",
        answer: "Consider switching when your monthly processing volume exceeds $10,000-$15,000 consistently, or when you calculate that the savings from interchange plus would exceed $200/month. A free statement analysis can tell you your exact breakeven point.",
      },
    ],
    relatedTerms: ["interchange-plus-pricing", "tiered-pricing", "effective-rate", "merchant-discount-rate", "interchange-fees", "processor-markup"],
    commercialLinks: [
      { label: "See If You'd Save vs. Square or Stripe", href: "/beat-square-stripe" },
      { label: "Compare Your Rate", href: "/compare-rates" },
    ],
    libertySection: `If you're currently on Square or Stripe, Liberty Bancard can show you exactly what you'd save with interchange plus pricing — before you switch. We do a free side-by-side comparison using your actual statements.

Most merchants who switch from flat rate to Liberty Bancard save between $300–$1,000+ per month depending on volume and card mix.`,
  },
  {
    slug: "tiered-pricing",
    name: "Tiered Pricing",
    shortDefinition: "A pricing model that groups transactions into qualified, mid-qualified, and non-qualified tiers with different rates for each.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "590/mo",
    fullDefinition: `Tiered pricing (also called bundled pricing or bucket pricing) is a payment processing model that groups the 300+ interchange categories into three tiers: qualified, mid-qualified, and non-qualified. Each tier carries a different rate, with qualified being lowest and non-qualified being highest.

The problem with tiered pricing is opacity. The processor decides which transactions qualify for which tier — and these decisions are not always disclosed or consistent. A basic credit card swiped in-store might be "qualified" at 1.69%, but a rewards card or a keyed-in transaction might be "non-qualified" at 3.50% or higher. Merchants have no visibility into why a transaction was downgraded.

Processors profit significantly from tiered pricing because they can set non-qualified rates much higher than actual interchange costs, and control which transactions fall into each tier. Mid-qualified and non-qualified surcharges are where processors extract the most margin.

Tiered pricing was the industry standard for decades. Many small business merchants are still on tiered pricing without realizing it. If your statement shows qualified, mid-qualified, and non-qualified rates — or if you see mysterious "EIRF" or "NABU" fees — you're likely on tiered pricing and almost certainly overpaying.

Interchange plus pricing has replaced tiered pricing as the recommended model for all merchants serious about cost management.`,
    merchantImpact: `Tiered pricing creates unpredictable costs because you can't control which tier your transactions fall into. If your customers frequently pay with rewards cards (which are extremely common), most of your transactions will be non-qualified — at the highest rate.

Merchants on tiered pricing typically pay 20-40% more than they would on interchange plus pricing. The opacity makes it difficult to audit or challenge your bills. Ask your processor for a "rate sheet" — if they can't clearly show you every interchange category they've assigned to each tier, that's a red flag.`,
    example: `A landscaping company processes $30,000/month. Many customers pay with corporate or rewards cards.
- Tiered pricing: 70% non-qualified at 3.50%, 20% mid-qual at 2.75%, 10% qualified at 1.79%
  - Total cost: (0.70 × $30,000 × 3.50%) + (0.20 × $30,000 × 2.75%) + (0.10 × $30,000 × 1.79%)
  - = $735 + $165 + $53.70 = $953.70
- Interchange plus at actual cost + 0.30% markup:
  - Effective rate ~2.1% = $630
- Monthly savings switching to interchange plus: $323.70`,
    faqs: [
      {
        question: "How do I know if I'm on tiered pricing?",
        answer: "Look at your processing statement. If you see 'qualified,' 'mid-qualified,' and 'non-qualified' rate categories, you're on tiered pricing. If you see individual interchange categories listed next to your transactions, you're on interchange plus.",
      },
      {
        question: "Is tiered pricing always bad?",
        answer: "Tiered pricing isn't always bad, but it's almost never better than interchange plus for merchants processing over $10,000/month. It can seem simpler, but the hidden costs typically outweigh the benefit of simplicity.",
      },
      {
        question: "Why do banks still offer tiered pricing?",
        answer: "Tiered pricing is more profitable for processors because they control the tier assignments and profit from the spread between actual interchange cost and the tiered rate. Many merchants don't realize they're overpaying.",
      },
      {
        question: "Can I switch from tiered to interchange plus with my current processor?",
        answer: "Yes, in many cases. Ask your current processor to reprice you to interchange plus. If they refuse or quote an unreasonably high markup, that's a signal to shop your account. Switching is often straightforward with no equipment changes required.",
      },
    ],
    relatedTerms: ["interchange-plus-pricing", "flat-rate-pricing", "qualified-rate", "mid-qualified-rate", "non-qualified-rate", "interchange-downgrade", "effective-rate"],
    commercialLinks: [
      { label: "Upload Statement to Check if You're on Tiered Pricing", href: "/upload-statement" },
      { label: "Compare Interchange Plus vs. Tiered Pricing", href: "/compare-rates" },
    ],
    libertySection: `We never put merchants on tiered pricing. Liberty Bancard uses interchange plus exclusively — every rate, every fee, every transaction category is visible on your statement. If you're currently on tiered pricing, upload your statement and we'll show you what interchange plus would have cost you last month.`,
  },
  {
    slug: "effective-rate",
    name: "Effective Rate",
    shortDefinition: "The true all-in cost of payment processing — total fees divided by total volume — your single best metric for comparing processors.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "390/mo",
    fullDefinition: `The effective rate is the true all-in cost of payment processing, expressed as a percentage. It's calculated by dividing your total monthly processing fees (including all fees — not just transaction fees) by your total monthly processing volume.

Effective Rate = Total Monthly Fees ÷ Total Monthly Volume × 100

For example, if you paid $2,200 in total fees on $100,000 in volume, your effective rate is 2.2%.

The effective rate is the most honest way to compare payment processors because it captures everything: interchange fees, assessment fees, processor markup, monthly fees, statement fees, PCI compliance fees, batch fees, and any other charges. A processor might advertise 1.79% + $0.10 per transaction but charge $50/month in fees that push your effective rate to 2.4%.

Calculating your effective rate monthly gives you a baseline for comparison and lets you detect fee creep — when processors gradually add or increase fees over time.

Industry benchmarks for effective rates:
- Excellent: Under 1.8% (primarily debit, high volume)
- Good: 1.8%–2.2% (typical credit card mix)
- Average: 2.2%–2.6%
- High: Over 2.7% (usually tiered pricing or small volume)`,
    merchantImpact: `Your effective rate is the number that matters most. Processors know this, which is why some advertise low transaction rates while hiding fees in monthly minimums, PCI fees, and compliance fees.

Calculate your effective rate from your last 3 months of statements. If it's above 2.5% and you're processing more than $15,000/month, you're likely overpaying. Every 0.1% reduction in effective rate saves you $100/month per $100,000 in volume.

Track your effective rate month-over-month. If it's creeping up without explanation, your processor may be adding fees or your transaction mix may have shifted toward more expensive card types.`,
    example: `A med spa processes $45,000 in card volume per month. Their statement shows:
- Transaction fees: $940 (2.09%)
- Monthly account fee: $15
- PCI compliance fee: $9.95
- Statement fee: $10
- Batch fee: $0.25/day × 30 = $7.50
- Total fees: $982.45
- Effective rate: $982.45 ÷ $45,000 = 2.18%

Compare this to the 2.09% transaction rate advertised. The effective rate is what you actually pay.`,
    faqs: [
      {
        question: "How do I calculate my effective rate?",
        answer: "Add all fees from your processing statement — transaction fees, monthly fees, PCI fees, statement fees, everything. Divide by your total card volume for the month, then multiply by 100 to get the percentage. This is your effective rate.",
      },
      {
        question: "What is a good effective rate for my business?",
        answer: "An effective rate under 2.0% is excellent for most businesses. 2.0%–2.4% is typical. Above 2.5% warrants comparison shopping. The ideal rate depends on your card mix, volume, and industry.",
      },
      {
        question: "Why is my effective rate higher than my quoted rate?",
        answer: "Monthly fees, PCI fees, statement fees, and non-qualified surcharges all add to your total cost. The quoted transaction rate only reflects part of your costs. Your effective rate captures everything.",
      },
      {
        question: "How often does my effective rate change?",
        answer: "Your effective rate changes monthly based on card mix and fixed fees. It may also jump in April and October when card networks update interchange rates. Track it month-over-month to spot trends.",
      },
    ],
    relatedTerms: ["merchant-discount-rate", "interchange-plus-pricing", "tiered-pricing", "processor-markup", "assessment-fees", "interchange-fees"],
    commercialLinks: [
      { label: "Calculate Your True Effective Rate", href: "/upload-statement" },
      { label: "Compare Your Rate vs. Industry Benchmarks", href: "/compare-rates" },
    ],
    libertySection: `Liberty Bancard shows you your exact effective rate on every statement — and we benchmark it against industry averages for your business type. When we do a free statement analysis, we calculate your current effective rate and project what it would be with us.

Our merchants' average effective rate: 1.95%. The national average for similar-sized merchants: 2.6%.`,
  },
  {
    slug: "basis-points",
    name: "Basis Points",
    shortDefinition: "A unit of measurement equal to 0.01% (one hundredth of one percent), commonly used to express payment processing rates.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "480/mo",
    fullDefinition: `A basis point (bps) is a unit of measurement used in finance equal to 0.01%, or one hundredth of one percent. In payment processing, rates and markups are often quoted in basis points to make small differences more legible.

1 basis point = 0.01%
10 basis points = 0.10%
25 basis points = 0.25%
100 basis points = 1.00%

For example, a processor might say "our markup is 25 basis points over interchange" meaning 0.25%. Another might quote "50 bps" meaning 0.50%.

Basis points matter because small differences compound over high volumes. A 10 basis point difference (0.10%) on $1 million in annual processing volume equals $1,000/year. For a business doing $5 million, it's $5,000/year.

Payment professionals use basis points because it's more precise and easier to compare than fractions of percentages. "25 basis points" is clearer than "0.25%" when discussing margins.`,
    merchantImpact: `Understanding basis points helps you evaluate competing processor quotes. When comparing interchange plus pricing proposals, the key figure to compare is the markup in basis points.

A 10 basis point difference in markup seems small but adds up. At $100,000 monthly volume, 10 bps = $100/month = $1,200/year. Negotiate your markup down by 15–25 bps if you can — at sufficient volume, this is real money.`,
    example: `Two processor proposals for a $200,000/month business:
- Processor A: interchange + 35 bps + $0.10 per transaction (2,000 transactions/month)
  - Markup cost: $200,000 × 0.35% + 2,000 × $0.10 = $700 + $200 = $900/month
- Processor B: interchange + 20 bps + $0.15 per transaction
  - Markup cost: $200,000 × 0.20% + 2,000 × $0.15 = $400 + $300 = $700/month
- Processor B saves $200/month despite having a higher per-transaction fee`,
    faqs: [
      {
        question: "How many basis points is a good processor markup?",
        answer: "For interchange plus pricing, a good markup is 10–35 basis points for businesses processing over $100,000/month. Small businesses may pay 40–60 basis points. Anything over 75 basis points on interchange plus is high.",
      },
      {
        question: "How do I convert basis points to a percentage?",
        answer: "Divide basis points by 100 to get the percentage. 25 bps = 0.25%. 150 bps = 1.50%. Or multiply the percentage by 100 to get basis points: 0.35% = 35 bps.",
      },
      {
        question: "Why do processors quote rates in basis points?",
        answer: "Basis points make it easier to compare small differences in rates and communicate precisely about fractions of a percent. It's standard financial industry terminology.",
      },
    ],
    relatedTerms: ["interchange-plus-pricing", "processor-markup", "effective-rate", "merchant-discount-rate", "interchange-fees"],
    commercialLinks: [
      { label: "See Our Exact Markup in Basis Points", href: "/compare-rates" },
      { label: "Free Statement Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard quotes all markups in basis points for full transparency. Our current standard markup ranges from 20–35 basis points over interchange depending on volume. We'll show you the exact number before you sign anything.`,
  },
  {
    slug: "processor-markup",
    name: "Processor Markup",
    shortDefinition: "The fee charged by your payment processor on top of interchange costs — their profit on every transaction you process.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "210/mo",
    fullDefinition: `The processor markup is the portion of your payment processing fees that goes directly to your payment processor or ISO (Independent Sales Organization) as their profit. Under interchange plus pricing, the markup is separated from interchange fees on your statement, making it easy to see what your processor earns on each transaction.

The markup typically has two components: a percentage and a per-transaction flat fee. For example, "interchange + 0.30% + $0.10" means the processor earns 0.30% of the transaction amount plus $0.10 on every transaction, regardless of interchange rates.

Under tiered pricing, the markup is hidden inside the bundled rate, making it impossible to see what the processor actually earns. A tiered pricing processor might charge 2.69% and pay interchange of 1.65% — earning a 1.04% markup — without you knowing it.

Typical processor markups under interchange plus:
- Large merchants (over $1M/year): 0.05%–0.20% + $0.05–$0.10
- Mid-size merchants ($100K–$1M/year): 0.20%–0.40% + $0.10–$0.15
- Small merchants (under $100K/year): 0.35%–0.60% + $0.10–$0.25

ISOs and agents earn their income from this markup, which is why it's worth negotiating.`,
    merchantImpact: `The processor markup is the only component of your processing costs that is negotiable. Interchange and assessment fees are fixed by card networks. Your processor's markup is set by them and can be reduced through negotiation, volume growth, or shopping your account competitively.

Even a 0.15% reduction in markup saves $150/month per $100,000 in volume. When negotiating, focus on both the percentage and the per-transaction fee — high average ticket merchants benefit more from lower percentages, while high transaction count merchants benefit more from lower per-transaction fees.`,
    example: `A hardware store processes $150,000/month with 3,000 transactions.
Current markup: interchange + 0.45% + $0.15
Monthly markup cost: ($150,000 × 0.45%) + (3,000 × $0.15) = $675 + $450 = $1,125

After negotiating to: interchange + 0.25% + $0.10
Monthly markup cost: ($150,000 × 0.25%) + (3,000 × $0.10) = $375 + $300 = $675

Annual savings from negotiating markup: $5,400`,
    faqs: [
      {
        question: "What is a fair processor markup?",
        answer: "For interchange plus pricing, fair markups range from 0.20%–0.40% + $0.10 for most small to mid-size businesses. High-volume merchants can negotiate to 0.05%–0.15%. Anything above 0.60% is high.",
      },
      {
        question: "How do I find out my current processor markup?",
        answer: "On an interchange plus statement, the markup appears separately from interchange fees. On a tiered pricing statement, it's hidden. Upload your statement for a free analysis to find out what you're actually paying in markup.",
      },
      {
        question: "Can I negotiate my processor markup?",
        answer: "Yes, absolutely. Processors expect negotiation. Volume, industry risk, processing history, and competition all affect what markup you can negotiate. Most merchants who ask for a reduction get one.",
      },
    ],
    relatedTerms: ["interchange-plus-pricing", "interchange-fees", "assessment-fees", "effective-rate", "basis-points", "merchant-discount-rate"],
    commercialLinks: [
      { label: "See Liberty Bancard's Exact Markup", href: "/compare-rates" },
      { label: "Get a Free Statement Analysis", href: "/upload-statement" },
    ],
    libertySection: `At Liberty Bancard, our processor markup is disclosed on every statement — no hidden fees. We make our money on a fair, negotiated markup, not by hiding costs in tiered pricing or surprise fees. Contact us to see what markup we'd offer your business based on volume and card mix.`,
  },
  {
    slug: "assessment-fees",
    name: "Assessment Fees",
    shortDefinition: "Fees paid directly to card networks (Visa, Mastercard, Discover, Amex) on every transaction — separate from interchange and processor markup.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "390/mo",
    fullDefinition: `Assessment fees (also called network fees or dues and assessments) are fees paid directly to the card networks — Visa, Mastercard, Discover, and American Express — on every card transaction. They are distinct from interchange fees (which go to the issuing bank) and processor markup (which goes to your processor).

Assessment fees are relatively small, typically 0.10%–0.15% of transaction volume, but they are mandatory and non-negotiable. Visa charges 0.14% for credit transactions and 0.13% for debit. Mastercard charges slightly different rates depending on volume tiers. These rates are publicly available in each network's regulations.

In addition to the basic assessment rate, card networks charge various other fees including:
- NABU (Network Access and Brand Usage): Mastercard's per-transaction fee
- FANF (Fixed Acquirer Network Fee): Visa's fee based on merchant location count
- APF (Acquirer Processing Fee): Visa's per-transaction fee
- KICC: Mastercard's transaction processing fee

These additional fees collectively add 0.01%–0.05% to effective processing costs. Under interchange plus pricing, all assessment fees are passed through at cost. Under tiered pricing, they're often embedded in the quoted rate.`,
    merchantImpact: `Assessment fees are small individually but unavoidable. For a merchant processing $100,000/month, assessment fees total approximately $135–$175/month. These cannot be negotiated away — they're the card networks' dues for using their infrastructure.

What matters is that your processor passes assessment fees through at actual cost, rather than marking them up. Some tiered pricing processors bundle assessments into their rates and charge more than the actual network fees. Under interchange plus, you can verify that assessment fees match published network rates.`,
    example: `A salon processes $20,000 in Visa credit card transactions and $5,000 in Mastercard credit transactions this month.
- Visa assessment (0.14%): $20,000 × 0.14% = $28.00
- Visa APF (Acquirer Processing Fee): ~$0.0195 per transaction × 200 transactions = $3.90
- Mastercard assessment (~0.13%): $5,000 × 0.13% = $6.50
- Mastercard NABU: ~$0.0195 per transaction × 50 transactions = $0.98
- Total assessment fees: ~$39.38
- These fees go directly to Visa and Mastercard, not to the processor`,
    faqs: [
      {
        question: "Are assessment fees negotiable?",
        answer: "No. Assessment fees are set by card networks and are non-negotiable for all but the largest merchants (with billions in volume). What you can ensure is that your processor passes them through at actual cost rather than marking them up.",
      },
      {
        question: "What is the difference between interchange fees and assessment fees?",
        answer: "Interchange fees go to the bank that issued the customer's card. Assessment fees go to the card network (Visa, Mastercard, etc.) that processed the transaction. Both are charged on every transaction.",
      },
      {
        question: "Why do my assessment fees change month to month?",
        answer: "Assessment fees fluctuate with volume and transaction count. Visa's FANF fee may change based on how many locations you have. Network fee structures are complex but the changes are usually small.",
      },
    ],
    relatedTerms: ["interchange-fees", "merchant-discount-rate", "processor-markup", "interchange-plus-pricing", "effective-rate"],
    commercialLinks: [
      { label: "See All Fees Broken Down", href: "/upload-statement" },
      { label: "Compare Processing Costs", href: "/compare-rates" },
    ],
    libertySection: `Liberty Bancard passes all assessment fees through at actual card network cost — zero markup. On your statement, you'll see Visa and Mastercard fees listed separately and at published rates. We never use assessment fees as a hidden profit center.`,
  },
  {
    slug: "cash-discount-program",
    name: "Cash Discount Program",
    shortDefinition: "A legal program that offers customers a discount for paying with cash, effectively offsetting credit card processing costs for merchants.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "1,600/mo",
    fullDefinition: `A cash discount program is a pricing strategy where a merchant lists all prices at their credit card price (higher price) and offers a discount to customers who pay with cash. This program is compliant under Visa, Mastercard, and federal law — as long as it is implemented correctly.

The key distinction between a cash discount and credit card surcharging is the framing: with cash discount, you're reducing the price for cash payers; with surcharging, you're adding a fee for card payers. Cash discounts are legal in all 50 states. Surcharging has restrictions in some states.

Cash discount programs are typically implemented through software that displays two prices on the receipt: the standard price (with card) and the discounted cash price. Many point-of-sale systems support this automatically. The "standard" price includes a margin to cover processing costs — typically 3-4% — and cash customers receive that percentage back as a discount.

Merchants who implement cash discount programs effectively eliminate their credit card processing costs. The credit card processing fee is absorbed into the listed price, which card customers pay. Cash customers pay less.

For cash discount to work properly:
- All prices must be displayed at the card price
- The cash discount must be clearly disclosed to customers before purchase
- The program must be registered with card networks through your processor
- Receipts must show both the card price and the cash discount amount`,
    merchantImpact: `A successful cash discount program can reduce your processing costs to near zero. A restaurant processing $80,000/month and paying $2,000 in processing fees could eliminate those fees entirely.

However, cash discount programs affect customer experience. Some customers object to paying more with a card, especially where prices seem to have been artificially inflated. Industries with high card usage and price-sensitive customers (restaurants, retail, automotive) need to consider how customers will respond.

Cash discount programs work best in: gas stations, small retail, service businesses, restaurants, and healthcare. They work less well in luxury retail, hotels, and businesses where price transparency is critical.`,
    example: `A hair salon sets all service prices at the card price:
- Haircut listed at: $52 (card price)
- Cash discount (4%): $52 × 4% = $2.08
- Cash price: $49.92 (rounded to $50)

Customer pays with card → salon pays ~4% in processing fees but collected $52 → effective cost: $0
Customer pays with cash → salon collects $50 → zero processing cost
Salon's revenue is the same either way; processing costs are covered`,
    faqs: [
      {
        question: "Is a cash discount program legal?",
        answer: "Yes, cash discount programs are legal in all 50 states. The Durbin Amendment (2011) explicitly permits cash discounts. The key is proper disclosure and implementation — prices must be listed at the card price, with a clear discount offered for cash.",
      },
      {
        question: "What is the difference between cash discount and surcharging?",
        answer: "Cash discount reduces the price for cash payers (legal everywhere). Surcharging adds a fee for card payers (prohibited or restricted in some states). The math may be similar, but the legal and customer-perception implications differ significantly.",
      },
      {
        question: "Do I need special equipment for a cash discount program?",
        answer: "Most modern point-of-sale systems support cash discount programs. Your processor must register the program with Visa and Mastercard. Some require a specific terminal or software version. Ask your processor what hardware and software changes are needed.",
      },
      {
        question: "Will a cash discount program drive customers away?",
        answer: "It depends on your industry and customers. Gas stations have used cash discounts for decades with no customer issues. In other industries, some customers object to paying more by card. Test it and track your customer response.",
      },
    ],
    relatedTerms: ["surcharging", "dual-pricing", "interchange-fees", "merchant-discount-rate", "flat-rate-pricing"],
    commercialLinks: [
      { label: "Learn About Our 0% Processing Program", href: "/0-percent-processing" },
      { label: "Get Started with Cash Discount", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard offers fully compliant cash discount programs that can eliminate your processing fees. We handle the setup, card network registration, terminal programming, and compliance requirements. Our cash discount merchants pay $0 in processing fees — legally and transparently.

See our 0% processing program page for full details and eligibility requirements.`,
  },
  {
    slug: "surcharging",
    name: "Surcharging",
    shortDefinition: "Adding a fee to credit card transactions to recover processing costs — legal in most states with proper disclosure and registration.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "1,200/mo",
    fullDefinition: `Credit card surcharging is the practice of adding a fee to transactions when customers pay with a credit card, to offset the merchant's processing costs. Unlike cash discount programs, surcharging adds a fee on top of the listed price rather than discounting for cash.

Surcharging rules are complex and vary by state and card network:
- Prohibited states: Connecticut and Massachusetts prohibit credit card surcharges
- All other states: Surcharging is generally permitted
- Maximum surcharge: Capped at the lesser of your actual processing cost or 3% (Visa) or 4% (Mastercard)
- Disclosure requirements: Surcharges must be disclosed at the point of entry, point of sale, and on the receipt
- Registration: You must notify Visa and Mastercard at least 30 days before implementing surcharging
- Debit cards: You cannot surcharge debit cards (even when processed as credit)

Surcharging has grown significantly since a 2013 class action settlement eliminated major legal barriers. Many retailers, healthcare providers, and service businesses now implement surcharging programs to offset rising processing costs.

The key compliance requirements for surcharging:
1. Register with Visa and Mastercard
2. Post notices at the store entrance and point of sale
3. The surcharge must appear as a separate line item on the receipt
4. Cannot exceed actual processing cost`,
    merchantImpact: `When implemented correctly, surcharging shifts the cost of credit card acceptance to the customers who choose to pay by credit card. This can completely eliminate credit card processing costs for merchants.

Customer acceptance varies. Surveys show roughly 30-40% of consumers have encountered surcharges, and while some object, most pay without significant complaint — particularly in industries like healthcare, utilities, and professional services where card payments are expected to have fees.

Businesses with loyal customer bases and where alternatives to paying in-store are limited (service businesses, healthcare) tend to implement surcharging most successfully.`,
    example: `A law firm processes a $5,000 retainer payment by credit card:
- Listed price: $5,000
- Surcharge (3%): $150
- Total charged to credit card: $5,150
- Law firm receives: $5,150 minus processing fees (~$150)
- Net to law firm: approximately $5,000 (same as cash payment)`,
    faqs: [
      {
        question: "Is credit card surcharging legal?",
        answer: "Yes, in 48 states and Washington D.C. Connecticut and Massachusetts prohibit surcharging. Federal law allows it. You must comply with card network rules including registration, disclosure, and the maximum surcharge cap.",
      },
      {
        question: "What is the maximum credit card surcharge I can charge?",
        answer: "The maximum is the lesser of your actual processing cost or 3% for Visa transactions and 4% for Mastercard transactions. Most merchants set their surcharge at 3% or less to stay within Visa's cap.",
      },
      {
        question: "Can I surcharge debit cards?",
        answer: "No. Card network rules and federal law prohibit surcharging debit cards, even when processed as credit. You can only surcharge credit card transactions.",
      },
      {
        question: "How do I register to surcharge?",
        answer: "You must notify Visa and Mastercard at least 30 days before implementing surcharging. Your processor typically handles this registration. Contact your payment processor to start the process.",
      },
    ],
    relatedTerms: ["cash-discount-program", "dual-pricing", "interchange-fees", "merchant-discount-rate", "pci-compliance"],
    commercialLinks: [
      { label: "Learn About 0% Processing Options", href: "/0-percent-processing" },
      { label: "Get Started", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard helps merchants implement fully compliant surcharging programs — including registration with card networks, proper signage, and compliant receipt formatting. We ensure you meet all federal and state requirements. Contact us to evaluate whether surcharging or cash discount is the right fit for your business.`,
  },
  {
    slug: "dual-pricing",
    name: "Dual Pricing",
    shortDefinition: "Displaying two prices at the point of sale — one for cash and one for card — so customers choose their payment method with full cost transparency.",
    category: "Core Fee & Pricing Terms",
    searchVolume: "480/mo",
    fullDefinition: `Dual pricing is a payment processing strategy where merchants display two distinct prices for every product or service: a cash price and a card price. Customers see exactly what they'll pay before choosing their payment method. This differs from cash discount programs (which advertise one price and discount for cash) and surcharging (which adds a fee at checkout).

Dual pricing requires specific point-of-sale technology that can display both prices simultaneously on price tags, menus, and receipts. At checkout, the customer selects their payment type and the system automatically applies the appropriate price.

The legal framework for dual pricing is well-established. Card networks permit dual pricing as a variant of cash discount. From a merchant's perspective, the card price includes a margin to cover processing costs — typically 3-4%. From a customer's perspective, they make an informed choice: pay less with cash or pay more with card.

Dual pricing is especially common at gas stations (which have displayed cash and credit prices for decades), convenience stores, and small retail businesses. The restaurant industry has seen growing adoption as processing costs have increased.

Benefits of dual pricing:
- Zero processing costs on card transactions (card price covers fees)
- Maximum price transparency for customers
- Legal in all 50 states
- No hidden fees or surprises at checkout`,
    merchantImpact: `Dual pricing effectively eliminates credit card processing costs while providing customers with clear pricing information. Merchants using dual pricing typically see their effective processing cost drop to near zero.

The main consideration is customer experience and implementation. Menu items, shelf tags, and digital displays all need to show both prices. This requires upfront work but pays off immediately in eliminated processing fees.

Customer acceptance is generally higher with dual pricing than with surcharging because the pricing is clear and disclosed upfront — customers choose their payment method knowing the costs.`,
    example: `A convenience store implements dual pricing:
- 20 oz. soda: Cash $1.89 / Card $1.96
- Sandwich: Cash $6.99 / Card $7.27
- Gas (per gallon): Cash $3.45 / Card $3.59

Customer choosing to pay cash saves 3.5-4% on their purchase. Customer paying by card sees no surprise at checkout — they knew the card price when they made their selection.`,
    faqs: [
      {
        question: "Is dual pricing the same as cash discount?",
        answer: "They achieve the same goal but differ in execution. Cash discount posts one price and offers a reduction for cash. Dual pricing posts both prices simultaneously. Some regulatory and network distinctions apply, but both are legal nationwide.",
      },
      {
        question: "What equipment do I need for dual pricing?",
        answer: "Dual pricing requires a point-of-sale system that supports displaying two price tiers and calculating the appropriate price at checkout. Many modern POS systems support this feature. Your processor will need to program it into your system.",
      },
      {
        question: "Is dual pricing legal in all states?",
        answer: "Yes. Dual pricing (showing separate cash and card prices) is legal in all 50 states, unlike surcharging which has restrictions in some states.",
      },
    ],
    relatedTerms: ["cash-discount-program", "surcharging", "interchange-fees", "merchant-discount-rate"],
    commercialLinks: [
      { label: "Explore 0% Processing Options", href: "/0-percent-processing" },
      { label: "Get Started with Dual Pricing", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard sets up and programs dual pricing systems for merchants across industries. We handle the POS configuration, card network compliance, and signage requirements. Ask us about dual pricing at your next free consultation.`,
  },
  {
    slug: "authorization",
    name: "Authorization",
    shortDefinition: "The process of verifying that a customer's card is valid and has sufficient funds or credit before completing a transaction.",
    category: "Transaction Flow Terms",
    searchVolume: "3,600/mo",
    fullDefinition: `Credit card authorization is the first step in processing a card payment — the process where the payment processor checks with the card-issuing bank to verify that the card is valid, not stolen, and has sufficient funds or credit available for the transaction.

The authorization process happens in seconds and involves multiple parties:
1. The merchant's terminal or payment gateway sends the transaction data
2. The acquiring bank receives the request and forwards it to the card network (Visa/Mastercard)
3. The card network routes it to the issuing bank
4. The issuing bank checks: Is the card valid? Is it stolen? Are funds/credit available?
5. The issuing bank sends back an approval or denial
6. The response returns through the network to the merchant's terminal

Authorization creates a temporary hold on the customer's funds. For credit cards, the hold reduces available credit. For debit cards, it reduces available balance. The hold typically lasts 1-3 business days until the transaction is settled or released.

Important distinction: authorization is NOT the same as payment capture. An authorized transaction means funds are reserved, not that they've moved. Settlement (the actual transfer of funds) happens later — usually in a daily batch process.

Authorization codes are recorded with each approved transaction. If you need to dispute a chargeback or prove a sale occurred, this authorization code is critical evidence.`,
    merchantImpact: `Understanding authorization helps merchants avoid declined transactions and manage holds correctly. A common merchant error is authorizing a transaction for one amount and capturing a different amount — this can trigger downgrades or chargebacks.

For restaurants, pre-authorization (placing a hold for the estimated check plus tip) is standard practice. For hotels, authorization at check-in covers the stay plus potential incidentals. When the final amount is captured, the hold is released.

Failed authorizations are immediate — customers see a declined message. Common reasons: insufficient funds, exceeded credit limit, card flagged for fraud, or a security code mismatch.`,
    example: `A hotel pre-authorizes a card at check-in:
- Customer's card: Visa with $500 available credit
- Hotel pre-auth: $350 (3 nights × $110 + $20 incidentals)
- Customer's available credit immediately drops to $150
- At checkout (2 days later): Final charge captured at $340
- Authorization hold released, available credit restored to $160`,
    faqs: [
      {
        question: "How long does a credit card authorization hold last?",
        answer: "Authorization holds typically last 1-3 business days for most transactions. Hotels, car rentals, and gas stations may hold funds for up to 30 days if the final amount isn't captured. Banks have different policies on release timing.",
      },
      {
        question: "What happens if an authorization is declined?",
        answer: "The transaction is not approved and no hold is placed on the customer's card. Common decline reasons: insufficient funds, exceeded credit limit, suspected fraud, expired card, or incorrect CVV. The merchant should ask the customer for an alternative payment.",
      },
      {
        question: "Is authorization the same as payment?",
        answer: "No. Authorization reserves the funds but doesn't transfer them. Payment (capture and settlement) happens when the merchant submits the batch. A merchant could technically authorize a transaction and never capture it.",
      },
    ],
    relatedTerms: ["capture", "settlement", "void", "batch-settlement", "chargeback", "card-present", "card-not-present"],
    commercialLinks: [
      { label: "Get a Free Statement Review", href: "/upload-statement" },
      { label: "Learn About Our Processing Solutions", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard's processing infrastructure is built for reliable authorization — with 99.9%+ uptime and connections to multiple card networks to prevent authorization failures during peak periods. Contact us to learn about our payment reliability guarantees.`,
  },
  {
    slug: "capture",
    name: "Capture",
    shortDefinition: "The step after authorization where a merchant finalizes the transaction and initiates the actual transfer of funds from the customer to the merchant.",
    category: "Transaction Flow Terms",
    searchVolume: "590/mo",
    fullDefinition: `Capture (also called "payment capture" or "transaction capture") is the second step in the payment process, following authorization. When a merchant captures a transaction, they finalize the amount and submit it to their acquirer for settlement. This is when the actual transfer of funds is initiated.

There are two models for authorization and capture:

1. **Auth-Capture (simultaneous)**: Used in most retail environments. The transaction is authorized and captured at the same time in one step. This is what happens when you swipe your card at a grocery store.

2. **Auth-only then Capture later**: Used in environments where the final amount may differ from the initial authorization. Restaurants authorize at order time and capture after the final bill (including tip) is determined. Hotels authorize at check-in and capture at checkout. E-commerce businesses may authorize at purchase but capture when the item ships.

The capture amount can be less than or equal to the authorized amount. It should not exceed the authorized amount — doing so can trigger a decline or chargeback. If you need to capture more than authorized, you should re-authorize the additional amount.

Capture triggers settlement: once you capture, the transaction enters your batch and will be submitted to your acquirer during the next settlement run.`,
    merchantImpact: `Merchants who separate authorization and capture need to be careful about:
- **Time limits**: Authorizations expire after 7 days (Visa/Mastercard standard). If you don't capture within that window, you'll need a new authorization.
- **Amount differences**: Capturing for less than authorized is fine; capturing for more can be declined.
- **Restaurant tip adjustment**: Capturing the post-tip amount within 24 hours of the initial auth is essential to avoid interchange downgrades.`,
    example: `A restaurant flow:
1. Customer orders, waiter runs card at order time → Authorization for $65 (estimated total)
2. Customer signs receipt, adds $13 tip → Final amount: $78
3. Nightly batch run: Restaurant captures $78 (within 24 hours of auth)
4. Funds transfer at settlement → Restaurant receives $78 minus processing fees`,
    faqs: [
      {
        question: "What happens if I don't capture an authorized transaction?",
        answer: "The authorization will expire (typically after 7 days) and the hold will be released from the customer's card. No funds will be transferred. You'll need to re-authorize if you still want to collect payment.",
      },
      {
        question: "Can I capture more than the authorized amount?",
        answer: "Generally no — capturing more than the authorized amount can result in a decline or chargeback. For restaurants, there's a tolerance for tip adjustments (typically 20% over the authorized amount), but this varies by card network and processor.",
      },
    ],
    relatedTerms: ["authorization", "settlement", "batch-settlement", "void", "refund", "tip-adjustment"],
    commercialLinks: [
      { label: "Optimize Your Payment Processing", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard's payment systems support both simultaneous and delayed capture workflows. If you're running a restaurant, hotel, or e-commerce store with complex authorization patterns, our team can configure your system to minimize downgrades and settlement delays.`,
  },
  {
    slug: "settlement",
    name: "Settlement",
    shortDefinition: "The final step in card payment processing where captured transaction funds are transferred from the customer's bank to the merchant's bank account.",
    category: "Transaction Flow Terms",
    searchVolume: "1,100/mo",
    fullDefinition: `Settlement is the process by which captured credit card transactions are actually paid out — when money moves from the customer's bank to the merchant's bank. Settlement completes the four-party payment flow: cardholder → issuing bank → card network → acquiring bank → merchant.

The settlement process works as follows:
1. At the end of each business day, the merchant submits a batch of captured transactions to their acquirer
2. The acquirer submits the batch to each card network
3. The card networks route settlement requests to the respective issuing banks
4. Issuing banks transfer funds to the acquirer
5. The acquirer deposits funds (minus fees) into the merchant's bank account

Settlement timing varies by processor and agreement:
- **Standard settlement**: 2-3 business days after batch close
- **Next-day funding**: Funds available the next business day
- **Same-day funding**: Available from some processors for an additional fee

Understanding settlement helps merchants manage cash flow. Delays in settlement can create cash flow problems, especially for small businesses. Next-day funding, while sometimes more expensive, can significantly improve cash flow predictability.`,
    merchantImpact: `Settlement timing directly affects your cash flow. A restaurant that batches on Saturday night expects funds by Monday or Tuesday. If your processor has 3-day settlement, you might not see funds until Wednesday — which matters when making payroll or paying suppliers.

Next-day funding is worth considering for high-volume businesses. The additional cost (typically 0.10%–0.30% of volume) may be offset by reduced reliance on a line of credit or avoided overdraft fees.

Always understand your settlement timeline before signing with a processor. "Next-day funding" is sometimes conditional on batching before a specific cutoff time (e.g., 9:00 PM EST).`,
    example: `A retail store batches transactions every night at 8 PM:
- Monday 8 PM batch: $8,400 in transactions captured
- Processor standard: 2-business-day settlement
- Monday night is Day 0
- Tuesday is Day 1
- Wednesday is Day 2 → $8,174 deposited (after ~2.7% fees)`,
    faqs: [
      {
        question: "What is next-day funding in payment processing?",
        answer: "Next-day funding means your captured transactions are deposited to your bank account the next business day. Standard processing is 2-3 days. Next-day funding is available from most processors, sometimes for an additional fee.",
      },
      {
        question: "Why are weekends excluded from settlement timing?",
        answer: "Banks process ACH transfers on business days. Transactions batched Friday night typically settle Monday or Tuesday. Some processors offer Saturday funding for an additional fee.",
      },
      {
        question: "What happens if a settlement is delayed?",
        answer: "Settlement delays beyond your contracted timeline may indicate a hold or reserve has been placed on your account. Contact your processor immediately. Unexplained holds are sometimes a sign of account risk review.",
      },
    ],
    relatedTerms: ["batch-settlement", "capture", "authorization", "refund", "reserve-account", "rolling-reserve"],
    commercialLinks: [
      { label: "Ask About Next-Day Funding", href: "/get-started" },
      { label: "Get a Free Consultation", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard offers next-day funding for qualified merchants at no additional fee. Our standard settlement is 1-2 business days, and we don't hold funds without cause. Contact us to understand exactly when you'd receive funds after batching.`,
  },
  {
    slug: "batch-settlement",
    name: "Batch Settlement",
    shortDefinition: "The daily process of submitting all captured transactions to your processor at once to initiate fund transfer to your bank account.",
    category: "Transaction Flow Terms",
    searchVolume: "390/mo",
    fullDefinition: `Batch settlement (also called "closing the batch" or "batch close") is the process of grouping all captured transactions from a period — typically a business day — and submitting them to the payment processor at once for settlement.

Most payment terminals and POS systems are set to automatically close the batch at a set time each night (e.g., 11 PM). Merchants can also close batches manually. Once a batch is closed, the transactions are submitted to the acquirer for settlement.

Why batching matters for costs:
1. **Interchange rate optimization**: Many interchange categories require transactions to be settled within a specific timeframe (typically 24 hours for card-present transactions) to qualify for the best rates. Delayed batching can cause interchange downgrades.
2. **Authorization expiration**: If you delay batching past the authorization window (up to 7 days), authorizations expire and captures may be declined.
3. **Cash flow**: Batch close time affects when you receive funds. Batching at 11 PM may qualify for next-day funding; batching at 6 AM may delay until the following business day.

For restaurants specifically, the IRS and card networks recommend closing the batch within 24 hours of the original authorization, especially for transactions where tips were adjusted.`,
    merchantImpact: `Setting your batch close time correctly is a simple way to avoid interchange downgrades. A restaurant that leaves transactions open for 48+ hours will see many card-present rates downgraded to card-not-present rates — adding 0.50%–1.0% in unnecessary fees.

Confirm with your processor: (1) what time your batch automatically closes, (2) what the cutoff time is for next-day funding eligibility, and (3) whether manual batch close is recommended before travel or holidays.`,
    example: `A restaurant with 200 transactions/day, average ticket $45:
- Auto-batch close: 11 PM daily
- Within 24 hours: Qualifies for standard restaurant interchange rate (~1.80%)
- Delayed batch (48+ hours after auth): Downgrades to 2.30% or higher
- Cost of daily batching vs. delayed: 0.50% on $9,000/day = $45/day = $16,425/year in unnecessary fees`,
    faqs: [
      {
        question: "Should I batch settle manually or automatically?",
        answer: "Automatic batch settlement is recommended for most businesses. Set it for a consistent time (typically late evening) after your last transaction of the day. Manual close is useful when you need to confirm tip adjustments or review transactions before submitting.",
      },
      {
        question: "What happens if I forget to close my batch?",
        answer: "Most systems auto-close at a preset time. If manually closing and you miss a day, transactions remain in open batch status. This can delay settlement and potentially cause interchange downgrades for card-present transactions older than 24 hours.",
      },
    ],
    relatedTerms: ["settlement", "capture", "authorization", "interchange-downgrade", "tip-adjustment"],
    commercialLinks: [
      { label: "Optimize Your Processing Setup", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard configures your batch close time during setup to optimize for your business hours and next-day funding eligibility. We also monitor for delayed batches that could trigger interchange downgrades. It's part of our proactive account management.`,
  },
  {
    slug: "void",
    name: "Void",
    shortDefinition: "Canceling a transaction before it has settled — the funds were never transferred, so no refund is needed.",
    category: "Transaction Flow Terms",
    searchVolume: "720/mo",
    fullDefinition: `A void is the cancellation of a transaction before it has been settled (before the batch closes). When you void a transaction, it's removed from the current batch and no funds are ever transferred. From the customer's perspective, the authorization hold will be released — though this may take 1-3 business days depending on their bank.

Voids are different from refunds:
- **Void**: Transaction canceled before settlement; no money moves
- **Refund**: Transaction already settled; money is returned to the customer

From a cost perspective, voiding is preferable to refunding. When you process a refund on a settled transaction, you already paid the interchange fees and assessment fees — those are not returned to you. When you void, the transaction never settles, so no fees are charged.

Voids must be processed before the batch closes. Once a batch is submitted for settlement, you can no longer void — you must process a refund instead.

Common reasons to void:
- Customer changes their mind before the sale is finalized
- Entry error (wrong amount, duplicate charge)
- Transaction declined after partial entry
- Merchant error during checkout`,
    merchantImpact: `When a customer wants to cancel or if you entered the wrong amount, void the transaction immediately if the batch hasn't closed. This saves you the interchange fees and assessment fees you'd pay on a refund — plus processing fees on the refund transaction itself.

Train your staff to void rather than refund for same-day errors. The savings are meaningful: on a $200 refund with a 2.2% effective rate, avoiding the refund (by voiding instead) saves $4.40 in fees.`,
    example: `A clothing store cashier accidentally charges a customer $185 for a $58 item:
1. Error discovered before end of day (before batch close)
2. Cashier voids the $185 transaction
3. Correct $58 transaction processed
4. Customer's authorization hold for $185 released within 1-3 days
5. Merchant pays zero fees on the erroneous transaction`,
    faqs: [
      {
        question: "How long do I have to void a transaction?",
        answer: "You can void a transaction anytime before your batch closes — typically the nightly batch at 11 PM or whenever you manually close. Once the batch is submitted, you must process a refund instead.",
      },
      {
        question: "Does a void cost anything?",
        answer: "No, a voided transaction incurs no processing fees because it never settles. This makes voiding preferable to refunding for same-day cancellations.",
      },
      {
        question: "What's the difference between a void and a return?",
        answer: "A void cancels a transaction before settlement; no money ever moves. A return (refund) occurs after settlement when money has already been transferred. Refunds may take 3-5 business days to appear on the customer's statement.",
      },
    ],
    relatedTerms: ["refund", "authorization", "capture", "batch-settlement", "chargeback"],
    commercialLinks: [
      { label: "Get a Free Statement Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard's terminal programming and POS setups make voiding easy and intuitive for staff. We train your team on the void process during onboarding to ensure no unnecessary refund fees.`,
  },
  {
    slug: "refund",
    name: "Refund",
    shortDefinition: "Returning funds to a customer for a transaction that has already settled — a credit to the customer's card account.",
    category: "Transaction Flow Terms",
    searchVolume: "880/mo",
    fullDefinition: `A refund (also called a credit or return) is the reversal of a previously settled transaction. When a merchant processes a refund, they return money to the customer's credit or debit card. Refunds occur after the transaction has already settled — meaning money has already moved from the customer's account to the merchant's account.

Refunds work differently than voids:
- **Void**: Cancels before settlement; no money ever moves
- **Refund**: After settlement; requires a separate credit transaction to return the money

Processing a refund involves creating a new credit transaction that flows through the payment network in reverse. The merchant's processor credits the customer's issuing bank, which credits the customer's account. This process typically takes 3-5 business days.

Important cost considerations for refunds:
- Original interchange fees are generally NOT returned to the merchant
- Some processors charge a per-transaction fee for refunds
- Assessment fees may or may not be credited back, depending on the processor
- The credit transaction itself may incur a small processing fee

Partial refunds are also possible — you can refund any amount up to the original transaction amount. You can process multiple partial refunds on the same transaction until the full amount has been returned.`,
    merchantImpact: `Refunds are unavoidable in retail, but they have hidden costs. When you process a $100 refund, you've already paid ~$2.50 in processing fees on the original sale — and those fees are not returned. The refund transaction may also have its own fees.

High refund rates (over 1-2% of transactions) can also flag your account for risk review by processors and card networks. Track your refund rate and investigate patterns: are certain products, employees, or channels generating disproportionate refunds?`,
    example: `A software company sells a $500 annual subscription:
- Original sale processed: $500 → merchant pays ~$12 in processing fees
- Customer requests full refund after 15 days
- Merchant issues $500 refund credit to customer's card
- Customer's $500 returned within 3-5 business days
- Merchant's processing fees from original sale ($12): NOT returned
- Net cost of the refund to merchant: $12 (plus any refund transaction fee)`,
    faqs: [
      {
        question: "How long do credit card refunds take?",
        answer: "Credit card refunds typically appear on the customer's statement within 3-5 business days. Some banks process credits faster; others take up to 10 business days. Debit card refunds may appear faster as they credit the checking account directly.",
      },
      {
        question: "Do I get my interchange fees back on a refund?",
        answer: "Generally no. Interchange fees paid on the original transaction are typically not refunded when you process a credit. This is one reason why voiding (before settlement) is preferred over refunding when possible.",
      },
      {
        question: "What if a customer claims they didn't receive their refund?",
        answer: "Get the ARN (Acquirer Reference Number) from your refund transaction and provide it to the customer. Their bank can use this to trace the credit. If the credit doesn't appear within 10 business days, escalate to your processor.",
      },
    ],
    relatedTerms: ["void", "chargeback", "capture", "settlement", "authorization", "retrieval-request"],
    commercialLinks: [
      { label: "Get a Free Statement Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard provides clear documentation on refund procedures and timelines. Our merchant portal gives you full visibility into refund status and transaction history. Contact our support team if a refund isn't appearing as expected.`,
  },
  {
    slug: "chargeback",
    name: "Chargeback",
    shortDefinition: "A forced reversal of a credit card transaction initiated by the cardholder's bank, typically due to a dispute, fraud claim, or unauthorized transaction.",
    category: "Transaction Flow Terms",
    searchVolume: "8,100/mo",
    fullDefinition: `A chargeback is when a cardholder disputes a charge and their issuing bank forcibly reverses the transaction, returning funds from the merchant to the cardholder. Unlike refunds (which merchants initiate), chargebacks are initiated by the customer's bank — often without the merchant's prior knowledge.

The chargeback process:
1. Cardholder disputes a transaction with their bank (up to 120 days after the transaction)
2. Issuing bank conducts initial review and may immediately credit the cardholder
3. Acquiring bank is notified and debits the merchant's account for the disputed amount
4. Merchant is notified and given a deadline to respond (typically 7-21 days)
5. Merchant submits "rebuttal documentation" — evidence the transaction was valid
6. Issuing bank reviews evidence and makes final decision
7. If merchant wins: funds returned. If merchant loses: funds kept by cardholder.

There are multiple chargeback reason codes categorized by type:
- **Fraud**: Unauthorized transaction, card not present fraud
- **Authorization**: No authorization obtained, authorization exceeded
- **Processing errors**: Duplicate transaction, incorrect amount, credit not processed
- **Consumer disputes**: Item not received, significantly not as described, recurring transaction canceled

Chargebacks also carry chargeback fees ($15–$100 per incident charged by most processors) and if your chargeback ratio exceeds 1% (Visa) or 1.5% (Mastercard) of monthly transactions, you may be placed on the MATCH list.`,
    merchantImpact: `Chargebacks are expensive in multiple ways: you lose the transaction amount, you pay a chargeback fee ($25–$100 typically), and excessive chargebacks can cost you your merchant account.

Preventing chargebacks requires good practices: use chip readers (reduces fraud chargebacks significantly), get authorization for every transaction, have clear refund policies, provide order confirmation and tracking, respond to all disputes promptly, and keep good transaction records.

If you're a high-risk merchant (travel, supplements, MOTO), expect a higher chargeback rate and plan your processes accordingly.`,
    example: `A consumer electronics retailer faces a chargeback:
- Customer purchased $890 laptop online
- Claims they "never received the item" (Reason Code: Item Not Received)
- Bank credits customer $890 and debits merchant
- Merchant receives chargeback notice with 10-day deadline to respond
- Merchant provides: tracking showing delivery confirmation, customer's signature
- Merchant wins representment: $890 returned to merchant account
- Chargeback fee: $35 (non-refundable regardless of outcome)`,
    faqs: [
      {
        question: "How do I fight a chargeback?",
        answer: "Submit compelling evidence within the deadline: signed receipts, delivery confirmation, communication records, customer service logs, and documentation showing the transaction was authorized and goods/services were provided. The key is having evidence ready before disputes happen.",
      },
      {
        question: "What is a chargeback fee?",
        answer: "A chargeback fee is charged by your processor for every chargeback regardless of outcome — typically $25–$100 per dispute. Even if you win the representment, you pay the fee. Some processors also charge representment fees.",
      },
      {
        question: "How many chargebacks is too many?",
        answer: "Visa's threshold is 1% of transactions (excessive) and 2% (high risk). Mastercard's is 1% (excessive). Exceeding these thresholds triggers monitoring programs with additional fees and potential account termination.",
      },
      {
        question: "Can I refuse a chargeback?",
        answer: "You cannot refuse to have a chargeback initiated, but you can fight it by submitting rebuttal documentation (representment). If you don't respond, you automatically lose. Always respond to chargebacks within the deadline.",
      },
    ],
    relatedTerms: ["chargeback-ratio", "retrieval-request", "refund", "void", "high-risk-merchant", "match-list", "pci-dss"],
    commercialLinks: [
      { label: "Chargeback Help for Healthcare Merchants", href: "/industries/healthcare-payment-processing" },
      { label: "Get Started with Better Protection", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard provides chargeback management support for all merchants. We help you build chargeback prevention protocols, respond to disputes with proper documentation, and monitor your chargeback ratio. High-risk merchants get dedicated chargeback management as part of their account.`,
  },
  {
    slug: "chargeback-ratio",
    name: "Chargeback Ratio",
    shortDefinition: "The percentage of transactions in a month that result in chargebacks — a key metric card networks use to identify at-risk merchants.",
    category: "Transaction Flow Terms",
    searchVolume: "260/mo",
    fullDefinition: `Chargeback ratio is calculated by dividing the number of chargebacks received in a month by the total number of transactions processed that month. It's expressed as a percentage and is monitored closely by card networks and acquiring banks to identify merchants with excessive dispute activity.

Chargeback Ratio = (Chargebacks in Month ÷ Total Transactions in Month) × 100

Card network thresholds:
- **Visa**: 
  - Excessive: 0.9% (Visa Dispute Monitoring Program triggered)
  - High Risk: 1.8% (Visa Fraud Monitoring Program triggered)
- **Mastercard**:
  - Excessive: 1.0% (Excessive Chargeback Program)
  - High Risk: 1.5% (High Excessive Chargeback Program)

Merchants who exceed thresholds are enrolled in monitoring programs with monthly fines ($1,000–$25,000 depending on program level) and must submit remediation plans. Merchants who remain in programs for extended periods risk account termination and MATCH list placement.

Note: Different networks calculate ratios slightly differently (some use previous month's transactions in the denominator, others use current month). Your acquirer can clarify which method applies to your account.`,
    merchantImpact: `A high chargeback ratio is a warning sign that can cost you your merchant account. Monitoring your ratio monthly and taking corrective action when it approaches 0.75% gives you time to remediate before triggering network monitoring programs.

The consequences of exceeding network thresholds are severe: monthly fines, forced remediation plans, potential account termination, and MATCH list placement that makes getting a new merchant account difficult or impossible.

Industries with naturally higher chargeback rates (travel, nutraceuticals, online gaming, subscription services) should implement proactive chargeback prevention strategies from day one.`,
    example: `An e-commerce store processes 2,000 transactions in January and receives 18 chargebacks:
- Chargeback ratio: 18 ÷ 2,000 = 0.90%
- This exceeds Visa's 0.9% excessive threshold
- Visa Dispute Monitoring Program triggered
- Month 1: Warning letter from acquirer
- Month 2+ (if still above threshold): Monthly fines begin
- Corrective actions needed: fraud screening, clearer billing descriptors, better customer service`,
    faqs: [
      {
        question: "What is a good chargeback ratio?",
        answer: "A healthy chargeback ratio is under 0.5%. Below 0.25% is excellent. Above 0.75% requires attention. Above 1% triggers card network monitoring programs with associated fines.",
      },
      {
        question: "How do I lower my chargeback ratio?",
        answer: "Key strategies: use chip readers for in-person transactions, implement fraud screening for online orders, have clear return policies, use recognizable billing descriptors, send order confirmations, provide responsive customer service, and process timely refunds for legitimate complaints.",
      },
      {
        question: "Does winning chargebacks improve my ratio?",
        answer: "No. Chargeback ratios are calculated based on the number of chargebacks received, regardless of whether you win or lose the representment. Even chargebacks you win count against your ratio.",
      },
    ],
    relatedTerms: ["chargeback", "retrieval-request", "match-list", "high-risk-merchant", "reserve-account"],
    commercialLinks: [
      { label: "Get Chargeback Management Support", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard monitors chargeback ratios for all merchant accounts and alerts you when your ratio approaches warning levels. We provide chargeback prevention consulting and can help you implement the systems needed to keep your ratio in the healthy range.`,
  },
  {
    slug: "retrieval-request",
    name: "Retrieval Request",
    shortDefinition: "A request from a cardholder's bank for transaction documentation before a chargeback — an early warning that allows merchants to resolve disputes without a full chargeback.",
    category: "Transaction Flow Terms",
    searchVolume: "320/mo",
    fullDefinition: `A retrieval request (also called a "copy request" or "soft chargeback") is a request from the cardholder's issuing bank for documentation about a specific transaction. It typically precedes a chargeback — the bank or cardholder wants to review the transaction details before deciding whether to dispute it.

When you receive a retrieval request, you have a limited time (typically 10-20 days) to provide documentation including: signed sales draft, transaction receipt, item description, proof of delivery, and any other relevant evidence.

If you fail to respond to a retrieval request:
1. The bank may automatically convert it to a chargeback
2. You lose the right to dispute the chargeback with evidence
3. The funds are automatically returned to the cardholder

If you respond with satisfactory documentation:
1. The cardholder and bank may be satisfied and close the case
2. You avoid a formal chargeback (and the associated fees)
3. The transaction stands

Retrieval requests are an opportunity to prevent chargebacks. Treat every retrieval request as urgent. Note: some networks (notably Visa) have moved away from retrieval requests in favor of direct chargebacks in their dispute resolution systems, but they still occur particularly on older transactions and through some issuing banks.`,
    merchantImpact: `Retrieval requests are less costly than chargebacks if resolved proactively. A retrieval request costs $5–$20 in fees (vs. $25–$100 for a chargeback) and doesn't count against your chargeback ratio if resolved without escalating.

Respond to every retrieval request promptly with complete documentation. If the original sale was valid, provide: the signed receipt, delivery confirmation, item description, and any communication with the customer. Well-documented responses prevent most retrieval requests from becoming chargebacks.`,
    example: `A furniture store receives a retrieval request:
- Transaction: $1,200 sofa, 45 days ago
- Reason: Cardholder claims they don't recognize the charge
- Deadline to respond: 15 days
- Merchant provides: signed sales receipt, customer's ID copy taken at purchase, delivery confirmation with signature
- Issuing bank reviews and closes the case — no chargeback issued
- Merchant paid only the $15 retrieval fee vs. $100 chargeback fee + potential loss of $1,200`,
    faqs: [
      {
        question: "How is a retrieval request different from a chargeback?",
        answer: "A retrieval request is a request for documentation — no funds are taken yet. A chargeback is a forced reversal — funds are debited from your account. Retrieval requests give you a chance to prevent the chargeback by providing evidence.",
      },
      {
        question: "How much time do I have to respond to a retrieval request?",
        answer: "Typically 10-20 days, depending on the card network and issuing bank. Check the notice carefully for the specific deadline. Missing the deadline almost always results in automatic chargeback.",
      },
    ],
    relatedTerms: ["chargeback", "chargeback-ratio", "refund", "void", "authorization"],
    commercialLinks: [
      { label: "Get a Free Consultation", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard notifies merchants of retrieval requests and helps compile the necessary documentation for an effective response. Our dispute management support is included for all accounts.`,
  },
  {
    slug: "merchant-account",
    name: "Merchant Account",
    shortDefinition: "A specialized bank account that allows businesses to accept credit and debit card payments and receive settled funds.",
    category: "Account & Business Terms",
    searchVolume: "2,900/mo",
    fullDefinition: `A merchant account is a type of bank account that enables businesses to accept and process credit and debit card payments. Without a merchant account, a business cannot receive funds from card transactions through traditional payment networks.

A merchant account isn't a regular checking account — it's a specialized account held at an acquiring bank that temporarily holds funds between authorization and settlement, then transfers them to your business checking account.

The merchant account application process involves underwriting: the acquiring bank and processor review your business type, processing history, chargeback rate, credit history, and anticipated volume. This process can take 1-7 business days for standard merchants and longer for high-risk businesses.

There are two types of merchant accounts:
1. **Dedicated merchant account**: Your business gets its own unique merchant account number. You deal with the underwriting process upfront, but you get stable pricing, direct relationships, and more control.
2. **Aggregated merchant account**: Services like Square, Stripe, and PayPal aggregate many merchants under a single merchant account. Easy to set up, but higher rates and less stability — your account can be frozen or terminated with little notice.

A true merchant account (dedicated) typically includes: a Merchant Identification Number (MID), direct pricing negotiation, a dedicated account manager, and more processing stability.`,
    merchantImpact: `The type of merchant account you have significantly affects your costs, stability, and support options. Aggregated accounts (Square, Stripe, PayPal) are fast to set up but come with higher rates and account instability risk — these platforms hold funds and freeze accounts more frequently than dedicated merchant account providers.

For businesses processing over $10,000/month, a dedicated merchant account typically offers better rates, more stability, and direct support. The underwriting process takes longer but the long-term relationship is more secure.`,
    example: `Two coffee shops accepting card payments:
- Shop A: Uses Square (aggregated account)
  - Instant setup, no application process
  - Pays 2.6% flat rate
  - Risk: Account could be frozen if Square flags unusual activity
  
- Shop B: Has a dedicated merchant account through Liberty Bancard
  - Took 3 days to set up after underwriting
  - Pays interchange + 0.30% (effective rate ~1.9%)
  - Stable, dedicated account, direct processor relationship
  - Monthly savings vs. Square: ~$440 on $60,000 volume`,
    faqs: [
      {
        question: "Do I need a merchant account to accept credit cards?",
        answer: "Yes, you need some form of merchant account. Options range from aggregated accounts (Square, Stripe — instant setup) to dedicated merchant accounts (traditional processors — require underwriting). Dedicated accounts offer better rates and stability for established businesses.",
      },
      {
        question: "How long does it take to get a merchant account?",
        answer: "Standard merchant accounts take 1-5 business days. High-risk merchants may take 1-3 weeks. Aggregated account providers (Square, Stripe) offer instant or same-day setup but with different terms and higher rates.",
      },
      {
        question: "Can my merchant account be terminated?",
        answer: "Yes. Merchant accounts can be terminated for excessive chargebacks, fraud, violation of terms, or business risk factors. Dedicated merchant accounts from traditional processors are generally more stable than aggregated accounts.",
      },
    ],
    relatedTerms: ["payment-processor", "acquiring-bank", "payment-gateway", "iso-msp", "high-risk-merchant", "underwriting"],
    commercialLinks: [
      { label: "Apply for a Merchant Account", href: "/merchant-application" },
      { label: "Get Started", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard provides dedicated merchant accounts with fast underwriting — most approvals within 24-48 hours. We specialize in challenging businesses that other processors turn away, including high-risk industries and merchants with processing history issues.`,
  },
  {
    slug: "payment-processor",
    name: "Payment Processor",
    shortDefinition: "A company that handles the technical and financial infrastructure for processing card payments between merchants, banks, and card networks.",
    category: "Account & Business Terms",
    searchVolume: "1,600/mo",
    fullDefinition: `A payment processor is a company that facilitates credit and debit card transactions by connecting merchants to card networks (Visa, Mastercard), acquiring banks, and issuing banks. They provide the technical infrastructure that makes card acceptance possible.

The payment processor handles:
- Transaction routing (sending authorization requests through the correct network)
- Security (encryption, tokenization, fraud detection)
- Settlement (batching and transferring funds)
- Reporting (providing statements and transaction data)
- Dispute management (handling chargebacks and retrievals)

There are two models:
1. **Processor-direct**: The merchant contracts directly with a large processing company (TSYS, First Data/Fiserv, Global Payments, Worldpay). Often requires volume minimums.
2. **Through an ISO**: Independent Sales Organizations (ISOs) like Liberty Bancard resell processing services from larger processors under their own pricing structures. ISOs provide personalized service and can often negotiate better rates for their merchants.

Major payment processors include: Fiserv (formerly First Data), Global Payments, TSYS (now part of Global), Worldpay (FIS), Chase Merchant Services, and Stripe.

Processors earn money on the markup portion of interchange plus pricing — the difference between what the card network charges and what the merchant pays.`,
    merchantImpact: `Choosing the right payment processor affects your rates, service quality, and account stability. Questions to ask any processor: What is your exact markup over interchange? What are all monthly fees? What is your chargeback support process? What is your next-day funding policy? What equipment do you support?

Don't focus only on the per-transaction rate — evaluate the full relationship including support quality, contract terms, and cancellation fees.`,
    example: `When a customer swipes their Visa card at a restaurant:
1. Restaurant terminal sends transaction to Liberty Bancard (ISO/processor)
2. Liberty Bancard forwards to their acquiring bank partner
3. Acquiring bank routes to Visa network
4. Visa routes to customer's issuing bank (Chase, BoA, etc.)
5. Issuing bank approves → response travels back through chain in under 2 seconds
6. Transaction approved; restaurant gets paid at settlement`,
    faqs: [
      {
        question: "What is the difference between a payment processor and a payment gateway?",
        answer: "A payment processor handles the financial transaction and moves money between parties. A payment gateway is the technology interface that connects your website or terminal to the processor. Many processors include a gateway; some are separate services.",
      },
      {
        question: "How do I choose a payment processor?",
        answer: "Compare effective rates (not just quoted rates), contract terms, monthly fees, chargeback support, equipment compatibility, and customer service. Get quotes from 2-3 processors and ask each to review your actual processing statements.",
      },
    ],
    relatedTerms: ["merchant-account", "acquiring-bank", "payment-gateway", "iso-msp", "interchange-plus-pricing", "merchant-discount-rate"],
    commercialLinks: [
      { label: "Compare Liberty Bancard to Other Processors", href: "/compare-rates" },
      { label: "Upload Statement for a Free Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard is a registered ISO that partners with top-tier acquiring banks to provide merchant accounts and payment processing. We're not a middleman adding fees — we're a direct channel with the purchasing power of our processing portfolio behind your rates.`,
  },
  {
    slug: "acquiring-bank",
    name: "Acquiring Bank",
    shortDefinition: "The bank that maintains a merchant's account and processes card payments on their behalf — the merchant's bank in the transaction flow.",
    category: "Account & Business Terms",
    searchVolume: "590/mo",
    fullDefinition: `The acquiring bank (also called the acquirer or merchant bank) is the financial institution that holds the merchant's account and processes card payment transactions on their behalf. In the four-party card payment model, the acquiring bank sits between the merchant and the card network.

When a customer pays with a credit card:
1. The transaction flows from the merchant → acquiring bank → card network → issuing bank
2. The issuing bank approves/declines and funds flow back through the chain
3. The acquiring bank deposits funds into the merchant's account at settlement

The acquiring bank bears real financial risk — they are responsible to the card networks for their merchants' transactions. If a merchant processes fraudulent transactions and goes out of business, the acquiring bank is liable. This is why acquirers carefully underwrite merchants and maintain reserves for high-risk accounts.

Major acquiring banks include: Bank of America Merchant Services, Chase Paymentech, Wells Fargo Merchant Services, Citibank, and many regional banks. Most small merchants don't deal directly with their acquiring bank — they interact through payment processors and ISOs who have sponsorship agreements with acquiring banks.

ISOs like Liberty Bancard are sponsored by acquiring banks to sell processing services. The ISO handles merchant relationships while the acquiring bank handles the underlying financial infrastructure.`,
    merchantImpact: `You may never interact directly with your acquiring bank, but they're the entity that ultimately approves your merchant account, holds your funds, and is responsible to card networks for your processing activity.

Understanding your acquiring bank matters when: applying for a high-risk merchant account (the acquirer must approve), responding to chargebacks (the acquirer sends the dispute notice), or when your processor is acquired or changes banking partners.`,
    example: `Liberty Bancard is sponsored by First National Bank of America as their acquiring bank partner. A merchant signing with Liberty Bancard gets:
- A merchant account held at First National Bank of America
- Processing through Liberty Bancard's systems
- Settlement deposited to their business checking account`,
    faqs: [
      {
        question: "What is the difference between an acquiring bank and a payment processor?",
        answer: "The acquiring bank is the financial institution that holds the merchant account and is ultimately responsible for the transactions. The payment processor is the technology company that routes and manages transactions. They may be the same company (e.g., Chase Merchant Services) or separate entities.",
      },
      {
        question: "Do I need to deal with my acquiring bank directly?",
        answer: "Usually not. Your payment processor or ISO handles day-to-day interactions. You would communicate directly with the acquiring bank if there are significant risk or compliance issues.",
      },
    ],
    relatedTerms: ["issuing-bank", "payment-processor", "merchant-account", "iso-msp", "settlement", "payment-facilitator"],
    commercialLinks: [
      { label: "Get Started with a Merchant Account", href: "/merchant-application" },
    ],
    libertySection: `Liberty Bancard is sponsored by regulated acquiring bank partners who provide financial stability and card network compliance. Our merchants get the stability of a bank-backed merchant account with the personalized service of an ISO.`,
  },
  {
    slug: "issuing-bank",
    name: "Issuing Bank",
    shortDefinition: "The bank that issued a customer's credit or debit card — the cardholder's bank in the payment transaction flow.",
    category: "Account & Business Terms",
    searchVolume: "480/mo",
    fullDefinition: `The issuing bank (or card issuer) is the financial institution that issued the customer's credit or debit card. In the four-party payment model, the issuing bank represents the cardholder's interests: it extends credit (for credit cards), holds the customer's account funds (for debit cards), and approves or declines transactions.

The issuing bank's role in a transaction:
1. Receives the authorization request from the card network
2. Checks if the card is valid, not stolen, and has sufficient funds/credit
3. Applies fraud scoring and risk algorithms
4. Approves or declines the transaction
5. Places a hold on funds (for debit) or reduces available credit (for credit)
6. Pays the acquiring bank at settlement (minus interchange fees)
7. Pays itself back when the cardholder makes their monthly payment

The issuing bank is who the merchant's interchange fees ultimately go to. When Visa's interchange rate for a signature credit card is 1.65%, that 1.65% goes to the issuing bank as compensation for bearing credit risk, funding rewards programs, and extending credit.

Major issuing banks include Chase, Bank of America, Citibank, Wells Fargo, American Express, and Discover. Capital One is notable for issuing high-rewards cards, which carry some of the highest interchange rates — a reason merchants dislike premium cards.`,
    merchantImpact: `Understanding the issuing bank's role helps merchants understand their costs. Rewards cards (Chase Sapphire, Amex Platinum, Capital One Venture) carry higher interchange rates because the issuing bank funds those rewards from interchange revenue. When your customers pay with premium rewards cards, you're subsidizing their airline miles and cash back.

This is why some merchants prefer cash discount or surcharging programs: to neutralize the cost difference between card types.`,
    example: `A customer uses their Chase Sapphire Preferred card (a premium rewards card):
- Visa interchange rate: 2.10% + $0.10 (premium card rate)
- This premium rate goes to Chase (the issuing bank) to fund rewards
- Contrast: Customer's basic Visa debit card interchange: 0.05% + $0.22 (Durbin regulated)
- The same $100 purchase costs the merchant $2.20 with the Sapphire vs. $0.27 with debit`,
    faqs: [
      {
        question: "Who is the issuing bank for a store credit card?",
        answer: "Store credit cards (like Target Redcard or Amazon Prime Visa) are issued by partner banks — Synchrony Bank, Comenity Bank, or Chase are common. The retailer co-brands the card but the bank issues it.",
      },
      {
        question: "Why do high-rewards credit cards cost merchants more?",
        answer: "Premium rewards cards carry higher interchange rates because the issuing bank needs that revenue to fund the rewards. Chase Sapphire cardholders earn valuable points; Chase funds those points from the interchange they collect on each transaction.",
      },
    ],
    relatedTerms: ["acquiring-bank", "interchange-fees", "merchant-account", "card-present", "card-not-present", "authorization"],
    commercialLinks: [
      { label: "Compare Your Interchange Costs", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard helps merchants understand how their card mix affects costs. Our statement analysis breaks down interchange costs by card type so you can see exactly how much premium rewards cards cost you — and evaluate whether a cash discount or surcharging program makes sense.`,
  },
  {
    slug: "payment-gateway",
    name: "Payment Gateway",
    shortDefinition: "The technology that securely transmits card data from a merchant's website or terminal to the payment processor for authorization.",
    category: "Account & Business Terms",
    searchVolume: "4,400/mo",
    fullDefinition: `A payment gateway is the technology interface that securely transmits payment data from the merchant's point of sale (whether online or in-person) to the payment processor and card networks. Think of it as the digital equivalent of the card swipe machine — it's the conduit that connects your business to the payment system.

For e-commerce businesses, the payment gateway:
- Collects card data on a secure checkout page
- Encrypts the data using SSL/TLS
- Transmits it to the processor for authorization
- Returns an approval or decline to the customer in real time
- Handles secure storage of payment data (tokenization)

For in-person businesses, the payment terminal often includes gateway functionality built in. The terminal encrypts card data at the point of swipe/chip/tap and transmits it through the gateway to the processor.

Popular payment gateways include: Authorize.net, Stripe (which is both gateway and processor), Braintree (owned by PayPal), NMI (Network Merchants Inc.), and USAePay. Many processors have their own proprietary gateways.

When choosing a payment gateway, consider:
- **Compatibility**: Does it integrate with your e-commerce platform or POS?
- **Security**: PCI-compliant, supports tokenization
- **Pricing**: Monthly gateway fee + per-transaction fee
- **Features**: Recurring billing support, fraud tools, virtual terminal access`,
    merchantImpact: `For e-commerce businesses, the payment gateway is essential — without it, you cannot accept online payments. Gateway selection affects your integration costs, security capabilities, and the customer checkout experience.

Many merchants unknowingly pay for both a gateway and a processor when some providers include both. Understand what you're paying for: a standalone gateway fee ($25-$50/month) plus a per-transaction fee ($0.05-$0.10) can add up quickly for high-volume merchants.`,
    example: `An online boutique needs payment processing:
- They use Shopify for their store
- Shopify Payments (Stripe-powered) is the easiest gateway integration but charges 2.9% + $0.30
- Alternative: Liberty Bancard's preferred gateway (NMI or Authorize.net) + their own merchant account
  - Gateway fee: $25/month + $0.05/transaction
  - Processing: interchange + 0.25%
  - On $50,000/month at 2% effective rate = $1,000 processing + $30 gateway = $1,030 vs. $1,450 (2.9%)`,
    faqs: [
      {
        question: "Do I need a payment gateway and a payment processor?",
        answer: "Yes, both are needed, but they may come from the same provider. Stripe combines both gateway and processor. Traditional setups have a separate gateway (Authorize.net) and processor (your ISO or bank). Combining them simplifies billing and support.",
      },
      {
        question: "What is the difference between a payment gateway and a virtual terminal?",
        answer: "A payment gateway processes payments from your website checkout. A virtual terminal is a web-based interface where you manually key in card details — useful for taking phone orders or invoicing customers.",
      },
      {
        question: "How does a payment gateway protect card data?",
        answer: "Payment gateways use SSL/TLS encryption to protect data in transit. They use tokenization to replace card numbers with non-sensitive tokens for storage. PCI-compliant gateways reduce your PCI scope significantly.",
      },
    ],
    relatedTerms: ["payment-processor", "merchant-account", "virtual-terminal", "tokenization", "encryption", "pci-dss"],
    commercialLinks: [
      { label: "Ask About Our Gateway Options", href: "/get-started" },
      { label: "Free Consultation", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard supports multiple payment gateway options including NMI, Authorize.net, and USAePay. We integrate with your existing e-commerce platform and configure the gateway for optimal security and pricing. Ask about our all-in gateway pricing.`,
  },
  {
    slug: "iso-msp",
    name: "ISO/MSP",
    shortDefinition: "An Independent Sales Organization (ISO) or Merchant Service Provider (MSP) is a company registered with card networks to sell payment processing services.",
    category: "Account & Business Terms",
    searchVolume: "210/mo",
    fullDefinition: `An ISO (Independent Sales Organization) or MSP (Merchant Service Provider) is a company registered with Visa, Mastercard, or other card networks to sell payment processing services to merchants. ISOs act as intermediaries between merchants and acquiring banks.

ISOs must be registered with Visa and Mastercard and sponsored by an acquiring bank. The sponsoring bank takes on regulatory and compliance responsibility while the ISO handles merchant sales, onboarding, and day-to-day service.

ISOs come in two types:
1. **Registered ISO**: Directly registered with Visa/Mastercard. Can underwrite merchants, set rates, and take on direct liability. Requires significant capital and compliance infrastructure.
2. **Sub-ISO (or Agent)**: Works under a registered ISO. Can sell services but cannot directly underwrite merchants or customize rates without parent ISO approval.

The ISO model benefits merchants by providing:
- Personalized service compared to large bank processors
- Competitive pricing through volume aggregation
- Industry expertise in specific verticals
- Local or specialized support

ISOs earn revenue on the markup above interchange — typically 0.10%–0.40% of processing volume. They may also earn on equipment, monthly fees, and software add-ons.`,
    merchantImpact: `Working with an ISO versus a bank-direct processor or an aggregator has tradeoffs. ISOs typically offer more personalized service and competitive pricing for established merchants. They may also be more flexible in underwriting non-standard businesses.

Verify any ISO you work with is properly registered with Visa and Mastercard. Registered ISO status is publicly verifiable through the card networks.`,
    example: `Liberty Bancard is a registered ISO/MSP with Visa and Mastercard:
- Sponsored by an acquiring bank partner
- Signs merchant agreements on behalf of the acquirer
- Sets pricing within parameters approved by the acquirer
- Manages merchant relationships, support, and onboarding
- Earns on the markup portion of interchange plus pricing`,
    faqs: [
      {
        question: "Is an ISO different from a payment processor?",
        answer: "An ISO is a reseller of payment processing services. They typically partner with a larger processing company or acquiring bank rather than maintaining their own processing infrastructure. The distinction matters for understanding where your fees go.",
      },
      {
        question: "How do I verify an ISO is legitimate?",
        answer: "You can verify ISO registration directly with Visa and Mastercard — both maintain registries of approved ISOs. Always ask to see their registration credentials before signing any merchant agreement.",
      },
    ],
    relatedTerms: ["registered-iso", "payment-facilitator", "payment-processor", "acquiring-bank", "merchant-account", "payfac-vs-iso"],
    commercialLinks: [
      { label: "Learn About Liberty Bancard", href: "/about-contact" },
      { label: "Get a Free Consultation", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard is a registered ISO/MSP with Visa and Mastercard. Our registration status means we're accountable to card networks and sponsoring banks for the quality and compliance of our merchant accounts. We don't operate in gray areas.`,
  },
  {
    slug: "registered-iso",
    name: "Registered ISO",
    shortDefinition: "An ISO that is directly registered with Visa and Mastercard — able to independently underwrite merchants and take on direct card network liability.",
    category: "Account & Business Terms",
    searchVolume: "180/mo",
    fullDefinition: `A registered ISO (Independent Sales Organization) is an entity that has been formally registered with Visa and/or Mastercard — directly appearing on their approved ISO lists. Registered ISO status requires significant capital requirements, compliance infrastructure, and sponsorship by an acquiring bank.

Registered ISO status enables a company to:
- Directly underwrite merchants (evaluate and approve merchant applications)
- Set pricing and terms for merchants within approved parameters
- Enter into direct merchant agreements
- Access card network resources and support
- Take on card network liability for their merchant portfolio

The distinction between a registered ISO and an unregistered agent/sub-ISO is significant: registered ISOs have direct accountability to card networks and must meet ongoing compliance requirements. Sub-ISOs work under registered ISOs without direct network registration.

Requirements for registered ISO status include:
- Formal application to Visa and Mastercard
- Acquiring bank sponsorship agreement
- Financial reserves meeting card network minimums
- Ongoing compliance with network rules and regulations
- Annual registration fees to the card networks`,
    merchantImpact: `Working with a registered ISO provides added security — the ISO is known to and regulated by card networks. If you ever have a dispute with your processor, you have avenues through the card networks that you don't have with unregistered agents.

Ask any ISO you work with whether they are directly registered with Visa and Mastercard. If they're a sub-agent of a larger ISO, understand who the registered entity is and what that means for your account stability.`,
    example: `A merchant is comparing two ISOs:
- ISO A: Registered ISO with Visa/Mastercard, direct acquiring bank relationship
  - Higher compliance requirements, more stable, card network regulated
  - Can sign merchant agreements in their own name
- ISO B: Sub-agent operating under a parent ISO
  - May offer competitive pricing, but parent ISO controls the account
  - Less direct accountability, account control sits elsewhere`,
    faqs: [
      {
        question: "How can I verify a company is a registered ISO?",
        answer: "Contact Visa or Mastercard directly, or ask the company for their registration number. Visa maintains a public list of registered ISOs and their sponsoring banks.",
      },
    ],
    relatedTerms: ["iso-msp", "payment-facilitator", "payment-processor", "acquiring-bank", "merchant-account"],
    commercialLinks: [
      { label: "About Liberty Bancard", href: "/about-contact" },
    ],
    libertySection: `Liberty Bancard maintains registered ISO status with both Visa and Mastercard. Our registration is kept current and our merchant agreements reflect our direct ISO relationship. Ask us for our registration credentials at any time.`,
  },
  {
    slug: "payment-facilitator",
    name: "Payment Facilitator",
    shortDefinition: "A company that aggregates many merchants under a single merchant account, simplifying onboarding but with less customization and account stability.",
    category: "Account & Business Terms",
    searchVolume: "590/mo",
    fullDefinition: `A payment facilitator (payfac) is a type of payment service provider that aggregates multiple sub-merchants under a single master merchant account. Square, Stripe, PayPal, and Shopify Payments are all payment facilitators. They allow merchants to begin accepting payments almost instantly with no traditional merchant underwriting.

How payfacs work:
1. The payfac applies for and holds a master merchant account
2. Merchants sign up as "sub-merchants" under the payfac
3. The payfac handles underwriting, compliance, and settlement
4. All transactions flow through the payfac's master account
5. The payfac pays out to sub-merchants after deducting their fees

The advantages of using a payfac:
- Instant or same-day account setup
- No complex underwriting process
- Predictable flat-rate pricing
- Simple, user-friendly interfaces

The disadvantages:
- Higher rates (the payfac charges a premium for the ease and risk management)
- Account instability (your sub-merchant account can be suspended or terminated quickly)
- Less negotiating power
- One-size-fits-all pricing doesn't favor high-volume or diverse merchants
- Customer service issues are common at scale`,
    merchantImpact: `Payment facilitators are excellent for startup businesses and those with very low volume. As your processing volume grows, the premium you pay for instant setup and simplicity becomes increasingly expensive.

The biggest operational risk with payfacs: account freezes. Square and Stripe are known to freeze accounts without notice when their algorithms flag unusual activity. For an established business, a processing freeze can be catastrophic.`,
    example: `Two e-commerce businesses, both processing $100,000/month:
- Business using Stripe (payfac): 2.9% + $0.30 = $2,900 + $600 = $3,500/month in fees
- Business with dedicated merchant account (interchange plus + 0.30%): ~1.9% effective = $1,900/month
- Monthly savings from dedicated account: $1,600
- Annual savings: $19,200`,
    faqs: [
      {
        question: "Is Square a payment facilitator?",
        answer: "Yes. Square, Stripe, PayPal, and Shopify Payments are all payment facilitators. They aggregate merchants under their master accounts. This enables quick setup but comes with different terms than dedicated merchant accounts.",
      },
      {
        question: "Can a payfac freeze my account?",
        answer: "Yes. Payment facilitators retain the right to freeze or terminate sub-merchant accounts at any time for suspected fraud, unusual activity, chargeback spikes, or policy violations. This is a significant operational risk for established businesses.",
      },
    ],
    relatedTerms: ["iso-msp", "payfac-vs-iso", "merchant-account", "payment-processor", "flat-rate-pricing", "registered-iso"],
    commercialLinks: [
      { label: "Get a Dedicated Merchant Account", href: "/merchant-application" },
      { label: "See How We Compare to Stripe/Square", href: "/beat-square-stripe" },
    ],
    libertySection: `If you're currently using Square, Stripe, or PayPal and processing over $30,000/month, switching to a Liberty Bancard dedicated merchant account will almost certainly save you money — and give you more account stability. We can show you the math before you switch.`,
  },
  {
    slug: "payfac-vs-iso",
    name: "PayFac vs. ISO",
    shortDefinition: "The key difference between payment facilitators (aggregated, instant setup) and ISOs (dedicated accounts, negotiated pricing, higher volume).",
    category: "Account & Business Terms",
    searchVolume: "320/mo",
    fullDefinition: `Understanding the difference between a payment facilitator (payfac) and an ISO (Independent Sales Organization) is essential for choosing the right payment processing structure for your business stage and volume.

**Payment Facilitator (Payfac)**:
- Example companies: Square, Stripe, PayPal, Shopify Payments, Toast
- Setup: Instant or same-day, minimal underwriting
- Pricing: Flat rate (typically 2.6%–2.9% + per-transaction fee)
- Account type: Sub-merchant account under payfac's master account
- Stability: Lower — accounts can be frozen or terminated quickly
- Control: Limited — payfac sets all terms and pricing
- Best for: Startups, very low volume, or businesses testing card acceptance

**ISO (Independent Sales Organization)**:
- Example companies: Liberty Bancard, North American Bancard, First Data agents
- Setup: 1-7 business days for underwriting and approval
- Pricing: Interchange plus (negotiated markup over actual interchange)
- Account type: Dedicated merchant account
- Stability: Higher — direct relationship with acquirer
- Control: More — can negotiate rates and terms
- Best for: Established businesses processing $10,000+/month

The fundamental economic difference: payfacs make money by charging a flat rate that covers their costs and profit in all scenarios. ISOs make money on a smaller markup over actual interchange, which scales with volume.`,
    merchantImpact: `Choosing between a payfac and an ISO is primarily a business stage decision:
- Starting out / under $5,000/month: Payfac (easier setup, lower risk)
- $5,000–$15,000/month: Either works, evaluate based on your needs
- Over $15,000/month: ISO with interchange plus will typically save 0.5%–1.0% in effective rate
- Over $50,000/month: ISO is almost always significantly cheaper`,
    example: `Annual comparison at $300,000 in processing:
- Payfac (Square at 2.6%): $7,800/year in fees
- ISO (Interchange plus at 1.95% effective): $5,850/year in fees
- Annual savings with ISO: $1,950`,
    faqs: [
      {
        question: "When should I switch from a payfac to an ISO?",
        answer: "Consider switching when you're consistently processing over $10,000-$15,000/month and the savings from lower rates justify the slightly more complex setup process. Most businesses find the crossover point between $10,000-$20,000/month.",
      },
      {
        question: "Can I use both a payfac and an ISO?",
        answer: "Yes, some businesses use a payfac as a backup or for specific channels while their primary processing runs through an ISO. This can provide processing redundancy.",
      },
    ],
    relatedTerms: ["payment-facilitator", "iso-msp", "flat-rate-pricing", "interchange-plus-pricing", "merchant-account", "registered-iso"],
    commercialLinks: [
      { label: "See How Liberty Bancard Compares", href: "/beat-square-stripe" },
      { label: "Get a Free Rate Comparison", href: "/compare-rates" },
    ],
    libertySection: `Liberty Bancard is an ISO — not a payfac. That means dedicated merchant accounts, negotiated interchange plus pricing, and personalized service. If you've outgrown Square or Stripe, we can show you exactly what you'd save by switching.`,
  },
  {
    slug: "pci-dss",
    name: "PCI DSS",
    shortDefinition: "Payment Card Industry Data Security Standard — the mandatory security requirements all merchants must follow to protect cardholder data.",
    category: "Risk & Compliance Terms",
    searchVolume: "2,400/mo",
    fullDefinition: `PCI DSS (Payment Card Industry Data Security Standard) is a set of security standards established by the Payment Card Industry Security Standards Council (PCI SSC) — a body founded by Visa, Mastercard, American Express, Discover, and JCB. Any business that processes, stores, or transmits cardholder data must comply with PCI DSS.

PCI DSS has 12 core requirements organized into six control objectives:

1. **Build and maintain a secure network**: Install firewalls, change default passwords
2. **Protect cardholder data**: Protect stored data, encrypt data in transit
3. **Maintain a vulnerability management program**: Antivirus, secure systems
4. **Implement strong access control**: Restrict access to cardholder data
5. **Monitor and test networks**: Track access, test security regularly
6. **Maintain an information security policy**: Address information security for employees and contractors

There are four levels of PCI compliance based on annual transaction volume:
- **Level 1**: Over 6 million transactions/year → annual on-site audit (QSA)
- **Level 2**: 1–6 million transactions/year → annual Self-Assessment Questionnaire (SAQ)
- **Level 3**: 20,000–1 million e-commerce transactions/year → SAQ
- **Level 4**: Under 20,000 e-commerce or under 1 million other transactions → SAQ

Most small merchants qualify for Level 4 and complete an SAQ annually. PCI compliance is the merchant's responsibility, though processors and ISOs typically provide guidance and tools.`,
    merchantImpact: `PCI non-compliance carries significant financial risk. Penalties for non-compliance range from $5,000–$100,000 per month. A data breach while non-compliant can result in card network fines, forensic investigation costs, and liability for fraudulent charges.

Beyond fines, the reputational damage from a breach can devastate a small business. Customers who have their card data stolen are unlikely to return.

The good news: for most small merchants using modern payment terminals and not storing card data, PCI compliance is achievable through an annual SAQ and basic security practices.`,
    example: `A small restaurant's PCI compliance path:
1. Confirm they don't store card data (they don't — terminal handles everything)
2. Determine their PCI level: Level 4 (under 1 million transactions/year)
3. Complete the appropriate SAQ form (SAQ B-IP for integrated terminals)
4. Ensure their terminal uses encryption and is listed on PCI's approved device list
5. Submit the SAQ and attestation to their acquirer annually
6. Pay the annual PCI compliance fee to their processor ($50-$150/year)`,
    faqs: [
      {
        question: "What happens if I'm not PCI compliant?",
        answer: "Non-compliant merchants pay monthly non-compliance fees ($10–$50+/month) from their processor, are liable for card data breaches, may face card network fines, and risk losing their merchant account. Compliance is mandatory, not optional.",
      },
      {
        question: "Does using a payment processor mean I'm automatically PCI compliant?",
        answer: "No. Your processor is compliant, but you must be separately compliant. If you use a terminal that doesn't store card data and complete your annual SAQ, you're likely compliant. But compliance is the merchant's responsibility.",
      },
      {
        question: "How long does PCI compliance take?",
        answer: "For most small merchants, completing the annual Self-Assessment Questionnaire takes 30-60 minutes. Larger merchants with complex IT environments may spend weeks on compliance activities.",
      },
      {
        question: "What is PCI SAQ?",
        answer: "SAQ stands for Self-Assessment Questionnaire. It's the compliance validation tool for merchants who don't need an on-site audit. There are multiple SAQ types (A, B, B-IP, C, C-VT, D) depending on how you accept cards and whether you store card data.",
      },
    ],
    relatedTerms: ["pci-compliance", "encryption", "tokenization", "merchant-account", "high-risk-merchant"],
    commercialLinks: [
      { label: "PCI Compliance Support", href: "/security-compliance" },
      { label: "Get a Free Consultation", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard provides PCI compliance guidance and tools to all merchants. Our annual PCI compliance fee covers your SAQ support, compliance monitoring, and breach assistance. We make PCI compliance straightforward for merchants without in-house IT.`,
  },
  {
    slug: "pci-compliance",
    name: "PCI Compliance",
    shortDefinition: "The state of meeting PCI DSS requirements — validating annually that your business properly protects cardholder data.",
    category: "Risk & Compliance Terms",
    searchVolume: "1,900/mo",
    fullDefinition: `PCI compliance refers to the ongoing state of adhering to PCI DSS (Payment Card Industry Data Security Standard) requirements. It's not a one-time certification — compliance must be maintained continuously and validated annually.

For most small merchants, PCI compliance is achieved by:
1. **Using compliant equipment**: Only using PCI-approved payment terminals on the Validated Payment Applications list
2. **Not storing sensitive cardholder data**: Most modern terminals don't store card numbers — but verify this is the case
3. **Completing the annual Self-Assessment Questionnaire (SAQ)**: An honest self-evaluation of your security practices
4. **Maintaining basic security practices**: Strong passwords, updated software, employee access controls
5. **Using encryption and tokenization**: Ensuring card data is protected in transit and at rest

PCI compliance fees: Most processors charge a PCI compliance fee ($5–$15/month or $50–$150/year) that covers the cost of their compliance programs and SAQ support. Some charge a non-compliance fee ($10–$50/month extra) if merchants don't complete their SAQ — this is often an additional profit center for processors.

Being "PCI compliant" reduces but does not eliminate liability in the event of a breach. If you've completed your SAQ and maintained compliant practices, liability shifts significantly. If you're non-compliant, you bear full liability.`,
    merchantImpact: `PCI compliance is a business protection measure. The $100–$200/year you spend on PCI compliance is insignificant compared to the cost of a data breach: card brand fines ($5,000–$100,000+), forensic investigation costs ($20,000–$100,000), remediation costs, and customer notification requirements.

Check your processing statement: if you're paying a "non-compliance fee" it means you haven't completed your annual SAQ. Contact your processor to complete it — the fee goes away and you're actually protected.`,
    example: `A small dental office's PCI compliance checklist:
- Payment terminal: Clover Flex (PCI-listed, point-to-point encrypted)
- No card data stored in practice management software
- Annual SAQ: SAQ B-IP completed in 20 minutes
- Wi-Fi network segmented (payment network separate from practice network)
- Employee access to payment terminal limited to front desk
- Result: PCI compliant, no non-compliance fees, reduced breach liability`,
    faqs: [
      {
        question: "How do I complete my PCI SAQ?",
        answer: "Your processor will provide you with a portal or link to complete the SAQ. The appropriate SAQ type depends on how you accept payments. Most small card-present merchants use SAQ B or B-IP. Answer honestly — false attestations carry legal liability.",
      },
      {
        question: "What is the PCI compliance fee on my statement?",
        answer: "The PCI compliance fee ($5–$15/month) is charged by your processor for PCI support services. This is normal. If you see both a compliance fee AND a non-compliance fee, call your processor — you may not have completed your annual SAQ.",
      },
      {
        question: "Does online selling require more PCI compliance work?",
        answer: "Yes. E-commerce merchants have more PCI requirements because card data is entered online. Using a PCI-compliant hosted payment page or tokenization can dramatically reduce your scope and compliance burden.",
      },
    ],
    relatedTerms: ["pci-dss", "encryption", "tokenization", "payment-gateway", "merchant-account", "high-risk-merchant"],
    commercialLinks: [
      { label: "Our Security & Compliance Commitment", href: "/security-compliance" },
      { label: "Get PCI Compliance Help", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard supports merchants through the entire PCI compliance process. Our compliance team walks you through your SAQ, answers security questions, and helps you achieve and maintain compliant status. PCI support is included in our merchant services.`,
  },
  {
    slug: "high-risk-merchant",
    name: "High-Risk Merchant",
    shortDefinition: "A business that processors classify as having elevated chargeback or fraud risk — requiring specialized merchant account solutions.",
    category: "Risk & Compliance Terms",
    searchVolume: "2,900/mo",
    fullDefinition: `A high-risk merchant is a business that payment processors and acquiring banks classify as having elevated risk of chargebacks, fraud, or regulatory issues. High-risk classification affects your ability to get a merchant account and the terms you receive.

Common high-risk industries and business types:
- Travel agencies and tour operators
- Nutraceuticals and dietary supplements
- Online gambling and gaming
- Adult content and entertainment
- Online firearms and ammunition sales
- Recurring billing and subscription services
- Debt consolidation and credit repair
- Telemarketing and call centers
- CBD and cannabis-adjacent products
- Bail bondsmen
- High-ticket e-commerce
- Alcohol delivery
- Online pharmacies

Risk factors that can make any business "high-risk":
- High chargeback history (over 1%)
- No processing history (new businesses)
- Bad personal or business credit
- Previous merchant account termination
- High transaction volume (over $20,000/month as a new merchant)
- International card acceptance
- Large average ticket size (over $500)

High-risk merchants need specialized processors who understand their industry and can structure appropriate terms.`,
    merchantImpact: `If you're classified as high-risk, expect: higher processing rates (1-3% above standard), mandatory rolling reserves (5-10% of volume held for 90-180 days), longer contract terms (often 3 years), and more restrictive terms.

Despite these challenges, many high-risk merchants operate profitably with the right processor. The key is finding a processor who understands your industry and can structure a merchant account that accounts for risk without overcharging.`,
    example: `A new online supplement company:
- Industry: Nutraceuticals (high-risk due to chargeback rates in industry)
- No processing history
- Expects $50,000/month in volume
- High-risk terms they might receive:
  - Rate: interchange + 1.5% (vs. 0.30% for standard merchants)
  - Rolling reserve: 10% for 180 days
  - Contract: 3-year term
  - Account approval time: 1-2 weeks`,
    faqs: [
      {
        question: "Can I get a merchant account if I'm high-risk?",
        answer: "Yes. Specialized high-risk processors exist to serve industries that standard processors won't touch. Rates will be higher and terms more restrictive, but merchant accounts are available for virtually all legal business types.",
      },
      {
        question: "Will I always be considered high-risk?",
        answer: "Not necessarily. A business that starts high-risk (new, no processing history) can graduate to standard risk classification after 6-12 months of clean processing history, low chargebacks, and growth. Building a track record is key.",
      },
      {
        question: "Why does my industry matter for payment processing?",
        answer: "Some industries historically have higher chargeback rates, fraud rates, or regulatory scrutiny. Processors price risk into their terms. Even if YOUR business has no issues, you may be classified by industry.",
      },
    ],
    relatedTerms: ["merchant-account", "reserve-account", "rolling-reserve", "chargeback-ratio", "match-list", "underwriting"],
    commercialLinks: [
      { label: "High-Risk Merchant Accounts", href: "/merchant-application" },
      { label: "Get a Free Consultation", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard specializes in merchant accounts for businesses that standard processors decline. We work with a network of high-risk acquiring banks and can structure accounts for challenging industries. Contact us to discuss your specific situation.`,
  },
  {
    slug: "reserve-account",
    name: "Reserve Account",
    shortDefinition: "Funds held by a processor as security against future chargebacks or financial losses — common for new or high-risk merchants.",
    category: "Risk & Compliance Terms",
    searchVolume: "480/mo",
    fullDefinition: `A reserve account (or merchant reserve) is an amount of funds held back from a merchant's settlements as financial security for the acquiring bank. If the merchant has chargebacks, fraud losses, or goes out of business, the acquiring bank uses the reserve to cover their exposure.

Reserve accounts are most common for:
- High-risk merchants (travel, supplements, online businesses)
- New merchants with no processing history
- Merchants with elevated chargeback history
- Businesses with high average ticket sizes (large potential liability per transaction)

There are two main types of reserves:
1. **Rolling reserve**: A percentage of each batch (typically 5-10%) is held for a set period (90-180 days), then released. As processing volume grows, older reserves release and new ones are created. Established merchants may have $0 in held reserves at any given time once the cycle matures.
2. **Capped reserve**: A fixed dollar amount is held until the reserve cap is reached (e.g., $5,000). Once reached, no additional funds are held. After a qualifying period (6-12 months of clean history), the reserve may be released.
3. **Upfront reserve**: Merchant pays a lump sum into a reserve account before processing begins. Less common.`,
    merchantImpact: `Reserve accounts affect cash flow. If your processor holds 10% of every batch for 180 days, you're effectively financing 10% of your receivables at all times. For a business processing $100,000/month, that's $10,000 tied up in reserve.

Understanding your reserve requirements before signing a merchant agreement is critical. Negotiate the reserve percentage, cap, and release schedule. As your processing history demonstrates low risk, request a reserve reduction or elimination.`,
    example: `A new travel agency processes $80,000/month:
- Rolling reserve: 10% of each batch held for 6 months
- Month 1: $8,000 held from $80,000 in transactions
- Month 2-6: Additional $8,000 held each month = $40,000 in reserve
- Month 7: Month 1's reserve ($8,000) released; new reserve from Month 7 held
- At steady state: $40,000 continuously in reserve (released and replaced monthly)`,
    faqs: [
      {
        question: "Will I ever get my reserve money back?",
        answer: "Yes. Rolling reserves are released on a schedule (typically 90-180 days after the funds are held). When your account closes, reserves are held for 90-180 days to cover any final chargebacks, then released.",
      },
      {
        question: "Can I negotiate my reserve requirements?",
        answer: "Yes, especially after building a clean processing history. Request a reserve review after 6-12 months of low chargeback rates. Providing financial statements or personal guarantees can also reduce reserve requirements.",
      },
      {
        question: "Do all merchant accounts require reserves?",
        answer: "No. Standard-risk merchants with good credit and established businesses typically get accounts with no reserves or minimal reserves. High-risk businesses and new merchants are most likely to have reserve requirements.",
      },
    ],
    relatedTerms: ["rolling-reserve", "high-risk-merchant", "chargeback-ratio", "settlement", "underwriting"],
    commercialLinks: [
      { label: "Get a Free Consultation", href: "/get-started" },
      { label: "Apply for a Merchant Account", href: "/merchant-application" },
    ],
    libertySection: `Liberty Bancard structures reserve requirements based on actual risk — not arbitrary policies. We work with merchants to minimize reserves through financial documentation, personal guarantees, and processing history. Contact us to discuss reserve options for your specific situation.`,
  },
  {
    slug: "rolling-reserve",
    name: "Rolling Reserve",
    shortDefinition: "A reserve type where a percentage of each batch is withheld for a set period, then released on a rolling basis — the most common merchant reserve structure.",
    category: "Risk & Compliance Terms",
    searchVolume: "390/mo",
    fullDefinition: `A rolling reserve is the most common type of merchant reserve account structure. Under a rolling reserve, the processor withholds a percentage (typically 5-10%) of each settlement batch for a defined holding period (typically 90-180 days), then releases those funds on a rolling schedule as the holding period expires.

How rolling reserves work in practice:
- Each day/week when funds settle, 5-10% is diverted to the reserve account
- Held for 90-180 days
- After the holding period, those specific funds are released to the merchant
- Simultaneously, new reserves from recent batches continue to be held

The rolling nature means reserves are always cycling: old funds releasing as new ones are held. Once a merchant has been processing for longer than the reserve period, the releases and holds roughly offset each other (in dollar terms), though new volume still creates new reserves.

Rolling reserves are preferred over upfront (or "upfront capped") reserves because merchants don't need to deposit a lump sum before processing. The reserve builds organically from processing volume.

When a merchant account is closed, rolling reserves continue to be held through the remainder of the reserve period (90-180 days) to cover any post-closure chargebacks. This is why merchants who switch processors sometimes find their old processor holding funds long after the switch.`,
    merchantImpact: `Rolling reserves create a cash flow burden for high-risk merchants. Budget for the fact that 5-10% of your revenue will be unavailable for 3-6 months.

Example cash flow impact: A business processing $50,000/month with a 10% rolling reserve (180 days) will have $30,000 locked in reserve at steady state (6 months × $5,000/month). This is significant working capital that could otherwise be reinvested in the business.

When evaluating processor terms, consider the reserve percentage, holding period, and any conditions that would accelerate reserve release (e.g., 12 months of clean history, financial statements, or higher revenue thresholds).`,
    example: `Rolling reserve timeline (5% reserve, 90-day hold):
- January: $100,000 processed → $5,000 held
- February: $100,000 processed → $5,000 held (Jan hold continues)
- March: $100,000 processed → $5,000 held (Jan, Feb continue)
- April: $100,000 processed → $5,000 held; January's $5,000 RELEASED
- From April forward: $5,000 released each month, $5,000 held each month → $15,000 constantly in reserve`,
    faqs: [
      {
        question: "How do I get my rolling reserve released faster?",
        answer: "Demonstrate low chargeback rates (under 0.5%), provide financial statements or tax returns showing business health, and formally request a reserve review. Most processors will reduce or eliminate reserves for merchants with clean 12-month histories.",
      },
      {
        question: "What happens to my rolling reserve if I close my merchant account?",
        answer: "Rolling reserves are held for the full reserve period after account closure. If your holding period is 180 days, funds processed in your last month before closure won't be released until 6 months after closure.",
      },
    ],
    relatedTerms: ["reserve-account", "high-risk-merchant", "settlement", "chargeback-ratio", "underwriting"],
    commercialLinks: [
      { label: "Discuss Reserve Terms", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard structures rolling reserves at the minimum level required by our acquiring banks for each merchant category. We review and reduce reserves proactively for merchants who demonstrate clean processing history. Ask us about our reserve reduction milestones.`,
  },
  {
    slug: "underwriting",
    name: "Underwriting",
    shortDefinition: "The process by which a payment processor or acquiring bank evaluates a merchant's risk level before approving a merchant account.",
    category: "Risk & Compliance Terms",
    searchVolume: "260/mo",
    fullDefinition: `Merchant account underwriting is the risk assessment process that determines whether a merchant is approved for a payment processing account and under what terms. It's similar to credit underwriting for a loan — the processor evaluates the likelihood that the merchant will generate chargebacks, fraud, or other losses.

Underwriting typically examines:
- **Business type**: Industry, products/services, transaction types
- **Processing history**: Chargeback rates, refund rates, processing volume
- **Financial stability**: Business credit, personal credit, time in business, revenue
- **Business legitimacy**: Website, business license, incorporation documents
- **Card mix**: Percentage of card-present vs. card-not-present transactions
- **Average ticket**: Higher average tickets create more risk per transaction
- **Geographic markets**: Domestic vs. international processing

The underwriting decision determines:
- Whether to approve the account
- Risk classification (standard vs. high-risk)
- Rate structure
- Reserve requirements
- Processing limits (daily/monthly caps)
- Contract terms

For standard merchants, underwriting may take 24-48 hours. For high-risk businesses or complex situations, underwriting can take 1-2 weeks.`,
    merchantImpact: `The underwriting process isn't something to dread — it's an opportunity to present your business favorably. Prepare your application with: a professional website, clear business description, accurate anticipated volume, processing history if available, and financial statements if requested.

Misrepresentation on merchant applications is fraud and can result in account termination, card network fines, and legal liability. Be accurate about your business model and volume projections.`,
    example: `Underwriting comparison:
- New restaurant: 1-2 day approval, standard risk, no reserve, interchange + 0.30%
- New online supplement company: 1-2 week review, high-risk, 10% rolling reserve, interchange + 1.5%
- Established restaurant (5 years, clean history): Same-day approval, negotiated rate, no reserve
The difference in terms reflects the processor's assessment of expected chargeback risk and account sustainability.`,
    faqs: [
      {
        question: "What documents do I need for merchant account underwriting?",
        answer: "Typically: government-issued ID, business license or articles of incorporation, voided business check (for bank account verification), 3 months of bank statements, 3 months of processing statements (if switching processors), and a clear business website.",
      },
      {
        question: "Can I get a merchant account with bad credit?",
        answer: "Yes, in many cases. Bad personal credit increases risk perception but doesn't necessarily disqualify you. Providing strong business financials, a larger reserve, or working with a high-risk specialist can overcome credit challenges.",
      },
      {
        question: "What happens if my merchant account is denied?",
        answer: "The denial reason matters. Processors should tell you why you were declined. Common reasons: high-risk industry without specialist processor, bad credit, insufficient business documentation, or previous merchant account termination. Each can be addressed differently.",
      },
    ],
    relatedTerms: ["high-risk-merchant", "reserve-account", "merchant-account", "match-list", "chargeback-ratio"],
    commercialLinks: [
      { label: "Apply for a Merchant Account", href: "/merchant-application" },
      { label: "High-Risk Account Consultation", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard's underwriting team reviews applications quickly — typically 24-48 hours for standard merchants. We provide clear feedback if additional documentation is needed and work with merchants to structure accounts that meet our approval criteria. Contact us to pre-qualify before submitting a formal application.`,
  },
  {
    slug: "match-list",
    name: "MATCH List",
    shortDefinition: "The Mastercard Alert To Control High-Risk Merchants list — a shared database of merchants whose accounts were terminated for fraud, chargebacks, or violations.",
    category: "Risk & Compliance Terms",
    searchVolume: "480/mo",
    fullDefinition: `The MATCH list (Mastercard Alert To Control High-Risk Merchants), formerly called the TMF (Terminated Merchant File), is a database maintained by Mastercard that lists merchants and their principals whose accounts were terminated by acquiring banks due to risk violations. Processors check this list before approving new merchant accounts.

Reasons for MATCH listing include:
- Excessive chargebacks (over 1% Mastercard threshold)
- Fraudulent activity
- Money laundering
- Violation of card network rules
- Account data compromise
- Bankruptcy or other financial issues
- Transaction laundering (processing transactions for other businesses)
- Illegal transactions

Being placed on the MATCH list is essentially a processing blacklist. When you apply for a new merchant account, processors run your name and business information through MATCH. A MATCH hit significantly (though not impossibly) impairs your ability to get a new merchant account.

The MATCH list is not public — it's only accessible to member financial institutions and their ISOs. Merchants can request their own MATCH status from Mastercard through specific channels.

MATCH listings remain for 5 years. Removal before 5 years is very difficult and requires the original listing entity to request removal — which they rarely do voluntarily.`,
    merchantImpact: `MATCH listing is serious — it can effectively prevent you from accepting card payments for up to 5 years through traditional channels. If you're MATCH listed, your options include: working with high-risk offshore processors (at high cost), using payment aggregators for small volumes, or pursuing legal removal of an incorrect listing.

Prevention is critical. Monitor your chargeback ratio, respond to all disputes, and never process transactions for other businesses through your merchant account (transaction laundering is a common reason for MATCH listing).`,
    example: `A merchant processes $200,000 in a month with an unusual spike of chargebacks (3% ratio):
- Processor terminates the account for excessive chargebacks
- Processor adds merchant's name, DBA, and principals to MATCH list
- Merchant applies for new accounts with multiple processors
- All run MATCH and decline due to the listing
- Merchant must wait 5 years or work with specialized high-risk processors`,
    faqs: [
      {
        question: "How do I find out if I'm on the MATCH list?",
        answer: "You can check your MATCH status by contacting Mastercard directly or asking your processor. Equifax LNA (formerly Naviant) administers MATCH for Mastercard and has a process for merchants to inquiry about their status.",
      },
      {
        question: "Can I be removed from the MATCH list?",
        answer: "Removal requires the entity that listed you to request removal — usually the processor or acquiring bank. This rarely happens voluntarily. If you were incorrectly listed (fraud, error, identity theft), you can dispute the listing with documentation.",
      },
      {
        question: "Can I still get a merchant account if I'm MATCH listed?",
        answer: "Standard processors will decline MATCH-listed merchants. Specialized high-risk processors and offshore acquiring banks may work with MATCH-listed merchants, but at significantly higher rates and with strict terms.",
      },
    ],
    relatedTerms: ["chargeback-ratio", "high-risk-merchant", "underwriting", "merchant-account", "chargeback"],
    commercialLinks: [
      { label: "High-Risk Merchant Account Help", href: "/merchant-application" },
      { label: "Consult with Our Team", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard helps merchants understand their MATCH status and options. If you've been MATCH listed, we can help evaluate specialized processing options and work with you on a plan to address the underlying issues that led to the listing.`,
  },
  {
    slug: "velocity-limits",
    name: "Velocity Limits",
    shortDefinition: "Processing limits that restrict the number or dollar amount of transactions a merchant can process within a given time period to prevent fraud.",
    category: "Risk & Compliance Terms",
    searchVolume: "160/mo",
    fullDefinition: `Velocity limits in payment processing are controls that cap the number of transactions, total dollar amount, or both that a merchant can process within a defined time window (per hour, per day, per month). They serve as a fraud prevention mechanism — limiting damage if fraudulent activity occurs.

Types of velocity limits:
- **Transaction count velocity**: Maximum number of transactions per hour or day
- **Dollar volume velocity**: Maximum dollar amount per day or month
- **Single transaction limits**: Maximum amount per individual transaction
- **Card velocity checks**: Maximum number of transactions from a single card number in a period

Velocity limits are set during underwriting based on your stated processing volume and risk profile. If your actual processing needs exceed your velocity limits, you need to request an increase.

Velocity checks are also implemented by processors and gateways as real-time fraud controls. If multiple transactions are attempted with the same card in a short window (possible carding attack), velocity limits will decline the attempts.

For merchants, velocity limits matter during:
- High-volume events (sales, holidays, seasonal spikes)
- Business growth (when actual volume exceeds originally approved limits)
- Account setup (new merchants often have conservative initial limits)`,
    merchantImpact: `If your processing volume hits velocity limits, transactions will be declined — potentially during your busiest periods. Proactively request velocity limit increases before seasonal peaks or promotional events.

If you regularly hit limits, work with your processor to document your legitimate volume and request higher limits. Providing 3-6 months of bank statements showing corresponding revenue deposits helps justify increased limits.`,
    example: `A holiday pop-up shop has a $50,000/month velocity limit:
- Regular months: Process $20,000 → no issues
- December: Expected volume $75,000 → will hit the $50,000 monthly limit mid-month
- Transactions declined after limit reached → lost sales
- Prevention: Request limit increase to $100,000 in October, before the holiday rush`,
    faqs: [
      {
        question: "How do I know what my velocity limits are?",
        answer: "Check your merchant processing agreement or ask your processor directly. Your monthly processing limit, daily limit, and per-transaction limit should be specified in your agreement.",
      },
      {
        question: "How do I request a velocity limit increase?",
        answer: "Contact your processor and request an increase. They will typically ask for documentation: recent bank statements, prior processing history, reason for the increase, and potentially financial statements. Process takes 1-5 business days.",
      },
    ],
    relatedTerms: ["merchant-account", "underwriting", "high-risk-merchant", "authorization", "chargeback-ratio"],
    commercialLinks: [
      { label: "Get the Right Processing Limits", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard proactively reviews velocity limits with merchants seasonally and after significant business growth. We ensure your processing limits match your actual business needs so you never lose a sale due to an arbitrary cap.`,
  },
  {
    slug: "emv-chip",
    name: "EMV Chip",
    shortDefinition: "The microchip embedded in modern credit and debit cards that generates a unique code for each transaction, dramatically reducing counterfeit card fraud.",
    category: "Equipment & Technology Terms",
    searchVolume: "720/mo",
    fullDefinition: `EMV (which stands for Europay, Mastercard, and Visa) is the global standard for chip-based payment cards. EMV chips are the small metallic squares on modern credit and debit cards that generate a unique, one-time cryptographic code for each transaction — making counterfeiting effectively impossible.

How EMV works:
1. Card is inserted (dipped) into an EMV-compliant terminal
2. The chip and terminal exchange encrypted data
3. The chip generates a unique cryptogram for that specific transaction
4. The cryptogram is verified by the issuing bank during authorization
5. Even if fraudsters capture the cryptogram, it cannot be reused

EMV was introduced in the US in 2015 when card networks implemented a "liability shift": if a merchant's terminal doesn't support chip reading and a fraudulent transaction occurs on a chip card, liability shifts to the merchant (rather than the issuing bank). This created a strong incentive for merchants to upgrade to EMV-compliant terminals.

Pre-EMV (magnetic stripe only):
- Counterfeit card fraud was rampant — criminals could clone magnetic stripes easily
- Issuing banks bore most fraud losses

Post-EMV:
- Counterfeit card fraud at chip-reading terminals reduced by over 70%
- Fraud shifted to card-not-present (online) transactions instead

Despite EMV adoption, many merchants still allow magnetic stripe fallback — where a chip card can be swiped if the chip read fails. This bypasses EMV protections and can trigger the liability shift.`,
    merchantImpact: `Using EMV-compliant terminals is financially and legally critical. Without EMV:
- You bear liability for counterfeit card fraud (could be thousands per incident)
- Your chargeback ratio may increase due to fraud chargebacks
- Your interchange rates may be higher (card-not-present or downgraded categories)

Ensure your terminals require chip insertion, not just magnetic stripe acceptance. If a chip card is swiped (rather than dipped), your terminal should prompt for chip insert. Allowing frequent swipe fallback eliminates EMV protection.`,
    example: `The financial impact of the EMV liability shift:
- A merchant uses an old swipe-only terminal in 2024
- Customer presents chip-enabled card; cashier swipes the stripe
- Fraudster had cloned the stripe; the transaction was fraudulent
- Issuing bank files a chargeback: $850
- Because merchant didn't use chip reader: Merchant loses $850 + $50 chargeback fee
- If chip reader had been used: Issuing bank bears fraud loss, not merchant`,
    faqs: [
      {
        question: "Do I need an EMV terminal?",
        answer: "Yes, for any business accepting in-person card payments. If your terminal doesn't support EMV chip reading, you're exposed to liability for counterfeit card fraud. EMV terminals are now standard and widely available.",
      },
      {
        question: "What is the EMV liability shift?",
        answer: "The EMV liability shift (implemented in 2015) means that if a fraudulent transaction occurs and the merchant's terminal doesn't support chip reading (but the customer's card has a chip), the merchant — not the issuing bank — is liable for the fraud loss.",
      },
      {
        question: "Is EMV the same as contactless payment?",
        answer: "No, but related. EMV refers specifically to chip technology (card inserted). Contactless (NFC) payments use a different radio technology to transmit payment data wirelessly. Modern terminals support both EMV chip and NFC contactless.",
      },
    ],
    relatedTerms: ["nfc-contactless", "pos-system", "payment-terminal", "card-reader", "encryption", "tokenization"],
    commercialLinks: [
      { label: "Shop EMV-Compliant Terminals", href: "/shop" },
      { label: "Get a Free Terminal", href: "/get-started" },
    ],
    libertySection: `All terminal equipment provided by Liberty Bancard is fully EMV-compliant and NFC-enabled. We don't place merchants on outdated hardware. New merchants receive a free EMV/NFC terminal with an approved merchant account.`,
  },
  {
    slug: "nfc-contactless",
    name: "NFC Contactless Payment",
    shortDefinition: "Near Field Communication technology that allows tap-to-pay transactions from cards, phones, or wearables without physical contact with the terminal.",
    category: "Equipment & Technology Terms",
    searchVolume: "1,300/mo",
    fullDefinition: `NFC (Near Field Communication) contactless payment technology allows customers to pay by tapping their card, smartphone (Apple Pay, Google Pay, Samsung Pay), or wearable device within 1-2 inches of a payment terminal. Data is transmitted wirelessly via radio frequency without physical card contact.

How NFC contactless payments work:
1. Customer holds NFC-enabled card or device near the terminal
2. The terminal detects the NFC signal and initiates communication
3. An encrypted, tokenized transaction code is transmitted
4. Authorization proceeds through the same network as chip/swipe transactions
5. Transaction completes in typically under one second

NFC contactless combines convenience with security:
- **Speed**: Tap-to-pay transactions are 2-3x faster than chip insert
- **Security**: Each transaction generates a unique token — original card number never transmitted
- **Hygiene**: No physical contact required (accelerated adoption post-COVID-19)
- **Customer experience**: Customers can pay with phones or watches without removing cards from wallets

NFC is included in all modern payment terminals (Clover, Dejavoo, PAX, Verifone) and is required by Visa for all new terminals. Contactless card limits vary by card and issuing bank — typically $100-$200 for tap without PIN. Higher amounts may require chip+PIN.

Apple Pay, Google Pay, and Samsung Pay all use NFC with additional security (biometric authentication on the device) making them generally more secure than physical card taps.`,
    merchantImpact: `Offering NFC contactless payment improves checkout speed (faster customer throughput), reduces friction (customers prefer tap-to-pay), and can reduce terminal maintenance (less card insertion wear).

Businesses with high customer throughput — coffee shops, fast food, retail — see measurable benefits from contactless checkout: faster lines, fewer declined chips, and happier customers.

There is no surcharge difference for contactless vs. chip transactions — the processing cost is the same.`,
    example: `A coffee shop implements NFC contactless:
- Before: Average checkout time (chip insert) = 22 seconds
- After: Average checkout time (tap-to-pay) = 8 seconds
- During a morning rush (150 customers in 2 hours): 150 × 14 seconds saved = 35 minutes of checkout time recovered
- Faster service = more customers per hour during peak times`,
    faqs: [
      {
        question: "Is tap-to-pay secure?",
        answer: "Yes, very secure. NFC contactless payments use tokenization — the actual card number is never transmitted. Each transaction generates a unique code. NFC transactions are considered more secure than magnetic stripe swipes.",
      },
      {
        question: "What is the difference between NFC and EMV?",
        answer: "EMV is chip technology (card inserted into terminal). NFC is contactless (card or phone tapped near terminal). Both are secure and use encrypted, tokenized data. Modern terminals support both.",
      },
      {
        question: "Does my terminal support Apple Pay and Google Pay?",
        answer: "Any terminal with NFC capability supports Apple Pay and Google Pay — these wallets use NFC to transmit payment data. Look for the contactless payment symbol (radio waves icon) on your terminal.",
      },
    ],
    relatedTerms: ["emv-chip", "pos-system", "payment-terminal", "card-reader", "tokenization", "encryption"],
    commercialLinks: [
      { label: "Shop NFC-Enabled Terminals", href: "/shop" },
      { label: "Get a Free Contactless Terminal", href: "/get-started" },
    ],
    libertySection: `Every Liberty Bancard terminal is NFC-enabled and supports Apple Pay, Google Pay, Samsung Pay, and all contactless-enabled cards. Contactless payment is standard on all our equipment at no extra charge.`,
  },
  {
    slug: "pos-system",
    name: "POS System",
    shortDefinition: "Point of Sale system — the combination of hardware and software used to process sales, accept payments, and manage business operations at the point of transaction.",
    category: "Equipment & Technology Terms",
    searchVolume: "9,900/mo",
    fullDefinition: `A Point of Sale (POS) system is the hardware and software combination that enables merchants to process sales transactions and accept payment. Modern POS systems have evolved far beyond simple cash registers — they now integrate payment processing, inventory management, employee scheduling, customer loyalty programs, and reporting.

Components of a POS system:
- **Hardware**: Terminal (with card reader), receipt printer, cash drawer, barcode scanner, customer-facing display
- **Software**: The POS application that manages transactions, inventory, and reporting
- **Payment processing**: Integrated or connected to a payment processor/gateway

Major POS platforms:
- **Clover**: Full-featured, integrates with many processors, excellent for restaurants and retail
- **Square**: Integrated payfac model, easy setup, flat-rate pricing
- **Toast**: Restaurant-focused, cloud-based, own payment processing
- **Lightspeed**: Retail and hospitality, multi-location support
- **NCR Silver/Aloha**: Enterprise restaurant POS
- **Shopify POS**: E-commerce-first, unified online/offline inventory
- **Revel Systems**: iPad-based, full-service restaurant focus

Cloud-based POS systems store data online for real-time access from anywhere, easier updates, and automatic backups. Legacy POS systems store data locally — more control but require manual updates and on-site servers.`,
    merchantImpact: `Your POS choice directly affects your processing costs, operational efficiency, and growth capabilities. Key questions when selecting a POS:

1. Is it compatible with interchange plus pricing, or does it lock you into a payfac rate?
2. What are the monthly software fees?
3. Does it support your industry-specific needs (table management, inventory tracking, etc.)?
4. What are the hardware costs and can you use existing equipment?
5. What is the contract term and what happens if you switch?

Many POS systems (especially Square and Toast) bundle in payment processing at flat-rate pricing. This simplifies setup but may cost more than a separate POS + dedicated merchant account.`,
    example: `A restaurant evaluating POS options:
- Toast (with built-in processing): $110/month software + 2.49% + $0.15 processing
  - On $80,000/month: $110 software + $2,006 processing = $2,116/month
- Clover (with Liberty Bancard processing at 1.95% effective):
  - $90/month software + $1,560 processing = $1,650/month
  - Annual savings: $5,592`,
    faqs: [
      {
        question: "Do I have to use my POS system's payment processing?",
        answer: "Not always. Many POS systems (Clover, PAX, Dejavoo) work with multiple processors. Others (Square, Toast, Shopify) are integrated with their own processing. If you want processing flexibility, choose a POS that supports multiple processor integrations.",
      },
      {
        question: "What is the difference between a POS system and a payment terminal?",
        answer: "A payment terminal only accepts card payments. A POS system includes payment acceptance plus additional business management features like inventory, reporting, and employee management. Many businesses use both (a full POS with an integrated payment terminal).",
      },
    ],
    relatedTerms: ["payment-terminal", "card-reader", "emv-chip", "nfc-contactless", "virtual-terminal", "payment-processor"],
    commercialLinks: [
      { label: "Shop POS Systems & Terminals", href: "/shop" },
      { label: "Get Started with the Right POS", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard supports Clover, PAX, Dejavoo, and other major POS platforms. We don't lock you into proprietary hardware — we work with the system that fits your business. Free terminal placement available for qualified merchants.`,
  },
  {
    slug: "virtual-terminal",
    name: "Virtual Terminal",
    shortDefinition: "A web-based interface that lets merchants manually enter card details to process payments — ideal for phone orders, invoicing, or remote transactions.",
    category: "Equipment & Technology Terms",
    searchVolume: "880/mo",
    fullDefinition: `A virtual terminal is a web browser-based payment processing interface that allows merchants to manually enter credit card information to process transactions without a physical card reader. Think of it as a software-based card swipe machine that runs in any web browser.

Virtual terminals are ideal for:
- **Phone orders (MOTO)**: Mail order/telephone order businesses where customers provide card info over the phone
- **Service businesses**: Contractors, consultants who invoice clients and take payment remotely
- **B2B transactions**: Businesses that accept card payments via email or purchase order
- **Backup processing**: When physical terminals are down
- **Remote teams**: Sales representatives who need to process payments from customer sites

How virtual terminals work:
1. Merchant logs into their secure virtual terminal portal
2. Enters customer's card number, expiration, CVV, billing address
3. Submits for authorization
4. Receives approval or decline
5. Can print, email, or save the receipt

Key limitations and cost considerations:
- **Security**: Card details are keyed in, not encrypted at the point of entry like chip readers. Tokenization and secure entry pages help mitigate risk.
- **Higher interchange rates**: Keyed (card-not-present) transactions carry higher interchange rates than card-present (chip/tap). The interchange rate premium is typically 0.50%–1.0% higher for keyed vs. swiped.
- **Fraud risk**: Card-not-present transactions have higher fraud rates since the card isn't physically verified.`,
    merchantImpact: `Virtual terminals are convenient but cost more per transaction. If most of your business is phone orders, budget for higher interchange rates compared to card-present transactions.

To minimize costs with virtual terminal payments, always collect AVS (address verification) and CVV data — failure to collect these can result in even higher interchange rates and reduced chargeback protection.`,
    example: `A plumber accepts a phone payment:
- Customer calls to pay $450 invoice by credit card over the phone
- Plumber logs into virtual terminal on laptop
- Enters: card number, expiration, CVV, billing address, amount
- Transaction approved; email receipt sent to customer
- Cost: interchange (keyed, card-not-present) + processor markup
  - ~2.30% effective rate vs. 1.85% for in-person tap`,
    faqs: [
      {
        question: "Is a virtual terminal secure?",
        answer: "Yes, when properly configured. Virtual terminals should use HTTPS (SSL/TLS), tokenize stored card data, and enforce strong login security. Using a PCI-compliant virtual terminal provider and not writing down card numbers are key security practices.",
      },
      {
        question: "How much does a virtual terminal cost?",
        answer: "Virtual terminals typically have a monthly fee ($10–$30/month) plus per-transaction fees. Your processor may include virtual terminal access as part of your account. Interchange rates are higher for keyed transactions than card-present.",
      },
      {
        question: "Can I use a virtual terminal for recurring billing?",
        answer: "Yes. Most virtual terminals support recurring billing — saving a card on file and automatically billing on a schedule. This requires additional PCI compliance for stored card data.",
      },
    ],
    relatedTerms: ["payment-gateway", "card-not-present", "keyed-entry", "card-on-file", "recurring-billing", "pos-system"],
    commercialLinks: [
      { label: "Get Virtual Terminal Access", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard provides virtual terminal access to all merchants at no additional monthly fee. Our virtual terminal supports recurring billing, stored cards with tokenization, and level 2/3 data entry for B2B transactions.`,
  },
  {
    slug: "payment-terminal",
    name: "Payment Terminal",
    shortDefinition: "The physical device used to accept credit and debit card payments at the point of sale — supports chip, swipe, and contactless payment methods.",
    category: "Equipment & Technology Terms",
    searchVolume: "1,600/mo",
    fullDefinition: `A payment terminal (also called a credit card terminal, card terminal, or POS terminal) is the physical hardware device that merchants use to accept credit and debit card payments. Modern terminals accept all major payment methods: magnetic stripe swipe, EMV chip insert, and NFC contactless tap.

Terminal types:
- **Countertop terminals**: Fixed terminals connected via Ethernet or Wi-Fi (Clover Mini, Dejavoo Z9, PAX A80)
- **Portable/wireless terminals**: Battery-powered, connect via Wi-Fi or Bluetooth — for table-side service or mobility (Clover Flex, PAX A920)
- **Mobile readers**: Compact readers that connect to smartphones via Bluetooth (Square Reader, Clover Go)
- **POS terminals**: Full-featured devices with screens and apps (Clover Station, Toast Flex)
- **Unattended/kiosk terminals**: Designed for self-service environments

Key features to look for in a payment terminal:
- **EMV chip support**: Required for liability protection
- **NFC contactless**: For tap-to-pay, Apple Pay, Google Pay
- **PIN pad**: For debit transactions, required for some transaction types
- **End-to-end encryption (E2EE)**: Protects card data from the moment of card interaction
- **Processor compatibility**: Ensure the terminal works with your processor

Terminal pricing: Terminals range from $50 (basic mobile readers) to $1,200+ (full POS systems). Many processors offer free terminal placement with processing agreements or lease terminals (which is generally not recommended — you often pay 2-3x the purchase price over the lease term).`,
    merchantImpact: `Your terminal choice affects security, customer experience, and your processing costs. An older terminal that doesn't support EMV chip creates fraud liability. A terminal without NFC means slower checkout for tap-to-pay customers.

Avoid terminal leases — they're generally poor value. A $400 terminal leased at $40/month over 48 months costs $1,920. Buy or request a free terminal from your processor instead.`,
    example: `Terminal selection for a busy diner:
- Need: Fast, durable, supports chip and tap, works with Liberty Bancard
- Option 1: Clover Flex ($599 retail) — handheld, table-side payments, NFC, EMV
- Option 2: PAX A920 ($350 retail) — similar features, slightly lower cost
- Option 3: Free Dejavoo Z11 with Liberty Bancard processing agreement
  - No upfront cost, full EMV/NFC support, included with account
  - Best choice for most restaurants`,
    faqs: [
      {
        question: "Should I buy or lease a payment terminal?",
        answer: "Buy or get one free from your processor — never lease. Terminal leases are extremely expensive (often $1,500–$3,000 for a $200–$400 device) and typically non-cancellable. Purchase outright or negotiate a free terminal placement with a processing agreement.",
      },
      {
        question: "Can I use my terminal with any processor?",
        answer: "Not always. Some terminals are locked (programmed) to specific processors and require re-keying or replacement to switch. Others (like PAX and Dejavoo) are more flexible. Confirm with your new processor before switching.",
      },
      {
        question: "How long does a payment terminal last?",
        answer: "Quality terminals last 5-7 years with normal use. Most terminals become outdated due to software/security updates rather than hardware failure. Plan to refresh equipment every 3-5 years to stay current with security standards.",
      },
    ],
    relatedTerms: ["emv-chip", "nfc-contactless", "pos-system", "card-reader", "tokenization", "encryption"],
    commercialLinks: [
      { label: "Shop Payment Terminals", href: "/shop" },
      { label: "Get a Free Terminal with Your Account", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard offers free terminal placement on Clover, PAX, and Dejavoo equipment for qualified merchants. All terminals are fully programmed, EMV/NFC-enabled, and shipped ready to process. No lease agreements — ever.`,
  },
  {
    slug: "card-reader",
    name: "Card Reader",
    shortDefinition: "A small mobile device that connects to a smartphone or tablet to accept card payments on the go — the entry-level payment hardware for mobile businesses.",
    category: "Equipment & Technology Terms",
    searchVolume: "1,900/mo",
    fullDefinition: `A mobile card reader is a compact hardware accessory that connects to a smartphone or tablet (via Bluetooth or audio jack) to turn the device into a payment terminal. Mobile card readers are popular for food trucks, market vendors, service businesses, and businesses that need to accept payments in the field.

Types of mobile card readers:
- **Magnetic stripe readers**: Plug into the audio jack or connect via Bluetooth. Basic and inexpensive but no EMV or NFC support. (Example: Square's original swipe reader)
- **EMV chip readers**: Connect via Bluetooth. Support chip insert and magnetic stripe. (Example: Square Reader for contactless and chip, Clover Go)
- **EMV + NFC readers**: Connect via Bluetooth. Support chip, swipe, and contactless tap. Most current-generation mobile readers include this.

Popular mobile card reader options:
- Square Reader (contactless + chip): ~$49
- Clover Go: ~$49
- PayPal Zettle: ~$29
- Stripe Reader M2: ~$59
- Liberty Bancard with NMI mobile: Various options

Important limitation: Mobile card readers typically require cellular data or Wi-Fi to process transactions. Some offer offline mode with limited capability.

Cost consideration: Mobile readers from payfacs (Square, PayPal) come with flat-rate pricing. Mobile readers from traditional processors offer interchange plus pricing and often lower effective rates.`,
    merchantImpact: `Mobile card readers enable businesses to accept payments anywhere with cellular or Wi-Fi connectivity. For the right business type (food trucks, farmers markets, contractors, event vendors), they're essential tools.

The main cost consideration: mobile processing through payfacs like Square costs 2.6% + $0.10. Through a traditional processor with interchange plus pricing, the same mobile transactions might cost 1.9%–2.1%. On $20,000 in monthly mobile volume, that's a $100–$140/month difference.`,
    example: `A mobile pet groomer processes $12,000/month via card reader:
- Using Square Reader (2.6% + $0.10, avg. $75 ticket, ~160 transactions):
  - Processing cost: $312 + $16 = $328/month
- Using Liberty Bancard mobile processing (interchange plus, ~2.0% effective):
  - Processing cost: ~$240/month
  - Monthly savings: $88
  - Annual savings: $1,056`,
    faqs: [
      {
        question: "What is the best mobile card reader for small business?",
        answer: "The best reader depends on your needs. For simplicity and instant setup: Square Reader. For lower rates and more control: a mobile reader through a traditional processor. Look for readers that support EMV chip and NFC contactless.",
      },
      {
        question: "Can a mobile card reader work without Wi-Fi?",
        answer: "Some readers offer limited offline mode where they store transaction data and process when connectivity is restored. Most require internet connectivity for real-time authorization. Check offline capabilities if you process in areas with poor connectivity.",
      },
      {
        question: "Are mobile card readers secure?",
        answer: "Modern mobile readers with EMV and NFC support are secure. They encrypt card data at the point of interaction. Avoid using outdated swipe-only readers that capture magnetic stripe data unencrypted.",
      },
    ],
    relatedTerms: ["emv-chip", "nfc-contactless", "payment-terminal", "pos-system", "payment-facilitator"],
    commercialLinks: [
      { label: "Shop Mobile Card Readers", href: "/shop" },
      { label: "Get Started with Mobile Processing", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard offers mobile card readers compatible with our interchange plus processing. Unlike Square or PayPal, our mobile solutions give you the same transparent pricing as your countertop terminal. Ask about our mobile processing setup.`,
  },
  {
    slug: "tokenization",
    name: "Tokenization",
    shortDefinition: "Replacing sensitive card data with a unique, non-sensitive token that can be used for transactions without exposing the actual card number.",
    category: "Equipment & Technology Terms",
    searchVolume: "1,600/mo",
    fullDefinition: `Payment tokenization is a security method that replaces sensitive card data (primarily the Primary Account Number, or PAN) with a randomly generated, unique string of characters called a token. The token has no intrinsic mathematical relationship to the original card number — it cannot be reverse-engineered to reveal the actual card data.

How tokenization works:
1. Customer enters card details during first payment
2. Payment processor (or token service provider) stores the actual card data in a secure vault
3. A unique token is returned and stored by the merchant or merchant's system
4. Future transactions use the token rather than the actual card number
5. When a transaction is processed, the processor maps the token back to the actual card in the vault

Tokenization vs. encryption:
- **Encryption**: Scrambles data using a key that can decrypt it → card data still exists in scrambled form
- **Tokenization**: Replaces data completely → no card data stored by the merchant, only a token

Two types of tokenization:
1. **Merchant tokenization**: Tokens are specific to one merchant. Allows recurring billing and card-on-file functionality.
2. **Network tokenization**: Tokens issued by card networks (Visa VTS, Mastercard MDES). Work across all merchants and automatically update when cards expire or are reissued.

Apple Pay and Google Pay use network tokens — the actual card number is never transmitted to the merchant's terminal.`,
    merchantImpact: `Tokenization dramatically reduces your PCI compliance scope and breach risk. If your systems store tokens instead of card numbers, a data breach exposes useless tokens — not card data.

For merchants with recurring billing or card-on-file programs, tokenization is essential. Storing actual card numbers requires extensive PCI compliance infrastructure. Storing tokens requires far less.

Network tokenization has an additional benefit: if a customer's card is lost/stolen and replaced, the token automatically updates — eliminating the need to re-collect card data from your customers.`,
    example: `An online subscription service uses tokenization:
- Customer subscribes and enters card 4111-1111-1111-1111
- Processor returns token: TXK-47829-ALPHA-8821
- Merchant stores: TXK-47829-ALPHA-8821 (not the card number)
- Monthly billing: Merchant submits token → processor retrieves real card → charges customer
- If merchant's database is breached: Tokens are exposed (worthless to fraudsters)
- Card data (in secure vault): Safe and not exposed`,
    faqs: [
      {
        question: "Is tokenization required for PCI compliance?",
        answer: "Tokenization is not strictly required by PCI DSS, but it significantly reduces PCI scope by eliminating stored card data. Most compliance experts recommend tokenization as a best practice for any business storing card information.",
      },
      {
        question: "What is the difference between tokenization and encryption?",
        answer: "Encryption scrambles data but the original data still exists (and can be decrypted with the right key). Tokenization replaces data with a different value — the original data is stored separately and cannot be derived from the token. Both add security; tokenization is generally considered stronger for stored card data.",
      },
    ],
    relatedTerms: ["encryption", "pci-dss", "pci-compliance", "payment-gateway", "card-on-file", "recurring-billing"],
    commercialLinks: [
      { label: "Our Security Commitment", href: "/security-compliance" },
      { label: "Get Started Securely", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard's payment infrastructure uses tokenization at every point of card data handling. Our merchants never store raw card numbers — only tokens. This reduces your PCI scope and protects your customers' data.`,
  },
  {
    slug: "encryption",
    name: "Encryption",
    shortDefinition: "The process of encoding payment card data during transmission and storage so it cannot be read without the proper decryption key.",
    category: "Equipment & Technology Terms",
    searchVolume: "590/mo",
    fullDefinition: `Payment card encryption is the process of converting readable card data into an unreadable, encoded format using cryptographic algorithms. Encrypted data can only be decrypted by parties with the correct key — protecting card information from interception and theft.

Point-to-point encryption (P2PE) is the gold standard for card-present transactions:
1. Card data is encrypted at the very first moment of card interaction (the physical terminal)
2. Data remains encrypted as it travels through the merchant's network and to the processor
3. Only the processor's secure decryption environment can decrypt the data
4. Merchants' systems never see unencrypted card data

P2PE significantly reduces PCI scope — because merchants' systems never touch unencrypted card data, the PCI assessment is dramatically simplified.

For online transactions, TLS (Transport Layer Security, formerly SSL) encrypts data in transit between the customer's browser and the payment gateway. Look for "HTTPS" in the website URL — this indicates TLS encryption is active.

Types of encryption in payments:
- **Symmetric encryption**: Same key encrypts and decrypts (AES-256 is the standard)
- **Asymmetric encryption (public key)**: Public key encrypts, private key decrypts (RSA, used in TLS)
- **End-to-end encryption (E2EE)**: Encryption from terminal to processor (includes P2PE)

Encryption differs from tokenization: encryption scrambles data that can be decrypted; tokenization replaces data with a different value entirely. Both are important security layers.`,
    merchantImpact: `Encryption protects your customers and your business. A terminal without P2PE transmits card data that could potentially be intercepted by malware or network attacks. P2PE-certified terminals are available from reputable processors and significantly reduce your risk exposure.

For e-commerce, using a PCI-compliant payment gateway that handles card data on their servers (hosted payment page) means your website never handles card numbers — eliminating the associated PCI obligations.`,
    example: `With and without P2PE encryption:
- Without: Customer swipes card → magnetic stripe data captured by terminal → transmitted (potentially unencrypted) through merchant's network → reaches processor
  - Risk: Malware on merchant's network could capture card data in transit
- With P2PE: Card swiped → immediately encrypted in terminal hardware → encrypted data travels through merchant's network → decrypted only in processor's secure environment
  - Risk: Even if malware is on merchant's network, it only captures meaningless encrypted data`,
    faqs: [
      {
        question: "What is end-to-end encryption in payment processing?",
        answer: "End-to-end encryption means card data is encrypted at the point of card interaction (the terminal) and remains encrypted until it reaches the processor's secure environment. Merchants' networks and systems never handle unencrypted card data.",
      },
      {
        question: "Does encryption replace PCI compliance?",
        answer: "No, but P2PE-certified encryption significantly reduces PCI scope and simplifies compliance. You still need to complete a PCI assessment, but with P2PE, the scope is much smaller because card data never appears unencrypted in your environment.",
      },
    ],
    relatedTerms: ["tokenization", "pci-dss", "pci-compliance", "payment-gateway", "emv-chip", "card-present"],
    commercialLinks: [
      { label: "Our Security Commitment", href: "/security-compliance" },
      { label: "Get Secure Processing", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard deploys P2PE-capable terminals that encrypt card data from the moment of card interaction. Your network and systems never see raw card data — significantly reducing your security risk and PCI compliance burden.`,
  },
  {
    slug: "qualified-rate",
    name: "Qualified Rate",
    shortDefinition: "The lowest rate tier in a tiered pricing model — applied to basic credit card transactions that meet all processor-defined criteria.",
    category: "Interchange Categories",
    searchVolume: "390/mo",
    fullDefinition: `The qualified rate is the lowest processing rate in a tiered pricing model. It applies to transactions that meet all of the processor's "qualification" criteria — typically basic consumer credit cards swiped in person by the merchant.

In tiered pricing, processors group the hundreds of interchange categories into three buckets:
1. **Qualified** (lowest rate): Basic consumer credit cards, swiped in person, settled within 24 hours
2. **Mid-qualified** (medium rate): Slightly more complex transactions — rewards cards swiped in person, keyed-in transactions
3. **Non-qualified** (highest rate): Complex cards (corporate, business, rewards), card-not-present, delayed settlement

Typical tiered rate examples:
- Qualified: 1.69% + $0.25
- Mid-qualified: 2.69% + $0.25
- Non-qualified: 3.49% + $0.25

The problem with tiered pricing: the processor decides which tier each transaction falls into. Merchants have little visibility or control. The criteria for "qualified" status varies by processor and is not publicly standardized.

Many merchants on tiered pricing assume most of their transactions are "qualified" but are shocked to find that the majority land in mid-qualified or non-qualified because their customers use rewards cards, corporate cards, or because their sales are card-not-present.

Under interchange plus pricing, the concept of qualified/non-qualified tiers disappears — each transaction pays the actual interchange rate plus a fixed markup.`,
    merchantImpact: `Merchants on tiered pricing often overestimate how many transactions qualify for the qualified rate. If your customers frequently use rewards cards (extremely common), business credit cards, or your business takes keyed-in payments, expect a significant portion of transactions to be non-qualified.

A restaurant with mostly consumer credit card customers might see 60-70% qualify for the qualified rate. An e-commerce business taking card-not-present transactions might see 0-20% qualify — with the rest in the much-higher non-qualified category.`,
    example: `A retail store on tiered pricing (qualified: 1.79%, mid-qual: 2.79%, non-qual: 3.59%):
- Month's transactions: $50,000 total
- 30% qualified (basic consumer swiped): $15,000 × 1.79% = $268.50
- 40% mid-qualified (rewards cards swiped): $20,000 × 2.79% = $558
- 30% non-qualified (corporate, rewards CNP): $15,000 × 3.59% = $538.50
- Total processing fees: $1,365
- Equivalent under interchange plus (avg. 2.1% effective): $1,050
- Monthly overcharge from tiered pricing: $315`,
    faqs: [
      {
        question: "What qualifies for the qualified rate in tiered pricing?",
        answer: "Qualification criteria vary by processor but typically include: basic consumer credit card (not rewards or corporate), card physically present and swiped, transaction settled within 24 hours, and required authorization fields provided.",
      },
      {
        question: "Is the qualified rate the only rate I should compare?",
        answer: "No — the qualified rate is often a 'teaser' rate. The more meaningful comparison is your actual effective rate across all transaction types, or the non-qualified rate where most of your transactions may land.",
      },
    ],
    relatedTerms: ["tiered-pricing", "mid-qualified-rate", "non-qualified-rate", "interchange-downgrade", "interchange-plus-pricing", "effective-rate"],
    commercialLinks: [
      { label: "Switch from Tiered to Interchange Plus", href: "/compare-rates" },
      { label: "Get a Free Statement Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard doesn't use qualified/mid-qualified/non-qualified tiered pricing. We pass through actual interchange rates transparently. Upload your statement to see how much you're losing to non-qualified rate downgrades.`,
  },
  {
    slug: "mid-qualified-rate",
    name: "Mid-Qualified Rate",
    shortDefinition: "The middle tier in tiered pricing — applied to transactions that partially meet qualification criteria, such as rewards cards swiped in person.",
    category: "Interchange Categories",
    searchVolume: "210/mo",
    fullDefinition: `The mid-qualified rate (also called "mid-qual") is the middle pricing tier in a tiered pricing model, sitting between the qualified rate (lowest) and non-qualified rate (highest). Mid-qualified transactions typically include: rewards credit cards swiped in person, basic credit cards that are keyed in rather than swiped, or transactions with certain data requirements not fully met.

Common transactions that land in mid-qualified:
- Consumer rewards credit cards (airline miles, cash back) swiped in person
- Basic consumer credit cards that are manually keyed (instead of swiped/dipped)
- Transactions with partial address verification data
- Cards that required manual authorization

The mid-qualified rate adds a "mid-qualification surcharge" to the qualified rate. This surcharge is the processor's additional profit on these transactions. The surcharge is not standardized — it's set by the processor and can range from 0.50% to 1.50% above the qualified rate.

Unlike interchange plus pricing (where each card type pays its exact interchange rate), mid-qualified lumps together many different card types into one rate bucket. A basic rewards card (with a real interchange cost of perhaps 1.85%) might be placed in the same mid-qualified bucket as a more expensive card (with a real cost of 2.25%) — the merchant pays the same rate regardless.`,
    merchantImpact: `The mid-qualified rate is often where processors hide significant profit margin. A processor might claim your transactions are mostly "qualified" when many are actually being downgraded to mid-qualified.

If you're on tiered pricing, request a detailed breakdown of what percentage of your transactions fall into each tier. If mid-qualified exceeds 30-40%, you're likely paying significantly more than you would on interchange plus.`,
    example: `A coffee shop's typical transaction mix on tiered pricing:
- Customer 1 pays with Chase Freedom (basic rewards card, swiped): MID-QUALIFIED at 2.79%
- Customer 2 pays with Visa debit (swiped): QUALIFIED at 1.79%
- Customer 3 pays with Amex Platinum (premium rewards, swiped): NON-QUALIFIED at 3.59%
- Customer 4 pays with basic Visa (swiped): QUALIFIED at 1.79%
- Most customers use rewards cards → most transactions are mid or non-qualified`,
    faqs: [
      {
        question: "Why are my rewards card transactions mid-qualified instead of qualified?",
        answer: "Most processors place rewards cards in the mid-qualified or non-qualified tier because the actual interchange cost for rewards cards is higher. The tiered structure allows them to charge a premium on these common card types.",
      },
      {
        question: "How do I reduce mid-qualified transactions?",
        answer: "The most effective way is to switch from tiered to interchange plus pricing. Under interchange plus, rewards cards simply pay their actual interchange rate — there's no tiered surcharge on top.",
      },
    ],
    relatedTerms: ["tiered-pricing", "qualified-rate", "non-qualified-rate", "interchange-downgrade", "interchange-plus-pricing"],
    commercialLinks: [
      { label: "Get Interchange Plus Pricing", href: "/compare-rates" },
      { label: "Free Statement Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard eliminates mid-qualified rates entirely. Every transaction pays its actual interchange cost — no tiered bundling, no arbitrary surcharges. See the difference in a free statement analysis.`,
  },
  {
    slug: "non-qualified-rate",
    name: "Non-Qualified Rate",
    shortDefinition: "The highest tier in tiered pricing — applied to complex card types, card-not-present transactions, and any sale that doesn't meet standard qualification criteria.",
    category: "Interchange Categories",
    searchVolume: "260/mo",
    fullDefinition: `The non-qualified rate (or "non-qual") is the highest rate tier in tiered pricing models. Transactions that don't meet "qualified" or "mid-qualified" criteria fall into this expensive bucket. The non-qualified rate typically applies to:

- Business credit cards and corporate purchase cards
- Premium rewards cards (high-tier travel, luxury cards)
- Government and purchasing cards
- Card-not-present transactions (phone orders, online)
- International cards
- Transactions with missing or failed address verification (AVS)
- Transactions settled more than 24-48 hours after authorization
- Transactions where CVV was not captured or failed

The non-qualified rate is the most profitable tier for processors. A non-qualified surcharge of 1.5-2.0% on top of the qualified rate creates enormous margin. Merchants on tiered pricing often don't realize that 30-60% of their transactions may be non-qualified.

Common non-qualified surcharge amounts: $0.25–$0.50 per transaction plus 1.0%–2.5% above the qualified rate.

The opacity of tiered pricing means merchants can't easily dispute non-qualified designations. Processors set their own criteria, and these criteria are rarely disclosed clearly in merchant agreements.`,
    merchantImpact: `The non-qualified rate is where merchants overpay the most on tiered pricing. For any business accepting corporate cards, e-commerce transactions, or keyed-in payments, non-qualified rates may apply to a majority of transactions.

Example: An HVAC company that bills corporate clients to company credit cards might see 70-80% of their volume hit non-qualified rates — potentially paying 3.5% or more on transactions where the actual interchange cost is 2.5%.`,
    example: `B2B distributor on tiered pricing:
- 80% of sales to businesses paid with corporate Visa cards (non-qualified)
- Non-qualified rate: 3.49% + $0.25
- Actual interchange for commercial Visa card (level 2 data provided): 1.90% + $0.10
- On a $1,000 corporate card transaction:
  - Tiered (non-qualified): $34.90 + $0.25 = $35.15
  - Interchange plus (level 2): $19.00 + $0.10 + 0.30% markup = $22.10
  - Overpayment per transaction: $13.05
  - At 100 transactions/month: $1,305/month overpayment → $15,660/year`,
    faqs: [
      {
        question: "Why are so many of my transactions non-qualified?",
        answer: "If your customers use corporate cards, rewards cards, or pay online, those transactions naturally land in non-qualified under tiered pricing. The non-qualified designation is largely based on card type and transaction method, not anything you're doing wrong.",
      },
      {
        question: "How can I avoid non-qualified rates?",
        answer: "Switch to interchange plus pricing, which eliminates tiered categories. Alternatively, ensure you're providing complete transaction data (AVS, CVV, level 2/3 data) to minimize downgrades.",
      },
    ],
    relatedTerms: ["tiered-pricing", "qualified-rate", "mid-qualified-rate", "interchange-downgrade", "interchange-plus-pricing", "card-not-present", "keyed-entry"],
    commercialLinks: [
      { label: "Stop Paying Non-Qualified Rates", href: "/compare-rates" },
      { label: "Free Statement Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard doesn't have a non-qualified rate bucket. Under interchange plus pricing, your corporate card transactions pay actual commercial interchange rates — not an inflated non-qualified tier. Upload your statement to see exactly how much you're losing to non-qualified surcharges.`,
  },
  {
    slug: "interchange-downgrade",
    name: "Interchange Downgrade",
    shortDefinition: "When a transaction doesn't meet criteria for the best interchange rate and is processed at a higher, less favorable rate.",
    category: "Interchange Categories",
    searchVolume: "480/mo",
    fullDefinition: `An interchange downgrade occurs when a transaction fails to qualify for the optimal (lowest) interchange rate category and is processed at a higher, more expensive interchange category instead. Downgrades increase your processing costs without any corresponding benefit.

Common causes of interchange downgrades:
1. **Delayed batch settlement**: Card-present transactions not settled within 24-48 hours are downgraded to card-not-present rates
2. **Missing authorization data**: Not providing required fields (AVS, CVV for card-not-present)
3. **Transactions over authorization amount**: Capturing more than authorized amount
4. **Swiped transactions on chip cards**: Using magnetic stripe instead of EMV chip
5. **Missing level 2/3 data**: For corporate cards where purchase data enhances the category
6. **Incorrect merchant category code (MCC)**: Wrong business type classification

Downgrade impact:
- Card-present to card-not-present: +0.5% to 1.0% on the interchange rate
- Missing level 2 data on commercial cards: +0.7% or more
- Delayed settlement: +0.5% to 1.0%

Under interchange plus pricing, downgrades are visible on your statement — you can see exactly which transactions downgraded and why. Under tiered pricing, downgrades are hidden in the non-qualified bucket.`,
    merchantImpact: `Identifying and eliminating downgrades can save significant money. For a $500,000/year business, reducing downgrades by even 10% of volume (from downgraded rate to optimal rate) at 0.50% per downgrade saves $250/year. For higher volumes, it's proportionally larger.

Audit your interchange downgrades by reviewing your processing statement's interchange detail report. Look for categories with "EIRF," "Standard," or "NABU" — these often indicate downgraded transactions.`,
    example: `A restaurant batch closes 3 days after transactions (mistake):
- Monday transactions worth $4,500: Authorized at card-present rates
- Batch closed Thursday (72+ hours late)
- All Monday transactions downgrade from card-present to card-not-present:
  - Standard restaurant rate: 1.80% = $81
  - Downgraded EIRF rate: 2.30% = $103.50
  - Unnecessary downgrade cost: $22.50 for this one day
  - Across a month of similar delays: ~$675/month in avoidable downgrades`,
    faqs: [
      {
        question: "How do I see if I have interchange downgrades?",
        answer: "Request an interchange detail report from your processor. Under interchange plus pricing, your statement shows every interchange category. Look for EIRF (Electronic Interchange Reimbursement Fee), Standard categories, or Non-Qual/NABU designations — these indicate downgraded transactions.",
      },
      {
        question: "Can I fix interchange downgrades?",
        answer: "Yes. Most downgrades are preventable through better practices: daily batch settlement, proper EMV chip use, collecting AVS/CVV, and providing level 2/3 data for commercial cards. Work with your processor to audit and correct downgrade causes.",
      },
    ],
    relatedTerms: ["tiered-pricing", "qualified-rate", "non-qualified-rate", "batch-settlement", "level-2-level-3-data", "card-present"],
    commercialLinks: [
      { label: "Get a Downgrade Audit", href: "/upload-statement" },
      { label: "Optimize Your Processing", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard proactively monitors for interchange downgrades and alerts merchants when we see patterns. Our account management team works with you to identify and eliminate downgrade causes — saving you money without requiring you to change your business operations.`,
  },
  {
    slug: "card-present",
    name: "Card Present",
    shortDefinition: "A transaction where the physical card is used at the point of sale — the most secure transaction type with the lowest interchange rates.",
    category: "Interchange Categories",
    searchVolume: "590/mo",
    fullDefinition: `Card present (CP) is a transaction environment where the cardholder's physical card is used at the point of sale — either via magnetic stripe swipe, EMV chip insert, or NFC contactless tap. The physical card and cardholder are present at the time of the transaction.

Card present transactions are considered the most secure transaction type because:
- The physical card must be possessed by the person making the purchase
- EMV chip technology creates a unique cryptogram for each transaction, preventing counterfeiting
- The merchant can visually verify the card and sometimes the cardholder's identity
- Biometric authentication may be involved (fingerprint for Apple Pay)

Interchange rates for card present transactions are significantly lower than card not present because:
- Lower fraud risk (physical card possession required)
- Higher cardholder authentication
- EMV chip prevents counterfeiting
- Real-time, same-location verification

Card present transaction examples:
- Customer swipes, dips, or taps at a retail checkout
- Restaurant table-side payment
- Mobile card reader in the field
- Unattended kiosk (gas pump with chip reader)

Card present vs. card not present interchange difference:
- Basic consumer credit, card present: ~1.51% + $0.10
- Same card, card not present: ~1.99% + $0.10
- Difference: 0.48% + $0.00 per transaction`,
    merchantImpact: `Card present transactions save you money through lower interchange rates. If you have both in-person and online channels, understanding the rate difference helps you price and evaluate your channel mix.

For businesses that primarily take phone orders but could potentially implement in-person terminal options, the interchange savings from card-present rates may justify the investment in new hardware.`,
    example: `A contractor processing $40,000/month:
- Currently: Takes all payments over phone (card-not-present)
- Average effective rate: 2.40% = $960/month
- If switched to in-person terminal/mobile reader (card-present):
  - Average effective rate: 1.85% = $740/month
  - Monthly savings: $220
  - Annual savings: $2,640
  - Equipment cost (mobile reader): $99 → ROI in less than 2 weeks`,
    faqs: [
      {
        question: "What is the difference between card present and card not present?",
        answer: "Card present: physical card used at point of sale (swipe, chip, tap). Card not present: card details entered remotely (online, phone, mail). Card present is more secure and has lower interchange rates due to reduced fraud risk.",
      },
      {
        question: "Is contactless (tap-to-pay) considered card present?",
        answer: "Yes. NFC contactless tap-to-pay is a card present transaction, even though the card doesn't touch the terminal. The card (or device) is physically present and in proximity to the terminal.",
      },
    ],
    relatedTerms: ["card-not-present", "emv-chip", "interchange-fees", "interchange-downgrade", "payment-terminal", "nfc-contactless"],
    commercialLinks: [
      { label: "Get Card-Present Hardware", href: "/shop" },
      { label: "Compare Card Present vs. Phone Order Costs", href: "/compare-rates" },
    ],
    libertySection: `Liberty Bancard helps merchants understand when switching to card-present acceptance can save money. Our sales team analyzes your transaction mix and identifies opportunities to reduce rates through better transaction environments.`,
  },
  {
    slug: "card-not-present",
    name: "Card Not Present",
    shortDefinition: "Transactions where the physical card isn't used at the point of sale — including online, phone, and mail orders — carrying higher interchange rates due to increased fraud risk.",
    category: "Interchange Categories",
    searchVolume: "720/mo",
    fullDefinition: `Card not present (CNP) refers to transactions where the cardholder's physical card is not present at the point of sale. The most common card-not-present environments include e-commerce (online shopping), telephone orders, mail orders, and recurring billing.

Card-not-present transactions carry higher interchange rates and higher fraud risk because:
- The card cannot be physically verified
- The cardholder's identity cannot be visually confirmed
- Stolen card numbers can be used without the physical card
- No EMV chip cryptogram is generated (the primary anti-counterfeiting measure)

The card-not-present premium varies by card type but is typically 0.40%–0.80% higher interchange than equivalent card-present rates.

CNP fraud reduction measures:
- **CVV/CVC verification**: 3-4 digit security code on the back of the card
- **AVS (Address Verification Service)**: Matches the billing address provided against the issuing bank's records
- **3D Secure (Verified by Visa, Mastercard Identity Check)**: Additional authentication step where cardholder verifies their identity with their bank
- **Velocity checks**: Limiting transactions from the same card or IP address
- **Machine learning fraud scoring**: Real-time risk assessment of each transaction

For online merchants, 3D Secure (3DS) can shift liability for fraud chargebacks to the issuing bank when the cardholder completes the authentication step. This is one of the most powerful fraud liability shift tools available.`,
    merchantImpact: `Card-not-present merchants face a dual challenge: higher interchange rates AND higher fraud risk. Online merchants should implement all available fraud prevention tools (AVS, CVV, 3DS, velocity limits) to both reduce fraud losses and potentially qualify for better interchange rates.

Some online merchants implement 3D Secure for high-risk transactions (large orders, new customers, unusual shipping addresses) while maintaining a frictionless checkout for known customers — balancing conversion rate with fraud prevention.`,
    example: `Online pet supply store, $75 average order:
- Card not present interchange rate: 1.80% + $0.10 = $1.45
- Equivalent card present rate (if they opened a retail location): 1.51% + $0.10 = $1.23
- Per-transaction difference: $0.22
- On 2,000 transactions/month: $440/month in additional interchange from CNP environment
- This is a real cost — but CNP enables broader market reach that typically offsets the difference`,
    faqs: [
      {
        question: "How can I reduce fraud in card-not-present transactions?",
        answer: "Implement AVS, CVV verification, 3D Secure authentication for high-risk orders, velocity limits per card/IP, and machine learning fraud screening. These measures reduce fraud AND can help qualify for better interchange rates.",
      },
      {
        question: "Does Verified by Visa (3D Secure) help with chargebacks?",
        answer: "Yes. When a cardholder successfully completes 3D Secure authentication, liability for fraud chargebacks shifts from the merchant to the issuing bank. This is particularly valuable for high-ticket e-commerce transactions.",
      },
    ],
    relatedTerms: ["card-present", "interchange-fees", "keyed-entry", "authorization", "pci-compliance", "tokenization", "encryption"],
    commercialLinks: [
      { label: "E-Commerce Payment Processing", href: "/get-started" },
      { label: "Get a Free Consultation", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard supports e-commerce merchants with full CNP processing infrastructure including AVS, CVV, 3D Secure, and fraud screening tools. Our interchange plus pricing ensures you see the actual cost of each transaction type in your e-commerce stack.`,
  },
  {
    slug: "keyed-entry",
    name: "Keyed Entry",
    shortDefinition: "Manually typing a customer's card number into a terminal or virtual terminal — the most expensive card-present transaction type due to higher fraud risk.",
    category: "Interchange Categories",
    searchVolume: "390/mo",
    fullDefinition: `Keyed entry (also called "manual entry," "hand-keyed," or "MOTO" for Mail Order/Telephone Order) is a transaction method where the merchant manually types the customer's card number, expiration date, and other card details into a terminal or virtual terminal rather than using a card reader.

Keyed entry carries higher interchange rates than swiped or chip transactions because:
- The physical card is not present or verified
- No EMV chip cryptogram is generated
- Fraud risk is higher — card numbers can be used without the physical card
- Higher rates compensate issuing banks for the additional risk

Typical interchange premium for keyed vs. swiped:
- Basic consumer credit, swiped: 1.51% + $0.10
- Same card, keyed: 1.80% + $0.10
- Premium for keying: 0.29% + $0.00

When keyed entry is legitimate and appropriate:
- Phone orders (MOTO business model)
- Virtual terminal payments for services
- Backup when terminal reader fails
- Keying emergency during chip read failure (though chip fallback is preferred)

When keyed entry is problematic:
- Keying chip cards instead of using the chip reader (unnecessary downgrade and liability shift)
- High rates of keyed transactions from businesses that should be card-present
- Training issues where staff key rather than swipe/dip out of habit`,
    merchantImpact: `Unnecessary keyed entry is an avoidable cost. If your staff keys cards when the chip or swipe reader is available, you're incurring unnecessary interchange costs and potentially shifting fraud liability to yourself.

Train staff: only key if the card absolutely cannot be read (chip fails multiple times, no magnetic stripe). All modern cards have chips — readers should be used.

For businesses that legitimately operate in a phone/mail order environment, keyed entry is appropriate and expected. In this case, focus on providing complete transaction data (AVS, CVV) to minimize the rate premium.`,
    example: `A gift shop has a card reader malfunction:
- Customers present chip cards, reader won't read chips
- Staff keys card numbers instead of calling for help
- For each $50 transaction keyed:
  - Keyed rate: 1.80% + $0.10 = $1.00
  - Swiped rate: 1.51% + $0.10 = $0.86
  - Extra cost per transaction from keying: $0.14
  - If 50 transactions are keyed that day: $7 in extra costs
  - More importantly: Merchant assumes fraud liability on chip cards not used with chip reader`,
    faqs: [
      {
        question: "What is the difference between keyed entry and card-not-present?",
        answer: "These terms are often used interchangeably, but technically differ: card-not-present is the broader category (includes online, phone, mail orders). Keyed entry is the specific method of entering card data manually. Both carry higher interchange rates than card-present/swiped transactions.",
      },
      {
        question: "Will keyed transactions show up on my interchange report?",
        answer: "Yes. Under interchange plus pricing, keyed transactions appear in higher-cost interchange categories. Review your interchange detail to see how many transactions are coded as keyed vs. swiped — this identifies training opportunities.",
      },
    ],
    relatedTerms: ["card-not-present", "card-present", "virtual-terminal", "interchange-downgrade", "interchange-fees"],
    commercialLinks: [
      { label: "Get a Working Terminal", href: "/shop" },
      { label: "Virtual Terminal for Phone Orders", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard helps merchants identify unnecessary keyed-entry charges in statement analysis. We provide properly functioning terminal equipment and train staff on correct card acceptance procedures to eliminate avoidable interchange downgrades.`,
  },
  {
    slug: "tip-adjustment",
    name: "Tip Adjustment",
    shortDefinition: "The process of adjusting a card transaction after the initial authorization to add a tip — common in restaurants and service businesses.",
    category: "Industry-Specific Terms",
    searchVolume: "320/mo",
    fullDefinition: `Tip adjustment (also called "tip edit" or "gratuity adjustment") is the process of modifying a card transaction amount after the initial authorization to add a tip. In restaurants, hospitality, and service businesses, it's standard practice to pre-authorize a transaction (for the bill total without tip) and then capture the final amount (including tip after the customer has written it in).

How tip adjustment works:
1. Waiter presents the bill and pre-authorizes the transaction for the subtotal
2. Customer writes in the tip on the paper receipt
3. Staff adjusts (edits) the transaction in the POS/terminal to add the tip amount
4. Nightly batch close captures all transactions at their adjusted (with tip) amounts

Tip adjustment rules and best practices:
- **Time limit**: Must be done before the batch closes. Tips added after batch close are a new transaction.
- **Amount tolerance**: Card networks allow capturing up to 20% over the authorized amount for gratuity. Beyond 20%, re-authorization may be required.
- **Record keeping**: Signed receipts with the tip amount written by the customer are essential chargeback defense.
- **Interchange impact**: Tip adjustments that are processed within 24 hours of the original authorization maintain card-present rates. Delays cause interchange downgrades.

Electronic tip (customer enters tip at terminal): Some modern POS systems ask customers to enter their tip amount at the terminal before completing the transaction — eliminating the tip adjustment step and reducing fraud/dispute risk.`,
    merchantImpact: `Tip adjustment practices directly affect interchange costs and chargeback exposure. Staff must be trained to:
1. Complete tip adjustments before end of shift or batch close
2. Keep all signed receipts with cardholder-written tips
3. Accurately enter the exact tip amount written by the customer
4. Know the tolerance limits for tip adjustments

Disputes over tip amounts are a common chargeback reason in restaurants. The best defense is the original signed receipt with the tip written clearly by the cardholder.`,
    example: `Restaurant tip adjustment flow:
- Customer's bill: $82.50
- Pre-authorization: $82.50 (card authorized at order payment time)
- Customer writes $18 tip on receipt, signs
- Staff adjusts transaction to $100.50 in POS
- Batch closes at 11 PM with $100.50 captured
- Interchange rate: Card-present restaurant rate (1.80%) applied correctly
- If adjustment not made before batch: $82.50 settles → tip becomes separate transaction → potential higher rate`,
    faqs: [
      {
        question: "What is the tip tolerance rule for credit cards?",
        answer: "Visa and Mastercard allow merchants to capture up to 20% over the original authorized amount for gratuity in tip-eligible businesses (restaurants, salons, etc.). Capturing the authorized amount + up to 20% for tip will not trigger a new authorization or chargeback.",
      },
      {
        question: "What happens if a customer disputes a tip amount?",
        answer: "If the customer claims the tip was different from what's on the receipt, you need the original signed receipt showing the tip amount clearly written by the cardholder. If you can't provide this, you'll likely lose the dispute.",
      },
    ],
    relatedTerms: ["capture", "authorization", "batch-settlement", "void", "chargeback", "interchange-downgrade"],
    commercialLinks: [
      { label: "Restaurant Payment Processing", href: "/industries/restaurant-payment-processing" },
      { label: "Get Started", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard provides restaurant-specific POS systems with built-in tip management — including electronic tip capture on the terminal and automated batch close with tip adjustments included. Contact us to see our restaurant payment solutions.`,
  },
  {
    slug: "recurring-billing",
    name: "Recurring Billing",
    shortDefinition: "Automatically charging a customer's card on a regular schedule — monthly subscriptions, memberships, and service plans.",
    category: "Industry-Specific Terms",
    searchVolume: "1,300/mo",
    fullDefinition: `Recurring billing is an automated payment model where a merchant charges a customer's credit or debit card on a regular schedule — weekly, monthly, annually, or on any custom interval. Common uses include: subscription services, gym memberships, insurance premiums, SaaS software, retainer agreements, and maintenance plans.

Technical requirements for recurring billing:
1. **Cardholder authorization**: Must obtain explicit written or digital consent from the cardholder for the amount and frequency of recurring charges
2. **Tokenization**: The card number must be stored securely (tokenized) for future charges
3. **Merchant agreement requirements**: Your merchant agreement must allow recurring/card-on-file transactions
4. **Cancellation process**: Must be easy for customers to cancel — complex cancellation processes are a major chargeback trigger

Regulatory and card network requirements:
- Clear disclosure of the billing amount, frequency, and cancellation policy before enrollment
- Email or SMS notification before each billing cycle
- Easy cancellation mechanism
- Handling of declined transactions and card updates

Account updater programs (Visa Account Updater, Mastercard Automatic Billing Updater) automatically update stored card details when customers receive new cards — reducing failed recurring transactions from card replacements.

Interchange rates for recurring billing: After the first transaction (which may be card-present or card-not-present), subsequent recurring charges typically qualify for recurring transaction interchange categories.`,
    merchantImpact: `Recurring billing creates predictable revenue and reduces collections work. However, it also creates compliance obligations. Failure to provide proper disclosure and cancellation processes is the #1 cause of chargebacks in subscription businesses.

Build your recurring billing system with: clear consent at signup, pre-billing notifications (3-7 days before charge), easy cancellation, and quick response to cancellation requests. These practices prevent the "I didn't know I was being charged" chargebacks.`,
    example: `A gym with 500 monthly members at $49.99/month:
- Monthly recurring billing: $24,995
- Processing cost (interchange plus): ~2.0% effective = $499.90/month
- 10 failed transactions from expired/changed cards per month
  → Without account updater: $0 recovered from 10 members
  → With account updater: 7-8 automatically updated and retried → ~$350 recovered
  - Annual difference from account updater: ~$4,200`,
    faqs: [
      {
        question: "Do I need customer permission for recurring billing?",
        answer: "Yes, written or digital authorization is required. The authorization must specify the billing amount, frequency, start date, and cancellation process. Charging without authorization is a Regulation E violation and almost certain chargeback.",
      },
      {
        question: "What is an account updater program?",
        answer: "Account updater programs (Visa Account Updater, Mastercard ABU) automatically update stored card tokens when cardholders receive new cards due to expiration, loss, or theft. This prevents failed recurring charges without the cardholder having to re-enter their card.",
      },
      {
        question: "How do I handle failed recurring payments?",
        answer: "Best practices: retry failed transactions 2-3 times over 7-14 days, notify customers immediately when cards decline, provide a self-service portal to update payment methods, and implement account updater programs to reduce failures.",
      },
    ],
    relatedTerms: ["card-on-file", "tokenization", "card-not-present", "chargeback", "virtual-terminal"],
    commercialLinks: [
      { label: "Set Up Recurring Billing", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard supports recurring billing with secure tokenization, account updater integration, and retry logic. Our virtual terminal and gateway support subscription businesses with compliant recurring transaction processing. Contact us to configure your recurring billing setup.`,
  },
  {
    slug: "card-on-file",
    name: "Card on File",
    shortDefinition: "A stored, tokenized card credential that allows merchants to charge a customer for future transactions without re-entering card details.",
    category: "Industry-Specific Terms",
    searchVolume: "720/mo",
    fullDefinition: `Card on file (COF) refers to the practice of storing a customer's payment card credentials (securely, via tokenization) for use in future transactions. Card on file enables merchants to bill customers without requiring them to present or re-enter their card for each transaction.

Common card-on-file use cases:
- **Recurring billing**: Monthly subscriptions billed to stored card
- **One-click checkout**: E-commerce where returning customers don't re-enter card details
- **Pay after service**: Healthcare, auto repair where card is stored at appointment booking and charged after service
- **Hospitality**: Hotel charges to card on file for room service, minibar, parking
- **Installment plans**: Billing a large purchase in multiple payments to the same card

Card on file compliance requirements (per Visa/Mastercard):
1. **Initial consent**: Obtain explicit cardholder authorization to store the card
2. **Disclosure**: Inform the cardholder what you'll use the stored card for
3. **Security**: Store only the token (not the actual card number) — requires tokenization
4. **Subsequent transaction flagging**: Tag future transactions as "card on file/recurring" in transaction data

Benefits of card on file:
- Increased retention and repeat purchase rates
- Reduced friction for returning customers
- Enables subscription and recurring revenue models
- Account updater programs keep stored cards current`,
    merchantImpact: `Card on file directly impacts customer lifetime value. E-commerce businesses with one-click checkout see 20-30% higher conversion rates from returning customers compared to forcing card re-entry.

For service businesses (dental, automotive, spa), card on file enables efficient post-service billing — collect the card at booking, charge automatically after service. This reduces collections friction significantly.

Ensure your card-on-file program uses proper tokenization — storing actual card numbers violates PCI DSS and creates enormous liability.`,
    example: `A healthcare practice implements card on file:
- Patient provides card at check-in → token stored
- After appointment, copay and balance billed automatically to stored card
- Patient receives email receipt
- No manual collection calls, no aging receivables for copays
- Result: Copay collection rate increases from 40% (collected day-of) to 95% (automatic billing)`,
    faqs: [
      {
        question: "Is card on file secure?",
        answer: "Yes, when implemented correctly with tokenization. The merchant stores a token (not the actual card number). Tokens are worthless to fraudsters if stolen. Proper implementation is required for PCI compliance.",
      },
      {
        question: "Can customers have their card removed from file?",
        answer: "Yes, and they have the right to request this. Your payment gateway or processor provides a way to delete stored card tokens. Honoring these requests promptly is required.",
      },
    ],
    relatedTerms: ["recurring-billing", "tokenization", "virtual-terminal", "card-not-present", "payment-gateway"],
    commercialLinks: [
      { label: "Set Up Card on File Processing", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard supports card-on-file processing with full tokenization through our gateway partners. Merchants can store customer cards securely for recurring billing, post-service charging, or one-click checkout. All card-on-file storage is tokenized — never raw card numbers.`,
  },
  {
    slug: "level-2-level-3-data",
    name: "Level 2 / Level 3 Data",
    shortDefinition: "Enhanced transaction data fields for B2B and government card payments that qualify merchants for significantly lower interchange rates.",
    category: "Industry-Specific Terms",
    searchVolume: "480/mo",
    fullDefinition: `Level 2 and Level 3 data are enhanced transaction data fields that merchants can provide when processing corporate, business, and government purchase cards. Providing this additional data qualifies transactions for lower interchange rates from Visa and Mastercard — potentially reducing rates by 0.50%–1.50% on eligible card types.

**Level 1 data** (standard for all transactions):
- Merchant name, date, amount, card number

**Level 2 data** (additional fields):
- Customer PO number, tax amount and indicator, merchant tax ID, destination zip code
- Interchange saving: typically 0.50%–0.70% vs. Level 1 on qualifying corporate cards
- Available for: Most credit card terminals and virtual terminals can capture Level 2

**Level 3 data** (most detailed):
- All Level 2 fields plus: line-item detail (description, quantity, unit price per item)
- Interchange saving: 0.20%–0.50% additional vs. Level 2
- Available for: Requires specific software/gateway support, most common in ERP integrations
- Best suited for: Large B2B distributors, government contractors

Which businesses benefit most from Level 2/3:
- B2B distributors selling to businesses and government agencies
- Government contractors
- Wholesale suppliers
- Any business where customers frequently pay with corporate or purchasing cards`,
    merchantImpact: `For B2B merchants, providing Level 2/3 data on corporate card transactions can save 0.50%–1.50% in interchange. On $500,000 in annual B2B volume processed on corporate cards, that's $2,500–$7,500 in annual savings.

The challenge: many B2B merchants don't know to request this, their software doesn't support it, or they're on tiered pricing where the benefit doesn't pass through. Under interchange plus pricing, Level 2/3 savings flow directly to the merchant.`,
    example: `Government contractor processing $200,000/month in government purchase card transactions:
- Without Level 2 data: Commercial card interchange ~2.50% = $5,000/month
- With Level 2 data: Government card Level 2 rate ~1.90% = $3,800/month
- With Level 3 data: Government card Level 3 rate ~1.65% = $3,300/month
- Monthly savings from Level 3 vs. no enhanced data: $1,700/month
- Annual savings: $20,400`,
    faqs: [
      {
        question: "How do I provide Level 2/3 data for transactions?",
        answer: "Your payment terminal, virtual terminal, or payment gateway must support Level 2/3 data entry. Contact your processor to confirm compatibility and configure required fields. ERP integrations often handle Level 3 data automatically.",
      },
      {
        question: "Which cards qualify for Level 2/3 interchange rates?",
        answer: "Corporate purchasing cards, business credit cards, and government procurement cards qualify for Level 2/3 interchange rates when the appropriate data is provided. Consumer credit cards are not eligible regardless of data provided.",
      },
    ],
    relatedTerms: ["interchange-fees", "interchange-plus-pricing", "card-not-present", "non-qualified-rate", "interchange-downgrade", "virtual-terminal"],
    commercialLinks: [
      { label: "B2B Payment Processing", href: "/get-started" },
      { label: "Get a Free Statement Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard configures Level 2 and Level 3 data capture for all B2B merchants. Our interchange plus pricing model means all Level 2/3 savings pass directly to you. If you accept corporate or government cards and aren't providing enhanced data, you're almost certainly overpaying. Let us audit your statement.`,
  },
  {
    slug: "ach-payment",
    name: "ACH Payment",
    shortDefinition: "Automated Clearing House payments — electronic bank-to-bank transfers commonly used for payroll, bill pay, and business-to-business payments.",
    category: "Industry-Specific Terms",
    searchVolume: "5,400/mo",
    fullDefinition: `ACH (Automated Clearing House) payments are electronic funds transfers processed through the ACH network — the US payment rail operated by NACHA (National Automated Clearing House Association). ACH is used for direct deposit, bill payment, payroll, and increasingly for business-to-business transactions.

ACH transaction types:
- **ACH credit**: Pushes funds from one account to another (payroll direct deposit, vendor payments)
- **ACH debit**: Pulls funds from a customer's account (utility bill autopay, loan payment, subscription billing)

ACH vs. credit cards:
- **Cost**: ACH transactions typically cost $0.25–$1.50 per transaction vs. 1.5%–3.5% for credit cards
- **Speed**: ACH takes 1-3 business days for standard processing; Same-Day ACH (available since 2016) settles same day
- **Risk**: ACH has higher return risk (NSF, stop payment) but lower chargeback risk than credit cards
- **Limits**: ACH transactions can be larger amounts without the percentage-based fees of cards
- **Consumer familiarity**: Credit cards are more familiar for retail; ACH is standard for recurring and B2B

ACH return codes: When an ACH payment fails, it returns with a specific reason code:
- R01: Insufficient funds
- R02: Account closed
- R03: No account/unable to locate
- R10: Unauthorized debit
- R29: Corporate customer advises not authorized

For high-ticket B2B transactions and subscription billing, ACH is often the most cost-effective payment option. A $10,000 invoice paid by ACH costs ~$1; the same invoice paid by business credit card costs $200+.`,
    merchantImpact: `ACH payment acceptance can dramatically reduce processing costs for high-ticket or B2B transactions. Merchants who accept both credit cards and ACH give customers payment flexibility while reducing their own processing costs when customers choose ACH.

The main challenge with ACH: return rates (failed payments) require robust handling — retry logic, customer notification, and possibly a reserve for returns. NSF (non-sufficient funds) returns are the most common.

For recurring billing businesses (subscriptions, memberships, utilities), ACH is significantly cheaper than credit card processing for the same transactions.`,
    example: `A commercial cleaning company processes $500/month recurring invoices:
- 50 clients × $500 = $25,000/month
- Via credit card (2.2% effective): $550/month in processing fees
- Via ACH ($0.50/transaction): $25/month in processing fees
- Monthly savings using ACH: $525
- Annual savings: $6,300`,
    faqs: [
      {
        question: "Is ACH the same as EFT?",
        answer: "ACH is a type of EFT (Electronic Funds Transfer). EFT is the broader category; ACH is the specific US payment network for bank-to-bank transfers. Wire transfers are also EFT but use a different network (Fedwire).",
      },
      {
        question: "How long do ACH payments take?",
        answer: "Standard ACH: 1-3 business days. Same-Day ACH: settles same day if submitted before cutoff times (typically 4:45 PM Eastern). International payments via ACH alternatives may take longer.",
      },
      {
        question: "What is an ACH return?",
        answer: "An ACH return occurs when a bank rejects the payment — most commonly for insufficient funds (R01), account closed (R02), or unauthorized transaction (R10). Returns typically arrive within 2-5 business days of the original transaction.",
      },
      {
        question: "Can I accept ACH payments for my business?",
        answer: "Yes. Most payment processors and ISOs offer ACH processing alongside credit card processing. You need to obtain proper authorization from customers (a signed ACH authorization form or electronic consent) before initiating ACH debits.",
      },
    ],
    relatedTerms: ["nacha", "recurring-billing", "card-on-file", "virtual-terminal", "merchant-account"],
    commercialLinks: [
      { label: "Ask About ACH Processing", href: "/get-started" },
      { label: "B2B Payment Solutions", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard offers ACH payment processing as part of our comprehensive merchant services. ACH is ideal for B2B merchants, subscription businesses, and any merchant looking to reduce processing costs on recurring or high-ticket transactions. Ask us about our ACH pricing.`,
  },
  {
    slug: "nacha",
    name: "NACHA",
    shortDefinition: "The National Automated Clearing House Association — the organization that governs and sets the rules for the US ACH payment network.",
    category: "Industry-Specific Terms",
    searchVolume: "590/mo",
    fullDefinition: `NACHA (National Automated Clearing House Association) is the non-profit organization that develops and manages the rules, standards, and procedures for the US ACH (Automated Clearing House) payment network. Every business and financial institution that participates in ACH must comply with NACHA's Operating Rules.

NACHA's key responsibilities:
- Setting and enforcing ACH network rules (the NACHA Operating Rules and Guidelines)
- Managing ACH network standards and protocols
- Administering the Same-Day ACH service
- Publishing guidelines for new payment types and technologies
- Issuing fines and sanctions for rules violations

Key NACHA rules merchants must know:
1. **Authorization**: NACHA requires written or digital authorization from the account holder before debiting their account. The authorization must specify the amount, timing, and right to revoke.
2. **Return rate limits**: Merchants must maintain ACH return rates below NACHA thresholds:
   - Unauthorized returns (R05, R07, R10, R29): Below 0.5%
   - Administrative returns (R02, R03, R04): Below 3%
   - Overall return rate: Below 15%
3. **Revocation**: Customers can revoke ACH authorization at any time with proper notice
4. **Reinitiation**: Failed ACH transactions can only be reinitiated 2 additional times (3 total attempts)

NACHA introduced Same-Day ACH in September 2016, allowing same-day settlement for eligible ACH transactions submitted before specific cutoff windows.`,
    merchantImpact: `NACHA compliance is non-negotiable for businesses accepting ACH payments. Exceeding return rate thresholds can result in your ACH origination privileges being suspended — preventing you from collecting payments via ACH.

Monitor your ACH return rates monthly. High return rates for "unauthorized" reason codes are a red flag that requires investigation — often indicating fraudulent authorizations or inadequate consent processes.`,
    example: `A subscription company violates NACHA rules:
- Charges 1,000 customers monthly via ACH
- 12 customers dispute as "unauthorized" (R10 return code)
- Unauthorized return rate: 12/1,000 = 1.2%
- NACHA threshold: 0.5%
- Consequence: NACHA compliance investigation, potential ACH suspension
- Root cause: Inadequate digital authorization workflow at signup
- Fix: Implement clear ACH authorization confirmation with email verification`,
    faqs: [
      {
        question: "What are NACHA return codes?",
        answer: "NACHA return codes are standardized reason codes that banks use when rejecting ACH transactions. Common codes: R01 (insufficient funds), R02 (account closed), R03 (no account), R04 (invalid account number), R10 (unauthorized), R29 (corporate not authorized).",
      },
      {
        question: "What is Same-Day ACH?",
        answer: "Same-Day ACH allows businesses to originate ACH credits and debits that settle the same business day. Transactions must be submitted before cutoff windows (typically 4:45 PM Eastern and 2:45 PM Eastern for two daily windows). There is a small per-transaction fee for Same-Day ACH.",
      },
    ],
    relatedTerms: ["ach-payment", "recurring-billing", "merchant-account", "payment-processor"],
    commercialLinks: [
      { label: "ACH Payment Solutions", href: "/get-started" },
    ],
    libertySection: `Liberty Bancard's ACH processing platform is NACHA-compliant with built-in return monitoring and authorization management. We help merchants maintain proper authorization workflows and monitor return rates to stay in compliance with NACHA rules.`,
  },
  {
    slug: "passthrough-pricing",
    name: "Passthrough Pricing",
    shortDefinition: "Another term for interchange plus pricing — the processor passes through actual card network costs and charges only a transparent markup on top.",
    category: "Industry-Specific Terms",
    searchVolume: "160/mo",
    fullDefinition: `Passthrough pricing is another name for interchange plus pricing — a processing model where the processor passes actual interchange fees and assessment fees through to the merchant at cost, then adds a transparent, fixed markup for their services.

The "passthrough" term emphasizes that the processor is passing costs through at actual network rates rather than bundling or marking up the underlying card network fees. Under passthrough pricing:
- Interchange fees: Passed through at exact network rates (no markup)
- Assessment fees: Passed through at exact card network rates (no markup)
- Processor compensation: A fixed, disclosed markup (percentage + per-transaction fee)

This contrasts with tiered pricing, where the processor bundles costs and marks up the underlying interchange without disclosure.

Passthrough pricing is particularly common in the commercial/B2B payment space and is the pricing model that large enterprise merchants (Fortune 500 companies) consistently demand — because it's the most cost-transparent and auditable pricing structure.

Some processors use "passthrough pricing" specifically to mean they also pass through all assessment fees at cost — distinguishing themselves from processors who mark up assessments or charge "network access fees" beyond actual costs.`,
    merchantImpact: `Passthrough pricing (interchange plus) is the most advantageous pricing model for merchants who want cost control and transparency. The key advantages:
- See exactly what you pay in exchange fees vs. processor margin
- Rates adjust automatically with card network fee changes
- Can audit and verify your statement against published interchange tables
- Processor cannot quietly raise fees by adjusting tier assignments`,
    example: `A merchant on passthrough pricing processes a $300 Visa Signature transaction:
Statement shows:
- Interchange: CPS/Retail 2 = 1.65% + $0.10 = $5.05 (paid to issuing bank)
- Assessment: Visa assessment = 0.14% = $0.42 (paid to Visa)
- Processor markup: 0.25% + $0.10 = $0.85
- Total processing cost: $6.32 (2.11% effective rate)

Every dollar is visible, every recipient is identified.`,
    faqs: [
      {
        question: "Is passthrough pricing the same as interchange plus?",
        answer: "Yes. Passthrough pricing and interchange plus (also called cost-plus or wholesale pricing) refer to the same model: actual card network costs passed through at cost, plus a transparent, fixed processor markup.",
      },
      {
        question: "Who benefits most from passthrough pricing?",
        answer: "Any merchant processing over $10,000/month benefits from passthrough pricing compared to flat rate or tiered pricing. The benefits scale with volume — the higher the volume, the more meaningful the transparent, optimized pricing.",
      },
    ],
    relatedTerms: ["interchange-plus-pricing", "interchange-fees", "assessment-fees", "processor-markup", "tiered-pricing", "effective-rate"],
    commercialLinks: [
      { label: "Get Passthrough Pricing", href: "/compare-rates" },
      { label: "Upload Statement for a Free Analysis", href: "/upload-statement" },
    ],
    libertySection: `Liberty Bancard operates exclusively on passthrough pricing — we pass through all interchange and assessment fees at network cost and charge only our disclosed markup. No bundling, no tiered rate games, no hidden markup on interchange. Request our rate sheet to see exact passthrough markup.`,
  },
];

export function getTermBySlug(slug: string): GlossaryTerm | undefined {
  return glossaryTerms.find((t) => t.slug === slug);
}

export function getTermsByCategory(category: string): GlossaryTerm[] {
  return glossaryTerms.filter((t) => t.category === category);
}

export function getRelatedTerms(slug: string): GlossaryTerm[] {
  const term = getTermBySlug(slug);
  if (!term) return [];
  return term.relatedTerms
    .map((s) => getTermBySlug(s))
    .filter((t): t is GlossaryTerm => !!t)
    .slice(0, 6);
}
