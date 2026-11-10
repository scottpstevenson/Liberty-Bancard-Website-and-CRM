// One location contract for every renderer. The server documents (server/ssr/locations.ts), the
// client routes (client/src/pages/LocationHubPage.tsx and LocationIndustryPage.tsx), the sitemap and
// /areas-served all read this module, so a city or industry exists in all of them or in none.
//
// What this module is allowed to say: a verified place name, an existing industry route, and neutral
// questions about payment workflows. A place name does not prove an office, a local team or local
// customers, so there is no business count, population, average rate, typical savings figure, funding
// promise, headquarters or street address anywhere in this file (W-D, WD-R01 and WD-R02).

import { claimText } from "./public-claims";
import { ABOUT_CONTACT_PATH } from "./public-contact-content";

export type LocationRegion = "south-florida" | "florida" | "nationwide";

export interface LocationCity {
  slug: string;
  name: string;
  state: string;
  stateName: string;
  region: LocationRegion;
}

export interface LocationVertical {
  slug: string;
  name: string;
  /** The existing /industries/:slug route that covers this vertical. */
  industrySlug: string;
  /** What the buyer is usually trying to do at checkout, in invoice or online. */
  workflow: string;
  topics: readonly { title: string; description: string }[];
  faqs: readonly { question: string; answer: string }[];
}

const FL = "Florida";

export const LOCATION_CITIES: readonly LocationCity[] = [
  { slug: "miami", name: "Miami", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "fort-lauderdale", name: "Fort Lauderdale", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "miami-beach", name: "Miami Beach", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "boca-raton", name: "Boca Raton", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "west-palm-beach", name: "West Palm Beach", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "pompano-beach", name: "Pompano Beach", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "hollywood-fl", name: "Hollywood", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "coral-springs", name: "Coral Springs", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "plantation", name: "Plantation", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "hialeah", name: "Hialeah", state: "FL", stateName: FL, region: "south-florida" },
  { slug: "tampa", name: "Tampa", state: "FL", stateName: FL, region: "florida" },
  { slug: "orlando", name: "Orlando", state: "FL", stateName: FL, region: "florida" },
  { slug: "jacksonville", name: "Jacksonville", state: "FL", stateName: FL, region: "florida" },
  { slug: "sarasota", name: "Sarasota", state: "FL", stateName: FL, region: "florida" },
  { slug: "st-petersburg", name: "St. Petersburg", state: "FL", stateName: FL, region: "florida" },
  { slug: "clearwater", name: "Clearwater", state: "FL", stateName: FL, region: "florida" },
  { slug: "cape-coral", name: "Cape Coral", state: "FL", stateName: FL, region: "florida" },
  { slug: "fort-myers", name: "Fort Myers", state: "FL", stateName: FL, region: "florida" },
  { slug: "gainesville", name: "Gainesville", state: "FL", stateName: FL, region: "florida" },
  { slug: "pensacola", name: "Pensacola", state: "FL", stateName: FL, region: "florida" },
  { slug: "houston", name: "Houston", state: "TX", stateName: "Texas", region: "nationwide" },
  { slug: "dallas", name: "Dallas", state: "TX", stateName: "Texas", region: "nationwide" },
  { slug: "austin", name: "Austin", state: "TX", stateName: "Texas", region: "nationwide" },
  { slug: "atlanta", name: "Atlanta", state: "GA", stateName: "Georgia", region: "nationwide" },
  { slug: "las-vegas", name: "Las Vegas", state: "NV", stateName: "Nevada", region: "nationwide" },
  { slug: "phoenix", name: "Phoenix", state: "AZ", stateName: "Arizona", region: "nationwide" },
  { slug: "nashville", name: "Nashville", state: "TN", stateName: "Tennessee", region: "nationwide" },
  { slug: "charlotte", name: "Charlotte", state: "NC", stateName: "North Carolina", region: "nationwide" },
  { slug: "denver", name: "Denver", state: "CO", stateName: "Colorado", region: "nationwide" },
  { slug: "chicago", name: "Chicago", state: "IL", stateName: "Illinois", region: "nationwide" },
];

