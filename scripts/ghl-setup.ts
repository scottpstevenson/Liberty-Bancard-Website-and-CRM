/**
 * GHL Automated Setup Script
 * --------------------------
 * Creates in your GHL sub-account:
 *   1. Sales Pipeline (10 stages)
 *   2. Onboarding Pipeline (9 stages)
 *   3. lb_do_not_sdr contact custom field
 *   4. Default booking calendar
 *
 * Usage:
 *   npx tsx scripts/ghl-setup.ts
 *
 * Requirements:
 *   GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID must be set.
 *
 * Idempotent: re-running will detect existing resources and skip creation.
 */

const GHL_BASE = "https://services.leadconnectorhq.com";
const TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;

const SALES_STAGES = [
  "New Lead",
  "Statement Received",
  "Review In Progress",
  "Call Booked",
  "Proposal Sent",
  "Negotiation / Follow-Up",
  "Verbal Commit",
  "Nurture / Not Now",
  "Closed Won",
  "Closed Lost",
];

const ONBOARDING_STAGES = [
  "Contract Sent",
  "Application Started",
  "Underwriting Submitted",
  "Approved",
  "Terminal Ordered",
  "Go-Live Scheduled",
  "Live (First Batch)",
  "Active (7 Days)",
  "Active (30 Days)",
];

function colorize(text: string, code: number) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green  = (s: string) => colorize(s, 32);
const yellow = (s: string) => colorize(s, 33);
const red    = (s: string) => colorize(s, 31);
const cyan   = (s: string) => colorize(s, 36);
const bold   = (s: string) => colorize(s, 1);

