import { ssrHtmlShell } from "../ssrShared";

const BASE_URL = "https://libertybancard.com";

interface IndustryData {
  slug: string;
  name: string;
  heroTitle: string;
  heroSubtitle: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string;
  painPoints: { title: string; description: string }[];
  solutions: { title: string; description: string }[];
  stats: { value: string; label: string }[];
  faqs: { question: string; answer: string }[];
}

export const INDUSTRY_DATA: Record<string, IndustryData> = {
  "restaurant-payment-processing": {
    slug: "restaurant-payment-processing",
    name: "Restaurant",
    heroTitle: "Payment Processing Built for Restaurants",
    heroSubtitle: "From quick-service to fine dining, restaurants face unique payment challenges. High transaction volumes, tips, and split checks mean your processor should understand your business — not just charge you for it.",
    metaTitle: "Restaurant Payment Processing | Liberty Bancard",
    metaDescription: "Transparent payment processing for restaurants. Reduce credit card processing fees with statement-based pricing. Free statement review for restaurant owners.",
    keywords: "restaurant payment processing, restaurant credit card processing, restaurant POS, restaurant merchant services, food service payment processing",
    painPoints: [
      { title: "Tip adjustments inflating your rate", description: "Every tip adjustment triggers a separate authorization, increasing your interchange costs without you realizing it." },
      { title: "POS system lock-in with hidden markups", description: "Many POS companies bundle processing at inflated rates, making it hard to see what you're actually paying per transaction." },
      { title: "Slow deposits affecting cash flow", description: "Restaurants run on tight margins. Waiting 3-5 days for deposits means you're borrowing money to cover food costs." },
      { title: "No support during peak hours", description: "When your terminal goes down during Friday dinner rush, you need someone who answers — not a call center queue." },
    ],
    solutions: [
      { title: "Interchange-plus pricing transparency", description: "See exactly what Visa and Mastercard charge vs. what your processor marks up. No bundled rates hiding the truth." },
      { title: "Next-day funding availability", description: "Qualified restaurants can receive deposits by the next business day, keeping cash flow predictable.*" },
      { title: "Tip adjustment optimization", description: "We help configure your terminal settings to minimize unnecessary authorizations and reduce interchange costs." },
      { title: "POS-agnostic integration", description: "Work with your preferred POS system without being locked into overpriced bundled processing." },
      { title: "Dedicated support representative", description: "A real person who understands restaurant operations and answers when you call." },
    ],
    stats: [
      { value: "2.4%", label: "Average effective rate we find on restaurant statements" },
      { value: "$3,200", label: "Average annual savings identified per location" },
      { value: "48hrs", label: "Typical time from approval to live processing" },
    ],
    faqs: [
      { question: "Can I keep my current POS system?", answer: "In most cases, yes. We integrate with major restaurant POS systems including Toast, Square, Clover, and others. We'll confirm compatibility during your statement review." },
      { question: "How do tip adjustments affect my processing costs?", answer: "Each tip adjustment creates a separate authorization that can trigger higher interchange rates. We optimize your terminal configuration to minimize these costs while maintaining compliance." },
      { question: "What about 0% processing for restaurants?", answer: "Compliant cash discount and surcharging programs are available where permitted by state law and card brand rules. We'll review your specific situation and explain all options during your statement analysis." },
      { question: "How fast will I receive my deposits?", answer: "Qualified merchants can receive next-day funding. Actual timing depends on cutoff times, bank schedules, and risk review. We'll outline your specific funding timeline during onboarding.*" },
      { question: "Is there a contract or early termination fee?", answer: "Contract terms and any applicable early termination fees are clearly outlined before you sign anything. We believe in transparency — no surprises." },
    ],
  },
  "retail-payment-processing": {
    slug: "retail-payment-processing",
    name: "Retail",
    heroTitle: "Payment Processing for Retail Businesses",
    heroSubtitle: "Whether you run a single storefront or multiple locations, retail businesses deserve pricing that reflects your actual transaction patterns — not a one-size-fits-all rate.",
    metaTitle: "Retail Payment Processing | Liberty Bancard",
    metaDescription: "Transparent payment processing for retail stores. Lower credit card fees with interchange-plus pricing. Free statement review for retail business owners.",
    keywords: "retail payment processing, retail credit card processing, store payment processing, retail merchant services, point of sale processing",
    painPoints: [
      { title: "Flat-rate pricing eating your margins", description: "Flat-rate processors charge the same percentage whether a customer uses a debit card or a rewards credit card — you overpay on every debit transaction." },
      { title: "Equipment leases costing thousands", description: "Terminal leases can cost 3-5x the purchase price over the lease term, and you don't even own the equipment at the end." },
      { title: "Seasonal volume fluctuations", description: "Your processing costs shouldn't penalize you during slow months with minimum processing fees and volume requirements." },
      { title: "Chargebacks with no guidance", description: "When a customer disputes a charge, you need a partner who helps you respond effectively — not one who just deducts from your account." },
    ],
    solutions: [
      { title: "True interchange-plus pricing", description: "Pay the actual card network cost plus a small, transparent markup. Save significantly on debit and standard credit card transactions." },
      { title: "Terminal purchase options", description: "Own your equipment outright instead of paying inflated lease costs. We offer modern EMV and NFC-capable terminals." },
      { title: "Multi-location management", description: "Consolidated reporting and consistent pricing across all your retail locations with a single point of contact." },
      { title: "Chargeback support", description: "We provide guidance on chargeback responses and help you implement best practices to reduce disputes." },
      { title: "Flexible contract terms", description: "Contract terms clearly outlined upfront. No hidden escalation clauses or automatic rate increases." },
    ],
    stats: [
      { value: "2.3%", label: "Average effective rate we find on retail statements" },
      { value: "$2,800", label: "Average annual savings identified per location" },
      { value: "24hrs", label: "Typical statement review turnaround" },
    ],
    faqs: [
      { question: "How is interchange-plus different from flat-rate pricing?", answer: "Flat-rate pricing charges a single percentage regardless of card type. Interchange-plus passes through the actual card network cost and adds a small, fixed markup. For most retail businesses processing over $10,000/month, interchange-plus saves money." },
      { question: "Can I use my existing terminals?", answer: "Many existing terminals can be reprogrammed to work with our processing. We'll assess your current equipment during the onboarding process and advise on compatibility." },
      { question: "Do you support contactless payments?", answer: "Yes. All terminals we provide support EMV chip, contactless/NFC (Apple Pay, Google Pay), and traditional swipe transactions." },
      { question: "What if I have multiple store locations?", answer: "We set up consolidated reporting so you can view all locations from a single dashboard. Pricing is consistent across locations, and you have one dedicated contact for all stores." },
      { question: "How do seasonal businesses handle minimum fees?", answer: "We'll review your annual volume patterns during the statement analysis and recommend a structure that accounts for seasonal fluctuations, minimizing the impact of low-volume months." },
    ],
  },
  "healthcare-payment-processing": {
    slug: "healthcare-payment-processing",
    name: "Healthcare",
    heroTitle: "Payment Processing for Healthcare Providers",
    heroSubtitle: "Medical and dental practices handle sensitive patient data and high-value transactions. Your payment processor should meet the same compliance standards you do.",
    metaTitle: "Healthcare Payment Processing | Liberty Bancard",
    metaDescription: "HIPAA-aware payment processing for medical and dental practices. Transparent pricing, secure terminals, and compliance support. Free statement review.",
    keywords: "healthcare payment processing, medical payment processing, dental payment processing, HIPAA compliant payment processing, medical merchant services",
    painPoints: [
      { title: "High per-transaction costs on large balances", description: "Patient payments are often larger amounts. Your processor's per-transaction fees may be costing you more than you realize on these higher-dollar charges." },
      { title: "Compliance concerns with payment data", description: "Healthcare providers must protect patient information. Your payment solution should support — not complicate — your compliance obligations." },
      { title: "Reconciliation headaches", description: "Matching patient payments to accounts is time-consuming when your processor doesn't provide clear, detailed reporting." },
      { title: "One-size-fits-all solutions", description: "Generic payment processors don't understand co-pays, patient financing, or the unique payment workflows in healthcare." },
    ],
    solutions: [
      { title: "Optimized pricing for healthcare transactions", description: "Higher average tickets mean per-transaction savings add up quickly. We structure pricing to reflect your actual transaction patterns." },
      { title: "PCI-compliant terminal solutions", description: "Secure, EMV-compliant terminals with point-to-point encryption to protect payment data at the point of sale." },
      { title: "Detailed transaction reporting", description: "Clear reporting that makes reconciliation with patient accounts straightforward, saving your billing team hours each month." },
      { title: "Payment plan support", description: "Accept recurring payments for patient payment plans with secure card-on-file capabilities." },
      { title: "Dedicated healthcare support", description: "A support team that understands medical office workflows and can help resolve issues without disrupting patient care." },
    ],
    stats: [
      { value: "2.6%", label: "Average effective rate we find on healthcare statements" },
      { value: "$4,100", label: "Average annual savings identified per practice" },
      { value: "99.9%", label: "Processing uptime SLA" },
    ],
    faqs: [
      { question: "Is your payment processing HIPAA compliant?", answer: "Our payment terminals and processing infrastructure are PCI DSS compliant. While payment processing itself is typically separate from PHI, we design our solutions to support your overall compliance posture. We recommend consulting with your compliance officer for your specific requirements." },
      { question: "Can patients pay bills online?", answer: "Yes. We offer secure online payment portals that allow patients to pay balances from any device, reducing collection calls and improving cash flow." },
      { question: "Do you support recurring payments for payment plans?", answer: "We provide secure card-on-file and recurring billing capabilities that allow you to set up patient payment plans with automatic charges on a defined schedule." },
      { question: "How do you handle refunds and adjustments?", answer: "Our merchant portal provides straightforward refund processing with detailed reporting that maps to patient accounts for clean reconciliation." },
      { question: "What terminals work best for medical offices?", answer: "We typically recommend countertop EMV terminals with NFC capability for front-desk payments. For mobile or bedside payments, we offer wireless terminal options as well." },
    ],
  },
  "salon-spa-payment-processing": {
    slug: "salon-spa-payment-processing",
    name: "Salon & Spa",
    heroTitle: "Payment Processing for Salons and Spas",
    heroSubtitle: "Tips, appointments, and retail product sales create a complex payment mix. Your processor should simplify it — not add confusion to your monthly statement.",
    metaTitle: "Salon & Spa Payment Processing | Liberty Bancard",
    metaDescription: "Transparent payment processing for salons and spas. Handle tips, appointments, and retail sales with clear pricing. Free statement review for salon owners.",
    keywords: "salon payment processing, spa payment processing, beauty salon credit card processing, hair salon merchant services, spa merchant account",
    painPoints: [
      { title: "Tip adjustments increasing costs", description: "Every tip added after authorization triggers additional processing that can inflate your effective rate beyond what you were quoted." },
      { title: "Bundled POS and processing lock-in", description: "Many salon software providers bundle payment processing at premium rates, making it expensive and difficult to switch." },
      { title: "Inconsistent daily deposits", description: "When your deposits don't match your daily sales, tracking revenue becomes a guessing game that wastes your time." },
      { title: "No-shows and cancellation fees", description: "Collecting cancellation fees requires card-on-file capability that many basic processors don't support properly." },
    ],
    solutions: [
      { title: "Tip-optimized processing", description: "Terminal configuration that minimizes the interchange impact of tip adjustments, keeping your effective rate closer to your quoted rate." },
      { title: "Card-on-file capability", description: "Securely store client cards for no-show fees, recurring appointments, and retail purchases with PCI-compliant tokenization." },
      { title: "Clear daily deposit reporting", description: "Match your daily deposits to your appointment book with detailed batch reporting that makes sense." },
      { title: "Software-agnostic integration", description: "Use your preferred salon management software without being forced into overpriced bundled processing." },
      { title: "Next-day funding availability", description: "Qualified salons can receive deposits by the next business day to keep cash flow aligned with daily operations.*" },
    ],
    stats: [
      { value: "2.8%", label: "Average effective rate we find on salon/spa statements" },
      { value: "$2,400", label: "Average annual savings identified per location" },
      { value: "30sec", label: "Statement upload time to start your review" },
    ],
    faqs: [
      { question: "Can I keep my salon scheduling software?", answer: "In most cases, yes. We work with your existing salon management software and integrate payment processing separately, so you're not locked into bundled rates." },
      { question: "How do you handle gratuity on card payments?", answer: "We configure your terminal to prompt for tip at the point of sale, which reduces the interchange cost compared to post-authorization tip adjustments. We'll walk you through the optimal setup." },
      { question: "Can I charge no-show fees?", answer: "Yes. With secure card-on-file tokenization, you can store client cards and charge cancellation or no-show fees according to your salon's policy." },
      { question: "What about selling retail products?", answer: "Your terminal handles both service payments and product sales. We can set up separate reporting categories if you want to track retail vs. service revenue." },
      { question: "Do you offer mobile payment options?", answer: "Yes. We offer wireless terminals that work anywhere in your salon or spa, so you're not tied to a single front-desk location." },
    ],
  },
  "auto-repair-payment-processing": {
    slug: "auto-repair-payment-processing",
    name: "Auto Repair",
    heroTitle: "Payment Processing for Auto Repair Shops",
    heroSubtitle: "Auto repair invoices are larger than average, which means every fraction of a percent in processing fees has a bigger impact on your bottom line.",
    metaTitle: "Auto Repair Payment Processing | Liberty Bancard",
    metaDescription: "Transparent payment processing for auto repair shops. Reduce credit card fees on high-ticket transactions. Free statement review for auto shop owners.",
    keywords: "auto repair payment processing, auto shop credit card processing, automotive merchant services, mechanic payment processing, auto body shop payments",
    painPoints: [
      { title: "High fees on large invoices", description: "A 3% fee on a $2,000 repair is $60. On interchange-plus pricing, that same transaction might cost $40-45. The difference adds up fast." },
      { title: "Keyed-in transactions at higher rates", description: "Phone orders and manually keyed transactions trigger higher interchange rates. If you key in transactions regularly, you're paying a premium." },
      { title: "Multi-day holds on large payments", description: "Some processors flag large transactions for review, delaying your deposits and complicating parts purchasing." },
      { title: "No understanding of your business", description: "Auto repair has unique transaction patterns. Your processor should know the difference between a $50 oil change and a $5,000 engine rebuild." },
    ],
    solutions: [
      { title: "High-ticket transaction optimization", description: "We structure pricing to minimize the per-transaction cost on larger invoices where flat-rate processing is most expensive." },
      { title: "Keyed-entry rate management", description: "For phone orders and fleet accounts, we provide competitive keyed-entry rates and help you move transactions to card-present when possible." },
      { title: "Fast deposit processing", description: "Qualified merchants receive deposits without unnecessary holds on legitimate large transactions, keeping your parts-purchasing cash flow intact.*" },
      { title: "Fleet and commercial card acceptance", description: "Accept Level II and Level III commercial cards at reduced interchange rates when properly configured." },
      { title: "Mobile payment capability", description: "Accept payments in the bay, at the counter, or in the parking lot with wireless terminal options." },
    ],
    stats: [
      { value: "3.0%", label: "Average effective rate we find on auto repair statements" },
      { value: "$4,800", label: "Average annual savings identified per shop" },
      { value: "$1,200", label: "Average transaction size where interchange-plus shines" },
    ],
    faqs: [
      { question: "Why are auto repair processing costs so high?", answer: "Auto repair shops have higher average tickets, which amplifies the impact of percentage-based pricing. Many also key in transactions for phone orders, triggering higher interchange categories. Both factors drive up your effective rate." },
      { question: "Can I accept fleet cards and commercial cards?", answer: "Yes. We configure your terminal for Level II processing, which provides lower interchange rates on qualifying commercial and fleet cards when proper data is submitted." },
      { question: "Will large transactions be held?", answer: "We work with you to establish appropriate transaction limits during onboarding so legitimate large repairs aren't flagged unnecessarily. This reduces deposit delays on your typical high-ticket work." },
      { question: "Do you offer payment plans for customers?", answer: "We can set up recurring billing capability for customers who need to pay large repair bills over time, with secure card-on-file storage." },
      { question: "What if I have multiple shop locations?", answer: "We provide consolidated reporting across locations with consistent pricing, so you can manage all shops from one account view." },
    ],
  },
  "professional-services-payment-processing": {
    slug: "professional-services-payment-processing",
    name: "Professional Services",
    heroTitle: "Payment Processing for Professional Services",
    heroSubtitle: "Law firms, accounting practices, consulting firms, and other professional services handle large, often irregular payments. Your processing should reflect that.",
    metaTitle: "Professional Services Payment Processing | Liberty Bancard",
    metaDescription: "Payment processing for law firms, accountants, and consultants. Optimize costs on high-value invoices with transparent pricing. Free statement review.",
    keywords: "professional services payment processing, law firm credit card processing, accounting firm payment processing, consulting payment processing, B2B payment processing",
    painPoints: [
      { title: "High percentage fees on large invoices", description: "When clients pay $10,000+ invoices by card, a 3% fee means $300+ per transaction. At scale, this significantly impacts profitability." },
      { title: "Card-not-present rate premiums", description: "Professional services often process payments remotely via email invoices or virtual terminals, triggering higher card-not-present interchange rates." },
      { title: "Irregular transaction volumes", description: "Project-based billing means volume fluctuates. Processors with monthly minimums penalize you during slower periods." },
      { title: "No invoice integration", description: "Sending a separate payment link for every invoice creates friction for clients and adds administrative work for your team." },
    ],
    solutions: [
      { title: "Optimized pricing for high-value transactions", description: "Interchange-plus pricing is most beneficial on larger transactions. We structure your pricing to maximize savings on your typical invoice sizes." },
      { title: "Virtual terminal and payment links", description: "Send secure payment links via email so clients can pay invoices directly. Clean, professional payment experience for your clients." },
      { title: "Recurring billing capability", description: "Set up retainer payments and recurring billing with secure card-on-file storage and automated charging." },
      { title: "Flexible terms for variable volume", description: "We structure your account to accommodate volume fluctuations without penalizing you during slower months." },
      { title: "Detailed transaction reporting", description: "Match payments to client accounts and invoices with clear, downloadable reporting for your bookkeeping." },
    ],
    stats: [
      { value: "3.2%", label: "Average effective rate we find on professional services statements" },
      { value: "$5,500", label: "Average annual savings identified per firm" },
      { value: "60%", label: "Of costs often from card-not-present premiums" },
    ],
    faqs: [
      { question: "Can clients pay invoices by credit card online?", answer: "Yes. We provide secure payment links that you can include in email invoices. Clients click, enter their card information on a secure page, and payment is processed and deposited to your account." },
      { question: "How do I handle retainer payments?", answer: "We set up recurring billing with secure card-on-file tokenization. You define the amount and schedule, and payments are automatically processed and reported." },
      { question: "Are there compliance considerations for law firms?", answer: "We're aware of trust account considerations. Payment processing goes through your designated business account. We recommend consulting with your state bar for specific trust account handling requirements." },
      { question: "What about Level II and Level III processing?", answer: "For B2B transactions, proper Level II/III data submission can qualify payments for lower interchange rates. We configure your account to submit the required data automatically when possible." },
      { question: "Can I set spending limits per client?", answer: "Your virtual terminal allows you to process individual transactions up to your approved processing limit. For recurring billing, you control the amounts and schedules." },
    ],
  },
  "ecommerce-payment-processing": {
    slug: "ecommerce-payment-processing",
    name: "E-Commerce",
    heroTitle: "Payment Processing for E-Commerce Businesses",
    heroSubtitle: "Online businesses face higher processing costs by default. Every transaction is card-not-present, which means interchange rates start higher — unless your pricing is structured correctly.",
    metaTitle: "E-Commerce Payment Processing | Liberty Bancard",
    metaDescription: "Transparent payment processing for online stores. Reduce card-not-present fees with optimized pricing. Gateway integration support. Free statement review.",
    keywords: "ecommerce payment processing, online store credit card processing, payment gateway, online merchant services, ecommerce merchant account",
    painPoints: [
      { title: "Card-not-present interchange premiums", description: "Every online transaction pays higher interchange rates than in-store transactions. Your pricing structure needs to account for this reality." },
      { title: "Fraud and chargeback exposure", description: "E-commerce businesses face higher fraud risk. Without proper tools, chargebacks can cost you the product, the revenue, and a fee on top." },
      { title: "Gateway fees adding up", description: "Monthly gateway fees, per-transaction gateway fees, and batch fees can add 0.1-0.3% on top of your processing costs." },
      { title: "Shopping cart integration complexity", description: "Getting your payment gateway to work properly with your e-commerce platform shouldn't require a developer every time something changes." },
    ],
    solutions: [
      { title: "E-commerce optimized pricing", description: "We structure interchange-plus pricing specifically for card-not-present transaction patterns, so you're not paying inflated rates designed for in-store businesses." },
      { title: "Fraud prevention tools", description: "AVS, CVV verification, 3D Secure, and velocity checking help reduce fraudulent transactions before they cost you money." },
      { title: "Gateway integration support", description: "We work with major payment gateways and e-commerce platforms including Shopify, WooCommerce, Magento, and custom integrations." },
      { title: "Chargeback management", description: "Proactive alerts and response guidance help you fight illegitimate chargebacks and reduce your overall dispute rate." },
      { title: "Transparent gateway pricing", description: "No hidden gateway fees. You'll know exactly what the gateway costs per transaction before you sign." },
    ],
    stats: [
      { value: "3.3%", label: "Average effective rate we find on e-commerce statements" },
      { value: "$6,200", label: "Average annual savings identified per online store" },
      { value: "0.5%", label: "Average gateway fee markup we help eliminate" },
    ],
    faqs: [
      { question: "Which e-commerce platforms do you support?", answer: "We integrate with Shopify, WooCommerce, Magento, BigCommerce, and most major e-commerce platforms. Custom API integration is also available for proprietary platforms." },
      { question: "How do you help reduce chargebacks?", answer: "We implement fraud prevention tools including AVS verification, CVV matching, 3D Secure authentication, and velocity checks. We also provide chargeback response templates and guidance for fighting illegitimate disputes." },
      { question: "Is there a separate gateway fee?", answer: "Gateway costs are clearly outlined in your pricing proposal. We don't hide gateway fees in bundled rates — you'll see exactly what processing costs and what gateway costs separately." },
      { question: "Can I accept international payments?", answer: "Yes. We support international card acceptance with competitive cross-border interchange rates. Currency conversion options are available depending on your gateway configuration." },
      { question: "What about subscription and recurring billing?", answer: "Our gateway integration supports tokenized recurring billing for subscription businesses, including retry logic for failed payments and customer notification capabilities." },
    ],
  },
  "construction-payment-processing": {
    slug: "construction-payment-processing",
    name: "Construction",
    heroTitle: "Payment Processing for Construction Companies",
    heroSubtitle: "Construction payments are large, often invoiced, and frequently involve commercial cards. Your processing costs on a $25,000 progress payment shouldn't be an afterthought.",
    metaTitle: "Construction Payment Processing | Liberty Bancard",
    metaDescription: "Payment processing for contractors and construction companies. Reduce fees on high-value invoices and commercial card payments. Free statement review.",
    keywords: "construction payment processing, contractor credit card processing, builder payment processing, construction merchant services, contractor merchant account",
    painPoints: [
      { title: "Massive fees on progress payments", description: "A 3% fee on a $25,000 progress payment is $750. On a $100,000 project with multiple card payments, processing costs can exceed $3,000." },
      { title: "Commercial card surcharges", description: "General contractors and property managers often pay with commercial cards that carry higher interchange rates — and most processors don't optimize for these." },
      { title: "Deposits held on large transactions", description: "Large, irregular transactions often trigger fraud holds that delay your deposits for days, complicating payroll and material purchasing." },
      { title: "No field payment capability", description: "Collecting deposits on job sites or processing change-order payments in the field requires mobile capability most processors don't prioritize." },
    ],
    solutions: [
      { title: "Level II/III processing for commercial cards", description: "Proper data submission on commercial card transactions can qualify for significantly lower interchange rates, saving hundreds per large transaction." },
      { title: "High-ticket transaction management", description: "We establish appropriate processing limits during onboarding so legitimate large payments aren't flagged, preventing unnecessary deposit delays." },
      { title: "Mobile and field payment acceptance", description: "Accept payments on job sites with mobile terminals or smartphone-based payment acceptance for deposits and change orders." },
      { title: "Invoice-based payment links", description: "Send professional payment links with invoices so clients can pay progress payments and final bills by card from any device." },
      { title: "Transparent pricing on every transaction", description: "With interchange-plus pricing, you see exactly what each large transaction costs — no surprises on your monthly statement." },
    ],
    stats: [
      { value: "3.1%", label: "Average effective rate we find on construction statements" },
      { value: "$8,400", label: "Average annual savings identified per company" },
      { value: "$750", label: "Average savings per $25,000 payment with Level II" },
    ],
    faqs: [
      { question: "What is Level II/III processing?", answer: "Level II and Level III processing involves submitting additional transaction data (like tax amount, invoice number, and line-item details) with commercial card transactions. This qualifies those transactions for lower interchange rates set by the card networks." },
      { question: "How much can I save on commercial card payments?", answer: "Commercial cards processed at Level II rates can save 0.5-1.0% per transaction compared to standard rates. On a $25,000 payment, that's $125-$250 in savings on a single transaction." },
      { question: "Will my large payments be held?", answer: "We work with you during onboarding to establish processing limits that reflect your typical transaction sizes. This significantly reduces holds on legitimate large payments." },
      { question: "Can I accept payments on job sites?", answer: "Yes. We offer mobile terminals with cellular connectivity and smartphone-based payment acceptance options for field payments." },
      { question: "How do I handle deposits and progress payments?", answer: "We provide payment links that you can include with invoices. Clients click, enter their card information, and payment is processed. You can also set up recurring billing for scheduled progress payments." },
    ],
  },
};

