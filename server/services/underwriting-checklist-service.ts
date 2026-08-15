/**
 * #1445 — Underwriting Checklist Auto-Init
 *
 * Creates per-deal underwriting checklist tasks when a deal enters an underwriting stage.
 * Vertical-keyed templates ensure the correct documents are requested for each industry.
 * Idempotent: skips if tasks with source="underwriting" already exist for this deal.
 */
import { db } from "../db";
import { storage } from "../storage";
import { tasks, underwritingConditions } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

/** Add N business days (Mon–Fri) to a start date. */
function addBusinessDays(start: Date, days: number): Date {
  const date = new Date(start);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date;
}

interface ChecklistTemplate {
  title: string;
  description: string;
  dueDays: number;
  priority: "high" | "normal" | "low";
}

const BASE_ITEMS: ChecklistTemplate[] = [
  {
    title: "Complete merchant application",
    description: "Ensure all sections of the merchant application are signed and submitted in full.",
    dueDays: 1,
    priority: "high",
  },
  {
    title: "Sign merchant processing agreement",
    description: "Obtain a fully executed merchant processing agreement from all principals.",
    dueDays: 3,
    priority: "high",
  },
  {
    title: "Submit government-issued photo ID",
    description: "Collect a valid government-issued photo ID (driver's license or passport) for each principal with ≥25% ownership.",
    dueDays: 2,
    priority: "normal",
  },
  {
    title: "Provide voided check or bank authorization letter",
    description: "Collect a voided business check or a signed bank letter for deposit account verification.",
    dueDays: 2,
    priority: "normal",
  },
  {
    title: "Submit 3 months business bank statements",
    description: "Collect the last 3 consecutive months of business bank statements.",
    dueDays: 3,
    priority: "normal",
  },
  {
    title: "Submit 3 months prior processing statements",
    description: "Provide the last 3 months of card processing statements from the current or prior processor (if applicable).",
    dueDays: 3,
    priority: "normal",
  },
];

const VERTICAL_EXTRA: Record<string, ChecklistTemplate[]> = {
  healthcare: [
    {
      title: "HIPAA compliance documentation",
      description: "Verify HIPAA compliance program and provide a signed Business Associate Agreement (BAA) if applicable.",
      dueDays: 5,
      priority: "high",
    },
    {
      title: "Medical license verification",
      description: "Confirm a valid medical license or professional certification for the primary applicant.",
      dueDays: 5,
      priority: "high",
    },
  ],
  medical: [
    {
      title: "HIPAA compliance documentation",
      description: "Verify HIPAA compliance and provide signed BAA if applicable.",
      dueDays: 5,
      priority: "high",
    },
    {
      title: "Medical license verification",
      description: "Confirm valid medical license or professional certification.",
      dueDays: 5,
      priority: "high",
    },
  ],
  food_beverage: [
    {
      title: "Health department permit",
      description: "Verify a current health department permit for food service operations.",
      dueDays: 5,
      priority: "normal",
    },
    {
      title: "Food service or restaurant license",
      description: "Collect a copy of the applicable food service, restaurant, or liquor license.",
      dueDays: 5,
      priority: "normal",
    },
  ],
  pharmacy: [
    {
      title: "DEA registration number",
      description: "Verify DEA registration number if controlled substances are dispensed.",
      dueDays: 7,
      priority: "high",
    },
    {
      title: "State pharmacy license",
      description: "Confirm a valid state pharmacy board license.",
      dueDays: 5,
      priority: "high",
    },
  ],
  legal: [
    {
      title: "State bar membership verification",
      description: "Confirm active state bar membership for all principal attorneys.",
      dueDays: 5,
      priority: "normal",
    },
    {
      title: "IOLTA trust account documentation",
      description: "If applicable, provide documentation for any IOLTA trust accounts used for client funds.",
      dueDays: 7,
      priority: "normal",
    },
  ],
  auto: [
    {
      title: "Auto dealer or repair facility license",
      description: "Verify a valid auto dealer or repair facility license if applicable.",
      dueDays: 5,
      priority: "normal",
    },
  ],
  ecommerce: [
    {
      title: "Website URL and Terms of Service review",
      description: "Provide the business website URL and confirm Terms of Service, Refund Policy, and Privacy Policy are published.",
      dueDays: 2,
      priority: "high",
    },
    {
      title: "SSL certificate and checkout security verification",
      description: "Confirm the website uses HTTPS with a valid SSL certificate and PCI-compliant checkout.",
      dueDays: 2,
      priority: "normal",
    },
  ],
};

