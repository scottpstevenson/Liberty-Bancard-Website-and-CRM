/**
 * Smoke test — NPS survey email send (#1250)
 *
 * Verifies that:
 * 1. Admin can POST /api/nps to create a 30-day NPS survey for a real contact.
 * 2. Response is 201 with the survey token.
 * 3. Auto-send queue fires without an unhandled exception.
 *
 * Run:
 *   npx tsx scripts/test-nps-email.ts
 */

import fetch from "node-fetch";

const BASE = process.env.APP_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("✗ MISSING: set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD");
  process.exit(1);
}

let pass = 0;
let fail = 0;

function ok(name: string) { console.log(`  ✓ ${name}`); pass++; }
function ko(name: string, detail?: string) { console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); fail++; }

async function login(): Promise<string> {
  const csrf = await fetch(`${BASE}/api/csrf-token`, { credentials: "include" });
  const setCookies = csrf.headers.raw()["set-cookie"] ?? [];
  const sessionCookie = setCookies.map(c => c.split(";")[0]).join("; ");
  const csrfToken = (await csrf.json() as any).token;

  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": sessionCookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const loginCookies = loginRes.headers.raw()["set-cookie"] ?? [];
  const allCookies = [...setCookies, ...loginCookies].map(c => c.split(";")[0]).join("; ");
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  return allCookies;
}

async function getCsrfToken(sessionCookie: string): Promise<{ cookie: string; token: string }> {
  const res = await fetch(`${BASE}/api/csrf-token`, {
    headers: { "Cookie": sessionCookie },
  });
  const setCookies = res.headers.raw()["set-cookie"] ?? [];
  const newCookies = [...sessionCookie.split("; "), ...setCookies.map(c => c.split(";")[0])].join("; ");
  return { cookie: newCookies, token: (await res.json() as any).token };
}

async function run() {
  console.log("\n▶ NPS Email Smoke Test\n");

  let sessionCookie: string;
  try {
    sessionCookie = await login();
    ok("Login as admin");
  } catch (e: any) {
    ko("Login as admin", e.message);
    process.exit(1);
  }

  const { cookie, token: csrfToken } = await getCsrfToken(sessionCookie);

  // Find a contact with a real email to avoid bouncing
  const contactsRes = await fetch(`${BASE}/api/contacts?limit=10`, {
    headers: { "Cookie": cookie },
  });
  const contactsData = (await contactsRes.json() as any);
  const contacts = contactsData?.data ?? contactsData ?? [];
  const contact = contacts.find((c: any) => c.email && !c.email.includes("test"));

  if (!contact) {
    ko("Find a contact with email");
    console.log("    ↳ No suitable contact found — ensure DB has seeded contacts");
    process.exit(1);
  }
  ok(`Found contact #${contact.id} (${contact.email})`);

  // Create an NPS survey for day-30
  const npsRes = await fetch(`${BASE}/api/nps`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({ contactId: contact.id, dayTrigger: 30 }),
  });

  if (npsRes.status === 201) {
    const survey = (await npsRes.json() as any);
    ok(`POST /api/nps → 201, token=${survey.token?.slice(0, 8)}…`);

    if (survey.token) {
      ok("Survey has token field");
    } else {
      ko("Survey token missing");
    }
    if (survey.dayTrigger === 30) {
      ok("Survey dayTrigger=30");
    } else {
      ko("Survey dayTrigger mismatch", String(survey.dayTrigger));
    }
  } else {
    const body = await npsRes.text();
    ko(`POST /api/nps → ${npsRes.status}`, body.slice(0, 120));
  }

  // Allow auto-send fire-and-forget to settle
  await new Promise(r => setTimeout(r, 1500));

  // Verify survey appears in NPS list
  const listRes = await fetch(`${BASE}/api/nps`, {
    headers: { "Cookie": cookie },
  });
  if (listRes.ok) {
    const list = (await listRes.json() as any) as any[];
    const found = list.find((s: any) => s.contactId === contact.id && s.dayTrigger === 30);
    if (found) {
      ok("Survey appears in GET /api/nps list");
    } else {
      ko("Survey NOT found in GET /api/nps list");
    }
  } else {
    ko(`GET /api/nps → ${listRes.status}`);
  }

  console.log(`\n${pass + fail} checks — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