async function ghlFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${GHL_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
      ...(options.headers as Record<string, string> || {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GHL ${res.status} on ${path}: ${text}`);
  }
  return JSON.parse(text);
}

async function getExistingPipelines(): Promise<Array<{ id: string; name: string }>> {
  try {
    const data = await ghlFetch(`/opportunities/pipelines?locationId=${LOCATION_ID}`);
    return data.pipelines || data || [];
  } catch {
    return [];
  }
}

async function createPipeline(name: string, stages: string[]): Promise<string> {
  const data = await ghlFetch("/opportunities/pipelines", {
    method: "POST",
    body: JSON.stringify({
      name,
      locationId: LOCATION_ID,
      stages: stages.map((s, i) => ({ name: s, probability: 0, position: i + 1 })),
    }),
  });
  return data.pipeline?.id || data.id;
}

async function getExistingCustomFields(): Promise<Array<{ id: string; fieldKey: string; name: string }>> {
  try {
    const data = await ghlFetch(`/locations/${LOCATION_ID}/customFields`);
    return data.customFields || data || [];
  } catch {
    return [];
  }
}

async function createCustomField(name: string, fieldKey: string): Promise<string> {
  const data = await ghlFetch(`/locations/${LOCATION_ID}/customFields`, {
    method: "POST",
    body: JSON.stringify({
      name,
      fieldKey,
      dataType: "TEXT",
      locationId: LOCATION_ID,
    }),
  });
  return data.customField?.id || data.id;
}

async function getExistingCalendars(): Promise<Array<{ id: string; name: string }>> {
  try {
    const data = await ghlFetch(`/calendars/?locationId=${LOCATION_ID}`);
    return data.calendars || data || [];
  } catch {
    return [];
  }
}

async function createCalendar(name: string, description: string): Promise<string> {
  const data = await ghlFetch("/calendars/", {
    method: "POST",
    body: JSON.stringify({
      locationId: LOCATION_ID,
      name,
      description,
      calendarType: "event",
      isActive: true,
    }),
  });
  return data.calendar?.id || data.id;
}

async function run() {
  console.log("\n" + bold("═══════════════════════════════════════════════"));
  console.log(bold("  Liberty Bancard — GHL Automated Setup Script"));
  console.log(bold("═══════════════════════════════════════════════") + "\n");

  if (!TOKEN || !LOCATION_ID) {
    console.error(red("✗ Missing credentials."));
    console.error("  Set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID as Replit Secrets.\n");
    process.exit(1);
  }

  console.log(cyan("▶ Using Location ID:"), LOCATION_ID);
  console.log(cyan("▶ Token:"), TOKEN.slice(0, 6) + "..." + TOKEN.slice(-4) + "\n");

  const results: Record<string, string> = {};

  // ─── 1. Sales Pipeline ───────────────────────────────────────────────────
  console.log(bold("1. Sales Pipeline"));
  const existingPipelines = await getExistingPipelines();
  const existingSales = existingPipelines.find(
    (p) => p.name.toLowerCase().includes("sales") || p.name.toLowerCase().includes("liberty")
  );

  if (existingSales) {
    console.log(yellow(`   ⚠ Found existing pipeline: "${existingSales.name}" (${existingSales.id})`));
    console.log(yellow("   Skipping creation — verify stage names match exactly in GHL UI."));
    results["GHL_PIPELINE_ID"] = existingSales.id;
  } else {
    try {
      const id = await createPipeline("Liberty Bancard Sales Pipeline", SALES_STAGES);
      results["GHL_PIPELINE_ID"] = id;
      console.log(green(`   ✓ Created: Liberty Bancard Sales Pipeline`));
      console.log(green(`     ID: ${id}`));
      SALES_STAGES.forEach((s) => console.log(`     · ${s}`));
    } catch (err: any) {
      console.error(red("   ✗ Failed:"), err.message);
    }
  }

  // ─── 2. Onboarding Pipeline ──────────────────────────────────────────────
  console.log(bold("\n2. Onboarding Pipeline"));
  const existingOnboarding = existingPipelines.find(
    (p) => p.name.toLowerCase().includes("onboarding") || p.name.toLowerCase().includes("boarding")
  );

  if (existingOnboarding) {
    console.log(yellow(`   ⚠ Found existing pipeline: "${existingOnboarding.name}" (${existingOnboarding.id})`));
    console.log(yellow("   Skipping creation — verify stage names match exactly in GHL UI."));
    results["GHL_ONBOARDING_PIPELINE_ID"] = existingOnboarding.id;
  } else {
    try {
      const id = await createPipeline("Liberty Bancard Onboarding Pipeline", ONBOARDING_STAGES);
      results["GHL_ONBOARDING_PIPELINE_ID"] = id;
      console.log(green(`   ✓ Created: Liberty Bancard Onboarding Pipeline`));
      console.log(green(`     ID: ${id}`));
      ONBOARDING_STAGES.forEach((s) => console.log(`     · ${s}`));
    } catch (err: any) {
      console.error(red("   ✗ Failed:"), err.message);
    }
  }

  // ─── 3. Custom Field ─────────────────────────────────────────────────────
  console.log(bold("\n3. Contact Custom Field: lb_do_not_sdr"));
  const existingFields = await getExistingCustomFields();
  const existingField = existingFields.find(
    (f) => f.fieldKey === "lb_do_not_sdr" || f.name === "LB Do Not SDR"
  );

  if (existingField) {
    console.log(yellow(`   ⚠ Field already exists: "${existingField.name}" (${existingField.id})`));
    console.log(yellow("   Skipping creation."));
  } else {
    try {
      const id = await createCustomField("LB Do Not SDR", "lb_do_not_sdr");
      console.log(green(`   ✓ Created custom field: lb_do_not_sdr`));
      console.log(green(`     ID: ${id}`));
      console.log(`     Purpose: Set to "true" to suppress a contact from AI SDR outreach`);
    } catch (err: any) {
      console.error(red("   ✗ Failed:"), err.message);
      console.log(`     → Manually create in GHL: Contacts → Settings → Custom Fields`);
      console.log(`       Field Key: lb_do_not_sdr  |  Type: Text`);
    }
  }

  // ─── 4. Default Calendar ─────────────────────────────────────────────────
  console.log(bold("\n4. Default Booking Calendar"));
  const existingCalendars = await getExistingCalendars();
  const existingCal = existingCalendars.find(
    (c) => c.name.toLowerCase().includes("liberty") || c.name.toLowerCase().includes("bancard")
  );

  if (existingCal) {
    console.log(yellow(`   ⚠ Found existing calendar: "${existingCal.name}" (${existingCal.id})`));
    console.log(yellow("   Skipping creation."));
    results["GHL_CALENDAR_ID"] = existingCal.id;
  } else {
    try {
      const id = await createCalendar(
        "Liberty Bancard Sales Booking",
        "Default calendar for merchant consultation and statement review appointments"
      );
      results["GHL_CALENDAR_ID"] = id;
      console.log(green(`   ✓ Created calendar: Liberty Bancard Sales Booking`));
      console.log(green(`     ID: ${id}`));
      console.log(`     Booking URL: https://api.leadconnectorhq.com/widget/booking/${id}`);
      if (!results["GHL_DEFAULT_BOOKING_LINK"]) {
        results["GHL_DEFAULT_BOOKING_LINK"] = `https://api.leadconnectorhq.com/widget/booking/${id}`;
      }
    } catch (err: any) {
      console.error(red("   ✗ Failed:"), err.message);
      console.log(`     → Manually create in GHL: Settings → Calendars → Create Calendar`);
    }
  }

  // ─── Output: Env Vars to Set ─────────────────────────────────────────────
  console.log("\n" + bold("═══════════════════════════════════════════════"));
  console.log(bold("  ✅ SETUP COMPLETE — Add these Replit Secrets:"));
  console.log(bold("═══════════════════════════════════════════════\n"));

  const envVars: Record<string, string> = {
    ...results,
  };

  if (Object.keys(envVars).length === 0) {
    console.log(yellow("  All resources already existed — no new IDs to set."));
  } else {
    Object.entries(envVars).forEach(([key, val]) => {
      console.log(`  ${bold(key)}`);
      console.log(`  ${green(val)}\n`);
    });
  }

  // ─── Next Steps ──────────────────────────────────────────────────────────
  console.log(bold("─────────────────────────────────────────────────"));
  console.log(bold("  NEXT STEPS (manual in GHL UI):"));
  console.log(bold("─────────────────────────────────────────────────\n"));

  const steps = [
    "Set your working hours on the Sales Booking calendar",
    "Set GHL_ONBOARDING_STAGE_NEW = ID of 'Contract Sent' stage in the Onboarding Pipeline",
    "Set GHL_DEFAULT_BOOKING_LINK = https://api.leadconnectorhq.com/widget/booking/{GHL_CALENDAR_ID}",
    "Set GHL_SUPPORT_TEAM_USER_ID = User ID of your support agent (GHL → Team → click user → copy URL ID)",
    "Set GHL_MERCHANT_AGREEMENT_TEMPLATE_ID = ID from your e-sign template (GHL → Documents)",
    "Build the 22 workflows in GHL Automations and paste IDs into /dashboard/integrations",
    "Purchase a phone number in GHL → Phone Numbers",
    "Install chat widget on your website (GHL → Sites → Chat Widget)",
  ];

  steps.forEach((step, i) => {
    console.log(`  ${cyan(String(i + 1) + ".")} ${step}`);
  });

  console.log("\n" + bold("  Run scripts/ghl-voice-dialer-setup.md for voice/auto-dial instructions.\n"));
}

run().catch((err) => {
  console.error(red("\n✗ Fatal error:"), err.message);
  process.exit(1);
});