function normalizeVertical(vertical: string | null): string {
  return (vertical ?? "").toLowerCase().replace(/[\s\-]/g, "_");
}

function getChecklistItems(vertical: string | null): ChecklistTemplate[] {
  const norm = normalizeVertical(vertical);
  const extras = VERTICAL_EXTRA[norm] ?? [];
  return [...BASE_ITEMS, ...extras];
}

// ─── Standard underwriting conditions (separate from per-rep tasks) ───────────
// These rows land in underwriting_conditions so admin can track them distinct from
// internal tasks. Each condition is also surfaced to the merchant via email.

interface ConditionTemplate {
  conditionType: string;
  description: string;
  dueDays: number;
}

const STANDARD_CONDITIONS: ConditionTemplate[] = [
  { conditionType: "merchant_application",         description: "Fully signed merchant application — all sections and principals completed", dueDays: 1 },
  { conditionType: "processing_agreement",         description: "Fully executed merchant processing agreement from all principals with ≥25% ownership", dueDays: 3 },
  { conditionType: "photo_id",                     description: "Valid government-issued photo ID (driver's license or passport) for each principal", dueDays: 2 },
  { conditionType: "voided_check",                 description: "Voided business check or signed bank letter for deposit account verification", dueDays: 2 },
  { conditionType: "bank_statements",              description: "3 consecutive months of business bank statements", dueDays: 3 },
  { conditionType: "prior_processing_statements",  description: "3 months prior card processing statements (waivable for new merchants — note if not applicable)", dueDays: 3 },
];

/**
 * Auto-create underwriting_conditions rows when a deal enters an underwriting stage.
 *
 * Idempotent — no-ops if conditions already exist for this deal.
 * Also sends the merchant an email listing required documents.
 */
export async function initUnderwritingConditions(
  dealId: number,
  contactEmail: string | null,
  contactName: string | null,
  contactId: number | null,
): Promise<void> {
  try {
    // Idempotency: skip if conditions already exist
    const existing = await db
      .select({ id: underwritingConditions.id })
      .from(underwritingConditions)
      .where(eq(underwritingConditions.dealId, dealId))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[Underwriting] Conditions already initialized for deal #${dealId} — skipping`);
      return;
    }

    const now = new Date();
    const conditionRows = STANDARD_CONDITIONS.map((c) => ({
      dealId,
      conditionType: c.conditionType,
      description:   c.description,
      status:        "pending" as const,
      merchantVisible: true,
      dueDate:       addBusinessDays(now, c.dueDays),
      ...(contactId ? { createdBy: contactId } : {}),
    }));

    await db.insert(underwritingConditions).values(conditionRows);
    console.log(`[Underwriting] ${conditionRows.length} conditions created for deal #${dealId}`);

    // Send merchant an email listing required documents
    if (contactEmail) {
      await sendMerchantConditionsEmail(dealId, contactEmail, contactName, STANDARD_CONDITIONS).catch(
        (err: Error) => console.error(`[Underwriting] conditions email error for deal #${dealId}:`, err.message),
      );
    }
  } catch (err) {
    console.error(`[Underwriting] conditions init error for deal #${dealId}:`, (err as Error).message);
  }
}

