/**
 * processor-detector-html-only.ts — MI-04 free enrichment HTML detection.
 *
 * This module is intentionally dependency-free from Serper, paid providers,
 * database, and any network call. It is a pure function that runs only on
 * already-fetched HTML content.
 *
 * Kill-line contract: importing this module must never transitively import
 * the Serper module or any other paid/external API client. The test
 * scripts/test-free-enrichment-killlines.ts verifies this invariant by
 * performing a fresh import and asserting zero outbound network calls.
 *
 * DO NOT add any import that references serper, apollo, outscraper,
 * zerobounce, or any module that itself imports those. The only permitted
 * imports are Node.js built-ins and pure utility code with no network side
 * effects.
 */

// No DB, no serper, no network imports — pure string processing only.

interface ProcessorFingerprint {
  vendor: string;
  signalType: "processor" | "pos" | "booking_platform" | "ecommerce_platform";
  patterns: {
    scripts: RegExp[];
    htmlText: RegExp[];
    metaTags: RegExp[];
  };
  confidence: number;
}

export interface HtmlDetectionResult {
  vendor: string;
  signalType: string;
  detectionMethod: string;
  confidence: number;
  evidence: string;
}

const PROCESSOR_FINGERPRINTS: ProcessorFingerprint[] = [
  {
    vendor: "Square",
    signalType: "processor",
    patterns: {
      scripts: [/squareup\.com/i, /square\.site/i, /squarecdn\.com/i],
      htmlText: [/sq-payment-form/i, /square\s+checkout/i, /powered\s+by\s+square/i, /squareup/i],
      metaTags: [/squareup/i, /square\.site/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "NMI",
    signalType: "processor",
    patterns: {
      scripts: [/secure\.networkmerchants\.com/i, /nmi\.com/i, /gateway\.nmi\.com/i],
      htmlText: [/network\s+merchants/i, /nmi\s+gateway/i, /powered\s+by\s+nmi/i],
      metaTags: [/nmi/i, /networkmerchants/i],
    },
    confidence: 0.75,
  },
  {
    vendor: "Authorize.net",
    signalType: "processor",
    patterns: {
      scripts: [/authorize\.net/i, /anet\.js/i, /acceptjs/i],
      htmlText: [/authorize\.net/i, /authorizenet/i, /powered\s+by\s+authorize/i, /accept\.js/i],
      metaTags: [/authorize\.net/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "WooCommerce",
    signalType: "ecommerce_platform",
    patterns: {
      scripts: [/woocommerce/i, /wc-blocks/i, /wc\.min\.js/i],
      htmlText: [/woocommerce/i, /wc-cart/i, /powered\s+by\s+woocommerce/i, /add-to-cart/i],
      metaTags: [/woocommerce/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Lightspeed",
    signalType: "pos",
    patterns: {
      scripts: [/lightspeedhq\.com/i, /lightspeedpos\.com/i, /ecwid\.com/i],
      htmlText: [/lightspeed\s+restaurant/i, /lightspeed\s+retail/i, /powered\s+by\s+lightspeed/i],
      metaTags: [/lightspeedhq/i, /lightspeed/i],
    },
    confidence: 0.75,
  },
  {
    vendor: "ChowNow",
    signalType: "booking_platform",
    patterns: {
      scripts: [/chownow\.com/i, /ordering\.chownow\.com/i],
      htmlText: [/chownow/i, /order\s+on\s+chownow/i, /powered\s+by\s+chownow/i],
      metaTags: [/chownow/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "DoorDash Storefront",
    signalType: "ecommerce_platform",
    patterns: {
      scripts: [/doordash\.com/i, /order\.doordash\.com/i],
      htmlText: [/doordash\s+storefront/i, /order\s+on\s+doordash/i, /powered\s+by\s+doordash/i],
      metaTags: [/doordash/i],
    },
    confidence: 0.75,
  },
  {
    vendor: "Wix Payments",
    signalType: "processor",
    patterns: {
      scripts: [/wix\.com/i, /static\.parastorage\.com/i, /cashier\.wix\.com/i],
      htmlText: [/wix\s+payments/i, /powered\s+by\s+wix/i, /wixsite/i],
      metaTags: [/wix\.com/i, /wixsite/i],
    },
    confidence: 0.75,
  },
  {
    vendor: "Squarespace Commerce",
    signalType: "ecommerce_platform",
    patterns: {
      scripts: [/squarespace\.com/i, /static\.squarespace\.com/i],
      htmlText: [/squarespace\s+commerce/i, /powered\s+by\s+squarespace/i, /squarespace-checkout/i],
      metaTags: [/squarespace/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Jane",
    signalType: "booking_platform",
    patterns: {
      scripts: [/jane\.app/i, /janeapp\.com/i],
      htmlText: [/jane\s+app/i, /book\s+on\s+jane/i, /powered\s+by\s+jane/i, /janeapp/i],
      metaTags: [/jane\.app/i, /janeapp/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Fresha",
    signalType: "booking_platform",
    patterns: {
      scripts: [/fresha\.com/i, /shedul\.com/i],
      htmlText: [/fresha/i, /book\s+on\s+fresha/i, /powered\s+by\s+fresha/i, /shedul/i],
      metaTags: [/fresha/i, /shedul/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Acuity Scheduling",
    signalType: "booking_platform",
    patterns: {
      scripts: [/acuityscheduling\.com/i, /squarespacescheduling\.com/i],
      htmlText: [/acuity\s+scheduling/i, /book\s+on\s+acuity/i, /powered\s+by\s+acuity/i],
      metaTags: [/acuityscheduling/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Square Appointments",
    signalType: "booking_platform",
    patterns: {
      scripts: [/squareup\.com\/appointments/i, /square\.site\/appointments/i],
      htmlText: [/square\s+appointments/i, /book\s+with\s+square/i, /squareup\.com\/appointments/i],
      metaTags: [/square\s+appointments/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Clover Online Ordering",
    signalType: "ecommerce_platform",
    patterns: {
      scripts: [/clover\.com\/online-ordering/i, /www\.clover\.com\/online/i],
      htmlText: [/clover\s+online\s+ordering/i, /order\s+online.*clover/i, /clover\s+order\s+online/i],
      metaTags: [/clover\s+online/i],
    },
    confidence: 0.78,
  },
  {
    vendor: "Toast Go",
    signalType: "pos",
    patterns: {
      scripts: [/toasttab\.com/i, /pos\.toasttab\.com/i],
      htmlText: [/toast\s+go/i, /toast\s+now/i, /toasttab\.com\/order/i, /order\.toasttab/i],
      metaTags: [/toast\s+go/i, /toasttab/i],
    },
    confidence: 0.78,
  },
  {
    vendor: "Stripe",
    signalType: "processor",
    patterns: {
      scripts: [/js\.stripe\.com/i, /stripe-js/i, /stripe\.js/i],
      htmlText: [/stripe[_-]?elements/i, /stripe[_-]?checkout/i, /powered\s+by\s+stripe/i],
      metaTags: [/stripe/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Toast",
    signalType: "pos",
    patterns: {
      scripts: [/toasttab\.com/i, /toast\.restaurants/i],
      htmlText: [/toast\s+online\s+ordering/i, /order\s+on\s+toast/i, /toasttab/i, /powered\s+by\s+toast/i],
      metaTags: [/toasttab/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Clover",
    signalType: "pos",
    patterns: {
      scripts: [/clover\.com/i, /clover-sdk/i],
      htmlText: [/clover\s+checkout/i, /powered\s+by\s+clover/i, /clover\s+online\s+ordering/i],
      metaTags: [/clover\.com/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Shopify",
    signalType: "ecommerce_platform",
    patterns: {
      scripts: [/cdn\.shopify\.com/i, /shopify\.com\/s/i],
      htmlText: [/shopify[_-]?checkout/i, /powered\s+by\s+shopify/i, /shopify-section/i, /Shopify\.theme/i],
      metaTags: [/shopify/i],
    },
    confidence: 0.90,
  },
  {
    vendor: "PayPal",
    signalType: "processor",
    patterns: {
      scripts: [/paypal\.com\/sdk/i, /paypalobjects\.com/i],
      htmlText: [/paypal[_-]?button/i, /pay\s+with\s+paypal/i, /paypal[_-]?checkout/i],
      metaTags: [/paypal/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Mindbody",
    signalType: "booking_platform",
    patterns: {
      scripts: [/mindbodyonline\.com/i, /healcode\.com/i],
      htmlText: [/mindbody/i, /healcode/i, /book\s+via\s+mindbody/i, /powered\s+by\s+mindbody/i],
      metaTags: [/mindbody/i, /healcode/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Vagaro",
    signalType: "booking_platform",
    patterns: {
      scripts: [/vagaro\.com/i],
      htmlText: [/vagaro/i, /book\s+on\s+vagaro/i, /powered\s+by\s+vagaro/i],
      metaTags: [/vagaro/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Boulevard",
    signalType: "booking_platform",
    patterns: {
      scripts: [/joinblvd\.com/i, /boulevard\.io/i],
      htmlText: [/boulevard/i, /joinblvd/i, /book\s+with\s+boulevard/i],
      metaTags: [/joinblvd/i, /boulevard/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "NCR",
    signalType: "pos",
    patterns: {
      scripts: [/ncr\.com/i, /aloha/i],
      htmlText: [/ncr\s+silver/i, /ncr\s+aloha/i, /powered\s+by\s+ncr/i],
      metaTags: [/ncr/i],
    },
    confidence: 0.75,
  },
];

/**
 * Detect processor/POS/booking/ecommerce signals from raw HTML.
 *
 * Pure function — zero imports from Serper, Apollo, Outscraper, or any
 * external API. Zero network calls. Zero DB writes. Input is a string;
 * output is an array of detections.
 *
 * Used exclusively by the MI-04 free enrichment pipeline via safeFetch.
 */
export function detectProcessorsFromHtmlOnly(html: string, _url: string): HtmlDetectionResult[] {
  if (!html) return [];

  const scriptTags = html.match(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi) || [];
  const scriptSrcs = scriptTags.map(tag => {
    const match = tag.match(/src=["']([^"']+)["']/i);
    return match ? match[1] : "";
  }).filter(Boolean);

  const metaTags = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*>/gi) || [];
  const metaContents = metaTags.map(tag => {
    const match = tag.match(/content=["']([^"']+)["']/i);
    return match ? match[1] : "";
  }).filter(Boolean);

  const results: HtmlDetectionResult[] = [];

  for (const fingerprint of PROCESSOR_FINGERPRINTS) {
    let detected = false;
    let method = "html_text";
    let evidence = "";

    for (const src of scriptSrcs) {
      for (const pattern of fingerprint.patterns.scripts) {
        if (pattern.test(src)) {
          detected = true;
          method = "script";
          evidence = `Script source: ${src.slice(0, 200)}`;
          break;
        }
      }
      if (detected) break;
    }

    if (!detected) {
      for (const pattern of fingerprint.patterns.htmlText) {
        const match = html.match(pattern);
        if (match) {
          detected = true;
          method = "html_text";
          const idx = html.indexOf(match[0]);
          evidence = `HTML match: ...${html.slice(Math.max(0, idx - 30), idx + match[0].length + 30).replace(/<[^>]+>/g, "").trim()}...`;
          break;
        }
      }
    }

    if (!detected) {
      for (const content of metaContents) {
        for (const pattern of fingerprint.patterns.metaTags) {
          if (pattern.test(content)) {
            detected = true;
            method = "html_text";
            evidence = `Meta tag content: ${content.slice(0, 200)}`;
            break;
          }
        }
        if (detected) break;
      }
    }

    if (detected) {
      results.push({
        vendor: fingerprint.vendor,
        signalType: fingerprint.signalType,
        detectionMethod: method,
        confidence: fingerprint.confidence,
        evidence,
      });
    }
  }

  return results;
}
