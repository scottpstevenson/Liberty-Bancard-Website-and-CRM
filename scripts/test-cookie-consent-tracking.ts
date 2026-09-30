type Call = any[];

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail = "") {
  if (condition) {
    console.log(`PASS: ${label}`);
    passed++;
  } else {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function createBrowserMocks() {
  const gtagCalls: Call[] = [];
  const fbqCalls: Call[] = [];
  const gtag = (...args: any[]) => gtagCalls.push(args);
  const firstScript: any = {
    parentNode: {
      insertBefore: (script: any) => { scripts.push(script); },
    },
  };
  const scripts: any[] = [];
  (globalThis as any).window = {
    gtag,
    fbq: (...args: any[]) => fbqCalls.push(args),
    dataLayer: [],
    location: { pathname: "/" },
  };
  (globalThis as any).document = {
    head: { appendChild: (script: any) => { scripts.push(script); } },
    createElement: () => ({ async: false, src: "", parentNode: null }),
    getElementsByTagName: () => [firstScript],
  };
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
  };
  return { gtagCalls, fbqCalls };
}

async function loadTracking(scenario: string) {
  const mocks = createBrowserMocks();
  process.env.VITE_FB_PIXEL_ID = "test-pixel-id";
  const tracking = await import(`../client/src/lib/tracking.ts?scenario=${scenario}`);
  return { ...mocks, tracking };
}

function consentUpdate(calls: Call[]) {
  return calls.find((args) => args[0] === "consent" && args[1] === "update")?.[2];
}

async function runTests() {
  {
    const { gtagCalls, fbqCalls, tracking } = await loadTracking("reject");
    tracking.applyConsentPreferences({ analytics: false, marketing: false });
    const update = consentUpdate(gtagCalls);
    assert(
      update?.analytics_storage === "denied" &&
        update?.ad_storage === "denied" &&
        update?.ad_user_data === "denied" &&
        update?.ad_personalization === "denied",
      "Reject sends denied updates for analytics and all ad consent keys",
    );
    assert(!fbqCalls.some((args) => args[0] === "init"), "Reject does not initialize Meta Pixel");
  }

  {
    const { gtagCalls, fbqCalls, tracking } = await loadTracking("accept");
    tracking.applyConsentPreferences({ analytics: true, marketing: true });
    const update = consentUpdate(gtagCalls);
    assert(
      update?.analytics_storage === "granted" &&
        update?.ad_storage === "granted" &&
        update?.ad_user_data === "granted" &&
        update?.ad_personalization === "granted",
      "Accept sends granted updates for analytics and all ad consent keys",
    );
    assert(fbqCalls.filter((args) => args[0] === "init").length === 1, "Accept initializes Meta Pixel exactly once");
  }

  {
    const { gtagCalls, fbqCalls, tracking } = await loadTracking("custom");
    tracking.applyConsentPreferences({ analytics: true, marketing: false });
    const update = consentUpdate(gtagCalls);
    assert(
      update?.analytics_storage === "granted" &&
        update?.ad_storage === "denied" &&
        update?.ad_user_data === "denied" &&
        update?.ad_personalization === "denied",
      "Custom consent grants analytics while denying all ad consent keys",
    );
    assert(!fbqCalls.some((args) => args[0] === "init"), "Custom analytics-only consent does not initialize Meta Pixel");
  }

  {
    const { fbqCalls, tracking } = await loadTracking("preference-change");
    tracking.applyConsentPreferences({ analytics: false, marketing: true });
    tracking.applyConsentPreferences({ analytics: true, marketing: true });
    assert(fbqCalls.filter((args) => args[0] === "init").length === 1, "Repeated marketing grants initialize Meta Pixel only once");
    assert(fbqCalls.filter((args) => args[0] === "track" && args[1] === "PageView").length === 1, "Repeated marketing grants fire one Meta PageView");
  }

  console.log(`\nCookie consent tracking tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((error) => {
  console.error("FAIL: Cookie consent tracking test runner", error);
  process.exit(1);
});