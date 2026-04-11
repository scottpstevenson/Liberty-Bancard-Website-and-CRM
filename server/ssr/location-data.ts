export interface CityData {
  slug: string;
  name: string;
  state: string;
  stateFullName: string;
  population: string;
  businessCount: string;
  description: string;
  neighborhoods: string;
}

export interface VerticalData {
  slug: string;
  name: string;
  industryPageSlug: string;
  avgRate: string;
  avgSavings: string;
  painPoints: string[];
  solutions: string[];
  faqs: { q: string; a: string }[];
}

export const CITIES: CityData[] = [
  {
    slug: "miami",
    name: "Miami",
    state: "FL",
    stateFullName: "Florida",
    population: "450,000",
    businessCount: "45,000+",
    description: "South Florida's largest city and a global hub for finance, tourism, and hospitality",
    neighborhoods: "Brickell, Wynwood, Coral Gables, Little Havana, South Beach",
  },
  {
    slug: "fort-lauderdale",
    name: "Fort Lauderdale",
    state: "FL",
    stateFullName: "Florida",
    population: "180,000",
    businessCount: "18,000+",
    description: "The Venice of America, home to Liberty Bancard headquarters and a thriving marine and hospitality industry",
    neighborhoods: "Las Olas, Flagler Village, Wilton Manors, Victoria Park",
  },
  {
    slug: "tampa",
    name: "Tampa",
    state: "FL",
    stateFullName: "Florida",
    population: "390,000",
    businessCount: "38,000+",
    description: "A rapidly growing Gulf Coast city with a diverse economy spanning healthcare, technology, and finance",
    neighborhoods: "Ybor City, Hyde Park, Channelside, South Tampa, Westshore",
  },
  {
    slug: "orlando",
    name: "Orlando",
    state: "FL",
    stateFullName: "Florida",
    population: "310,000",
    businessCount: "32,000+",
    description: "Florida's theme park capital and one of the fastest-growing cities in the Southeast",
    neighborhoods: "Downtown, Thornton Park, Milk District, College Park, Dr. Phillips",
  },
  {
    slug: "jacksonville",
    name: "Jacksonville",
    state: "FL",
    stateFullName: "Florida",
    population: "950,000",
    businessCount: "62,000+",
    description: "The largest city by area in the contiguous United States, with a strong logistics, military, and healthcare sector",
    neighborhoods: "Riverside, San Marco, Southside, Avondale, Town Center",
  },
  {
    slug: "miami-beach",
    name: "Miami Beach",
    state: "FL",
    stateFullName: "Florida",
    population: "90,000",
    businessCount: "9,500+",
    description: "A world-famous barrier island city known for Art Deco architecture, nightlife, and luxury tourism",
    neighborhoods: "South Beach, Mid-Beach, North Beach, Sunset Harbour, Venetian Islands",
  },
  {
    slug: "boca-raton",
    name: "Boca Raton",
    state: "FL",
    stateFullName: "Florida",
    population: "100,000",
    businessCount: "11,000+",
    description: "An affluent South Florida city known for upscale retail, technology companies, and medical facilities",
    neighborhoods: "Downtown, Mizner Park, West Boca, East Boca, University",
  },
  {
    slug: "west-palm-beach",
    name: "West Palm Beach",
    state: "FL",
    stateFullName: "Florida",
    population: "115,000",
    businessCount: "12,000+",
    description: "Palm Beach County's largest city and the cultural hub of the Treasure Coast region",
    neighborhoods: "Downtown, Northwood, El Cid, SoSo, Flamingo Park",
  },
  {
    slug: "pompano-beach",
    name: "Pompano Beach",
    state: "FL",
    stateFullName: "Florida",
    population: "112,000",
    businessCount: "10,500+",
    description: "A coastal Broward County city experiencing significant economic growth and waterfront development",
    neighborhoods: "Downtown, Atlantic, McNab, Crystal Lake, Pompano Isles",
  },
  {
    slug: "hollywood-fl",
    name: "Hollywood",
    state: "FL",
    stateFullName: "Florida",
    population: "153,000",
    businessCount: "14,000+",
    description: "A vibrant coastal city between Miami and Fort Lauderdale with a growing arts and restaurant scene",
    neighborhoods: "Downtown, Young Circle, Hollywood Beach, Driftwood, West Lake",
  },
  {
    slug: "coral-springs",
    name: "Coral Springs",
    state: "FL",
    stateFullName: "Florida",
    population: "133,000",
    businessCount: "11,500+",
    description: "A master-planned Broward County city consistently ranked among the best places to live in Florida",
    neighborhoods: "Downtown, Ramblewood, Eagle Trace, Coral Ridge, Winston Park",
  },
  {
    slug: "plantation",
    name: "Plantation",
    state: "FL",
    stateFullName: "Florida",
    population: "94,000",
    businessCount: "9,000+",
    description: "A suburban Broward County city home to major corporate headquarters and strong retail corridors",
    neighborhoods: "Downtown, Plantation Acres, Jacaranda, Westward, Sunrise",
  },
  {
    slug: "hialeah",
    name: "Hialeah",
    state: "FL",
    stateFullName: "Florida",
    population: "220,000",
    businessCount: "20,000+",
    description: "Miami-Dade's second largest city with a thriving small business community and strong Cuban-American culture",
    neighborhoods: "Hialeah Gardens, Lakes, Palm Springs North, Westland",
  },
  {
    slug: "sarasota",
    name: "Sarasota",
    state: "FL",
    stateFullName: "Florida",
    population: "57,000",
    businessCount: "7,500+",
    description: "A Gulf Coast arts and cultural hub known for pristine beaches, galleries, and upscale dining",
    neighborhoods: "Downtown, Southside Village, Burns Court, Rosemary District, St. Armands",
  },
  {
    slug: "st-petersburg",
    name: "St. Petersburg",
    state: "FL",
    stateFullName: "Florida",
    population: "265,000",
    businessCount: "24,000+",
    description: "A thriving Tampa Bay city with a booming arts district, craft brewery scene, and waterfront development",
    neighborhoods: "Downtown, Grand Central, Edge District, Kenwood, Pinellas Point",
  },
  {
    slug: "clearwater",
    name: "Clearwater",
    state: "FL",
    stateFullName: "Florida",
    population: "116,000",
    businessCount: "10,000+",
    description: "A Gulf Coast beach city and Pinellas County seat with world-famous white sand beaches",
    neighborhoods: "Downtown, Beach Walk, North Greenwood, Harbor Oaks, Clearwater Beach",
  },
  {
    slug: "cape-coral",
    name: "Cape Coral",
    state: "FL",
    stateFullName: "Florida",
    population: "194,000",
    businessCount: "15,000+",
    description: "Southwest Florida's largest city by area with an expansive canal system and rapid population growth",
    neighborhoods: "Cape Coral Pkwy, Pelican, Trafalgar, Burnt Store, Del Prado",
  },
  {
    slug: "fort-myers",
    name: "Fort Myers",
    state: "FL",
    stateFullName: "Florida",
    population: "82,000",
    businessCount: "8,500+",
    description: "The City of Palms in Lee County, a growing Southwest Florida hub for tourism, healthcare, and retail",
    neighborhoods: "Downtown River District, McGregor, Page Field, Colonial, Iona",
  },
  {
    slug: "gainesville",
    name: "Gainesville",
    state: "FL",
    stateFullName: "Florida",
    population: "133,000",
    businessCount: "10,000+",
    description: "Home to the University of Florida, a vibrant college town with a strong healthcare and technology sector",
    neighborhoods: "Downtown, Midtown, University Avenue, Haile Plantation, Jonesville",
  },
  {
    slug: "pensacola",
    name: "Pensacola",
    state: "FL",
    stateFullName: "Florida",
    population: "55,000",
    businessCount: "6,500+",
    description: "The Emerald Coast city in Florida's Panhandle with a strong military presence and growing tourism economy",
    neighborhoods: "Downtown, East Hill, Palafox, Pensacola Beach, North Hill",
  },
  {
    slug: "houston",
    name: "Houston",
    state: "TX",
    stateFullName: "Texas",
    population: "2,300,000",
    businessCount: "120,000+",
    description: "The energy capital of the world and the fourth-largest U.S. city with a diverse economy spanning oil, medical, and aerospace",
    neighborhoods: "Midtown, Montrose, The Heights, River Oaks, Galleria",
  },
  {
    slug: "dallas",
    name: "Dallas",
    state: "TX",
    stateFullName: "Texas",
    population: "1,300,000",
    businessCount: "95,000+",
    description: "A major North Texas metropolis and corporate hub anchoring one of the fastest-growing metro areas in the U.S.",
    neighborhoods: "Uptown, Deep Ellum, Bishop Arts, Lakewood, Oak Cliff",
  },
  {
    slug: "atlanta",
    name: "Atlanta",
    state: "GA",
    stateFullName: "Georgia",
    population: "500,000",
    businessCount: "55,000+",
    description: "The Southeast's economic capital, home to major Fortune 500 companies and a booming hospitality and film industry",
    neighborhoods: "Midtown, Buckhead, Little Five Points, Inman Park, Old Fourth Ward",
  },
  {
    slug: "las-vegas",
    name: "Las Vegas",
    state: "NV",
    stateFullName: "Nevada",
    population: "650,000",
    businessCount: "52,000+",
    description: "The world's entertainment capital with massive hospitality, gaming, and restaurant processing volumes",
    neighborhoods: "The Strip, Downtown Fremont, Summerlin, Henderson, Henderson South",
  },
  {
    slug: "phoenix",
    name: "Phoenix",
    state: "AZ",
    stateFullName: "Arizona",
    population: "1,600,000",
    businessCount: "105,000+",
    description: "The fifth-largest U.S. city with rapid growth in tech, manufacturing, and healthcare industries",
    neighborhoods: "Downtown, Scottsdale Road, Arcadia, Biltmore, South Mountain",
  },
  {
    slug: "nashville",
    name: "Nashville",
    state: "TN",
    stateFullName: "Tennessee",
    population: "700,000",
    businessCount: "60,000+",
    description: "Music City — a booming Southern hub for tourism, healthcare, and an exploding restaurant and hospitality scene",
    neighborhoods: "Downtown, The Gulch, East Nashville, 12South, Germantown",
  },
  {
    slug: "charlotte",
    name: "Charlotte",
    state: "NC",
    stateFullName: "North Carolina",
    population: "875,000",
    businessCount: "65,000+",
    description: "The largest city in the Carolinas, a major banking and financial services center with rapid population growth",
    neighborhoods: "Uptown, NoDa, South End, Plaza Midwood, Dilworth",
  },
  {
    slug: "denver",
    name: "Denver",
    state: "CO",
    stateFullName: "Colorado",
    population: "715,000",
    businessCount: "68,000+",
    description: "The Mile High City, a vibrant hub for outdoor recreation, craft brewing, and a thriving tech and healthcare sector",
    neighborhoods: "LoDo, RiNo, Capitol Hill, Highlands, Cherry Creek",
  },
  {
    slug: "austin",
    name: "Austin",
    state: "TX",
    stateFullName: "Texas",
    population: "960,000",
    businessCount: "72,000+",
    description: "The Live Music Capital of the World and a booming tech hub attracting major companies and entrepreneurs",
    neighborhoods: "Downtown, East Austin, South Congress, Hyde Park, Domain",
  },
  {
    slug: "chicago",
    name: "Chicago",
    state: "IL",
    stateFullName: "Illinois",
    population: "2,700,000",
    businessCount: "175,000+",
    description: "The Windy City — the third-largest U.S. city with world-class restaurants, diverse industries, and a massive merchant base",
    neighborhoods: "The Loop, River North, Wicker Park, Lincoln Park, Pilsen",
  },
];

