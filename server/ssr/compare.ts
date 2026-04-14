import { ssrHtmlShell } from "../ssrShared";

interface CompetitorData {
  slug: string;
  name: string;
  fullName: string;
  tagline: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  heroDescription: string;
  comparison: {
    feature: string;
    competitor: string;
    liberty: string;
    advantage: "liberty" | "competitor" | "tie";
  }[];
  competitorPros: string[];
  competitorCons: string[];
  libertyPros: string[];
  whoShouldUseCompetitor: string;
  whoShouldUseLiberty: string;
  savingsExample: {
    monthlyVolume: string;
    competitorCost: string;
    libertyCost: string;
    annualSavings: string;
  };
  faqs: { question: string; answer: string }[];
}

export const COMPETITOR_DATA: Record<string, CompetitorData> = {
  square: {
    slug: "square",
    name: "Square",
    fullName: "Square (Block, Inc.)",
    tagline: "Flat-Rate Simplicity vs. Wholesale Savings",
    metaTitle: "Liberty Bancard vs Square - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Square side by side. See how interchange-plus pricing saves businesses $2,000-$6,000/year over Square's flat-rate processing fees.",
    metaKeywords: "square alternative, square vs liberty bancard, better than square, square payment processing fees, square competitor",
    heroDescription: "Square's 2.6% + $0.10 flat rate is simple but expensive for growing businesses. Liberty Bancard's interchange-plus pricing passes through actual card costs with a small markup, saving most merchants thousands per year.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.6% + $0.10 flat rate", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$0", liberty: "$0 - $9.95", advantage: "tie" },
      { feature: "Contract Length", competitor: "No contract", liberty: "No long-term contract", advantage: "tie" },
      { feature: "Early Termination Fee", competitor: "None", liberty: "None", advantage: "tie" },
      { feature: "Next-Day Funding", competitor: "Extra fee (Instant)", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Liberty Zero™ Program", competitor: "No", liberty: "Available*", advantage: "liberty" },
      { feature: "Free Terminal", competitor: "No (hardware purchase)", liberty: "For qualifying merchants*", advantage: "liberty" },
      { feature: "PCI Compliance", competitor: "Included", liberty: "Included", advantage: "tie" },
      { feature: "Chargeback Protection", competitor: "Basic", liberty: "Full support + guidance", advantage: "liberty" },
      { feature: "Onboarding Support", competitor: "Self-service", liberty: "Guided, personal setup", advantage: "liberty" },
    ],
    competitorPros: [
      "Easy self-service signup process",
      "No monthly fee on basic plan",
      "Built-in POS software and hardware ecosystem",
      "Good for very small or occasional sellers",
      "Simple, predictable flat-rate pricing",
    ],
    competitorCons: [
      "2.6% + $0.10 is expensive at higher volumes",
      "No interchange passthrough means you overpay on debit cards",
      "No dedicated account representative",
      "Account stability issues reported by merchants",
      "Limited support for high-volume businesses",
      "Hardware must be purchased upfront",
    ],
    libertyPros: [
      "Interchange-plus pricing saves money at $5K+/month volume",
      "Dedicated human support who knows your business",
      "Free statement review shows exact savings before switching",
      "No long-term contracts or early termination fees",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "Free terminal for qualifying merchants*",
      "Next-day funding available*",
      "Guided onboarding with go-live support",
    ],
    whoShouldUseCompetitor: "Square is a reasonable choice for micro-businesses processing under $3,000/month, occasional sellers at farmers markets or pop-up events, and businesses that want an all-in-one POS without separate processing. If simplicity matters more than cost optimization, Square works.",
    whoShouldUseLiberty: "Liberty Bancard is the better choice for businesses processing $5,000+/month who want to stop overpaying on flat-rate fees. If you want transparent pricing, real human support, and a statement-based analysis showing your exact savings, Liberty Bancard delivers.",
    savingsExample: {
      monthlyVolume: "$25,000/month",
      competitorCost: "$675/month",
      libertyCost: "$475/month*",
      annualSavings: "$2,400*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than Square?", answer: "For businesses processing over $5,000/month, Liberty Bancard's interchange-plus pricing typically saves $2,000-$6,000 per year compared to Square's flat 2.6% + $0.10 rate. Square's flat rate overcharges on debit cards and lower-cost card types. Liberty Bancard passes through actual interchange costs with a small, transparent markup." },
      { question: "Can I switch from Square to Liberty Bancard easily?", answer: "Yes. Liberty Bancard handles the transition with guided onboarding. In most cases, you can be processing within 48 hours. Upload your Square statement and we'll show you a side-by-side cost comparison before you make any decisions." },
      { question: "Does Liberty Bancard have a POS system like Square?", answer: "Liberty Bancard partners with compatible POS systems so you get the features you need without being locked into expensive processing rates. We help you find the right POS match for your business type." },
      { question: "Why is Square more expensive than Liberty Bancard?", answer: "Square uses flat-rate pricing that charges the same percentage on every transaction. This means you overpay significantly on debit cards (which have much lower interchange costs) and other lower-cost card types. Liberty Bancard passes through the actual card network cost and adds a small markup, which saves money on the majority of transactions." },
      { question: "Does Liberty Bancard charge monthly fees?", answer: "Liberty Bancard's monthly fees range from $0 to $9.95 depending on your plan. Even with a monthly fee, the savings from interchange-plus pricing far exceed the cost for most businesses processing over $5,000/month. Square has no monthly fee but its higher per-transaction rate costs more overall." },
    ],
  },
  stripe: {
    slug: "stripe",
    name: "Stripe",
    fullName: "Stripe, Inc.",
    tagline: "Developer-First vs. Business-First Processing",
    metaTitle: "Liberty Bancard vs Stripe - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Stripe side by side. See how businesses save $3,000-$8,000/year switching from Stripe's 2.9% + $0.30 to interchange-plus pricing.",
    metaKeywords: "stripe alternative, stripe vs liberty bancard, better than stripe, stripe processing fees, stripe competitor",
    heroDescription: "Stripe's 2.9% + $0.30 online rate is one of the most expensive flat-rate options available. Liberty Bancard's interchange-plus pricing delivers significant savings for businesses processing meaningful volume.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.9% + $0.30 flat rate", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$0", liberty: "$0 - $9.95", advantage: "tie" },
      { feature: "Contract Length", competitor: "No contract", liberty: "No long-term contract", advantage: "tie" },
      { feature: "Early Termination Fee", competitor: "None", liberty: "None", advantage: "tie" },
      { feature: "Next-Day Funding", competitor: "Extra fee (Instant)", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "No (email support)", liberty: "Yes", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "In-Person Payments", competitor: "Limited (Stripe Terminal)", liberty: "Full terminal support", advantage: "liberty" },
      { feature: "Liberty Zero™ Program", competitor: "No", liberty: "Available*", advantage: "liberty" },
      { feature: "Developer API", competitor: "Extensive", liberty: "Gateway integrations", advantage: "competitor" },
      { feature: "Chargeback Protection", competitor: "Radar (extra cost)", liberty: "Full support included", advantage: "liberty" },
      { feature: "Onboarding Support", competitor: "Self-service docs", liberty: "Guided, personal setup", advantage: "liberty" },
    ],
    competitorPros: [
      "Excellent developer documentation and APIs",
      "No monthly fee",
      "Strong for SaaS and marketplace platforms",
      "Global payment support in 40+ countries",
      "Advanced fraud detection (Stripe Radar)",
    ],
    competitorCons: [
      "2.9% + $0.30 is very expensive for in-person and card-present transactions",
      "No interchange passthrough pricing available by default",
      "No dedicated account representative for most merchants",
      "Limited in-person payment capabilities",
      "Support is primarily email-based",
      "Not designed for traditional retail or restaurant businesses",
    ],
    libertyPros: [
      "Interchange-plus pricing dramatically reduces costs",
      "Dedicated human support who answers the phone",
      "Free statement review shows exact savings",
      "Purpose-built for in-person and card-present businesses",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "Free terminal for qualifying merchants*",
      "Next-day funding available*",
      "No long-term contracts",
    ],
    whoShouldUseCompetitor: "Stripe is a strong choice for SaaS companies, marketplaces, and developer-heavy teams building custom payment flows. If you need global payments, subscription billing APIs, or complex platform monetization, Stripe's developer tools are hard to beat.",
    whoShouldUseLiberty: "Liberty Bancard is ideal for brick-and-mortar businesses, service providers, and any company processing in-person payments. If you want transparent pricing, real human support, and cost savings that show up on your bottom line, Liberty Bancard is the clear choice.",
    savingsExample: {
      monthlyVolume: "$30,000/month",
      competitorCost: "$960/month",
      libertyCost: "$540/month*",
      annualSavings: "$5,040*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than Stripe?", answer: "For in-person businesses processing over $5,000/month, Liberty Bancard typically saves $3,000-$8,000 per year compared to Stripe's 2.9% + $0.30. Stripe excels at online-only and developer-centric use cases, but its pricing is expensive for card-present transactions." },
      { question: "Can I switch from Stripe to Liberty Bancard?", answer: "Yes. If you process in-person payments, Liberty Bancard can get you set up quickly with guided onboarding. Upload your Stripe processing statement and we'll show you a detailed cost comparison before you commit to anything." },
      { question: "Does Liberty Bancard support online payments?", answer: "Liberty Bancard partners with payment gateways that support online transactions. If e-commerce is part of your business, include it in your statement review request and we'll recommend the best-fit setup for both in-person and online payments." },
      { question: "Why is Stripe so expensive for in-person payments?", answer: "Stripe was built primarily for online transactions. Its 2.9% + $0.30 rate doesn't distinguish between expensive card types and cheap debit cards. For in-person transactions where interchange costs are lower, you're overpaying significantly. Liberty Bancard passes through actual interchange costs, which are much lower for card-present transactions." },
      { question: "Does Liberty Bancard have an API like Stripe?", answer: "Liberty Bancard focuses on payment processing excellence rather than developer tools. We integrate with popular POS systems and payment gateways. If you need custom API integrations for a software platform, Stripe may be a better fit. For businesses focused on accepting payments efficiently, Liberty Bancard delivers better value." },
    ],
  },
  clover: {
    slug: "clover",
    name: "Clover",
    fullName: "Clover Network (Fiserv)",
    tagline: "Bundled POS vs. Best-in-Class Processing",
    metaTitle: "Liberty Bancard vs Clover - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Clover POS. Avoid long-term contracts and high processing fees. See how interchange-plus pricing saves $2,500-$5,000/year.",
    metaKeywords: "clover alternative, clover vs liberty bancard, better than clover, clover processing fees, clover competitor, clover contract",
    heroDescription: "Clover bundles POS hardware with processing, but that convenience comes with long-term contracts, higher rates, and equipment you may not own. Liberty Bancard gives you transparent pricing without the lock-in.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.3-3.5% + $0.10 (varies)", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$14.95+", liberty: "$0 - $9.95", advantage: "liberty" },
      { feature: "Contract Length", competitor: "36-month typical", liberty: "No long-term contract", advantage: "liberty" },
      { feature: "Early Termination Fee", competitor: "$250-$500", liberty: "None", advantage: "liberty" },
      { feature: "Equipment Ownership", competitor: "Often leased, not owned", liberty: "Free terminal for qualifying*", advantage: "liberty" },
      { feature: "Next-Day Funding", competitor: "Extra fee", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "Varies by reseller", liberty: "Yes", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Built-in POS Software", competitor: "Yes (bundled)", liberty: "POS partnerships", advantage: "competitor" },
      { feature: "Liberty Zero™ Program", competitor: "Limited", liberty: "Available*", advantage: "liberty" },
      { feature: "PCI Compliance", competitor: "Extra fee common", liberty: "Included", advantage: "liberty" },
      { feature: "Onboarding Support", competitor: "Varies", liberty: "Guided, personal setup", advantage: "liberty" },
    ],
    competitorPros: [
      "All-in-one POS hardware and software",
      "App marketplace for add-on features",
      "Familiar brand with wide retail presence",
      "Built-in inventory and employee management",
      "Multiple hardware form factors available",
    ],
    competitorCons: [
      "Long-term contracts (36 months) are standard",
      "Early termination fees of $250-$500",
      "Equipment is often leased, not owned",
      "Processing rates vary widely by reseller",
      "PCI compliance fees commonly added",
      "Monthly software fees start at $14.95 and increase",
      "Rate increases after promotional periods",
    ],
    libertyPros: [
      "No long-term contracts or termination fees",
      "Interchange-plus pricing is transparent and lower",
      "Free terminal for qualifying merchants*",
      "PCI compliance included at no extra charge",
      "Dedicated support rep who knows your business",
      "Free statement review before switching",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "You own your equipment and your data",
    ],
    whoShouldUseCompetitor: "Clover can work for businesses that want a fully integrated POS ecosystem and don't mind being locked into a multi-year contract. If having one vendor for hardware, software, and processing is your top priority and you're comfortable with the contract terms, Clover is an option.",
    whoShouldUseLiberty: "Liberty Bancard is the right choice if you want freedom from long-term contracts, transparent pricing, and equipment you actually own. If you've been locked into a Clover contract and are tired of rate increases and add-on fees, switching to Liberty Bancard can save thousands.",
    savingsExample: {
      monthlyVolume: "$20,000/month",
      competitorCost: "$560/month",
      libertyCost: "$360/month*",
      annualSavings: "$2,400*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than Clover?", answer: "For most businesses, yes. Liberty Bancard offers lower interchange-plus pricing without the long-term contracts, equipment leases, and add-on fees that Clover is known for. Businesses typically save $2,500-$5,000 per year by switching from Clover to Liberty Bancard." },
      { question: "Can I get out of my Clover contract?", answer: "If your Clover contract is ending soon, Liberty Bancard can help you transition smoothly. We'll review your current statement, show you exact savings, and handle the onboarding so the switch is seamless. If you're mid-contract, we can help you understand the termination costs and whether switching still saves money." },
      { question: "Do I need to buy new equipment to switch from Clover?", answer: "Liberty Bancard provides free terminals for qualifying merchants. We'll help you find equipment that matches your business needs without the leasing costs that Clover typically requires." },
      { question: "Why does Clover charge PCI compliance fees?", answer: "Many Clover resellers add PCI compliance fees as an additional revenue stream, typically $79-$129/year. Liberty Bancard includes PCI compliance at no additional charge because we believe it's a basic requirement of payment processing, not an upsell opportunity." },
      { question: "Can Liberty Bancard match Clover's POS features?", answer: "Liberty Bancard partners with compatible POS systems that offer similar features to Clover including inventory management, employee tools, and reporting. The difference is you get those features with transparent interchange-plus pricing instead of inflated bundled rates." },
    ],
  },
  toast: {
    slug: "toast",
    name: "Toast",
    fullName: "Toast, Inc.",
    tagline: "Restaurant POS vs. Flexible Payment Processing",
    metaTitle: "Liberty Bancard vs Toast - Restaurant Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Toast for restaurant payment processing. See how restaurants save $3,000-$7,000/year by switching from Toast's bundled pricing.",
    metaKeywords: "toast alternative, toast vs liberty bancard, better than toast, toast processing fees, toast competitor, restaurant payment processing",
    heroDescription: "Toast combines restaurant POS with payment processing, but their 2.49-3.69% rates and long-term contracts cost restaurants thousands more than necessary. Liberty Bancard offers restaurant-friendly pricing without the lock-in.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.49-3.69% + $0.15", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$0-$69+ (tiered plans)", liberty: "$0 - $9.95", advantage: "liberty" },
      { feature: "Contract Length", competitor: "24-36 months", liberty: "No long-term contract", advantage: "liberty" },
      { feature: "Early Termination Fee", competitor: "Up to $10,000+", liberty: "None", advantage: "liberty" },
      { feature: "Equipment Ownership", competitor: "Financed, not always owned", liberty: "Free terminal for qualifying*", advantage: "liberty" },
      { feature: "Next-Day Funding", competitor: "Extra fee", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "Limited", liberty: "Yes", advantage: "liberty" },
      { feature: "Restaurant POS Features", competitor: "Full restaurant POS", liberty: "POS partnerships", advantage: "competitor" },
      { feature: "Online Ordering", competitor: "Built-in (with fees)", liberty: "Integration partners", advantage: "competitor" },
      { feature: "Liberty Zero™ Program", competitor: "Limited", liberty: "Available*", advantage: "liberty" },
      { feature: "Processing Lock-in", competitor: "Must use Toast processing", liberty: "No lock-in", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
    ],
    competitorPros: [
      "Purpose-built restaurant POS system",
      "Online ordering and delivery integration",
      "Kitchen display system integration",
      "Restaurant-specific reporting and analytics",
      "Payroll and team management features",
    ],
    competitorCons: [
      "Processing rates of 2.49-3.69% are significantly above interchange",
      "Long-term contracts (24-36 months) with heavy penalties",
      "Early termination fees can exceed $10,000",
      "Equipment financing locks you in further",
      "Must use Toast processing (no flexibility)",
      "Monthly software fees increase as you add features",
      "Rate increases after promotional period",
    ],
    libertyPros: [
      "Interchange-plus pricing saves restaurants thousands",
      "No long-term contracts or termination penalties",
      "Dedicated support rep who understands restaurant operations",
      "Liberty Zero™ program popular with restaurant owners (pay $0 to process)*",
      "Free terminal for qualifying merchants*",
      "Free statement review before committing",
      "Next-day funding keeps cash flow healthy*",
      "Freedom to choose your own POS system",
    ],
    whoShouldUseCompetitor: "Toast makes sense for new restaurants that want a complete, integrated system and are comfortable with long-term contracts and higher processing rates. If you need online ordering, kitchen displays, and payroll in one platform and cost isn't the primary concern, Toast is an option.",
    whoShouldUseLiberty: "Liberty Bancard is ideal for restaurants that want to keep more of their revenue. If you're processing $10,000+/month and tired of Toast's high rates and contract lock-in, switching to interchange-plus pricing can save your restaurant $3,000-$7,000 per year.",
    savingsExample: {
      monthlyVolume: "$35,000/month",
      competitorCost: "$1,085/month",
      libertyCost: "$630/month*",
      annualSavings: "$5,460*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than Toast for restaurants?", answer: "For payment processing costs, yes. Liberty Bancard's interchange-plus pricing saves most restaurants $3,000-$7,000 per year compared to Toast's 2.49-3.69% rates. Toast offers a full restaurant POS, but you pay a premium for processing that's locked to their platform." },
      { question: "Can I keep my POS system if I switch from Toast?", answer: "Toast requires you to use their processing, so switching processors means transitioning your POS as well. Liberty Bancard partners with restaurant-compatible POS systems and handles the migration with guided onboarding to minimize disruption." },
      { question: "How much does Toast's early termination fee cost?", answer: "Toast's early termination fees can exceed $10,000 depending on your contract terms and remaining equipment financing. We recommend reviewing your contract before switching and can help you calculate whether the savings from Liberty Bancard's lower rates offset the termination cost." },
      { question: "Does Liberty Bancard support restaurants specifically?", answer: "Yes. Liberty Bancard serves many restaurant merchants with features like cash discount programs, next-day funding for cash flow management, and dedicated support reps who understand restaurant operations. We partner with restaurant POS systems for a complete solution." },
      { question: "What POS systems work with Liberty Bancard?", answer: "Liberty Bancard integrates with a variety of POS systems suitable for restaurants including those that support table management, menu customization, and kitchen printing. During your statement review, we'll recommend POS options that fit your restaurant's needs." },
    ],
  },
  paypal: {
    slug: "paypal",
    name: "PayPal",
    fullName: "PayPal Holdings, Inc.",
    tagline: "Consumer Brand vs. Merchant-First Processing",
    metaTitle: "Liberty Bancard vs PayPal - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs PayPal for business payment processing. See how merchants save $2,000-$5,000/year switching from PayPal's flat-rate fees.",
    metaKeywords: "paypal alternative, paypal vs liberty bancard, better than paypal, paypal processing fees, paypal business competitor",
    heroDescription: "PayPal is great for consumers, but its 2.99% + $0.49 in-person rate and account hold policies make it expensive and risky for growing businesses. Liberty Bancard offers merchant-focused pricing and support.",
    comparison: [
      { feature: "Pricing Model", competitor: "2.99% + $0.49 in-person", liberty: "Interchange + 0.15-0.40%", advantage: "liberty" },
      { feature: "Online Rate", competitor: "3.49% + $0.49", liberty: "Interchange + markup", advantage: "liberty" },
      { feature: "Monthly Fee", competitor: "$0 (or $5-$30 for Zettle)", liberty: "$0 - $9.95", advantage: "tie" },
      { feature: "Contract Length", competitor: "No contract", liberty: "No long-term contract", advantage: "tie" },
      { feature: "Account Stability", competitor: "Holds and freezes common", liberty: "Stable merchant account", advantage: "liberty" },
      { feature: "Next-Day Funding", competitor: "Extra fee (Instant)", liberty: "Available*", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "No", liberty: "Yes", advantage: "liberty" },
      { feature: "Liberty Zero™ Program", competitor: "No", liberty: "Available*", advantage: "liberty" },
      { feature: "Chargeback Support", competitor: "Basic (Seller Protection)", liberty: "Full support + guidance", advantage: "liberty" },
      { feature: "Consumer Brand Recognition", competitor: "Very high", liberty: "Merchant-focused", advantage: "competitor" },
      { feature: "Onboarding Support", competitor: "Self-service", liberty: "Guided, personal setup", advantage: "liberty" },
    ],
    competitorPros: [
      "Strong consumer brand recognition",
      "Easy self-service setup",
      "PayPal checkout increases conversion for some online stores",
      "Buy Now Pay Later options for customers",
      "International payment support",
    ],
    competitorCons: [
      "2.99% + $0.49 in-person rate is one of the highest",
      "Account holds and fund freezes are common complaints",
      "No dedicated support for merchant accounts",
      "No interchange passthrough pricing",
      "Per-transaction fixed fee ($0.49) is very high",
      "Limited in-person payment hardware options",
      "Not designed for high-volume brick-and-mortar businesses",
    ],
    libertyPros: [
      "Interchange-plus pricing saves significantly on every transaction",
      "Stable merchant account without surprise holds",
      "Dedicated human support who knows your business",
      "Free statement review shows exact savings",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "Free terminal for qualifying merchants*",
      "Next-day funding available*",
      "Purpose-built for businesses, not consumers",
    ],
    whoShouldUseCompetitor: "PayPal is reasonable for very small online sellers, eBay merchants, and businesses where PayPal checkout is expected by customers. If brand recognition at checkout matters more than processing costs, PayPal has value as a supplementary payment method.",
    whoShouldUseLiberty: "Liberty Bancard is the better choice for any business processing $5,000+/month, especially in-person. If you're tired of PayPal's high fees, account holds, and lack of support, switching to a dedicated merchant account with transparent pricing is a significant upgrade.",
    savingsExample: {
      monthlyVolume: "$20,000/month",
      competitorCost: "$696/month",
      libertyCost: "$380/month*",
      annualSavings: "$3,792*",
    },
    faqs: [
      { question: "Is Liberty Bancard better than PayPal for businesses?", answer: "For in-person businesses processing over $5,000/month, Liberty Bancard is significantly better. PayPal's 2.99% + $0.49 in-person rate is one of the highest in the industry, and their account hold policies create cash flow risk. Liberty Bancard offers interchange-plus pricing, stable accounts, and dedicated support." },
      { question: "Why do PayPal accounts get frozen?", answer: "PayPal uses automated risk algorithms that can freeze funds for 21+ days without warning. Because PayPal serves both consumers and businesses on the same platform, merchant accounts don't get the same stability as a dedicated merchant services provider like Liberty Bancard." },
      { question: "Can I still accept PayPal if I switch to Liberty Bancard?", answer: "Yes. You can use Liberty Bancard as your primary payment processor for card transactions while still offering PayPal as an alternative checkout option for customers who prefer it. Many businesses use both." },
      { question: "How much can I save switching from PayPal?", answer: "Most businesses processing $20,000+/month save $2,000-$5,000 per year by switching from PayPal to Liberty Bancard's interchange-plus pricing. Upload your PayPal statement and we'll show you a detailed breakdown of your exact savings." },
      { question: "Does Liberty Bancard work for online businesses?", answer: "Liberty Bancard supports both in-person and online payment processing through gateway partnerships. If you process online transactions, include that information when you submit your statement for review and we'll recommend the right setup." },
    ],
  },
  helcim: {
    slug: "helcim",
    name: "Helcim",
    fullName: "Helcim Inc.",
    tagline: "Interchange-Plus vs. Interchange-Plus — The Details Matter",
    metaTitle: "Liberty Bancard vs Helcim - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Helcim side by side. Both offer interchange-plus pricing — see where Liberty Bancard's dedicated support and local expertise give businesses an edge.",
    metaKeywords: "helcim alternative, helcim vs liberty bancard, helcim payment processing fees, helcim competitor, helcim review",
    heroDescription: "Helcim and Liberty Bancard both offer interchange-plus pricing, but the details — support, local expertise, and program flexibility — matter for growing businesses.",
    comparison: [
      { feature: "Pricing Model", competitor: "Interchange-plus with volume tiers", liberty: "Interchange-plus, transparent markup", advantage: "tie" },
      { feature: "Monthly Fee", competitor: "$0 (volume-based markup)", liberty: "Varies by program", advantage: "tie" },
      { feature: "Dedicated Account Rep", competitor: "Online/chat support", liberty: "Dedicated local rep", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "Not offered", liberty: "Free detailed analysis", advantage: "liberty" },
      { feature: "0% Processing Programs", competitor: "Not available", liberty: "Compliant surcharge/cash discount", advantage: "liberty" },
      { feature: "In-Person Support", competitor: "Remote only", liberty: "Local rep available", advantage: "liberty" },
      { feature: "Equipment Options", competitor: "Helcim hardware", liberty: "Multi-brand, lease or purchase", advantage: "liberty" },
      { feature: "Contract Terms", competitor: "Month-to-month", liberty: "Flexible terms", advantage: "tie" },
      { feature: "eCommerce Integration", competitor: "Strong online tools", liberty: "Gateway partnerships available", advantage: "competitor" },
      { feature: "Chargeback Support", competitor: "Self-service portal", liberty: "Rep-assisted resolution", advantage: "liberty" },
    ],
    competitorPros: ["No monthly fee structure", "Strong eCommerce tools", "Transparent volume-tiered pricing", "Self-service portal for managing transactions"],
    competitorCons: ["No dedicated account rep for most accounts", "No 0% processing options", "Remote support only — no local expertise", "Limited program flexibility for complex businesses"],
    libertyPros: ["Dedicated local account rep", "Free statement analysis before you commit", "Compliant 0% processing programs where permitted", "Rep-assisted chargeback support", "Local expertise for Florida-area businesses"],
    whoShouldUseCompetitor: "Helcim works well for tech-savvy online businesses and eCommerce operations that want to manage everything self-service and don't need a dedicated rep.",
    whoShouldUseLiberty: "Liberty Bancard is the better choice for in-person businesses, restaurant owners, retail shops, and service providers who value a dedicated point of contact and the option to reduce net processing costs to near zero.",
    savingsExample: {
      monthlyVolume: "$25,000/month",
      competitorCost: "$455/month",
      libertyCost: "$375/month*",
      annualSavings: "$960*",
    },
    faqs: [
      { question: "Is Helcim the same as Liberty Bancard?", answer: "Both offer interchange-plus pricing, but they serve different customer needs. Helcim is a self-service platform for tech-forward businesses. Liberty Bancard provides dedicated account management, local support, and program flexibility like 0% processing that Helcim doesn't offer." },
      { question: "Does Helcim charge a monthly fee?", answer: "Helcim uses volume-based markup that decreases as processing volume increases, with no fixed monthly fee. Liberty Bancard's pricing depends on your program and volume. A free statement review will compare your exact costs side by side." },
      { question: "Can I get 0% processing with Helcim?", answer: "Helcim does not currently offer compliant cash discount or surcharging programs. Liberty Bancard offers both where permitted by state law and card brand rules, which can reduce net processing costs significantly for qualifying businesses." },
      { question: "How do I switch from Helcim to Liberty Bancard?", answer: "Upload your current Helcim statement for a free analysis. We'll show you a detailed cost comparison and handle the transition, including equipment setup and merchant account approval, typically within 3-5 business days." },
    ],
  },
  "authorize-net": {
    slug: "authorize-net",
    name: "Authorize.Net",
    fullName: "Authorize.Net (a Visa company)",
    tagline: "Legacy Gateway Fees vs. Modern Transparent Pricing",
    metaTitle: "Liberty Bancard vs Authorize.Net - Payment Processing Comparison",
    metaDescription: "Compare Liberty Bancard vs Authorize.Net. See how Liberty Bancard eliminates Authorize.Net's $25/month gateway fees and provides interchange-plus transparency over bundled pricing.",
    metaKeywords: "authorize.net alternative, authorize.net vs liberty bancard, authorize.net fees, authorize.net review, payment gateway alternative",
    heroDescription: "Authorize.Net charges a $25/month gateway fee plus per-transaction fees on top of your processor's rates. Liberty Bancard offers transparent all-in pricing with no separate gateway fees for most programs.",
    comparison: [
      { feature: "Pricing Model", competitor: "Bundled/tiered + gateway fee", liberty: "Interchange-plus, transparent", advantage: "liberty" },
      { feature: "Monthly Gateway Fee", competitor: "$25/month", liberty: "No separate gateway fee (most programs)", advantage: "liberty" },
      { feature: "Per-Transaction Fee", competitor: "$0.10 per transaction + processor fee", liberty: "Included in interchange-plus markup", advantage: "liberty" },
      { feature: "Setup Fee", competitor: "Up to $99", liberty: "$0 setup", advantage: "liberty" },
      { feature: "Dedicated Account Rep", competitor: "Not available", liberty: "Dedicated local rep", advantage: "liberty" },
      { feature: "0% Processing Programs", competitor: "Not available", liberty: "Compliant surcharge/cash discount", advantage: "liberty" },
      { feature: "Free Statement Review", competitor: "Not offered", liberty: "Free detailed analysis", advantage: "liberty" },
      { feature: "eCommerce Integration", competitor: "Extensive — 100+ integrations", liberty: "Gateway partnerships available", advantage: "competitor" },
      { feature: "Brand Recognition", competitor: "Very high — industry standard", liberty: "Regional leader", advantage: "competitor" },
      { feature: "Customer Support", competitor: "Phone/chat/email", liberty: "Dedicated rep + support team", advantage: "liberty" },
    ],
    competitorPros: ["Industry-standard gateway with 100+ integrations", "Very high brand recognition", "Extensive developer tools and APIs", "Trusted by major eCommerce platforms"],
    competitorCons: ["$25/month gateway fee regardless of volume", "$0.10 per-transaction charge on top of processor fees", "No dedicated account rep for most merchants", "Bundled pricing lacks transparency", "No 0% processing programs"],
    libertyPros: ["No separate $25/month gateway fee", "Interchange-plus pricing shows exact cost breakdown", "Dedicated local rep included", "Free statement analysis before you switch", "Liberty Zero™ — pay $0 to accept cards (where eligible)*"],
    whoShouldUseCompetitor: "Authorize.Net is worth keeping if you depend on its specific integrations with your eCommerce stack, or if your processor already bundles it without an extra fee. As a standalone gateway, the $25/month fee adds up.",
    whoShouldUseLiberty: "Liberty Bancard is the better choice for in-person businesses and those who want to eliminate the $25/month gateway fee, get transparent interchange-plus pricing, and have a dedicated rep handle their account.",
    savingsExample: {
      monthlyVolume: "$20,000/month",
      competitorCost: "$640/month",
      libertyCost: "$385/month*",
      annualSavings: "$3,060*",
    },
    faqs: [
      { question: "What is Authorize.Net's monthly fee?", answer: "Authorize.Net charges a $25/month gateway fee for merchant accounts, plus $0.10 per transaction. These fees are on top of your payment processor's rates. For many businesses, this adds $300-$600+ per year in base costs alone." },
      { question: "Is Authorize.Net a payment processor?", answer: "Authorize.Net is a payment gateway, not a full payment processor. It routes transactions to your processor (like a bank or ISO). Liberty Bancard is a merchant services provider that includes gateway functionality in your pricing, so you're not paying twice." },
      { question: "Can I keep Authorize.Net and add Liberty Bancard?", answer: "In most cases you can continue using Authorize.Net as a gateway while working with Liberty Bancard as your merchant services provider. However, many businesses switch fully to avoid the $25/month gateway fee. A free statement review will clarify the best path for your setup." },
      { question: "How much do I save eliminating the $25/month Authorize.Net fee?", answer: "Eliminating the $25/month gateway fee saves $300/year before accounting for rate improvements. When you also switch to interchange-plus pricing, total annual savings are typically $1,500-$4,000 for businesses processing $15,000+/month." },
    ],
  },
};

