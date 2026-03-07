export interface HelpArticle {
  slug: string;
  title: string;
  category: string;
  categorySlug: string;
  summary: string;
  keywords: string;
  content: string;
}

export interface HelpCategory {
  name: string;
  slug: string;
  description: string;
  icon: string;
}

export const helpCategories: HelpCategory[] = [
  {
    name: "Getting Started",
    slug: "getting-started",
    description: "Set up your account, run your first transaction, and connect your POS system.",
    icon: "Rocket",
  },
  {
    name: "Billing & Statements",
    slug: "billing-statements",
    description: "Understand your monthly statement, fees, and how to dispute charges.",
    icon: "Receipt",
  },
  {
    name: "Technical Support",
    slug: "technical-support",
    description: "Troubleshoot terminals, gateways, and integration issues.",
    icon: "Wrench",
  },
  {
    name: "Account Management",
    slug: "account-management",
    description: "Update business info, add users, and manage settings.",
    icon: "Settings",
  },
  {
    name: "Compliance & Security",
    slug: "compliance-security",
    description: "PCI compliance, data security best practices, and fraud prevention.",
    icon: "ShieldCheck",
  },
  {
    name: "General FAQ",
    slug: "general-faq",
    description: "Answers to the most common questions about payment processing.",
    icon: "HelpCircle",
  },
];