export const LOCATION_VERTICALS: readonly LocationVertical[] = [
  {
    slug: "restaurant",
    name: "Restaurant",
    industrySlug: "restaurant-payment-processing",
    workflow: "Table service, counter orders, tips added after the card is read, and busy-hour checkout.",
    topics: [
      { title: "Tips and split checks", description: "Ask how tip adjustments and split checks are priced, and how they appear on the statement." },
      { title: "Your point of sale", description: "Your ordering and POS setup comes first. Bring the name and version so we can confirm what is supported." },
      { title: "Busy-hour support", description: "Ask who you reach when a terminal stops working during service, and when they are available." },
    ],
    faqs: [
      { question: "What should a restaurant ask before changing processors?", answer: "Ask how tips, split checks and keyed orders are priced, which fees stay with your POS vendor, and what your current agreement says about ending it. A statement review lays these out line by line." },
      { question: "Can I keep my current POS system?", answer: claimText("compat.inquiry") },
      { question: "Is a cash discount program an option for a restaurant?", answer: claimText("program.overview") },
    ],
  },
  {
    slug: "auto-repair",
    name: "Auto Repair",
    industrySlug: "auto-repair-payment-processing",
    workflow: "Larger repair invoices, parts deposits, phone approvals and keyed-in card numbers.",
    topics: [
      { title: "Larger invoices", description: "A percentage fee matters more on a large repair bill. Ask how both the percentage and any per-transaction fee apply." },
      { title: "Keyed-in payments", description: "Ask how phone and keyed-in payments are priced compared with card-present ones." },
      { title: "Commercial and fleet cards", description: "Ask how commercial and fleet cards are handled and whether any extra data is needed to qualify." },
    ],
    faqs: [
      { question: "What should an auto repair shop look at on its statement?", answer: "Look at how large tickets, keyed-in payments and commercial cards are charged, and which equipment or software fees are on the statement. A review separates these for you." },
      { question: "Will large repair invoices be held?", answer: claimText("funding.availability") },
      { question: "Can I take a deposit before parts are ordered?", answer: "Taking a card deposit depends on your setup and your account approval. Tell us how you take deposits today and we will confirm what is available." },
    ],
  },
  {
    slug: "healthcare",
    name: "Healthcare",
    industrySlug: "healthcare-payment-processing",
    workflow: "Front-desk copays, balances after insurance, payment plans and patient statements.",
    topics: [
      { title: "Front-desk and balance payments", description: "Ask how in-office and online balance payments are processed and reported." },
      { title: "Recurring plans", description: "If you collect on a schedule, ask how cards are stored and how a failed payment is handled." },
      { title: "Your own obligations", description: "Payment data and patient records are handled separately. Ask your compliance advisor what applies to your practice." },
    ],
    faqs: [
      { question: "What should a medical practice ask before changing processors?", answer: "Ask how copays, balances and recurring plans are priced, how reports reconcile with your billing software, and which fees stay with that software. A statement review lists the current ones." },
      { question: "Is this a compliance review?", answer: "No. A statement review looks at processing costs. Questions about patient-record privacy rules go to your own compliance advisor." },
      { question: "Can I keep my practice management software?", answer: claimText("compat.inquiry") },
    ],
  },
  {
    slug: "salon",
    name: "Salon & Spa",
    industrySlug: "salon-spa-payment-processing",
    workflow: "Appointments, tips, retail product sales and cards kept on file for no-show policies.",
    topics: [
      { title: "Tips at checkout", description: "Ask when the tip is entered and how tip adjustments after the card is read are priced." },
      { title: "Cards on file", description: "If you charge for late cancellations, ask how stored cards are handled and what your clients agree to." },
      { title: "Booking software", description: "Your booking and payment tools may be bundled. Ask which fees come from the software and which from processing." },
    ],
    faqs: [
      { question: "What should a salon or spa review on its statement?", answer: "Review how tips, retail sales and stored-card charges appear, and whether your booking software adds its own payment fees. A statement review separates them." },
      { question: "Can I keep my booking software?", answer: claimText("compat.inquiry") },
      { question: "Can I charge a no-show fee?", answer: "That depends on your booking software, your client agreement and your account setup. Tell us how you handle cancellations today and we will confirm what applies." },
    ],
  },
  {
    slug: "retail",
    name: "Retail",
    industrySlug: "retail-payment-processing",
    workflow: "Counter checkout, contactless payments, returns and one or more store locations.",
    topics: [
      { title: "Card types you see", description: "Debit, credit and rewards cards are priced differently. Ask how each is charged under the pricing model you are offered." },
      { title: "Equipment terms", description: claimText("equipment.agreement.summary") },
      { title: "More than one location", description: "Ask whether reports and pricing are shared across locations or set up one by one." },
    ],
    faqs: [
      { question: "What should a retailer ask before changing processors?", answer: "Ask how debit and credit cards are priced, what the equipment arrangement requires, and what your current agreement says about ending it. A statement review shows your current charges." },
      { question: "Can I use my existing terminals?", answer: claimText("compat.inquiry") },
      { question: "What if I have more than one store?", answer: "Bring a statement for each location if they are billed separately. We will note how each one is set up." },
    ],
  },
  {
    slug: "dental",
    name: "Dental",
    industrySlug: "dental-payment-processing",
    workflow: "Treatment-plan payments, copays and balances after insurance, and deposits before larger procedures.",
    topics: [
      { title: "Larger treatment payments", description: "Ask how fees apply to a large single payment compared with several smaller ones." },
      { title: "Patient payment plans", description: "If you split larger balances, ask how stored cards are used and who sets the schedule." },
      { title: "Reconciliation", description: "Ask for a sample report and compare it with how your front desk reconciles today." },
    ],
    faqs: [
      { question: "What should a dental practice ask before changing processors?", answer: "Ask how large treatment payments and stored-card plans are priced, how reports reconcile with your practice software and what the agreement says about equipment and ending it." },
      { question: "Does this cover patient financing programs?", answer: "Third-party patient financing is separate from card processing. Tell us what you use today and we will say what a statement review does and does not cover." },
      { question: "Can I keep my practice management software?", answer: claimText("compat.inquiry") },
    ],
  },
  {
    slug: "fitness",
    name: "Fitness & Gym",
    industrySlug: "fitness-payment-processing",
    workflow: "Monthly memberships, class packs, front-desk sales and cards kept on file.",
    topics: [
      { title: "Recurring billing", description: "Ask who runs the recurring charges, your software or the processor, and what each charges." },
      { title: "Failed payments", description: "Ask how declined membership payments are retried and what is shown to your staff." },
      { title: "Software fees", description: "Membership software often adds its own payment fees. Ask which fees come from the software." },
    ],
    faqs: [
      { question: "What should a gym ask before changing processors?", answer: "Ask who owns the recurring billing, how failed payments are retried, which fees come from your membership software and what the agreement says about ending it." },
      { question: "Can I keep my membership software?", answer: claimText("compat.inquiry") },
      { question: "Can members update their card online?", answer: "That depends on your membership software and the gateway it uses. Tell us your platform and we will confirm what is supported." },
    ],
  },
  {
    slug: "hotel",
    name: "Hotel & Hospitality",
    industrySlug: "hospitality-payment-processing",
    workflow: "Check-in holds, final charges at checkout, group and event billing and reservations taken by phone.",
    topics: [
      { title: "Holds and final charges", description: "Ask how a hold at check-in becomes the final charge and what happens when the amounts differ." },
      { title: "Reservations by phone or online", description: "Cards that are not present at the desk are priced differently. Ask how each channel is charged." },
      { title: "Group and event billing", description: "Ask how deposits, master billing and event payments are handled and reported." },
    ],
    faqs: [
      { question: "What should a hotel ask before changing processors?", answer: "Ask how holds, final charges and reservations taken remotely are priced, how your property system connects, and what the agreement says about ending it." },
      { question: "Can I keep my property management system?", answer: claimText("compat.inquiry") },
      { question: "Can corporate cards be priced differently?", answer: "Card types can be priced differently. A statement review shows how the cards you accept appear on your current statement." },
    ],
  },
  {
    slug: "barbershop",
    name: "Barbershop",
    industrySlug: "salon-spa-payment-processing",
    workflow: "Walk-ins and booked cuts, tips on nearly every sale, and chairs rented by independent barbers.",
    topics: [
      { title: "Tips and cash", description: "Ask how tips on card payments are handled and whether a cash discount program is an option where you are." },
      { title: "Chair renters", description: "If chairs are rented, ask who is responsible for each barber's payments and how they are reported." },
      { title: "Readers and terminals", description: "Ask what equipment is offered, what it costs and what the agreement says about returning it." },
    ],
    faqs: [
      { question: "What should a barbershop ask before changing processors?", answer: "Ask how tips and keyed-in payments are priced, which equipment terms apply and what your current agreement says about ending it. A statement review shows your current charges." },
      { question: "Is a cash discount program an option?", answer: claimText("program.overview") },
      { question: "Can each barber take payments separately?", answer: "That depends on how the account is set up and approved. Tell us how your shop is organized and we will confirm what is possible." },
    ],
  },
  {
    slug: "contractor",
    name: "Contractor & Home Services",
    industrySlug: "construction-payment-processing",
    workflow: "Deposits, progress payments, payments on the job site and invoices paid by card.",
    topics: [
      { title: "Deposits and progress payments", description: "Ask how a large deposit or progress payment is priced and whether it can be held." },
      { title: "Payments in the field", description: "Ask what mobile options exist and how a payment taken by phone is priced." },
      { title: "Invoice payments", description: "If clients pay invoices online, ask how the payment link or portal is provided and what it costs." },
    ],
    faqs: [
      { question: "What should a contractor ask before changing processors?", answer: "Ask how large deposits and progress payments are priced, how payments taken in the field or by phone are charged and what your current agreement says about ending it." },
      { question: "Will a large deposit be held?", answer: claimText("funding.availability") },
      { question: "Can I take payments on a job site?", answer: "Mobile payment options depend on your account and equipment. Tell us how you take payments today and we will confirm what is available." },
    ],
  },
];

