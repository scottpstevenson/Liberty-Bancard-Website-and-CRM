import { Helmet } from 'react-helmet-async';

interface StructuredData {
  "@context": string;
  "@type": string;
  [key: string]: unknown;
}

interface BreadcrumbItem {
  name: string;
  path: string;
}

interface SEOProps {
  title: string;
  description: string;
  path?: string;
  keywords?: string;
  ogImage?: string;
  twitterImage?: string;
  ogType?: "website" | "article";
  noindex?: boolean;
  canonical?: string;
  hreflang?: { lang: string; href: string }[];
  structuredData?: StructuredData | StructuredData[];
  breadcrumbs?: BreadcrumbItem[];
  article?: {
    publishedTime?: string;
    modifiedTime?: string;
    author?: string;
    section?: string;
    tags?: string[];
  };
}

const BASE_URL = "https://libertybancard.com";
const DEFAULT_OG_IMAGE = `${BASE_URL}/favicon.png`;

export function getOrganizationSchema(): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Liberty Bancard",
    url: BASE_URL,
    logo: `${BASE_URL}/favicon.png`,
    description: "Liberty Bancard provides transparent, statement-based payment processing for businesses. Wholesale pricing, next-day funding, and real human support.",
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+1-954-266-8214",
      contactType: "sales",
      areaServed: "US",
      availableLanguage: "English",
    },
    sameAs: [],
  };
}

export function getWebSiteSchema(): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Liberty Bancard",
    url: BASE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE_URL}/blog?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function getLocalBusinessSchema(): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Liberty Bancard",
    url: BASE_URL,
    logo: `${BASE_URL}/favicon.png`,
    image: `${BASE_URL}/favicon.png`,
    telephone: "+1-954-266-8214",
    description: "Transparent payment processing with statement-based pricing. Serving restaurants, retail, medical, automotive, and more.",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Fort Lauderdale",
      addressRegion: "FL",
      addressCountry: "US",
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "09:00",
        closes: "18:00",
      },
    ],
    priceRange: "$$",
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Payment Processing Services",
      itemListElement: [
        { "@type": "Offer", itemOffered: { "@type": "Service", name: "Statement Review & Analysis" } },
        { "@type": "Offer", itemOffered: { "@type": "Service", name: "Wholesale Interchange-Plus Pricing" } },
        { "@type": "Offer", itemOffered: { "@type": "Service", name: "Cash Discount / 0% Processing Programs" } },
        { "@type": "Offer", itemOffered: { "@type": "Service", name: "Next-Day Funding" } },
        { "@type": "Offer", itemOffered: { "@type": "Service", name: "POS Terminal Equipment" } },
      ],
    },
  };
}

export function getServiceSchema(name: string, description: string, servicePath: string): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name,
    description,
    url: `${BASE_URL}${servicePath}`,
    provider: {
      "@type": "Organization",
      name: "Liberty Bancard",
      url: BASE_URL,
    },
    areaServed: {
      "@type": "Country",
      name: "United States",
    },
  };
}

export function getFAQSchema(faqs: { question: string; answer: string }[]): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function getBreadcrumbSchema(items: BreadcrumbItem[]): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: BASE_URL,
      },
      ...items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 2,
        name: item.name,
        item: `${BASE_URL}${item.path}`,
      })),
    ],
  };
}

export function SEO({
  title,
  description,
  path,
  keywords,
  ogImage,
  twitterImage,
  ogType = "website",
  noindex = false,
  canonical,
  hreflang,
  structuredData,
  breadcrumbs,
  article,
}: SEOProps) {
  const fullTitle = `${title} | Liberty Bancard`;
  const url = path ? `${BASE_URL}${path}` : undefined;
  const canonicalUrl = canonical || url;
  const resolvedOgImage = ogImage || DEFAULT_OG_IMAGE;
  const resolvedTwitterImage = twitterImage || ogImage || DEFAULT_OG_IMAGE;

  const allStructuredData: StructuredData[] = [];

  allStructuredData.push(getOrganizationSchema());

  if (breadcrumbs && breadcrumbs.length > 0) {
    allStructuredData.push(getBreadcrumbSchema(breadcrumbs));
  }

  if (structuredData) {
    if (Array.isArray(structuredData)) {
      allStructuredData.push(...structuredData);
    } else {
      allStructuredData.push(structuredData);
    }
  }

  const structuredDataArray = allStructuredData;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

      {hreflang &&
        hreflang.map(({ lang, href }) => (
          <link key={lang} rel="alternate" hrefLang={lang} href={href} />
        ))}

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType === "article" ? "article" : "website"} />
      {url && <meta property="og:url" content={url} />}
      <meta property="og:image" content={resolvedOgImage} />
      <meta property="og:site_name" content="Liberty Bancard" />

      {article && ogType === "article" && (
        <>
          {article.publishedTime && (
            <meta property="article:published_time" content={article.publishedTime} />
          )}
          {article.modifiedTime && (
            <meta property="article:modified_time" content={article.modifiedTime} />
          )}
          {article.author && <meta property="article:author" content={article.author} />}
          {article.section && <meta property="article:section" content={article.section} />}
          {article.tags &&
            article.tags.map((tag) => (
              <meta key={tag} property="article:tag" content={tag} />
            ))}
        </>
      )}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={resolvedTwitterImage} />

      {structuredDataArray.map((data, index) => (
        <script key={index} type="application/ld+json">
          {JSON.stringify(data)}
        </script>
      ))}
    </Helmet>
  );
}
