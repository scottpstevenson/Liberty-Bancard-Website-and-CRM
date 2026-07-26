/**
 * Reroute sequence email CTA buttons from the GHL calendar booking URL
 * to the correct destination based on button label intent.
 *
 * Rules:
 *  - Booking-intent labels (Book…, Schedule…, etc.) → keep calendar, no change
 *  - Account-mgmt labels (Contact Your AM, etc.) → leave as-is
 *  - Upload/statement labels → /upload-statement
 *  - Application labels → /get-started
 *  - Terminal/shop labels → /shop
 *  - Submit a Referral → /dashboard/referral-program
 *  - Everything else → /free-analysis
 *
 * Also updates variant_b_body for any A/B-tested steps.
 */

const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CALENDAR_URL =
  "https://api.leadconnectorhq.com/widget/bookings/libertybancard";

const BASE = "https://libertybancard.com";

/** Labels that should KEEP the calendar URL — booking intent */
function isBookingLabel(label) {
  const l = label.toLowerCase().trim();
  return (
    l.startsWith("book") ||
    l.startsWith("schedule") ||
    l.startsWith("reschedule") ||
    l.startsWith("rebook") ||
    l.startsWith("grab a quick") ||
    l.startsWith("walk through") ||
    l === "let's chat" ||
    l === "let's talk" ||
    l === "get setup help"
  );
}

/** Labels in account-mgmt tracks that already have non-calendar URLs or should be left alone */
function isLeaveAsIs(label) {
  const l = label.toLowerCase().trim();
  return [
    "contact your am",
    "talk to your am",
    "learn about our terms",
    "explore surcharging",
    "automate my billing",
    "explore revenue tools",
    "explore membership billing",
  ].includes(l);
}

function getDestinationUrl(label) {
  const l = label.toLowerCase().trim();

  // Upload / statement
  if (
    l.includes("upload") ||
    (l.includes("statement") && !l.includes("review") && !l.includes("savings"))
  ) {
    return `${BASE}/upload-statement`;
  }

  // Terminal / shop
  if (
    l.includes("terminal") ||
    l.includes("equipment") ||
    l.includes("hardware") ||
    l === "see terminal options" ||
    l === "claim your terminal"
  ) {
    return `${BASE}/shop`;
  }

  // Application
  if (
    l.includes("application") ||
    l.includes("apply") ||
    (l.includes("complete") && l.includes("app"))
  ) {
    return `${BASE}/get-started`;
  }

  // Referral
  if (l === "submit a referral") {
    return `${BASE}/dashboard/referral-program`;
  }

  // Default: free analysis (covers all review/savings/recommendation labels)
  return `${BASE}/free-analysis`;
}

/** Process a single body string — returns { newBody, changes } */
function processBody(body, stepId, column) {
  if (!body) return { newBody: body, changes: [] };

  const changes = [];

  const buttonRegex =
    /<a href="([^"]+)"([^>]*font-weight:600[^>]*)>([^<]+)<\/a>/g;

  const newBody = body.replace(buttonRegex, (fullMatch, href, attrs, label) => {
    const cleanLabel = label.trim();

    // Skip if not pointing at the calendar — already correct
    if (href !== CALENDAR_URL) return fullMatch;

    // Leave account-mgmt labels alone
    if (isLeaveAsIs(cleanLabel)) return fullMatch;

    // Keep booking-intent labels on the calendar
    if (isBookingLabel(cleanLabel)) return fullMatch;

    const newUrl = getDestinationUrl(cleanLabel);
    changes.push({ stepId, column, label: cleanLabel, newUrl });
    return `<a href="${newUrl}"${attrs}>${label}</a>`;
  });

  return { newBody, changes };
}

async function main() {
  const { rows } = await pool.query(`
    SELECT id, body, variant_b_body
    FROM sequence_steps
    WHERE action_type = 'email'
      AND body IS NOT NULL
      AND body LIKE '%font-weight:600%'
  `);

  console.log(`Processing ${rows.length} email steps…\n`);

  let totalUpdated = 0;
  let totalChanges = 0;
  const allChanges = [];

  for (const row of rows) {
    const { id, body, variant_b_body } = row;

    const { newBody, changes: bodyChanges } = processBody(body, id, "body");
    const { newBody: newVariantB, changes: variantChanges } = processBody(
      variant_b_body,
      id,
      "variant_b_body"
    );

    const allRowChanges = [...bodyChanges, ...variantChanges];
    if (allRowChanges.length === 0) continue;

    await pool.query(
      "UPDATE sequence_steps SET body = $1, variant_b_body = $2 WHERE id = $3",
      [newBody, newVariantB, id]
    );

    totalUpdated++;
    totalChanges += allRowChanges.length;
    allChanges.push(...allRowChanges);

    for (const c of allRowChanges) {
      console.log(`  [step ${c.stepId}/${c.column}] "${c.label}" → ${c.newUrl}`);
    }
  }

  console.log(`\n✅ Done — ${totalUpdated} steps updated, ${totalChanges} CTAs rerouted`);

  // Summary by destination
  const byDest = {};
  for (const c of allChanges) {
    byDest[c.newUrl] = (byDest[c.newUrl] || 0) + 1;
  }
  console.log("\nBy destination:");
  for (const [url, count] of Object.entries(byDest).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(3)}  ${url}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