export const VERTICALS: VerticalData[] = [
  {
    slug: "restaurant",
    name: "Restaurant",
    industryPageSlug: "restaurant-payment-processing",
    avgRate: "2.4% – 3.1%",
    avgSavings: "$3,200",
    painPoints: [
      "Tip adjustments inflate your effective rate on every transaction",
      "Flat-rate processors charge the same on $12 appetizers and $200 bar tabs",
      "Settlement delays disrupt daily food and beverage purchasing",
    ],
    solutions: [
      "Interchange-plus pricing transparently separates base cost from markup",
      "Terminal configuration minimizes interchange impact of tip adjustments",
      "Next-day deposits keep your ingredient purchasing on schedule",
    ],
    faqs: [
      {
        q: "What is the best payment processor for restaurants?",
        a: "The best processor for restaurants offers interchange-plus pricing, understands tip adjustments, provides next-day funding, and is compatible with your existing POS. Liberty Bancard specializes in restaurant payment processing with transparent pricing and local support.",
      },
      {
        q: "How much can restaurants save on processing fees?",
        a: "Most restaurants we review save $3,200 or more annually. Actual savings depend on your volume, average ticket, and current pricing structure — which we identify in your free statement review.",
      },
      {
        q: "Can I keep my current restaurant POS system?",
        a: "In most cases, yes. We integrate with major restaurant POS platforms and are not tied to any single system. We confirm compatibility during your statement review.",
      },
    ],
  },
  {
    slug: "auto-repair",
    name: "Auto Repair",
    industryPageSlug: "auto-repair-payment-processing",
    avgRate: "3.0% – 3.6%",
    avgSavings: "$4,800",
    painPoints: [
      "High-ticket invoices amplify every basis point of rate you overpay",
      "Fleet and commercial card transactions often fail to qualify for lower interchange tiers",
      "Keyed-entry phone orders carry a significant rate penalty under flat pricing",
    ],
    solutions: [
      "Interchange-plus pricing saves meaningfully more on $1,000+ repair invoices",
      "Level II commercial card setup reduces fleet card interchange rates",
      "Next-day deposits fund parts purchasing without waiting days for settlement",
    ],
    faqs: [
      {
        q: "What is the cheapest credit card processing for auto repair shops?",
        a: "Interchange-plus pricing is consistently cheapest for auto repair shops because it saves proportionally more on high-ticket transactions like engine rebuilds and transmission work. Upload your statement for a free comparison.",
      },
      {
        q: "Can I accept fleet cards at lower rates?",
        a: "Yes. We configure Level II commercial card processing, which qualifies fleet and corporate card transactions for reduced interchange rates.",
      },
      {
        q: "Will large repair invoices trigger holds on my deposits?",
        a: "We set appropriate processing limits during onboarding so legitimate large repair invoices are not flagged. This prevents unnecessary deposit delays.",
      },
    ],
  },
  {
    slug: "healthcare",
    name: "Healthcare",
    industryPageSlug: "healthcare-payment-processing",
    avgRate: "2.6% – 3.2%",
    avgSavings: "$4,100",
    painPoints: [
      "Mixed payment types — co-pays, deductibles, and balances — create unpredictable costs",
      "Recurring patient payment plan billing requires secure card-on-file storage",
      "Billing teams need exportable reports that reconcile with practice management software",
    ],
    solutions: [
      "Interchange-plus pricing optimizes costs across all patient payment types",
      "Secure tokenized card-on-file for recurring payment plans",
      "Detailed exportable reporting to simplify reconciliation for billing teams",
    ],
    faqs: [
      {
        q: "What payment processing do medical practices use?",
        a: "Medical practices benefit from interchange-plus pricing with PCI-compliant terminals, detailed reporting, and secure recurring billing. Liberty Bancard provides solutions designed for healthcare payment workflows.",
      },
      {
        q: "Is your processing HIPAA compliant?",
        a: "Our payment processing is PCI DSS compliant. Payment data is handled separately from protected health information. We design solutions to support your overall compliance posture.",
      },
      {
        q: "Do you support recurring patient payment plans?",
        a: "Yes. Secure card-on-file tokenization allows you to set up payment plans with automated monthly charges and no manual re-entry.",
      },
    ],
  },
  {
    slug: "salon",
    name: "Salon & Spa",
    industryPageSlug: "salon-spa-payment-processing",
    avgRate: "2.8% – 3.3%",
    avgSavings: "$2,400",
    painPoints: [
      "Tip adjustments after authorization inflate effective rates on most transactions",
      "No-shows and last-minute cancellations create revenue loss without card-on-file",
      "Bundled rates from salon software add markup you cannot see or negotiate",
    ],
    solutions: [
      "Terminal configuration to prompt tips at point-of-sale reduces post-auth adjustments",
      "Secure card-on-file tokenization for cancellation and no-show fee collection",
      "Software-agnostic processing works alongside your existing booking platform",
    ],
    faqs: [
      {
        q: "What is the best payment processing for salons?",
        a: "The best processing for salons offers tip optimization, card-on-file for no-shows, and works with your existing scheduling software. Liberty Bancard provides all of these with transparent interchange-plus pricing.",
      },
      {
        q: "Can I charge no-show fees with card-on-file?",
        a: "Yes. With secure tokenized card-on-file storage, you can charge cancellation or no-show fees according to your salon's policy without re-entering card details.",
      },
      {
        q: "How do tip adjustments affect my processing costs?",
        a: "Each post-authorization tip adjustment can trigger higher interchange rates. We configure your terminal to prompt for tips at the point of sale, reducing post-authorization adjustments and their associated cost.",
      },
    ],
  },
  {
    slug: "retail",
    name: "Retail",
    industryPageSlug: "retail-payment-processing",
    avgRate: "2.3% – 2.9%",
    avgSavings: "$2,800",
    painPoints: [
      "Flat-rate processors charge the same on debit and premium rewards cards — you lose on debit",
      "Equipment leases lock merchants into overpriced terminal rental for years",
      "Multi-location retailers pay more without consolidated reporting or volume pricing",
    ],
    solutions: [
      "Interchange-plus pricing captures the full debit card savings flat-rate hides",
      "Purchase or lease terminals at fair prices — no inflated multi-year leases",
      "Consolidated multi-location reporting and consistent pricing across all stores",
    ],
    faqs: [
      {
        q: "What is the cheapest credit card processing for retail stores?",
        a: "For retailers processing over $10,000/month, interchange-plus pricing consistently costs less than flat-rate processors. Upload your statement for a free comparison against Square, Stripe, or your current processor.",
      },
      {
        q: "Can I use my existing card terminals?",
        a: "Many existing terminals can be reprogrammed. We assess your equipment during onboarding and advise on compatibility with our processing platform.",
      },
      {
        q: "Do you support multiple store locations?",
        a: "Yes. We set up consolidated reporting across all locations with consistent pricing and one dedicated account manager for all your stores.",
      },
    ],
  },
  {
    slug: "dental",
    name: "Dental",
    industryPageSlug: "dental-payment-processing",
    avgRate: "2.7% – 3.3%",
    avgSavings: "$5,100",
    painPoints: [
      "High-value cosmetic and restorative procedures make every basis point costly",
      "Insurance coordination delays mean practices often wait longer to collect balances",
      "Patient financing programs add cost layers that are difficult to track against processing",
    ],
    solutions: [
      "Interchange-plus pricing maximizes savings on high-ticket dental procedures",
      "Recurring billing for payment plans keeps collections systematic and automated",
      "Transparent monthly statements make it easy to track processing costs vs. collections",
    ],
    faqs: [
      {
        q: "What is the best payment processing for dental practices?",
        a: "Dental practices benefit most from interchange-plus pricing with Level II card acceptance, secure recurring billing for patient payment plans, and PCI-compliant terminals. Liberty Bancard specializes in healthcare and dental payment processing.",
      },
      {
        q: "How much can a dental practice save on processing fees?",
        a: "Dental practices typically have high average tickets for cosmetic and restorative work. We identify an average of $5,100 in annual savings — higher than many verticals due to transaction size.",
      },
      {
        q: "Can patients pay their remaining balance online?",
        a: "Yes. We offer secure online payment links patients can use to pay balances from any device, reducing front-desk billing time and collection calls.",
      },
    ],
  },
  {
    slug: "fitness",
    name: "Fitness & Gym",
    industryPageSlug: "fitness-payment-processing",
    avgRate: "2.5% – 3.1%",
    avgSavings: "$2,900",
    painPoints: [
      "Monthly recurring membership billing requires reliable card-on-file management",
      "Failed payments and declined cards create manual follow-up work for staff",
      "Flat-rate pricing is inefficient for the mix of card types gym members use",
    ],
    solutions: [
      "Automated recurring billing with secure tokenized card-on-file storage",
      "Automated retry and decline management for failed membership payments",
      "Interchange-plus pricing optimizes across the full range of consumer and debit card types",
    ],
    faqs: [
      {
        q: "What payment processing works best for gyms and fitness studios?",
        a: "Gyms need reliable recurring billing, secure card-on-file storage, and transparent pricing. Liberty Bancard provides all three with interchange-plus pricing that saves more than flat-rate on the debit and standard cards most members use.",
      },
      {
        q: "How do you handle failed membership payments?",
        a: "Our recurring billing system includes automated retry logic for declined transactions, reducing the manual follow-up your staff handles each month.",
      },
      {
        q: "Can members pay online or through a mobile app?",
        a: "Yes. We provide payment gateway integrations that allow members to pay, update card information, and manage their billing profile online.",
      },
    ],
  },
  {
    slug: "hotel",
    name: "Hotel & Hospitality",
    industryPageSlug: "hospitality-payment-processing",
    avgRate: "2.6% – 3.2%",
    avgSavings: "$6,400",
    painPoints: [
      "Pre-authorization and final settlement discrepancies create processing complications",
      "High card-present and card-not-present transaction mix results in inconsistent rates",
      "Business and corporate travel card transactions often fail to qualify for lower interchange",
    ],
    solutions: [
      "Hospitality-specific processing configured for pre-auth and incidental hold workflows",
      "Level II and Level III corporate card acceptance to reduce business travel interchange",
      "Interchange-plus pricing captures actual cost difference between card types and brands",
    ],
    faqs: [
      {
        q: "What payment processing do hotels need?",
        a: "Hotels require processing configured for pre-authorization holds, multi-day settlement, business card optimization, and high-volume card-not-present transactions. Liberty Bancard provides hospitality-specific solutions.",
      },
      {
        q: "How does pre-authorization work for hotel check-in?",
        a: "We configure your system for standard hospitality pre-authorization workflows, including incidental holds that settle to actual charges at checkout without the discrepancy penalties common with poorly configured setups.",
      },
      {
        q: "Can we reduce costs on corporate and business card transactions?",
        a: "Yes. Level II and III processing configuration qualifies corporate card transactions for reduced interchange rates, saving hotels significantly on the high proportion of business travel cards they process.",
      },
    ],
  },
  {
    slug: "barbershop",
    name: "Barbershop",
    industryPageSlug: "salon-spa-payment-processing",
    avgRate: "2.9% – 3.5%",
    avgSavings: "$1,800",
    painPoints: [
      "Tip-heavy transactions increase effective rate when processed on post-auth adjustment",
      "Many barbershops are still paying with flat-rate readers that penalize cash-discount programs",
      "Card-not-present phone bookings incur higher interchange than face-to-face transactions",
    ],
    solutions: [
      "Cash discount program setup allows shops to pass processing costs to card-paying customers",
      "Terminal configuration prompts tips at point-of-sale to minimize post-auth rate inflation",
      "Mobile readers and countertop terminals available for any shop layout",
    ],
    faqs: [
      {
        q: "What is the best payment processing for barbershops?",
        a: "Barbershops benefit from either a cash discount program that offsets processing costs entirely or interchange-plus pricing with tip-optimized terminals. Liberty Bancard helps barbershops choose the right model based on their customer mix.",
      },
      {
        q: "What is a cash discount program for barbershops?",
        a: "A cash discount program adds a small service fee to card transactions while discounting cash payments. This legally offsets your processing costs. Many barbershops eliminate their processing fees entirely with this approach.",
      },
      {
        q: "Do you provide card readers for booth renters?",
        a: "Yes. We can set up individual card readers for booth renters under the shop's master account, with simplified reporting for each chair.",
      },
    ],
  },
  {
    slug: "contractor",
    name: "Contractor & Home Services",
    industryPageSlug: "construction-payment-processing",
    avgRate: "3.1% – 3.8%",
    avgSavings: "$5,600",
    painPoints: [
      "Large project invoices over $5,000 make every rate basis point expensive",
      "Keyed-entry and card-not-present transactions from phone quotes carry penalty rates",
      "Collecting deposits and final payments on job sites requires mobile processing capability",
    ],
    solutions: [
      "Interchange-plus pricing saves significantly more on large project invoices",
      "Mobile card readers and virtual terminal for field and phone payment collection",
      "Competitive keyed-entry rates for phone-collected card numbers",
    ],
    faqs: [
      {
        q: "What is the best payment processing for contractors?",
        a: "Contractors need mobile processing for job sites, competitive keyed-entry rates for phone collections, and interchange-plus pricing that saves more on large invoices. Liberty Bancard provides all three.",
      },
      {
        q: "Can I accept payments on job sites?",
        a: "Yes. Mobile card readers process EMV chip, contactless, and swipe payments anywhere with a cell signal. We set up mobile processing alongside your existing phone and office billing.",
      },
      {
        q: "How do you handle large project deposits and final payments?",
        a: "We configure appropriate transaction limits so large deposits and final payments are processed without flagging. This prevents hold issues common with processors that aren't set up for high-ticket contractor transactions.",
      },
    ],
  },
];

export function getCityData(slug: string): CityData | undefined {
  return CITIES.find((c) => c.slug === slug);
}

export function getVerticalData(slug: string): VerticalData | undefined {
  return VERTICALS.find((v) => v.slug === slug);
}