// Map-based lookups so request-controlled values such as "constructor" or "__proto__" never resolve.
const CITY_BY_SLUG = new Map(LOCATION_CITIES.map((city) => [city.slug, city]));
const VERTICAL_BY_SLUG = new Map(LOCATION_VERTICALS.map((vertical) => [vertical.slug, vertical]));

export function getLocationCity(slug: string | undefined): LocationCity | undefined {
  return slug === undefined ? undefined : CITY_BY_SLUG.get(slug);
}

export function getLocationVertical(slug: string | undefined): LocationVertical | undefined {
  return slug === undefined ? undefined : VERTICAL_BY_SLUG.get(slug);
}

/** Every city is valid with every vertical; the check exists so both renderers share one decision. */
export function isValidLocationCombination(citySlug: string | undefined, verticalSlug: string | undefined): boolean {
  return getLocationCity(citySlug) !== undefined && getLocationVertical(verticalSlug) !== undefined;
}

export const locationHubPath = (citySlug: string): string => `/locations/${citySlug}`;
export const locationDetailPath = (citySlug: string, verticalSlug: string): string => `/locations/${citySlug}/${verticalSlug}`;

/** The 30 hub paths followed by the 300 detail paths: the whole retained location inventory. */
export const LOCATION_HUB_PATHS: readonly string[] = LOCATION_CITIES.map((city) => locationHubPath(city.slug));
export const LOCATION_DETAIL_PATHS: readonly string[] = LOCATION_CITIES.flatMap((city) =>
  LOCATION_VERTICALS.map((vertical) => locationDetailPath(city.slug, vertical.slug)),
);
export const LOCATION_ALL_PATHS: readonly string[] = [...LOCATION_HUB_PATHS, ...LOCATION_DETAIL_PATHS];