function renderIndustryHtml(data: IndustryData): string {
  const canonical = `/industries/${data.slug}`;
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
      { "@type": "ListItem", position: 2, name: `${data.name} Payment Processing`, item: `https://libertybancard.com${canonical}` },
    ],
  };

  const painPointsHtml = data.painPoints
    .map(
      (p) => `<div class="ssr-card ssr-pain-item">
      <div class="ssr-pain-icon">⚠</div>
      <div>
        <div class="ssr-item-title">${p.title}</div>
        <div class="ssr-item-text">${p.description}</div>
      </div>
    </div>`
    )
    .join("");

  const solutionsHtml = data.solutions
    .map(
      (s) => `<div class="ssr-card ssr-pain-item">
      <div class="ssr-solution-icon">✓</div>
      <div>
        <div class="ssr-item-title">${s.title}</div>
        <div class="ssr-item-text">${s.description}</div>
      </div>
    </div>`
    )
    .join("");

  const statsHtml = data.stats
    .map(
      (s) => `<div class="ssr-card" style="text-align:center;">
      <div class="ssr-stat-value">${s.value}</div>
      <div class="ssr-stat-label">${s.label}</div>
    </div>`
    )
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
      <div class="ssr-hero-inner">
        <div class="ssr-breadcrumb">
          <a href="/">Home</a><span>/</span>
          <a href="/industries/restaurant-payment-processing">Industries</a><span>/</span>
          <span>${data.name}</span>
        </div>
        <h1>${data.heroTitle}</h1>
        <p class="ssr-hero-subtitle">${data.heroSubtitle}</p>
        <div class="ssr-hero-buttons">
          <a href="/upload-statement" class="ssr-btn-primary">📤 Free Statement Review</a>
          <a href="tel:9542668214" class="ssr-btn-outline">📞 Call (954) 266-8214</a>
        </div>
      </div>
    </div>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">What ${data.name} Businesses Are Dealing With</h2>
        <p class="ssr-section-subheading">Common payment processing challenges we see in your industry — and fix.</p>
        <div class="ssr-grid-2">${painPointsHtml}</div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">How Liberty Bancard Solves Them</h2>
        <p class="ssr-section-subheading">Practical solutions built around how ${data.name.toLowerCase()} businesses actually operate.</p>
        <div class="ssr-grid-2">${solutionsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">By the Numbers</h2>
        <div class="ssr-grid-3">${statsHtml}</div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Frequently Asked Questions</h2>
        <div class="ssr-faq-wrapper">${faqsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>See What You're Actually Paying</h2>
          <p>Upload your most recent processing statement. We'll break it down line-by-line and show you exactly where your money goes — no commitment required.</p>
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
    keywords: data.keywords,
    schemaJsons: [faqSchema, breadcrumbSchema],
    body,
  });
}

export function getIndustryHtml(slug: string): string | null {
  const data = INDUSTRY_DATA[slug];
  if (!data) return null;
  return renderIndustryHtml(data);
}