async function sendMerchantConditionsEmail(
  dealId: number,
  email: string,
  name: string | null,
  conditions: ConditionTemplate[],
): Promise<void> {
  const pausedRaw = await storage.getSystemSetting("outboundGlobalPaused");
  if (pausedRaw === true || pausedRaw === "true") {
    console.log(`[Underwriting] outboundGlobalPaused — skipping conditions email for deal #${dealId}`);
    return;
  }

  const { isSmtpConfigured, sendSmtpEmail } = await import("./smtp-email");
  if (!isSmtpConfigured()) return;

  const greeting = name ? `Hi ${name.split(" ")[0]}` : "Hello";
  const itemsHtml = conditions
    .map((c, i) => `<li style="margin-bottom:6px"><strong>${i + 1}. ${c.conditionType.replace(/_/g, " ")}</strong><br/>${c.description}</li>`)
    .join("\n");
  const itemsText = conditions
    .map((c, i) => `${i + 1}. ${c.description}`)
    .join("\n");

  await sendSmtpEmail({
    to: email,
    subject: "Action Required: Documents Needed to Complete Your Application",
    html: `
      <p>${greeting},</p>
      <p>Thank you for your merchant application. To advance through underwriting we need the following documents:</p>
      <ol>${itemsHtml}</ol>
      <p>Please submit these as soon as possible. Reply to this email or contact your representative if you have questions.</p>
      <p>Best regards,<br/>Liberty Bancard Underwriting Team</p>
    `,
    category: "onboarding",
    contactId: undefined, // dealId not tracked at SMTP level
  });

  console.log(`[Underwriting] Conditions email sent to ${email} for deal #${dealId}`);
}

/**
 * Auto-initialize an underwriting checklist as tasks for the given deal.
 *
 * Idempotent — no-ops if tasks with source="underwriting" already exist for this deal.
 *
 * @param dealId   ID of the sales deal entering an underwriting stage
 * @param vertical Merchant vertical (e.g. "healthcare", "auto"); used to select
 *                 the vertical-specific document requirements template
 */
export async function initUnderwritingChecklist(
  dealId: number,
  vertical: string | null,
): Promise<void> {
  try {
    // Idempotency guard
    const existing = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.dealId, dealId), eq((tasks as any).source, "underwriting")))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[Underwriting] Checklist already initialized for deal #${dealId} — skipping`);
      return;
    }

    const now = new Date();
    const items = getChecklistItems(vertical);

    const taskRows = items.map((item) => ({
      dealId,
      title: item.title,
      description: item.description,
      dueDate: addBusinessDays(now, item.dueDays),
      status: "pending",
      priority: item.priority,
      source: "underwriting",
      automationKey: `uw_${dealId}_${item.title.toLowerCase().replace(/\W+/g, "_").slice(0, 50)}`,
    }));

    // Wrap all inserts in a transaction so the full template set is either committed
    // atomically or rolled back entirely. A mid-loop failure leaves no partial state;
    // retries will succeed because ON CONFLICT DO NOTHING handles any rows that may
    // have been inserted by a concurrent request between the idempotency read and here.
    let insertedCount = 0;
    await db.transaction(async (tx) => {
      for (const row of taskRows) {
        const result = await tx.execute(sql`
          INSERT INTO tasks
            (deal_id, title, description, due_date, status, priority, source, automation_key)
          VALUES
            (${row.dealId}, ${row.title}, ${row.description}, ${row.dueDate},
             ${row.status}, ${row.priority}, ${row.source}, ${row.automationKey})
          ON CONFLICT (automation_key)
            WHERE automation_key IS NOT NULL AND source = 'underwriting'
          DO NOTHING
        `);
        if ((result.rowCount ?? 0) > 0) insertedCount++;
      }
    });

    if (insertedCount === 0) {
      console.log(`[Underwriting] Checklist already initialized for deal #${dealId} (concurrent init) — skipping`);
      return;
    }

    console.log(
      `[Underwriting] Checklist initialized for deal #${dealId} — ` +
        `${insertedCount}/${taskRows.length} items inserted (vertical: ${vertical ?? "generic"})`,
    );
  } catch (err) {
    // Non-fatal — log and continue
    console.error(
      `[Underwriting] checklist init error for deal #${dealId}:`,
      (err as Error).message,
    );
  }
}