export const LOCATION_REGION_LABELS: Record<LocationRegion, string> = {
  "south-florida": "South Florida",
  florida: "Elsewhere in Florida",
  nationwide: "Nationwide",
};

export const LOCATION_REGION_ORDER: readonly LocationRegion[] = ["south-florida", "florida", "nationwide"];

export function citiesInRegion(region: LocationRegion): readonly LocationCity[] {
  return LOCATION_CITIES.filter((city) => city.region === region);
}

// ── Page content ───────────────────────────────────────────────────────────

export const LOCATION_SEED_SENTENCE = (placeLabel: string): string => `Payment processing for businesses in ${placeLabel}.`;
export const LOCATION_BODY_SENTENCE =
  "Explore processing options, a statement review and terminal-program eligibility for your business.";

export const LOCATION_COVERAGE_NOTE =
  "A statement review works from your own processing statement, so it does not depend on where your business is. This page does not mean Liberty Bancard has an office, a local team or other customers in this city.";

export interface LocationAction {
  label: string;
  href: string;
}

export interface LocationLink {
  label: string;
  href: string;
}

export interface LocationDetailContent {
  citySlug: string;
  verticalSlug: string;
  cityName: string;
  state: string;
  stateName: string;
  verticalName: string;
  canonicalPath: string;
  title: string;
  metaDescription: string;
  keywords: string;
  badge: string;
  h1: string;
  lead: string;
  industryHref: string;
  hubHref: string;
  workflowHeading: string;
  workflow: string;
  topicsHeading: string;
  topics: readonly { title: string; description: string }[];
  coverageNote: string;
  faqHeading: string;
  faqs: readonly { question: string; answer: string }[];
  primaryAction: LocationAction;
  secondaryAction: LocationAction;
  ctaHeading: string;
  ctaBody: string;
  citiesHeading: string;
  relatedCities: readonly LocationLink[];
  verticalsHeading: string;
  relatedVerticals: readonly LocationLink[];
}