export const helpArticles: HelpArticle[] = [
  // ── Getting Started ──
  {
    slug: "setting-up-your-merchant-account",
    title: "Setting Up Your Merchant Account",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "Step-by-step guide to getting your Liberty Bancard merchant account approved and activated.",
    keywords: "merchant account setup, application, onboarding, activation",
    content: `<h2>Before You Apply</h2>
<p>Before submitting your merchant application, gather the following documents:</p>
<ul>
<li>Valid government-issued photo ID (driver's license or passport)</li>
<li>Voided business checking account check or bank letter</li>
<li>Business license or articles of incorporation</li>
<li>Most recent processing statement (if switching from another processor)</li>
<li>EIN or Social Security number for sole proprietors</li>
</ul>

<h2>The Application Process</h2>
<p>Our application is streamlined and typically takes less than 10 minutes to complete online. Here's what to expect:</p>
<ol>
<li><strong>Submit your application</strong> - Fill out the online form with your business details, ownership information, and banking credentials.</li>
<li><strong>Underwriting review</strong> - Our team reviews your application. Most merchants are approved within 24-48 hours. High-risk or high-volume accounts may require additional documentation.</li>
<li><strong>Account activation</strong> - Once approved, you'll receive your Merchant ID (MID) and gateway credentials via email.</li>
<li><strong>Equipment setup</strong> - If you ordered a terminal or POS device, it typically ships within 1-2 business days after approval.</li>
<li><strong>First transaction</strong> - Run a test transaction to confirm everything is working. Our support team is available to walk you through it.</li>
</ol>

<h2>What Affects Approval?</h2>
<p>Underwriting considers several factors including your business type, processing history, credit profile, and anticipated monthly volume. Businesses in certain industries may face additional scrutiny due to card brand regulations.</p>

<h2>Timeline</h2>
<p>Most standard retail and restaurant merchants are approved and processing within 3-5 business days from application submission. Rush processing is available for urgent needs.</p>`,
  },
  {
    slug: "running-your-first-transaction",
    title: "Running Your First Transaction",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "Learn how to process your first credit card payment after your account is activated.",
    keywords: "first transaction, test payment, processing, card swipe, tap to pay",
    content: `<h2>Preparing for Your First Sale</h2>
<p>Before processing your first live transaction, make sure you have:</p>
<ul>
<li>Your terminal powered on and connected to the internet (Wi-Fi or Ethernet)</li>
<li>Your Merchant ID (MID) configured in the device</li>
<li>A test card or your own personal card for a small test charge</li>
</ul>

<h2>Processing a Card-Present Transaction</h2>
<p>For in-person payments using a physical terminal:</p>
<ol>
<li>Enter the sale amount on the terminal keypad.</li>
<li>Prompt the customer to insert their chip card, tap their contactless card or phone, or swipe the magnetic stripe.</li>
<li>Wait for the authorization response. An approved transaction will display an approval code.</li>
<li>Have the customer sign if required (transactions under $25 typically do not require a signature).</li>
<li>Print or email the receipt.</li>
</ol>

<h2>Processing a Card-Not-Present Transaction</h2>
<p>For phone or mail orders using a virtual terminal:</p>
<ol>
<li>Log in to your virtual terminal or gateway portal.</li>
<li>Select "New Transaction" or "Sale."</li>
<li>Enter the card number, expiration date, CVV, and billing ZIP code.</li>
<li>Enter the transaction amount and any invoice or order reference.</li>
<li>Submit and confirm the authorization.</li>
</ol>

<h2>Test Transactions</h2>
<p>We recommend running a small test charge (e.g., $1.00) and then voiding it the same day to confirm your terminal and account are working properly. Voided transactions do not incur interchange fees.</p>

<h2>Troubleshooting</h2>
<p>If your first transaction declines, check that your terminal is connected to the internet, your MID is correctly programmed, and the card being used is valid. Contact our support team if issues persist.</p>`,
  },
  {
    slug: "connecting-your-pos-system",
    title: "Connecting Your POS System",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "How to integrate Liberty Bancard processing with popular POS platforms.",
    keywords: "POS integration, point of sale, Clover, Square alternative, POS setup",
    content: `<h2>Supported POS Systems</h2>
<p>Liberty Bancard integrates with a wide range of POS platforms including:</p>
<ul>
<li>Clover (Flex, Mini, Station)</li>
<li>Dejavoo terminals</li>
<li>PAX Technology terminals</li>
<li>Valor PayTech</li>
<li>Most USB and IP-connected terminals</li>
</ul>

<h2>Integration Methods</h2>
<p>There are two primary ways to connect your POS with our processing:</p>
<h3>Semi-Integrated</h3>
<p>Your POS sends the transaction amount to the terminal, the customer pays on the terminal, and the approval is sent back to the POS. This is the most common and secure method because card data never touches your POS software.</p>
<h3>Fully Integrated</h3>
<p>Card data flows through your POS software to our gateway. This requires PCI-validated software and is typically used with custom or enterprise POS systems.</p>

<h2>Setup Steps</h2>
<ol>
<li>Confirm your POS platform and version with our onboarding team.</li>
<li>We'll provision your terminal or gateway credentials for that platform.</li>
<li>Install or configure the payment module in your POS software.</li>
<li>Enter the terminal IP address or serial number in your POS settings.</li>
<li>Run a test transaction to verify the connection.</li>
</ol>

<h2>Need Help?</h2>
<p>If you're using a POS system not listed above, contact our integration team. We support most platforms that use standard payment protocols and can often configure custom integrations within a few business days.</p>`,
  },
  {
    slug: "understanding-your-pricing",
    title: "Understanding Your Pricing",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "A clear explanation of interchange-plus pricing and how your rates are structured.",
    keywords: "interchange plus, pricing, processing rates, markup, fees explained",
    content: `<h2>Interchange-Plus Pricing Explained</h2>
<p>Liberty Bancard uses interchange-plus (also called "cost-plus") pricing, which is the most transparent pricing model in the payments industry. Here's how it works:</p>
<ul>
<li><strong>Interchange</strong> - This is the base cost set by Visa, Mastercard, Discover, and American Express. It varies by card type, industry, and how the card is accepted.</li>
<li><strong>Plus (Markup)</strong> - This is Liberty Bancard's fee on top of interchange. It's a fixed percentage and/or per-transaction amount that doesn't change.</li>
</ul>

<h2>Why Interchange-Plus Is Better</h2>
<p>Unlike flat-rate or tiered pricing, interchange-plus shows you exactly what the card brands charge and exactly what your processor charges. There's no bundling or hiding of costs.</p>

<h2>Common Fee Categories</h2>
<ul>
<li><strong>Transaction fees</strong> - Per-swipe or per-authorization charges</li>
<li><strong>Monthly account fee</strong> - A small fixed monthly fee for account maintenance</li>
<li><strong>PCI compliance fee</strong> - Covers your annual PCI DSS validation</li>
<li><strong>Batch fee</strong> - A small fee each time you settle your daily transactions</li>
<li><strong>Statement fee</strong> - Covers monthly statement generation and delivery</li>
</ul>

<h2>What We Don't Charge</h2>
<p>Liberty Bancard does not charge application fees, setup fees, or annual fees. We also don't pad interchange rates or add hidden surcharges to your monthly statement.</p>

<h2>Reading Your Effective Rate</h2>
<p>Your effective rate is your total processing cost divided by your total sales volume. This single number tells you more about your true cost than any quoted rate. We help you calculate and monitor your effective rate monthly.</p>`,
  },
  {
    slug: "next-day-funding-setup",
    title: "Setting Up Next-Day Funding",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "How to enable and optimize next-day deposit of your processed funds.",
    keywords: "next day funding, fast deposits, settlement, batch time, funding speed",
    content: `<h2>What Is Next-Day Funding?</h2>
<p>Next-day funding means the money from your credit card transactions is deposited into your bank account the following business day. This is significantly faster than the standard 2-3 day settlement offered by many processors.</p>

<h2>Eligibility</h2>
<p>Most merchants approved through Liberty Bancard qualify for next-day funding. Requirements include:</p>
<ul>
<li>A verified business checking account at a major US bank</li>
<li>No active holds or reserves on your account</li>
<li>Transactions batched before the daily cutoff time</li>
</ul>

<h2>Setting Your Batch Time</h2>
<p>Your batch time is when your terminal or gateway automatically sends the day's transactions for settlement. For next-day funding:</p>
<ol>
<li>Set your batch time to before 9:00 PM Eastern.</li>
<li>Transactions batched after the cutoff will fund the following business day.</li>
<li>Weekend and holiday transactions fund on the next business day.</li>
</ol>

<h2>How to Enable</h2>
<p>Next-day funding is enabled by default for qualifying merchants. If you're not receiving funds the next day:</p>
<ul>
<li>Verify your batch time is set correctly on your terminal.</li>
<li>Confirm your bank account information is accurate in our system.</li>
<li>Check for any account holds or risk reviews that may delay settlement.</li>
<li>Contact our support team to verify your funding schedule.</li>
</ul>

<h2>Same-Day Funding</h2>
<p>Same-day funding is available for select merchants with higher volume. Contact your account representative to learn about eligibility and any associated fees.</p>`,
  },

  // ── Billing & Statements ──
  {
    slug: "reading-your-monthly-statement",
    title: "Reading Your Monthly Statement",
    category: "Billing & Statements",
    categorySlug: "billing-statements",
    summary: "A section-by-section guide to understanding your merchant processing statement.",
    keywords: "monthly statement, processing statement, fees breakdown, statement guide",
    content: `<h2>Statement Overview</h2>
<p>Your monthly merchant statement summarizes all processing activity, fees, and adjustments for the billing period. Understanding each section helps you verify charges and identify potential savings.</p>

<h2>Key Sections</h2>
<h3>Account Summary</h3>
<p>Shows your total sales volume, number of transactions, refunds, and net processing amount for the month. This is your high-level snapshot.</p>

<h3>Transaction Detail</h3>
<p>Lists every batch settlement with dates, transaction counts, and amounts. Compare this against your POS reports to ensure accuracy.</p>

<h3>Interchange Charges</h3>
<p>Breaks down the interchange fees charged by Visa, Mastercard, Discover, and Amex. Each card type and transaction method has a different interchange rate. This section shows the actual cost passed through from the card brands.</p>

<h3>Processor Fees</h3>
<p>Shows Liberty Bancard's markup fees including per-transaction charges, monthly account fees, and any applicable service fees. These should match your signed agreement.</p>

<h3>Assessments & Dues</h3>
<p>Card brand assessment fees (Visa, MC, Discover, Amex) are small percentage-based fees charged by the networks themselves. These are separate from interchange.</p>

<h3>Adjustments</h3>
<p>Any chargebacks, chargeback reversals, or other credits and debits applied during the month.</p>

<h2>Calculating Your Effective Rate</h2>
<p>Divide your total fees by your total sales volume. For example, if you processed $50,000 and paid $1,250 in total fees, your effective rate is 2.50%. This number is the most meaningful metric for comparing processors.</p>

<h2>Questions About Your Statement?</h2>
<p>Upload your statement through our free review tool and we'll provide a line-by-line analysis at no cost.</p>`,
  },
  {
    slug: "understanding-processing-fees",
    title: "Understanding Processing Fees",
    category: "Billing & Statements",
    categorySlug: "billing-statements",
    summary: "Detailed breakdown of every fee type that may appear on your merchant statement.",
    keywords: "processing fees, merchant fees, transaction fees, monthly fees, PCI fee",
    content: `<h2>Types of Processing Fees</h2>
<p>Payment processing fees fall into three main categories: interchange, assessments, and processor markup. Here's what each means for your business.</p>

<h2>Interchange Fees</h2>
<p>Set by Visa, Mastercard, Discover, and Amex, interchange fees make up the largest portion of your processing cost (typically 1.5%-2.5% of each transaction). Factors that affect interchange rates:</p>
<ul>
<li>Card type (debit vs credit, rewards vs basic)</li>
<li>Entry method (chip insert vs keyed entry)</li>
<li>Business category (MCC code)</li>
<li>Whether AVS and CVV data are provided</li>
</ul>

<h2>Assessment Fees</h2>
<p>Card brand assessments are small fees (typically 0.13%-0.15%) charged by the card networks on all transactions. These are non-negotiable and the same regardless of your processor.</p>

<h2>Processor Markup Fees</h2>
<p>These are the fees your processor (Liberty Bancard) charges for providing the service. Common markup fees include:</p>
<ul>
<li><strong>Per-transaction fee</strong> - A fixed amount (e.g., $0.08) per authorization</li>
<li><strong>Monthly account fee</strong> - Typically $5-$15/month for account maintenance</li>
<li><strong>Batch fee</strong> - $0.10-$0.25 per daily settlement batch</li>
<li><strong>Statement fee</strong> - $5-$10/month for statement generation</li>
<li><strong>PCI compliance fee</strong> - $5-$10/month or annually for compliance program</li>
</ul>

<h2>Fees We Never Charge</h2>
<p>Liberty Bancard does not charge: application fees, setup fees, annual fees, cancellation fees (on month-to-month agreements), minimum processing fees, or IRS reporting fees.</p>`,
  },
  {
    slug: "disputing-a-charge-on-your-statement",
    title: "Disputing a Charge on Your Statement",
    category: "Billing & Statements",
    categorySlug: "billing-statements",
    summary: "How to identify and dispute incorrect fees or charges on your monthly processing statement.",
    keywords: "dispute charge, incorrect fee, billing dispute, overcharge, fee review",
    content: `<h2>When to Dispute a Charge</h2>
<p>Review your statement monthly and dispute any charge that:</p>
<ul>
<li>Doesn't match your signed processing agreement</li>
<li>Appears as a new fee not previously disclosed</li>
<li>Shows an incorrect transaction count or volume</li>
<li>Includes duplicate charges or unauthorized debits</li>
</ul>

<h2>How to File a Dispute</h2>
<ol>
<li><strong>Document the issue</strong> - Note the specific line item, amount, and why you believe it's incorrect.</li>
<li><strong>Contact support</strong> - Reach out to our support team via phone, email, or the support form on our website.</li>
<li><strong>Provide evidence</strong> - Upload your statement highlighting the disputed charge, along with your signed agreement if relevant.</li>
<li><strong>Review timeline</strong> - We investigate all billing disputes within 5 business days and provide a written response.</li>
</ol>

<h2>Common Statement Errors</h2>
<ul>
<li>PCI non-compliance fee when you've completed your SAQ</li>
<li>Rate increase applied without proper notice</li>
<li>Equipment lease charges after returning a terminal</li>
<li>Duplicate monthly fees from processor migration</li>
</ul>

<h2>Resolution Process</h2>
<p>If we confirm an error, credits are applied to your next month's statement or refunded directly to your bank account. We maintain a transparent dispute log accessible through your merchant portal.</p>

<h2>Prevention</h2>
<p>Keep a copy of your signed merchant agreement and rate schedule. Compare your first statement against this agreement to establish a baseline for future reviews.</p>`,
  },
  {
    slug: "managing-chargebacks",
    title: "Managing Chargebacks and Disputes",
    category: "Billing & Statements",
    categorySlug: "billing-statements",
    summary: "How chargebacks work, how to respond, and strategies to prevent them.",
    keywords: "chargeback, dispute, representment, chargeback response, fraud dispute",
    content: `<h2>What Is a Chargeback?</h2>
<p>A chargeback occurs when a cardholder disputes a transaction with their issuing bank. The bank reverses the charge and debits your merchant account while the dispute is investigated. Chargebacks can result from fraud, customer dissatisfaction, or processing errors.</p>

<h2>The Chargeback Process</h2>
<ol>
<li><strong>Notification</strong> - You receive a chargeback notification with the reason code, transaction details, and response deadline (typically 7-10 days).</li>
<li><strong>Review</strong> - Determine if the chargeback is valid. If it's legitimate (e.g., you issued a refund that crossed with the dispute), you may accept it.</li>
<li><strong>Representment</strong> - If you believe the charge is valid, submit compelling evidence to fight the chargeback. This includes receipts, delivery confirmation, signed authorization, correspondence with the customer, etc.</li>
<li><strong>Decision</strong> - The issuing bank reviews your evidence and makes a final determination. You're notified of the outcome.</li>
</ol>

<h2>Common Reason Codes</h2>
<ul>
<li><strong>Fraud</strong> - Cardholder claims they didn't authorize the transaction</li>
<li><strong>Product not received</strong> - Customer says goods/services weren't delivered</li>
<li><strong>Not as described</strong> - Product or service didn't match what was advertised</li>
<li><strong>Duplicate charge</strong> - Customer was billed more than once</li>
<li><strong>Credit not processed</strong> - Refund was promised but not issued</li>
</ul>

<h2>Prevention Strategies</h2>
<ul>
<li>Use EMV chip readers for in-person transactions</li>
<li>Collect signatures and require CVV for keyed entries</li>
<li>Send receipts via email or text immediately after purchase</li>
<li>Maintain clear refund and cancellation policies</li>
<li>Respond to customer complaints promptly before they escalate</li>
<li>Use delivery tracking and require signature confirmation for high-value orders</li>
</ul>

<h2>Chargeback Fees</h2>
<p>Each chargeback incurs a fee (typically $15-$25) regardless of the outcome. Excessive chargebacks (above 1% of transactions) can result in monitoring programs from card brands, higher fees, or account termination.</p>`,
  },
  {
    slug: "understanding-refunds-and-credits",
    title: "Understanding Refunds and Credits",
    category: "Billing & Statements",
    categorySlug: "billing-statements",
    summary: "How to process refunds, partial credits, and void transactions properly.",
    keywords: "refund, credit, void transaction, partial refund, return policy",
    content: `<h2>Void vs Refund</h2>
<p>Understanding the difference between voids and refunds saves you money:</p>
<ul>
<li><strong>Void</strong> - Cancels a transaction before the batch settles (same day). No interchange fees are charged.</li>
<li><strong>Refund</strong> - Reverses a transaction after settlement. The original interchange fee is not refunded by the card brands, so you pay processing costs on both the original sale and the refund.</li>
</ul>

<h2>Processing a Refund</h2>
<ol>
<li>Locate the original transaction in your terminal or virtual terminal by date, amount, or card number.</li>
<li>Select "Refund" or "Return" for the transaction.</li>
<li>Enter the refund amount (full or partial).</li>
<li>Confirm and process. The refund is submitted in your next batch.</li>
<li>The cardholder typically sees the credit within 3-7 business days.</li>
</ol>

<h2>Partial Refunds</h2>
<p>You can issue a partial refund for a portion of the original transaction. This is useful for returns of individual items from a multi-item purchase or for service adjustments.</p>

<h2>Refund Best Practices</h2>
<ul>
<li>Always void same-day transactions instead of refunding to avoid unnecessary fees.</li>
<li>Process refunds promptly to prevent chargebacks.</li>
<li>Keep documentation of the reason for each refund.</li>
<li>Never refund to a different card than the one used for the original purchase.</li>
<li>Set internal refund authorization limits and require manager approval above certain thresholds.</li>
</ul>

<h2>Impact on Your Statement</h2>
<p>Refunds appear as negative amounts on your statement and reduce your net sales volume. They do not reduce your total transaction count for fee calculation purposes.</p>`,
  },

  // ── Technical Support ──
  {
    slug: "terminal-troubleshooting",
    title: "Terminal Troubleshooting Guide",
    category: "Technical Support",
    categorySlug: "technical-support",
    summary: "Common terminal issues and step-by-step solutions to get back up and running.",
    keywords: "terminal not working, terminal error, connection issue, terminal offline, reboot terminal",
    content: `<h2>Terminal Won't Power On</h2>
<ul>
<li>Check that the power adapter is firmly connected to both the terminal and the outlet.</li>
<li>Try a different power outlet to rule out an outlet issue.</li>
<li>If using a charging base, ensure the terminal is properly seated.</li>
<li>If the terminal still won't power on after 5 minutes of charging, contact support for a replacement.</li>
</ul>

<h2>Terminal Shows "No Connection" or "Communication Error"</h2>
<ol>
<li>Verify your internet connection is active (test with another device).</li>
<li>For Ethernet connections, check the cable is securely plugged in and the port on your router shows activity.</li>
<li>For Wi-Fi terminals, go to Settings and verify the correct network is selected and the password is correct.</li>
<li>Restart your router/modem and wait 2 minutes before retrying.</li>
<li>Reboot the terminal by holding the power button for 10 seconds.</li>
</ol>

<h2>Transactions Declining</h2>
<p>If transactions are consistently declining:</p>
<ul>
<li>Verify the terminal is showing the correct date and time.</li>
<li>Check that your MID and TID are correctly programmed (Settings > Terminal Info).</li>
<li>Try a different card to determine if the issue is card-specific.</li>
<li>Contact support to verify there are no holds or blocks on your merchant account.</li>
</ul>

<h2>Chip Reader Not Working</h2>
<ul>
<li>Clean the chip reader slot with a cleaning card (available from most office supply stores).</li>
<li>Have the customer try inserting their card more slowly.</li>
<li>If the chip consistently fails, the terminal will prompt for a swipe fallback. If swipe also fails, the card may be damaged.</li>
</ul>

<h2>Receipt Printer Issues</h2>
<ul>
<li>Open the printer compartment and check for a paper jam.</li>
<li>Ensure the thermal paper roll is installed with the print side facing out.</li>
<li>Replace the paper roll if the thermal coating has been depleted (blank receipts).</li>
</ul>

<h2>When to Contact Support</h2>
<p>If you've tried the steps above and the issue persists, contact our technical support team. Have your terminal serial number and MID ready for faster resolution.</p>`,
  },
  {
    slug: "gateway-setup-configuration",
    title: "Payment Gateway Setup and Configuration",
    category: "Technical Support",
    categorySlug: "technical-support",
    summary: "How to configure your payment gateway for online and virtual terminal transactions.",
    keywords: "payment gateway, gateway setup, virtual terminal, online payments, API keys",
    content: `<h2>What Is a Payment Gateway?</h2>
<p>A payment gateway securely transmits transaction data between your website, POS, or virtual terminal and the payment processor. It encrypts sensitive card data and communicates with the card networks to authorize transactions.</p>

<h2>Gateway Login and Dashboard</h2>
<p>After account activation, you'll receive gateway login credentials via email. The gateway dashboard provides:</p>
<ul>
<li>Virtual terminal for keyed-in transactions</li>
<li>Transaction search and reporting</li>
<li>Recurring billing management</li>
<li>Customer vault for storing card-on-file data securely</li>
<li>API keys for website integration</li>
</ul>

<h2>Virtual Terminal Setup</h2>
<ol>
<li>Log in to your gateway portal.</li>
<li>Navigate to the Virtual Terminal section.</li>
<li>Configure your default settings (receipt email, tax rates, tip options).</li>
<li>Add any custom fields needed for your business (invoice number, PO number, etc.).</li>
<li>Process a test transaction to verify everything works.</li>
</ol>

<h2>Website Integration</h2>
<p>For e-commerce payments, you'll need to integrate the gateway with your website. Options include:</p>
<ul>
<li><strong>Hosted payment page</strong> - Redirect customers to a secure, PCI-compliant payment page hosted by the gateway.</li>
<li><strong>Embedded form</strong> - Embed a payment form directly on your website using JavaScript.</li>
<li><strong>API integration</strong> - Use the gateway's REST API for full custom control over the checkout experience.</li>
</ul>

<h2>API Keys</h2>
<p>Your gateway provides separate API keys for sandbox (testing) and production (live) environments. Never use production keys during development, and never expose API keys in client-side code.</p>

<h2>Security Settings</h2>
<p>Configure the following security features in your gateway:</p>
<ul>
<li>Enable AVS (Address Verification System) checking</li>
<li>Require CVV for all card-not-present transactions</li>
<li>Set velocity filters to flag unusual transaction patterns</li>
<li>Enable IP-based access restrictions for the admin portal</li>
</ul>`,
  },
  {
    slug: "resolving-batch-settlement-issues",
    title: "Resolving Batch Settlement Issues",
    category: "Technical Support",
    categorySlug: "technical-support",
    summary: "What to do when your batch doesn't settle or funds aren't depositing as expected.",
    keywords: "batch settlement, batch not closing, funding delay, missing deposit, settlement error",
    content: `<h2>Understanding Batch Settlement</h2>
<p>A "batch" is the collection of transactions processed on your terminal or gateway throughout the day. When the batch closes (settles), those transactions are submitted for funding. Most terminals auto-batch at a set time each day.</p>

<h2>Common Batch Issues</h2>

<h3>Batch Didn't Close</h3>
<p>If your terminal shows transactions from the previous day still in the open batch:</p>
<ul>
<li>Check your auto-batch time setting (Settings > Batch > Auto Close Time).</li>
<li>Verify the terminal was powered on and connected to the internet at the scheduled batch time.</li>
<li>Manually close the batch: Menu > Batch > Close Batch.</li>
</ul>

<h3>Missing Deposit</h3>
<p>If you closed a batch but don't see the deposit in your bank account:</p>
<ul>
<li>Allow 1-2 business days for standard funding or 1 business day for next-day funding.</li>
<li>Verify the batch actually closed by checking the batch report on your terminal.</li>
<li>Confirm the bank account number on file is correct.</li>
<li>Check with your bank for any incoming ACH credits that may not have posted yet.</li>
<li>Contact support if the deposit hasn't appeared after 3 business days.</li>
</ul>

<h3>Deposit Amount Doesn't Match</h3>
<p>Your deposit will be your gross sales minus processing fees (if fees are deducted from deposits) and any refunds processed in the same batch. Compare your batch report totals against your bank deposit and fee schedule.</p>

<h2>Best Practices</h2>
<ul>
<li>Set auto-batch for a consistent time after your business closes each day.</li>
<li>Reconcile your batch reports against bank deposits weekly.</li>
<li>Keep your terminal powered on and connected 24/7 if possible.</li>
<li>Review your funding schedule in your merchant portal for weekends and holidays.</li>
</ul>`,
  },
  {
    slug: "wifi-and-network-connectivity",
    title: "Wi-Fi and Network Connectivity for Terminals",
    category: "Technical Support",
    categorySlug: "technical-support",
    summary: "How to configure and troubleshoot Wi-Fi connectivity on payment terminals.",
    keywords: "wifi terminal, network setup, terminal connectivity, ethernet, wireless terminal",
    content: `<h2>Connection Options</h2>
<p>Most modern payment terminals support multiple connectivity methods:</p>
<ul>
<li><strong>Ethernet (wired)</strong> - Most reliable. Connect directly to your router with an Ethernet cable.</li>
<li><strong>Wi-Fi</strong> - Convenient for countertop and portable terminals. Requires a stable wireless network.</li>
<li><strong>4G/LTE cellular</strong> - For mobile terminals used at events, in vehicles, or locations without reliable internet.</li>
</ul>

<h2>Setting Up Wi-Fi</h2>
<ol>
<li>On your terminal, navigate to Settings > Communication > Wi-Fi.</li>
<li>Select "Scan Networks" to find available networks.</li>
<li>Select your business Wi-Fi network and enter the password.</li>
<li>Wait for the terminal to connect. A Wi-Fi icon should appear in the status bar.</li>
<li>Process a test transaction to confirm connectivity.</li>
</ol>

<h2>Wi-Fi Best Practices</h2>
<ul>
<li>Use a dedicated 2.4 GHz network for payment terminals (they often don't support 5 GHz).</li>
<li>Place the terminal within 30 feet of the router for a strong signal.</li>
<li>Avoid placing the terminal near microwaves, cordless phones, or other devices that interfere with 2.4 GHz signals.</li>
<li>Use a static IP assignment on your router for the terminal if you experience intermittent disconnections.</li>
<li>Set a complex Wi-Fi password and change it periodically for PCI compliance.</li>
</ul>

<h2>Troubleshooting</h2>
<ul>
<li>If the terminal shows "Connected" but transactions fail, your router's firewall may be blocking outbound traffic on the required ports. Contact our support team for the port list.</li>
<li>If the terminal drops Wi-Fi frequently, try switching to Ethernet or moving the router closer.</li>
<li>After a power outage, restart both your router and terminal before attempting transactions.</li>
</ul>`,
  },
  {
    slug: "contactless-and-nfc-troubleshooting",
    title: "Contactless and NFC Payment Troubleshooting",
    category: "Technical Support",
    categorySlug: "technical-support",
    summary: "Fixing issues with tap-to-pay, Apple Pay, Google Pay, and contactless card transactions.",
    keywords: "contactless, NFC, tap to pay, Apple Pay, Google Pay, contactless not working",
    content: `<h2>How Contactless Payments Work</h2>
<p>Contactless (NFC) payments use near-field communication to transmit payment data when a card or phone is tapped or held close to the terminal's reader. This includes physical contactless cards (with the wave symbol), Apple Pay, Google Pay, and Samsung Pay.</p>

<h2>Enabling Contactless</h2>
<p>Most modern terminals come with contactless enabled by default. If yours isn't accepting taps:</p>
<ol>
<li>Check Settings > Payment Types and ensure NFC/Contactless is enabled.</li>
<li>Verify your terminal's firmware is up to date.</li>
<li>Confirm with support that your MID is provisioned for contactless transactions.</li>
</ol>

<h2>Common Issues and Fixes</h2>

<h3>Tap Not Recognized</h3>
<ul>
<li>Ensure the card or phone is held within 1-2 inches of the contactless reader (usually indicated by the wave symbol on the terminal).</li>
<li>The customer should hold their device still for 1-2 seconds until the terminal beeps or shows "Approved."</li>
<li>Remove the phone case if it's thick or contains metal, as this can block NFC signals.</li>
</ul>

<h3>Transaction Prompts for Chip Insert</h3>
<p>Some cards or terminal configurations will fallback to chip after a failed tap attempt. This is normal for:</p>
<ul>
<li>Transactions above the contactless limit (varies by card brand)</li>
<li>Cards that don't support contactless despite having a chip</li>
<li>Terminals with outdated NFC firmware</li>
</ul>

<h3>Apple Pay / Google Pay Specific</h3>
<ul>
<li>Ensure the customer has authenticated on their phone (Face ID, fingerprint, or PIN) before tapping.</li>
<li>The payment app must be active on screen when tapping.</li>
<li>If using Apple Pay, the customer should double-click the side button to activate.</li>
</ul>

<h2>Security</h2>
<p>Contactless transactions use dynamic tokenization, meaning a unique code is generated for each transaction. The actual card number is never transmitted, making contactless payments more secure than magnetic stripe swipes.</p>`,
  },

  // ── Account Management ──
  {
    slug: "updating-business-information",
    title: "Updating Your Business Information",
    category: "Account Management",
    categorySlug: "account-management",
    summary: "How to update your business name, address, phone number, and other account details.",
    keywords: "update business info, change address, update phone, account changes, business name change",
    content: `<h2>What Can Be Updated</h2>
<p>You can request changes to the following account information:</p>
<ul>
<li>Business DBA (doing business as) name</li>
<li>Business address and phone number</li>
<li>Customer service phone number (appears on cardholder statements)</li>
<li>Email address for notifications and statements</li>
<li>Authorized contacts and signers</li>
</ul>

<h2>How to Request Changes</h2>
<ol>
<li>Contact our support team via phone, email, or the support form.</li>
<li>Provide your Merchant ID (MID) and the specific changes needed.</li>
<li>For name changes or ownership changes, additional documentation may be required (e.g., new business license, articles of amendment).</li>
<li>Changes are typically processed within 1-3 business days.</li>
</ol>

<h2>Bank Account Changes</h2>
<p>Changing your deposit bank account requires additional verification:</p>
<ul>
<li>Submit a voided check or bank letter for the new account.</li>
<li>The new account must be in the same business name.</li>
<li>Allow 3-5 business days for verification and activation.</li>
<li>A brief hold on deposits may occur during the transition for security purposes.</li>
</ul>

<h2>Ownership Changes</h2>
<p>Changes in business ownership (adding or removing owners with 25% or more ownership) require a new underwriting review. This includes:</p>
<ul>
<li>Updated ownership documentation</li>
<li>Personal guarantor information for new owners</li>
<li>New background and credit checks</li>
</ul>

<h2>Descriptor Changes</h2>
<p>Your payment descriptor is what appears on your customer's card statement. To change it, contact support with your preferred descriptor (up to 22 characters). Allow 2-5 business days for the change to take effect across all card brands.</p>`,
  },
  {
    slug: "adding-users-and-permissions",
    title: "Adding Users and Managing Permissions",
    category: "Account Management",
    categorySlug: "account-management",
    summary: "How to add team members to your merchant account and set appropriate access levels.",
    keywords: "add user, permissions, team access, admin, manager, employee access",
    content: `<h2>User Roles</h2>
<p>Liberty Bancard supports multiple user roles to control access to your account:</p>
<ul>
<li><strong>Owner / Admin</strong> - Full access to all features, settings, and reports. Can add and remove other users.</li>
<li><strong>Manager</strong> - Can process transactions, view reports, and manage daily operations. Cannot change account settings or bank information.</li>
<li><strong>Employee</strong> - Can process transactions only. Limited reporting access.</li>
<li><strong>View Only</strong> - Can view reports and transaction history but cannot process or refund transactions.</li>
</ul>

<h2>Adding a New User</h2>
<ol>
<li>Log in to your merchant portal or gateway dashboard as an Admin.</li>
<li>Navigate to Settings > User Management.</li>
<li>Click "Add User" and enter the new user's name, email, and phone number.</li>
<li>Select the appropriate role and any specific permission overrides.</li>
<li>The new user receives an email with login instructions and a temporary password.</li>
</ol>

<h2>Managing Permissions</h2>
<p>Beyond the standard roles, you can customize permissions for:</p>
<ul>
<li>Refund processing (enable/disable, set dollar limits)</li>
<li>Report access (all reports vs. daily summary only)</li>
<li>Void privileges</li>
<li>Customer vault access (stored card data)</li>
<li>Recurring billing management</li>
</ul>

<h2>Removing Users</h2>
<p>When an employee leaves, remove their access promptly:</p>
<ol>
<li>Go to Settings > User Management.</li>
<li>Find the user and select "Deactivate" or "Remove."</li>
<li>Their access is revoked immediately.</li>
<li>Review any recurring billing or saved settings associated with that user.</li>
</ol>

<h2>Security Best Practices</h2>
<ul>
<li>Never share login credentials between users.</li>
<li>Use unique usernames and strong passwords for each team member.</li>
<li>Review user access quarterly and remove unused accounts.</li>
<li>Enable two-factor authentication when available.</li>
</ul>`,
  },
  {
    slug: "changing-your-processing-settings",
    title: "Changing Your Processing Settings",
    category: "Account Management",
    categorySlug: "account-management",
    summary: "How to modify tip settings, tax rates, receipt options, and other terminal configurations.",
    keywords: "terminal settings, tip settings, tax rate, receipt configuration, auto batch",
    content: `<h2>Tip Configuration</h2>
<p>For restaurants and service businesses, configure tip options on your terminal:</p>
<ul>
<li>Enable tip prompt at the time of sale (customer enters tip before authorization).</li>
<li>Set suggested tip percentages (e.g., 15%, 18%, 20%).</li>
<li>Enable post-authorization tip adjust (customer writes tip on receipt, you enter it later).</li>
<li>Configure no-tip option to allow customers to skip.</li>
</ul>

<h2>Tax Settings</h2>
<p>Set your local sales tax rate in the terminal so it's automatically calculated:</p>
<ol>
<li>Navigate to Settings > Tax.</li>
<li>Enter your state/local tax rate as a percentage.</li>
<li>Choose whether tax is included in the entered amount or added on top.</li>
<li>For businesses with multiple tax rates, configure additional tax categories.</li>
</ol>

<h2>Receipt Options</h2>
<ul>
<li><strong>Print</strong> - Thermal receipt printed at the terminal.</li>
<li><strong>Email</strong> - Digital receipt sent to the customer's email address.</li>
<li><strong>Text/SMS</strong> - Receipt link sent via text message.</li>
<li><strong>No receipt</strong> - Customer can decline a receipt.</li>
</ul>
<p>You can offer customers a choice at checkout or set a default. Digital receipts reduce paper costs and provide a better customer experience.</p>

<h2>Auto-Batch Time</h2>
<p>Set your terminal to automatically close the batch at a consistent time each day:</p>
<ol>
<li>Navigate to Settings > Batch > Auto Close.</li>
<li>Set the time (recommended: 30 minutes after your business closes).</li>
<li>Ensure the terminal is powered on at the scheduled time.</li>
</ol>

<h2>Currency and Language</h2>
<p>Configure display language (English or Spanish) and currency (USD) in Settings > Display. These settings affect customer-facing prompts and receipts.</p>`,
  },
  {
    slug: "adding-a-new-location",
    title: "Adding a New Business Location",
    category: "Account Management",
    categorySlug: "account-management",
    summary: "How to set up payment processing at a second location or expand to multiple sites.",
    keywords: "second location, multi-location, new terminal, expansion, multiple locations",
    content: `<h2>Multi-Location Processing</h2>
<p>When you open a new business location, you'll need a separate Merchant ID (MID) for each location. This allows for:</p>
<ul>
<li>Location-specific reporting and reconciliation</li>
<li>Separate bank account assignments if needed</li>
<li>Individual rate structures per location</li>
<li>Distinct payment descriptors on customer statements</li>
</ul>

<h2>Setting Up a New Location</h2>
<ol>
<li>Contact your account representative or submit a support request.</li>
<li>Provide the new location's address, phone number, and expected monthly volume.</li>
<li>Complete a brief supplemental application (much shorter than the original).</li>
<li>We'll provision a new MID and ship equipment to the new location.</li>
<li>Setup typically takes 2-3 business days.</li>
</ol>

<h2>Centralized Reporting</h2>
<p>With multiple locations, you can view consolidated reports across all MIDs through your merchant portal. Filter by location to compare performance, track volume trends, and identify cost differences.</p>

<h2>Equipment for New Locations</h2>
<p>You can order additional terminals through your account representative. Options include:</p>
<ul>
<li>Same equipment model as your existing location(s) for consistency</li>
<li>Different equipment to match the needs of the new location</li>
<li>Mobile terminals for temporary or seasonal locations</li>
</ul>

<h2>Pricing</h2>
<p>New locations under the same business entity typically qualify for the same negotiated rates. High-volume multi-location businesses may qualify for additional volume discounts.</p>`,
  },
  {
    slug: "closing-or-pausing-your-account",
    title: "Closing or Pausing Your Account",
    category: "Account Management",
    categorySlug: "account-management",
    summary: "How to temporarily suspend or permanently close your merchant processing account.",
    keywords: "close account, cancel account, pause processing, seasonal business, account closure",
    content: `<h2>Pausing Your Account (Seasonal Hold)</h2>
<p>If your business is seasonal or you need to temporarily stop processing:</p>
<ul>
<li>Contact support to place your account on seasonal hold.</li>
<li>During hold, no monthly fees are charged (equipment lease fees may still apply if applicable).</li>
<li>Your account and settings are preserved for reactivation.</li>
<li>Reactivation typically takes 1-2 business days with a simple phone call.</li>
</ul>

<h2>Closing Your Account</h2>
<p>To permanently close your merchant account:</p>
<ol>
<li>Contact our support team by phone or email.</li>
<li>Confirm there are no outstanding chargebacks, holds, or pending transactions.</li>
<li>Return any leased equipment (if applicable) to avoid ongoing charges.</li>
<li>We process the closure within 3-5 business days.</li>
<li>Final statement and any remaining deposits are processed within the normal cycle.</li>
</ol>

<h2>Before You Close</h2>
<p>Consider these items before closing:</p>
<ul>
<li>Process any pending refunds or credits.</li>
<li>Download or save historical reports and statements.</li>
<li>Cancel any recurring billing arrangements.</li>
<li>Update stored payment methods for any subscription services that use this account.</li>
<li>Verify no chargeback disputes are pending (these may take 45-120 days to resolve).</li>
</ul>

<h2>No Cancellation Fees</h2>
<p>Liberty Bancard month-to-month agreements do not carry early termination fees. If you have a term agreement, check your contract for any applicable fees.</p>

<h2>Reactivation</h2>
<p>Closed accounts can often be reactivated within 6 months without a full reapplication. After 6 months, a new application is required but previous account history is considered.</p>`,
  },

  // ── Compliance & Security ──
  {
    slug: "pci-compliance-basics",
    title: "PCI Compliance Basics for Merchants",
    category: "Compliance & Security",
    categorySlug: "compliance-security",
    summary: "What PCI DSS compliance means for your business and how to stay compliant.",
    keywords: "PCI compliance, PCI DSS, SAQ, self assessment questionnaire, data security",
    content: `<h2>What Is PCI DSS?</h2>
<p>The Payment Card Industry Data Security Standard (PCI DSS) is a set of security requirements designed to protect cardholder data. Every business that accepts credit cards must comply with PCI DSS, regardless of size or transaction volume.</p>

<h2>PCI Compliance Levels</h2>
<p>Merchants are categorized into four levels based on annual transaction volume:</p>
<ul>
<li><strong>Level 4</strong> - Under 20,000 e-commerce or under 1 million total transactions (most small businesses)</li>
<li><strong>Level 3</strong> - 20,000 to 1 million e-commerce transactions</li>
<li><strong>Level 2</strong> - 1 million to 6 million total transactions</li>
<li><strong>Level 1</strong> - Over 6 million transactions or any merchant that has had a data breach</li>
</ul>

<h2>Your Compliance Requirements</h2>
<p>Most Liberty Bancard merchants are Level 4 and must:</p>
<ol>
<li>Complete the appropriate Self-Assessment Questionnaire (SAQ) annually.</li>
<li>Run quarterly network vulnerability scans if you have external-facing IP addresses.</li>
<li>Maintain an information security policy.</li>
<li>Attest to compliance through the validation portal.</li>
</ol>

<h2>Which SAQ Do I Need?</h2>
<ul>
<li><strong>SAQ A</strong> - E-commerce merchants that fully outsource payment processing (no card data touches your systems).</li>
<li><strong>SAQ B</strong> - Merchants using imprint machines or standalone dial-up terminals.</li>
<li><strong>SAQ C</strong> - Merchants with payment applications connected to the internet.</li>
<li><strong>SAQ D</strong> - All other merchants (the most comprehensive questionnaire).</li>
</ul>

<h2>Consequences of Non-Compliance</h2>
<ul>
<li>Monthly PCI non-compliance fees (typically $19.95-$49.95/month)</li>
<li>Increased liability in the event of a data breach</li>
<li>Potential fines from card brands ranging from $5,000 to $100,000 per month</li>
<li>Account termination by the acquiring bank</li>
</ul>

<h2>How We Help</h2>
<p>Liberty Bancard provides access to a PCI compliance portal where you can complete your SAQ online, schedule network scans, and download your compliance certificate. Our support team can guide you through the process.</p>`,
  },
  {
    slug: "protecting-customer-data",
    title: "Protecting Customer Payment Data",
    category: "Compliance & Security",
    categorySlug: "compliance-security",
    summary: "Best practices for keeping your customers' credit card information secure.",
    keywords: "data security, credit card security, encryption, tokenization, data protection",
    content: `<h2>Never Store Raw Card Data</h2>
<p>The most important rule of payment data security: never store full credit card numbers, CVV codes, or magnetic stripe data anywhere in your business. This includes:</p>
<ul>
<li>Paper receipts with full card numbers</li>
<li>Spreadsheets or databases containing card data</li>
<li>Email or text messages with card numbers</li>
<li>Handwritten notes with customer card information</li>
<li>CCTV footage that captures card numbers being entered</li>
</ul>

<h2>Encryption and Tokenization</h2>
<p>Modern payment processing uses two key technologies to protect data:</p>
<ul>
<li><strong>Point-to-point encryption (P2PE)</strong> - Encrypts card data at the moment of swipe, dip, or tap. The encrypted data can only be decrypted by the payment processor, never by your terminal or POS system.</li>
<li><strong>Tokenization</strong> - Replaces the actual card number with a random token for storage and recurring billing. The token is useless if stolen because it can only be used within our processing system.</li>
</ul>

<h2>Physical Security</h2>
<ul>
<li>Keep payment terminals in sight of staff at all times.</li>
<li>Inspect terminals regularly for tampering devices (skimmers).</li>
<li>Restrict physical access to network equipment and servers.</li>
<li>Shred any paper documents containing partial card numbers.</li>
</ul>

<h2>Digital Security</h2>
<ul>
<li>Use strong, unique passwords for all payment-related systems.</li>
<li>Keep terminal firmware and POS software up to date.</li>
<li>Use a firewall between your payment network and public internet.</li>
<li>Never process payments over public or unsecured Wi-Fi.</li>
<li>Enable automatic screen lock on devices with access to payment systems.</li>
</ul>

<h2>Employee Training</h2>
<p>Train all employees who handle payments on security best practices. Key topics include recognizing phishing attempts, proper card handling procedures, and reporting suspected breaches immediately.</p>`,
  },
  {
    slug: "fraud-prevention-tips",
    title: "Fraud Prevention Tips for Merchants",
    category: "Compliance & Security",
    categorySlug: "compliance-security",
    summary: "Practical strategies to detect and prevent credit card fraud at your business.",
    keywords: "fraud prevention, credit card fraud, suspicious transactions, fraud detection, scams",
    content: `<h2>Recognizing Suspicious Transactions</h2>
<p>Watch for these red flags that may indicate fraudulent activity:</p>
<ul>
<li>Multiple declined transactions followed by a successful one (testing stolen card numbers)</li>
<li>Unusually large orders from new customers, especially for easily resalable goods</li>
<li>Rush shipping requests, particularly to different addresses than billing</li>
<li>Multiple transactions on the same card in quick succession</li>
<li>Customers who seem nervous or in a hurry during card-present transactions</li>
<li>Phone orders from blocked or unknown caller IDs</li>
</ul>

<h2>In-Person Fraud Prevention</h2>
<ul>
<li>Always use EMV chip readers instead of swipe when possible.</li>
<li>Compare the name on the card to the customer's ID for large transactions.</li>
<li>If the chip read fails, the terminal may fall back to swipe. Be extra cautious with swipe fallback transactions.</li>
<li>Train staff to examine cards for signs of tampering (misaligned numbers, wrong colors, peeling layers).</li>
<li>Never manually key in a card number that was present but "wouldn't read." This is a common tactic used with stolen card numbers.</li>
</ul>

<h2>Online/Phone Fraud Prevention</h2>
<ul>
<li>Require CVV for all card-not-present transactions.</li>
<li>Enable AVS (Address Verification System) and reject transactions with mismatched addresses.</li>
<li>Use 3D Secure (Verified by Visa, Mastercard SecureCode) for e-commerce transactions.</li>
<li>Set velocity filters to limit the number of transactions per card per hour/day.</li>
<li>Verify the customer's phone number and email before shipping high-value orders.</li>
</ul>

<h2>Internal Fraud Prevention</h2>
<ul>
<li>Limit refund and void privileges to managers only.</li>
<li>Review all refunds daily for patterns (same employee, same amounts, late-night transactions).</li>
<li>Use unique employee login IDs on your POS and terminal.</li>
<li>Reconcile daily reports against actual cash and card activity.</li>
</ul>

<h2>What to Do If You Suspect Fraud</h2>
<ol>
<li>Do not confront the customer directly if you suspect in-person fraud.</li>
<li>Decline the transaction if possible, citing a "system issue."</li>
<li>Note any details about the individual or transaction.</li>
<li>Contact our fraud team and your local law enforcement.</li>
<li>Preserve any evidence (receipts, camera footage, order details).</li>
</ol>`,
  },
  {
    slug: "handling-a-data-breach",
    title: "What to Do If You Experience a Data Breach",
    category: "Compliance & Security",
    categorySlug: "compliance-security",
    summary: "Step-by-step response plan if your business experiences a payment data security incident.",
    keywords: "data breach, security incident, breach response, incident response, compromised data",
    content: `<h2>Immediate Steps</h2>
<p>If you suspect or confirm that payment card data has been compromised:</p>
<ol>
<li><strong>Contain the breach</strong> - Disconnect compromised systems from the network. Do not turn off or wipe any devices as forensic evidence may be lost.</li>
<li><strong>Contact Liberty Bancard</strong> - Call our security team immediately. We'll initiate the card brand notification process and guide you through the required steps.</li>
<li><strong>Document everything</strong> - Record the date and time the breach was discovered, how it was detected, which systems are affected, and what data may have been exposed.</li>
<li><strong>Preserve evidence</strong> - Do not attempt to investigate or remediate on your own. A PCI Forensic Investigator (PFI) may need to examine the systems.</li>
</ol>

<h2>Investigation Phase</h2>
<p>After the initial containment:</p>
<ul>
<li>A PFI firm conducts a forensic investigation to determine the scope of the breach.</li>
<li>Card brands may require compromised card numbers to be identified and reported.</li>
<li>You'll receive a list of remediation requirements based on the investigation findings.</li>
<li>The investigation typically takes 2-4 weeks.</li>
</ul>

<h2>Notification Requirements</h2>
<p>Depending on your state and the scope of the breach, you may be required to:</p>
<ul>
<li>Notify affected customers in writing</li>
<li>Report to your state attorney general</li>
<li>Notify credit reporting agencies if a large number of records are affected</li>
<li>Post a notice on your website</li>
</ul>

<h2>Recovery</h2>
<ul>
<li>Implement all remediation steps identified in the forensic report.</li>
<li>Complete a new PCI DSS assessment.</li>
<li>Update security policies and employee training.</li>
<li>Consider cyber liability insurance for future protection.</li>
</ul>

<h2>Prevention</h2>
<p>The best breach response is prevention. Maintain PCI compliance, use P2PE terminals, keep all software updated, and conduct regular security assessments.</p>`,
  },
  {
    slug: "understanding-emv-and-liability-shift",
    title: "Understanding EMV and the Liability Shift",
    category: "Compliance & Security",
    categorySlug: "compliance-security",
    summary: "How EMV chip technology protects your business and shifts fraud liability.",
    keywords: "EMV, chip card, liability shift, counterfeit fraud, chip reader",
    content: `<h2>What Is EMV?</h2>
<p>EMV (Europay, Mastercard, Visa) is the global standard for chip-based credit and debit card transactions. Unlike magnetic stripes, EMV chips generate a unique transaction code for each payment, making it nearly impossible to create counterfeit cards from stolen data.</p>

<h2>The Liability Shift</h2>
<p>Since October 2015, the liability for counterfeit card fraud shifts to the party using the least secure technology:</p>
<ul>
<li>If a chip card is swiped (instead of dipped) at a terminal without a chip reader, and the transaction turns out to be fraudulent, the merchant bears the liability.</li>
<li>If a chip card is dipped at a chip-enabled terminal and fraud occurs, the card-issuing bank bears the liability.</li>
</ul>

<h2>Why This Matters</h2>
<p>Merchants without EMV-capable terminals are financially responsible for counterfeit fraud losses. These chargebacks can be significant, especially for high-ticket transactions. Upgrading to an EMV terminal protects you from this liability.</p>

<h2>Best Practices</h2>
<ul>
<li>Always prompt customers to insert their chip card rather than swipe.</li>
<li>If a chip read fails on the first attempt, have the customer try again before falling back to swipe.</li>
<li>After three failed chip attempts, the terminal will allow a swipe fallback. Document these fallback transactions.</li>
<li>Keep your terminal firmware updated to maintain EMV certification.</li>
</ul>

<h2>Contactless and EMV</h2>
<p>Contactless (tap) transactions also use EMV technology and provide the same liability protection as chip-dip transactions. Encouraging customers to tap is faster and equally secure.</p>

<h2>Check Your Terminal</h2>
<p>If your terminal does not have a chip reader slot, contact Liberty Bancard to upgrade. We provide EMV-capable terminals to all merchants.</p>`,
  },

  // ── General FAQ ──
  {
    slug: "what-is-payment-processing",
    title: "What Is Payment Processing?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "A simple explanation of how credit card payment processing works.",
    keywords: "payment processing, how credit cards work, merchant services, transaction flow",
    content: `<h2>The Basics</h2>
<p>Payment processing is the system that allows your business to accept credit card, debit card, and digital wallet payments from customers. When a customer pays with a card, multiple parties work together in seconds to authorize, clear, and settle the transaction.</p>

<h2>The Transaction Flow</h2>
<ol>
<li><strong>Authorization</strong> - The customer presents their card. Your terminal sends the transaction details through the payment gateway to the card network (Visa, Mastercard, etc.), which routes it to the card-issuing bank. The bank checks the account balance and fraud filters, then sends back an approval or decline.</li>
<li><strong>Clearing</strong> - At the end of the day, your terminal sends all approved transactions (the batch) to the processor for clearing. The processor forwards the transactions to the card networks for settlement.</li>
<li><strong>Settlement</strong> - The card-issuing bank transfers the funds (minus interchange fees) to the acquiring bank, which deposits the money into your business bank account (minus processor fees).</li>
</ol>

<h2>Who's Involved?</h2>
<ul>
<li><strong>Merchant (you)</strong> - Accepts the payment</li>
<li><strong>Payment processor (Liberty Bancard)</strong> - Facilitates the transaction</li>
<li><strong>Acquiring bank</strong> - The bank that holds your merchant account</li>
<li><strong>Card network</strong> - Visa, Mastercard, Discover, or Amex</li>
<li><strong>Issuing bank</strong> - The customer's bank that issued their card</li>
</ul>

<h2>Why It Matters</h2>
<p>Understanding the transaction flow helps you appreciate why certain fees exist, why some transactions cost more than others, and how to optimize your processing to reduce costs.</p>`,
  },
  {
    slug: "how-long-does-approval-take",
    title: "How Long Does Merchant Account Approval Take?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "Timeline expectations for merchant account application and approval.",
    keywords: "approval time, application timeline, how long to get approved, underwriting time",
    content: `<h2>Standard Timeline</h2>
<p>Most merchant applications are reviewed and approved within 24-48 hours of submission. The complete timeline from application to first transaction is typically 3-5 business days:</p>
<ul>
<li><strong>Day 1</strong> - Application submitted with required documents</li>
<li><strong>Day 1-2</strong> - Underwriting review and approval</li>
<li><strong>Day 2-3</strong> - Account provisioning and equipment shipping</li>
<li><strong>Day 3-5</strong> - Equipment arrives, setup, and first transaction</li>
</ul>

<h2>What Can Delay Approval?</h2>
<ul>
<li>Missing or incomplete documentation</li>
<li>Unclear business description or website</li>
<li>High-risk industry classification requiring additional review</li>
<li>Credit issues with the business owner or guarantor</li>
<li>Unusually high requested processing volume without history</li>
</ul>

<h2>Rush Processing</h2>
<p>If you need to process payments urgently, let your account representative know. We can often expedite the underwriting process and arrange overnight equipment shipping for an additional fee.</p>

<h2>What You Can Do to Speed Things Up</h2>
<ul>
<li>Submit a complete application with all required fields filled in.</li>
<li>Provide clear, legible copies of your ID and voided check.</li>
<li>Include your most recent processing statement if switching processors.</li>
<li>Respond promptly to any requests for additional information.</li>
</ul>`,
  },
  {
    slug: "what-are-interchange-fees",
    title: "What Are Interchange Fees?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "Understanding the wholesale cost that makes up the bulk of your processing fees.",
    keywords: "interchange fees, interchange rates, wholesale cost, card brand fees, Visa Mastercard fees",
    content: `<h2>Interchange Defined</h2>
<p>Interchange fees are the wholesale transaction fees set by the card brands (Visa, Mastercard, Discover, American Express) and paid by the acquiring bank to the card-issuing bank for each transaction. These fees compensate the issuing bank for the risk of lending money to the cardholder and for maintaining the card account.</p>

<h2>How Much Are They?</h2>
<p>Interchange rates vary widely based on several factors:</p>
<ul>
<li><strong>Card type</strong> - Basic debit cards have the lowest rates (0.05% + $0.21 for regulated debit). Premium rewards cards have the highest rates (2.0%+ for some Amex cards).</li>
<li><strong>Transaction type</strong> - Card-present (swiped/dipped/tapped) rates are lower than card-not-present (keyed/online) rates because there's less fraud risk.</li>
<li><strong>Industry</strong> - Supermarkets, utilities, and some service industries have lower interchange categories.</li>
<li><strong>Transaction data</strong> - Providing additional data (Level 2 or Level 3) can qualify B2B transactions for lower rates.</li>
</ul>

<h2>Can Interchange Be Negotiated?</h2>
<p>No. Interchange rates are set by the card brands and are the same for every processor. What your processor charges on top of interchange (the markup) is what you can negotiate. This is why interchange-plus pricing is the most transparent model - you can see exactly what the non-negotiable cost is and what the negotiable markup is.</p>

<h2>Interchange Optimization</h2>
<p>While you can't negotiate interchange, you can optimize how your transactions qualify:</p>
<ul>
<li>Use chip readers instead of keying in card numbers</li>
<li>Settle batches daily</li>
<li>Provide AVS and CVV data for card-not-present transactions</li>
<li>Use Level 2/3 data for B2B and government card transactions</li>
</ul>`,
  },
  {
    slug: "do-i-need-a-contract",
    title: "Do I Need a Long-Term Contract?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "Information about contract terms, month-to-month options, and cancellation policies.",
    keywords: "contract, month to month, no contract, cancellation, early termination fee",
    content: `<h2>Month-to-Month Processing</h2>
<p>Liberty Bancard offers month-to-month processing agreements with no early termination fees. You can close your account at any time without penalty, giving you the flexibility to stay because you want to, not because you're locked in.</p>

<h2>Why Some Processors Require Contracts</h2>
<p>Many processors use long-term contracts (2-3 years) with early termination fees ($295-$595 or based on remaining months) to lock merchants in. This practice often means:</p>
<ul>
<li>They know their rates aren't competitive enough to retain merchants voluntarily.</li>
<li>They plan to raise rates after the initial period.</li>
<li>They profit from cancellation fees when merchants discover hidden costs.</li>
</ul>

<h2>Our Approach</h2>
<p>We believe our pricing and service should earn your business every month. Our month-to-month agreement includes:</p>
<ul>
<li>No setup fees or application fees</li>
<li>No annual fees</li>
<li>No early termination fees</li>
<li>30-day notice for rate changes</li>
<li>Equipment return within 30 days of closure (for placed equipment)</li>
</ul>

<h2>Equipment Considerations</h2>
<p>If you receive a free terminal placement, the equipment remains the property of Liberty Bancard and must be returned if you close your account. Purchased equipment is yours to keep.</p>

<h2>Reading the Fine Print</h2>
<p>Before signing with any processor, carefully review: termination clauses, rate escalation provisions, equipment lease terms (which may have separate cancellation fees), and minimum processing requirements.</p>`,
  },
  {
    slug: "what-is-a-merchant-id",
    title: "What Is a Merchant ID (MID)?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "Explanation of your Merchant ID number and why it's important.",
    keywords: "MID, merchant ID, merchant identification number, TID, terminal ID",
    content: `<h2>Your Merchant ID</h2>
<p>A Merchant ID (MID) is a unique identification number assigned to your business when your merchant account is approved. Think of it as your account number in the payment processing system.</p>

<h2>Where to Find It</h2>
<ul>
<li>On your approval confirmation email</li>
<li>On your monthly processing statement (usually at the top)</li>
<li>On your terminal: Menu > Settings > Terminal Info</li>
<li>In your online merchant portal dashboard</li>
</ul>

<h2>When You Need It</h2>
<p>Have your MID ready when:</p>
<ul>
<li>Contacting customer support or technical support</li>
<li>Setting up a new terminal or POS integration</li>
<li>Referencing specific transactions for chargeback responses</li>
<li>Requesting account changes or updates</li>
<li>Reconciling deposits with your bank account</li>
</ul>

<h2>MID vs TID</h2>
<p>Your Merchant ID (MID) identifies your merchant account. Your Terminal ID (TID) identifies a specific piece of equipment. A single merchant account can have multiple terminals, each with its own TID, all under one MID.</p>

<h2>Multiple MIDs</h2>
<p>Some businesses have multiple MIDs for:</p>
<ul>
<li>Different physical locations</li>
<li>Separate business entities</li>
<li>Different business types (e.g., retail store and online shop)</li>
<li>Different settlement accounts</li>
</ul>

<h2>Keep It Secure</h2>
<p>Your MID is sensitive information. Don't share it publicly or with unauthorized individuals, as it can be used to reference your account and transaction history.</p>`,
  },
  {
    slug: "can-i-accept-amex",
    title: "Can I Accept American Express?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "How American Express acceptance works and what it costs compared to Visa and Mastercard.",
    keywords: "American Express, Amex, accept Amex, Amex rates, OptBlue",
    content: `<h2>Yes, You Can Accept Amex</h2>
<p>All Liberty Bancard merchants can accept American Express through the OptBlue program. This means Amex transactions are processed through us along with your Visa, Mastercard, and Discover transactions, with one combined statement and one deposit.</p>

<h2>OptBlue Pricing</h2>
<p>Under the OptBlue program, Amex pricing works similarly to Visa and Mastercard:</p>
<ul>
<li>Interchange-plus pricing applies</li>
<li>Rates are significantly lower than Amex's direct merchant program</li>
<li>Amex rates have become much more competitive in recent years</li>
<li>For most merchants, the average Amex rate is only 0.3%-0.5% higher than Visa/Mastercard</li>
</ul>

<h2>Why Accept Amex?</h2>
<ul>
<li>Amex cardholders tend to spend 2-3x more per transaction than Visa/MC cardholders.</li>
<li>Refusing Amex may cause you to lose high-value customers entirely.</li>
<li>The OptBlue program has made Amex rates competitive with premium Visa/MC cards.</li>
<li>Amex provides fraud protection and dispute resolution comparable to other card brands.</li>
</ul>

<h2>Do I Have to Accept Amex?</h2>
<p>Amex acceptance is optional. You can choose to accept only Visa, Mastercard, and Discover if you prefer. However, we recommend accepting all major card brands to maximize your sales opportunities.</p>

<h2>Setup</h2>
<p>Amex acceptance is typically enabled by default when your merchant account is approved. If it's not enabled, contact support to add it. There's no additional application or setup fee.</p>`,
  },
  {
    slug: "what-is-a-cash-discount-program",
    title: "What Is a Cash Discount Program?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "How cash discount programs work and whether your business qualifies.",
    keywords: "cash discount, zero cost processing, 0 percent processing, eliminate processing fees",
    content: `<h2>Cash Discount Explained</h2>
<p>A cash discount program allows you to offer a discount to customers who pay with cash while charging a service fee to those who pay with a credit or debit card. This effectively transfers processing costs to the cardholder, resulting in zero or near-zero processing fees for your business.</p>

<h2>How It Works</h2>
<ol>
<li>Your posted prices include a small service fee (typically 3.5%-4%).</li>
<li>Customers who pay with cash receive a discount equal to the service fee.</li>
<li>Customers who pay with a card pay the posted price, which includes the fee.</li>
<li>The service fee collected from card transactions covers your processing costs.</li>
</ol>

<h2>Is It Legal?</h2>
<p>Cash discount programs are legal in all 50 states when properly structured. The key distinction is between a cash discount (legal everywhere) and a credit card surcharge (restricted in some states). Our program is structured as a compliant cash discount.</p>

<h2>Equipment and Signage</h2>
<p>Cash discount programs require:</p>
<ul>
<li>A terminal or POS system programmed to automatically apply and remove the service fee.</li>
<li>Proper signage at the entrance and point of sale clearly disclosing the program.</li>
<li>Receipts that itemize the service fee separately.</li>
<li>We provide all required signage and program the terminal at no additional cost.</li>
</ul>

<h2>Who Is It Best For?</h2>
<ul>
<li>Businesses with a significant cash-paying customer base</li>
<li>Service businesses with higher average tickets</li>
<li>Businesses operating on thin margins where processing fees significantly impact profitability</li>
<li>Quick-service restaurants and convenience stores</li>
</ul>

<h2>Customer Response</h2>
<p>Most customers are already accustomed to cash discounts at gas stations and other businesses. When implemented with clear signage and professional communication, the vast majority of customers accept the program without issue.</p>`,
  },
  {
    slug: "how-to-read-your-rate",
    title: "How to Read Your Processing Rate",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "Understanding the difference between your quoted rate and your actual effective rate.",
    keywords: "processing rate, effective rate, quoted rate, actual cost, rate comparison",
    content: `<h2>Quoted Rate vs Effective Rate</h2>
<p>The rate your processor quotes you (e.g., "1.65% + $0.10") is only part of the story. Your effective rate is the actual total percentage of your sales volume that goes to processing fees. This number includes interchange, assessments, processor markup, and all monthly fees.</p>

<h2>Calculating Your Effective Rate</h2>
<p>It's simple math:</p>
<p><strong>Effective Rate = Total Fees / Total Sales Volume x 100</strong></p>
<p>For example, if you processed $80,000 and paid $2,000 in total fees, your effective rate is 2.50%.</p>

<h2>Why Effective Rate Matters</h2>
<p>Two processors might quote very different rates but result in similar effective rates because:</p>
<ul>
<li>One may have a lower percentage but higher per-transaction fees.</li>
<li>One may have a lower rate but more monthly fees.</li>
<li>One may use tiered pricing that downgrades many transactions to a higher tier.</li>
<li>One may not disclose all fees in the initial quote.</li>
</ul>

<h2>What's a Good Effective Rate?</h2>
<p>Effective rates vary by industry, average ticket size, and card mix, but general benchmarks are:</p>
<ul>
<li><strong>Retail (card-present)</strong> - 1.8% - 2.5%</li>
<li><strong>Restaurant</strong> - 1.9% - 2.6%</li>
<li><strong>E-commerce (card-not-present)</strong> - 2.3% - 3.0%</li>
<li><strong>B2B with Level 2/3 data</strong> - 1.5% - 2.2%</li>
</ul>

<h2>How We Help</h2>
<p>Upload your current processing statement and we'll calculate your effective rate for free. We'll show you exactly where your money is going and identify specific savings opportunities.</p>`,
  },
  {
    slug: "what-is-next-day-funding",
    title: "What Is Next-Day Funding?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "How next-day deposits work and how to qualify for faster funding.",
    keywords: "next day funding, fast funding, same day funding, deposit speed, settlement time",
    content: `<h2>Standard vs Next-Day Funding</h2>
<p>Standard funding typically takes 2-3 business days from batch settlement to bank deposit. Next-day funding reduces this to 1 business day, meaning yesterday's sales are in your bank account the next morning.</p>

<h2>How to Qualify</h2>
<p>Most Liberty Bancard merchants qualify for next-day funding. Requirements include:</p>
<ul>
<li>An approved merchant account in good standing</li>
<li>A verified business checking account at a major US bank</li>
<li>No active account holds, reserves, or risk reviews</li>
<li>Batching before the daily cutoff time (typically 9:00 PM Eastern)</li>
</ul>

<h2>Important Notes</h2>
<ul>
<li>Weekends and bank holidays affect funding. Friday batches fund on Monday.</li>
<li>Transactions batched after the cutoff fund the following business day.</li>
<li>Very large transactions may be held for additional review before funding.</li>
<li>Refunds are processed from your next deposit.</li>
</ul>

<h2>Same-Day Funding</h2>
<p>Same-day funding is available for qualifying high-volume merchants. Transactions batched before the morning cutoff are deposited the same business day. Contact your account representative for eligibility and pricing.</p>

<h2>Tracking Your Deposits</h2>
<p>Monitor your deposits through the merchant portal, which shows batch totals, expected funding dates, and actual deposit confirmations. Set up email or text alerts for deposit notifications.</p>`,
  },
  {
    slug: "how-to-switch-processors",
    title: "How to Switch Payment Processors",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "A step-by-step guide to switching from your current processor to Liberty Bancard.",
    keywords: "switch processor, change processor, cancel processor, transfer merchant account, migrate",
    content: `<h2>Before You Switch</h2>
<p>Switching payment processors is simpler than most merchants think. Here's what to prepare:</p>
<ul>
<li>A copy of your current processing statement (so we can guarantee savings)</li>
<li>Your current contract terms (check for early termination fees)</li>
<li>A list of any integrations (POS, website, recurring billing) that reference your current processor</li>
</ul>

<h2>The Switching Process</h2>
<ol>
<li><strong>Statement review</strong> - Upload your current statement. We'll provide a detailed comparison showing your projected savings.</li>
<li><strong>Application</strong> - Complete our simple application (10 minutes).</li>
<li><strong>Approval</strong> - Typical approval in 24-48 hours.</li>
<li><strong>Equipment</strong> - We ship and configure your new terminal or POS integration.</li>
<li><strong>Go live</strong> - Process your first transaction on the new account.</li>
<li><strong>Cancel old account</strong> - Once you've confirmed the new account works, cancel your old processor. We can help you navigate the cancellation process.</li>
</ol>

<h2>What About My Existing Equipment?</h2>
<p>If you own your current terminal outright, it may be reprogrammable to work with our processing. If you're leasing equipment, check your lease terms for cancellation provisions. We provide replacement equipment at no additional charge for qualifying merchants.</p>

<h2>Recurring Billing Migration</h2>
<p>If you have customers on recurring billing or card-on-file:</p>
<ul>
<li>We can help migrate your customer vault data to our gateway.</li>
<li>Some stored card data (tokens) may not transfer between processors.</li>
<li>In some cases, customers will need to re-enter their card information.</li>
<li>We'll help you plan the migration to minimize disruption.</li>
</ul>

<h2>Zero Downtime</h2>
<p>We recommend keeping your old account active until your new account is fully operational and tested. This ensures no gap in your ability to accept payments. Most merchants complete the full switch within 5-7 business days.</p>`,
  },
  {
    slug: "what-is-pci-compliance",
    title: "What Is PCI Compliance and Do I Need It?",
    category: "General FAQ",
    categorySlug: "general-faq",
    summary: "Quick overview of PCI compliance requirements for small business merchants.",
    keywords: "PCI compliance, PCI DSS, do I need PCI, PCI requirements, PCI fee",
    content: `<h2>The Short Answer</h2>
<p>Yes, every business that accepts credit or debit cards must comply with PCI DSS (Payment Card Industry Data Security Standard). This applies whether you process one transaction a month or millions.</p>

<h2>What It Means for Small Businesses</h2>
<p>For most small businesses (Level 4 merchants processing fewer than 1 million transactions per year), PCI compliance involves:</p>
<ol>
<li>Completing an annual Self-Assessment Questionnaire (SAQ) - a set of yes/no questions about your security practices.</li>
<li>Running quarterly network vulnerability scans if you have external-facing IP addresses or e-commerce.</li>
<li>Maintaining basic security practices (firewalls, antivirus, strong passwords).</li>
</ol>

<h2>How Long Does It Take?</h2>
<p>For a typical retail merchant using a standalone terminal, the SAQ takes about 15-20 minutes to complete online. We provide access to a compliance portal that walks you through each question.</p>

<h2>What Happens If I'm Not Compliant?</h2>
<ul>
<li>Monthly PCI non-compliance fees (typically $19.95-$49.95) are added to your statement.</li>
<li>In the event of a data breach, non-compliant merchants face significantly higher fines and liabilities.</li>
<li>Card brands can levy fines against your acquiring bank, which passes them to you.</li>
</ul>

<h2>Our Support</h2>
<p>Liberty Bancard includes PCI compliance support with every merchant account. We provide the compliance portal, guide you through the SAQ, and help you maintain compliance year after year.</p>`,
  },
];

export function getArticlesByCategory(categorySlug: string): HelpArticle[] {
  return helpArticles.filter((a) => a.categorySlug === categorySlug);
}

export function getArticleBySlug(categorySlug: string, slug: string): HelpArticle | undefined {
  return helpArticles.find((a) => a.categorySlug === categorySlug && a.slug === slug);
}

export function searchArticles(query: string): HelpArticle[] {
  const lower = query.toLowerCase();
  return helpArticles.filter(
    (a) =>
      a.title.toLowerCase().includes(lower) ||
      a.summary.toLowerCase().includes(lower) ||
      a.keywords.toLowerCase().includes(lower) ||
      a.content.toLowerCase().includes(lower)
  );
}

export const popularArticles = [
  "reading-your-monthly-statement",
  "terminal-troubleshooting",
  "pci-compliance-basics",
  "what-is-a-cash-discount-program",
  "managing-chargebacks",
  "next-day-funding-setup",
];

export function getPopularArticles(): HelpArticle[] {
  return popularArticles
    .map((slug) => helpArticles.find((a) => a.slug === slug))
    .filter(Boolean) as HelpArticle[];
}