function renderCompareHtml(data: CompetitorData): string {
  const canonical = `/compare/${data.slug}`;
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: "Compare Rates", item: "https://libertybancard.com/compare-rates" },
      { "@type": "ListItem", position: 3, name: `vs ${data.name}`, item: `https://libertybancard.com${canonical}` },
    ],
  };

  const libertyWins = data.comparison.filter((c) => c.advantage === "liberty").length;
  const competitorWins = data.comparison.filter((c) => c.advantage === "competitor").length;
  const ties = data.comparison.filter((c) => c.advantage === "tie").length;

  const tableRows = data.comparison
    .map((row) => {
      const icon = row.advantage === "liberty"
        ? `<span class="ssr-check-green">✓</span> Liberty Bancard`
        : row.advantage === "competitor"
        ? `<span class="ssr-check-amber">✓</span> ${data.name}`
        : "Tie";
      return `<tr>
        <td><strong>${row.feature}</strong></td>
        <td>${row.competitor}</td>
        <td style="color:#1e3a5f;font-weight:500;">${row.liberty}</td>
        <td style="font-size:0.8125rem;">${icon}</td>
      </tr>`;
    })
    .join("");

  const competitorProsList = data.competitorPros
    .map((p) => `<li><span class="check-icon">✓</span>${p}</li>`)
    .join("");
  const competitorConsList = data.competitorCons
    .map((c) => `<li><span class="x-icon">✗</span>${c}</li>`)
    .join("");
  const libertyProsList = data.libertyPros
    .map((p) => `<li><span class="check-icon">✓</span>${p}</li>`)
    .join("");

  const faqsHtml = data.faqs
    .map(
      (f) => `<div class="ssr-faq-item">
      <div class="ssr-faq-q">${f.question}</div>
      <div class="ssr-faq-a">${f.answer}</div>
    </div>`
    )
    .join("");

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner" style="text-align:center;">
        <div class="ssr-breadcrumb" style="justify-content:center;display:flex;gap:0.25rem;">
          <a href="/">Home</a><span>/</span>
          <a href="/compare-rates">Compare</a><span>/</span>
          <span>vs ${data.name}</span>
        </div>
        <div class="ssr-hero-badge" style="margin:0 auto 1.25rem;">📊 Head-to-Head Comparison</div>
        <h1>Liberty Bancard vs ${data.name}</h1>
        <p class="ssr-hero-subtitle">${data.tagline}<br/><span style="font-size:0.9375rem;">${data.heroDescription}</span></p>
        <div class="ssr-hero-buttons" style="justify-content:center;">
          <a href="/upload-statement" class="ssr-btn-primary">📤 Get My Free Statement Analysis</a>
          <a href="/savings-calculator" class="ssr-btn-outline">🧮 Try Savings Calculator</a>
        </div>
      </div>
    </div>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Price Comparison Snapshot</h2>
        <p class="ssr-section-subheading">Based on typical monthly volume merchants</p>
        <div class="ssr-savings-grid">
          <div class="ssr-savings-card">
            <div class="ssr-savings-label">${data.name}</div>
            <div class="ssr-savings-value">${data.savingsExample.competitorCost}</div>
            <div class="ssr-savings-sub">/month estimate (${data.savingsExample.monthlyVolume})</div>
          </div>
          <div class="ssr-savings-card winner">
            <div class="ssr-savings-label winner">Est. Annual Savings</div>
            <div class="ssr-savings-value winner">${data.savingsExample.annualSavings}</div>
            <div class="ssr-savings-sub">switching to Liberty Bancard*</div>
          </div>
          <div class="ssr-savings-card liberty">
            <div class="ssr-savings-label liberty">Liberty Bancard</div>
            <div class="ssr-savings-value liberty">${data.savingsExample.libertyCost}</div>
            <div class="ssr-savings-sub">/month estimate*</div>
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Feature Comparison</h2>
        <p class="ssr-section-subheading">Liberty Bancard wins <strong>${libertyWins}</strong> categories, ${data.name} wins <strong>${competitorWins}</strong>, and <strong>${ties}</strong> are tied.</p>
        <div class="ssr-table-wrapper">
          <table class="ssr-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>${data.name}</th>
                <th>Liberty Bancard</th>
                <th>Advantage</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <div class="ssr-grid-2">
          <div class="ssr-card">
            <h3 class="ssr-card-title">${data.name}: Pros</h3>
            <ul class="ssr-check-list">${competitorProsList}</ul>
            <h3 class="ssr-card-title" style="margin-top:1.5rem;">${data.name}: Cons</h3>
            <ul class="ssr-x-list">${competitorConsList}</ul>
          </div>
          <div class="ssr-card" style="border-color: #1e3a5f; border-width: 2px;">
            <h3 class="ssr-card-title" style="color:#1e3a5f;">Liberty Bancard Advantages</h3>
            <ul class="ssr-check-list">${libertyProsList}</ul>
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Who Should Choose Which?</h2>
        <div class="ssr-grid-2">
          <div class="ssr-card">
            <h3 class="ssr-card-title">Who Should Use ${data.name}</h3>
            <p class="ssr-card-text">${data.whoShouldUseCompetitor}</p>
          </div>
          <div class="ssr-card" style="border-color: #1e3a5f; border-width: 2px;">
            <h3 class="ssr-card-title" style="color:#1e3a5f;">Who Should Use Liberty Bancard</h3>
            <p class="ssr-card-text">${data.whoShouldUseLiberty}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Frequently Asked Questions</h2>
        <div class="ssr-faq-wrapper">${faqsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>Ready to See Your Real Savings?</h2>
          <p>Upload your ${data.name} statement and we'll show you a line-by-line comparison with exactly how much you'll save. Free, no obligation.</p>
          <div class="ssr-cta-buttons">
            <a href="/upload-statement" class="ssr-btn-primary">📤 Upload Statement — Free Review</a>
            <a href="tel:9542668214" class="ssr-btn-outline">📞 Call (954) 266-8214</a>
          </div>
        </div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title: data.metaTitle,
    description: data.metaDescription,
    canonical,
    keywords: data.metaKeywords,
    schemaJsons: [faqSchema, breadcrumbSchema],
    body,
  });
}

export function getCompareHtml(slug: string): string | null {
  const data = COMPETITOR_DATA[slug];
  if (!data) return null;
  return renderCompareHtml(data);
}