export interface LocationHubContent {
  citySlug: string;
  cityName: string;
  state: string;
  stateName: string;
  canonicalPath: string;
  title: string;
  metaDescription: string;
  keywords: string;
  badge: string;
  h1: string;
  lead: string;
  coverageNote: string;
  verticalsHeading: string;
  verticalsIntro: string;
  verticals: readonly { slug: string; name: string; summary: string; href: string }[];
  primaryAction: LocationAction;
  secondaryAction: LocationAction;
  ctaHeading: string;
  ctaBody: string;
}

const PRIMARY_ACTION: LocationAction = { label: "Get a free statement review", href: "/upload-statement" };
const SECONDARY_ACTION: LocationAction = { label: "Ask a question without a statement", href: `${ABOUT_CONTACT_PATH}#inquiry` };

const RELATED_CITY_LIMIT = 12;

function plainName(name: string): string {
  return name.replace(/\s*&\s*/g, " and ");
}

function relatedCityLinks(city: LocationCity, vertical: LocationVertical): LocationLink[] {
  const sameState = LOCATION_CITIES.filter((c) => c.slug !== city.slug && c.state === city.state);
  const otherState = LOCATION_CITIES.filter((c) => c.slug !== city.slug && c.state !== city.state);
  return [...sameState, ...otherState].slice(0, RELATED_CITY_LIMIT).map((c) => ({
    label: `${c.name}, ${c.state}`,
    href: locationDetailPath(c.slug, vertical.slug),
  }));
}

/** Longest document title the site's SEO audit accepts (the brand suffix counts). */
export const LOCATION_TITLE_MAX = 70;
const LOCATION_TITLE_BRAND = "Liberty Bancard";

/**
 * The document title of a location page: the page title plus the brand suffix when the whole fits the
 * audit limit, otherwise the page title alone (the longest industry names with the longest city names).
 * The server documents and the React pages both use it, so they carry the same title.
 */
export function locationDocumentTitle(title: string): string {
  const withBrand = `${title} | ${LOCATION_TITLE_BRAND}`;
  return withBrand.length <= LOCATION_TITLE_MAX ? withBrand : title;
}

export function buildLocationDetail(citySlug: string, verticalSlug: string): LocationDetailContent | null {
  const city = getLocationCity(citySlug);
  const vertical = getLocationVertical(verticalSlug);
  if (!city || !vertical) return null;

  const place = `${city.name}, ${city.state}`;
  const vName = plainName(vertical.name);
  const vLower = vName.toLowerCase();

  return {
    citySlug: city.slug,
    verticalSlug: vertical.slug,
    cityName: city.name,
    state: city.state,
    stateName: city.stateName,
    verticalName: vName,
    canonicalPath: locationDetailPath(city.slug, vertical.slug),
    title: `${vName} Payment Processing in ${place}`,
    metaDescription: `${LOCATION_SEED_SENTENCE(place)} ${LOCATION_BODY_SENTENCE}`,
    keywords: `${vLower} payment processing ${city.name}, ${vLower} merchant services ${place}, payment processing ${city.name} ${city.stateName}`,
    badge: `${city.name}, ${city.stateName}`,
    h1: `${vName} Payment Processing in ${place}`,
    lead: `${LOCATION_SEED_SENTENCE(place)} ${LOCATION_BODY_SENTENCE}`,
    industryHref: `/industries/${vertical.industrySlug}`,
    hubHref: locationHubPath(city.slug),
    workflowHeading: `How ${vLower} businesses take payments`,
    workflow: vertical.workflow,
    topicsHeading: `What to ask about ${vLower} payment processing`,
    topics: vertical.topics,
    coverageNote: LOCATION_COVERAGE_NOTE,
    faqHeading: `${vName} payment processing in ${city.name}: questions`,
    faqs: vertical.faqs,
    primaryAction: PRIMARY_ACTION,
    secondaryAction: SECONDARY_ACTION,
    ctaHeading: `${city.name} ${vLower} owners: see what you are paying`,
    ctaBody: `${claimText("review.cost.free", "page")} ${claimText("review.process.summary", "page")}`,
    citiesHeading: `${vName} payment processing in other cities`,
    relatedCities: relatedCityLinks(city, vertical),
    verticalsHeading: `Other industries in ${city.name}`,
    relatedVerticals: LOCATION_VERTICALS.filter((v) => v.slug !== vertical.slug).map((v) => ({
      label: plainName(v.name),
      href: locationDetailPath(city.slug, v.slug),
    })),
  };
}

