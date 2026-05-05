import { Helmet } from 'react-helmet-async';

export interface StructuredData {
  "@context": string;
  "@type": string;
  [key: string]: unknown;
}

interface BreadcrumbItem {
  name: string;
  path: string;
}

interface ArticleSchemaInput {
  title: string;
  description: string;
  slug: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
  image?: string;
  section?: string;
  tags?: string[];
}

interface ProductSchemaInput {
  name: string;
  description: string;
  path: string;
  image?: string;
  brand?: string;
  sku?: string;
  offers?: {
    price?: string;
    priceCurrency?: string;
    availability?: string;
    url?: string;
  };
  aggregateRating?: {
    ratingValue: number;
    reviewCount: number;
    bestRating?: number;
  };
}

interface ReviewSchemaInput {
  itemName: string;
  itemPath: string;
  ratingValue: number;
  bestRating?: number;
  reviewCount?: number;
  reviews?: Array<{
    author: string;
    rating: number;
    body: string;
    date?: string;
  }>;
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
  ogTemplate?: "default" | "article" | "industry" | "compare" | "location" | "service";
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

// Webmaster verification tags (GSC_VERIFICATION / BING_VERIFICATION) are
// injected server-side by ssrShared.ts for SSR-rendered pages. SPA-shell
// pages don't need them here because search crawlers receive the SSR HTML.

function slugify(input: string): string {
  return (input || "page")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
}

function programmaticOgUrl(template: string, slugSource: string): string {
  return `${BASE_URL}/og/${template}/${slugify(slugSource)}.png`;
}

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

export function getServiceSchema(
  name: string,
  description: string,
  servicePath: string,
  options?: { ratingValue?: number; reviewCount?: number },
): StructuredData {
  const schema: StructuredData = {
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
  if (options?.ratingValue !== undefined && options?.reviewCount !== undefined) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: options.ratingValue,
      reviewCount: options.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }
  return schema;
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

export function getArticleSchema(input: ArticleSchemaInput): StructuredData {
  const url = `${BASE_URL}/blog/${input.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    image: input.image || `${BASE_URL}/og/article/${slugify(input.slug)}.png`,
    datePublished: input.publishedTime,
    dateModified: input.modifiedTime || input.publishedTime,
    author: {
      "@type": "Organization",
      name: input.author || "Liberty Bancard",
    },
    publisher: {
      "@type": "Organization",
      name: "Liberty Bancard",
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/favicon.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    ...(input.section ? { articleSection: input.section } : {}),
    ...(input.tags && input.tags.length ? { keywords: input.tags.join(", ") } : {}),
  };
}

export function getProductSchema(input: ProductSchemaInput): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description: input.description,
    image: input.image || `${BASE_URL}/favicon.png`,
    brand: {
      "@type": "Brand",
      name: input.brand || "Liberty Bancard",
    },
    ...(input.sku ? { sku: input.sku } : {}),
    ...(input.offers
      ? {
          offers: {
            "@type": "Offer",
            price: input.offers.price,
            priceCurrency: input.offers.priceCurrency || "USD",
            availability: input.offers.availability || "https://schema.org/InStock",
            url: input.offers.url || `${BASE_URL}${input.path}`,
          },
        }
      : {}),
    ...(input.aggregateRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: input.aggregateRating.ratingValue,
            reviewCount: input.aggregateRating.reviewCount,
            bestRating: input.aggregateRating.bestRating || 5,
          },
        }
      : {}),
  };
}

export function getReviewSchema(input: ReviewSchemaInput): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.itemName,
    url: `${BASE_URL}${input.itemPath}`,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: input.ratingValue,
      bestRating: input.bestRating || 5,
      reviewCount: input.reviewCount || (input.reviews ? input.reviews.length : 1),
    },
    ...(input.reviews && input.reviews.length
      ? {
          review: input.reviews.map((r) => ({
            "@type": "Review",
            author: { "@type": "Person", name: r.author },
            reviewRating: {
              "@type": "Rating",
              ratingValue: r.rating,
              bestRating: input.bestRating || 5,
            },
            reviewBody: r.body,
            ...(r.date ? { datePublished: r.date } : {}),
          })),
        }
      : {}),
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
  ogTemplate,
  article,
}: SEOProps) {
  const fullTitle = `${title} | Liberty Bancard`;
  const url = path ? `${BASE_URL}${path}` : undefined;
  const canonicalUrl = canonical || url;

  const template = ogTemplate || (ogType === "article" ? "article" : "default");
  const slugSource = path ? path.replace(/^\//, "").replace(/\/$/, "") || "home" : title;
  const fallbackOg = programmaticOgUrl(template, slugSource);

  const resolvedOgImage = ogImage || fallbackOg;
  const resolvedTwitterImage = twitterImage || ogImage || fallbackOg;

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

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

      {/* Default hreflang for US English when not overridden */}
      {!hreflang && canonicalUrl && (
        <link rel="alternate" hrefLang="en-US" href={canonicalUrl} />
      )}
      {!hreflang && canonicalUrl && (
        <link rel="alternate" hrefLang="x-default" href={canonicalUrl} />
      )}

      {hreflang &&
        hreflang.map(({ lang, href }) => (
          <link key={lang} rel="alternate" hrefLang={lang} href={href} />
        ))}

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType === "article" ? "article" : "website"} />
      {url && <meta property="og:url" content={url} />}
      <meta property="og:image" content={resolvedOgImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
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

      {allStructuredData.map((data, index) => (
        <script key={index} type="application/ld+json">
          {JSON.stringify(data)}
        </script>
      ))}
    </Helmet>
  );
}