export function buildLocationHub(citySlug: string): LocationHubContent | null {
  const city = getLocationCity(citySlug);
  if (!city) return null;
  const place = `${city.name}, ${city.state}`;

  return {
    citySlug: city.slug,
    cityName: city.name,
    state: city.state,
    stateName: city.stateName,
    canonicalPath: locationHubPath(city.slug),
    title: `Payment Processing in ${place}`,
    metaDescription: `${LOCATION_SEED_SENTENCE(place)} ${LOCATION_BODY_SENTENCE}`,
    keywords: `payment processing ${city.name}, merchant services ${place}, payment processing ${city.name} ${city.stateName}`,
    badge: `${city.name}, ${city.stateName}`,
    h1: `Payment Processing in ${place}`,
    lead: `${LOCATION_SEED_SENTENCE(place)} ${LOCATION_BODY_SENTENCE}`,
    coverageNote: LOCATION_COVERAGE_NOTE,
    verticalsHeading: `Payment processing by industry in ${city.name}`,
    verticalsIntro: "Choose your industry to see what to ask before you change processors.",
    verticals: LOCATION_VERTICALS.map((v) => ({
      slug: v.slug,
      name: plainName(v.name),
      summary: v.workflow,
      href: locationDetailPath(city.slug, v.slug),
    })),
    primaryAction: PRIMARY_ACTION,
    secondaryAction: SECONDARY_ACTION,
    ctaHeading: `${city.name} business owners: see what you are paying`,
    ctaBody: `${claimText("review.cost.free", "page")} ${claimText("review.process.summary", "page")}`,
  };
}

// ── /areas-served ──────────────────────────────────────────────────────────

export interface AreasServedCity {
  slug: string;
  label: string;
  hubHref: string;
  /** Industry links are listed only for the primary region; elsewhere the hub page lists them. */
  verticals: readonly LocationLink[];
}

export interface AreasServedGroup {
  region: LocationRegion;
  heading: string;
  intro: string;
  cities: readonly AreasServedCity[];
}

const AREAS_SERVED_INTROS: Record<LocationRegion, string> = {
  "south-florida": "South Florida is the primary focus. Choose a city, then your industry.",
  florida: "Other Florida cities with their own page.",
  nationwide: "Nationwide service is secondary. These pages list the same questions to ask before you change processors.",
};

export function buildAreasServed() {
  const groups: AreasServedGroup[] = LOCATION_REGION_ORDER.map((region) => ({
    region,
    heading: LOCATION_REGION_LABELS[region],
    intro: AREAS_SERVED_INTROS[region],
    cities: citiesInRegion(region).map((city) => ({
      slug: city.slug,
      label: `${city.name}, ${city.state}`,
      hubHref: locationHubPath(city.slug),
      verticals:
        region === "south-florida"
          ? LOCATION_VERTICALS.map((v) => ({ label: `${plainName(v.name)} Payment Processing`, href: locationDetailPath(city.slug, v.slug) }))
          : [],
    })),
  }));

  return {
    path: "/areas-served",
    title: "Payment Processing by City & Industry",
    metaDescription:
      "Where Liberty Bancard payment processing pages apply. South Florida is the primary focus; pages for other Florida cities and cities across the United States are listed after it.",
    h1: "Payment Processing by City & Industry",
    badge: "Areas served",
    lead: "South Florida is Liberty Bancard's primary focus, and nationwide service is secondary. Find your city, then your industry.",
    coverageNote: LOCATION_COVERAGE_NOTE,
    groupsHeading: "Choose your city",
    groups,
    industriesHeading: "Browse by industry",
    industriesIntro: "Each industry page covers what to ask before you change processors.",
    industries: LOCATION_VERTICALS.map((v) => ({
      label: `${plainName(v.name)} payment processing`,
      href: `/industries/${v.industrySlug}`,
    })),
    ctaHeading: "Business outside these cities?",
    ctaBody: `${claimText("review.cost.free", "page")} A statement review works from your own statement, wherever your business is.`,
    primaryAction: PRIMARY_ACTION,
    secondaryAction: { label: "Contact us", href: ABOUT_CONTACT_PATH },
  };
}

export type AreasServedContent = ReturnType<typeof buildAreasServed>;
