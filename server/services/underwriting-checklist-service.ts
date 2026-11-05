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
 * Race-safe and idempotent per condition: each standard condition has an identity (automation_key) backed by a
 * partial unique index, so concurrent or repeated runs insert only the MISSING items (a partially initialized deal
 * is completed, never duplicated) and a previously superseded standard condition is not resurrected.
 * The merchant chase is recorded as a durable owed row in the same transaction and delivered separately, so a
 * paused/unconfigured sender leaves it owed instead of dropping it. Real failures propagate so the durable
 * stage-effect intent that called this retries.
 */
export async function initUnderwritingConditions(
  dealId: number,
  contactEmail: string | null,
  contactName: string | null,
  _contactId: number | null,
  deps: ChaseDeps = {},
): Promise<{ inserted: number }> {
  const now = new Date();
  let inserted = 0;
  await db.transaction(async (tx) => {
    for (const c of STANDARD_CONDITIONS) {
      const r = await tx.execute(sql`
        INSERT INTO underwriting_conditions
          (deal_id, condition_type, description, status, merchant_visible, due_date, automation_key)
        VALUES (${dealId}, ${c.conditionType}, ${c.description}, 'pending', true,
                ${addBusinessDays(now, c.dueDays)}, ${`std:${c.conditionType}`})
        ON CONFLICT (deal_id, automation_key) WHERE automation_key IS NOT NULL DO NOTHING
      `);
      if ((r.rowCount ?? 0) > 0) inserted++;
    }
    if (contactEmail) {
      await tx.execute(sql`
        INSERT INTO underwriting_condition_chases (deal_id, channel, status, recipient_email, recipient_name)
        VALUES (${dealId}, 'email', 'owed', ${contactEmail}, ${contactName})
        ON CONFLICT (deal_id, channel) DO NOTHING
      `);
    }
  });
  console.log(`[Underwriting] ${inserted} missing conditions created for deal #${dealId}`);
  // Delivery is attempted now; if it cannot go out it stays owed for the recurring sweep.
  await retryOwedConditionChases({ dealId }, deps).catch((err: Error) =>
    console.error(`[Underwriting] conditions chase error for deal #${dealId}:`, err.message));
  return { inserted };
}

export interface ChaseDeps {
  authorize?: () => Promise<{ allowed: boolean; reasonCode?: string }>;
  canExecute?: (key: string) => Promise<boolean>;
  isSmtpConfigured?: () => boolean;
  sendEmail?: (msg: { to: string; subject: string; html: string; category: string }) => Promise<unknown>;
}

export interface ChaseSweepResult { attempted: number; sent: number; stillOwed: number; notApplicable: number; heldUnknown: number; unsent: number }

const GATE_RECHECK_MINUTES = 2;
const UNSENT_RECHECK_MINUTES = 15;
const CHASE_BATCH = 50;
/** Only these error codes are ever stored; provider messages can carry addresses or payloads. */
const SAFE_CHASE_ERROR_CODES = new Set(["EAUTH", "EENVELOPE", "EMESSAGE", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EDNS", "ESOCKET"]);
export function chaseErrorCode(err: unknown): string {
  const code = (err as any)?.code;
  return typeof code === "string" && SAFE_CHASE_ERROR_CODES.has(code) ? code : "send_error";
}
function safeProviderCode(raw: unknown): string {
  return typeof raw === "string" && SAFE_CHASE_ERROR_CODES.has(raw) ? raw : "provider_refused";
}

/**
 * Delivers owed merchant chases. Each (deal, channel) is claimed with a compare-and-set (owed -> sending) pinned to
 * the recipient and obligation versions that were read, so concurrent sweeps send once and a recipient or
 * obligation change between read and claim is not sent against stale facts.
 *
 * Only an SMTP result with success === true AND outcome === "sent" settles sent. A resolved refusal whose outcome
 * is "unsent" returns to owed (retried later); anything else (uncertain, missing, a throw) is an unknown outcome
 * held in `sending` for review and never auto-resent. Fairness beyond the first batch comes from a durable
 * next_check_at cursor: rows that stay owed move to the back, so a stuck head cannot starve later rows.
 */
export async function retryOwedConditionChases(
  scope: { dealId?: number } = {},
  deps: ChaseDeps = {},
): Promise<ChaseSweepResult> {
  const result: ChaseSweepResult = { attempted: 0, sent: 0, stillOwed: 0, notApplicable: 0, heldUnknown: 0, unsent: 0 };
  const owed = await db.execute(sql`
    SELECT id, deal_id, recipient_email, recipient_name, recipient_version, obligation_version
    FROM underwriting_condition_chases
    WHERE channel = 'email' AND status = 'owed'
      ${scope.dealId != null ? sql`AND deal_id = ${scope.dealId}` : sql`AND (next_check_at IS NULL OR next_check_at <= now())`}
    ORDER BY next_check_at NULLS FIRST, id LIMIT ${CHASE_BATCH}
  `);
  const heldRows = await db.execute(sql`
    SELECT count(*)::int AS n FROM underwriting_condition_chases
    WHERE channel = 'email' AND status = 'sending' ${scope.dealId != null ? sql`AND deal_id = ${scope.dealId}` : sql``}
  `);
  result.heldUnknown = Number((heldRows as any).rows?.[0]?.n ?? 0);

  type OwedRow = { id: number; deal_id: number; recipient_email: string | null; recipient_name: string | null; recipient_version: number; obligation_version: number };
  const stayOwed = async (id: number, reason: string, minutes: number) => {
    await db.execute(sql`UPDATE underwriting_condition_chases SET last_reason = ${reason}, last_attempt_at = now(),
      next_check_at = now() + (${minutes}::int * interval '1 minute'), updated_at = now() WHERE id = ${id} AND status = 'owed'`);
  };

  for (const row of (owed as any).rows as OwedRow[]) {
    // Gates are checked BEFORE the claim so a paused system does not burn an attempt.
    const authorizeFn = deps.authorize ?? (async () => {
      const { authorize } = await import("./outbound-pause-authority");
      return await authorize({});
    });
    const decision = await authorizeFn();
    if (!decision.allowed) {
      await stayOwed(row.id, `paused:${decision.reasonCode ?? "unknown"}`, GATE_RECHECK_MINUTES);
      result.stillOwed++;
      continue;
    }
    const canExec = deps.canExecute ?? (async (k: string) => (await import("./outbound-queue-coordinator")).canExecute(k));
    if (!(await canExec("underwriting-notifications"))) {
      await stayOwed(row.id, "coordinator_hold", GATE_RECHECK_MINUTES);
      result.stillOwed++;
      continue;
    }
    const configured = deps.isSmtpConfigured ? deps.isSmtpConfigured() : (await import("./smtp-email")).isSmtpConfigured();
    if (!configured) {
      await stayOwed(row.id, "smtp_not_configured", GATE_RECHECK_MINUTES);
      result.stillOwed++;
      continue;
    }

    const claimed = await db.execute(sql`
      UPDATE underwriting_condition_chases SET status = 'sending', attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
      WHERE id = ${row.id} AND status = 'owed'
        AND recipient_version = ${row.recipient_version} AND obligation_version = ${row.obligation_version}
      RETURNING id
    `);
    if (((claimed as any).rows ?? []).length === 0) continue; // another sweep owns it, or it changed since it was read
    result.attempted++;

    let snapRecipientVersion = row.recipient_version;
    const snapObligationVersion = row.obligation_version;
    const settle = async (status: "owed" | "sent" | "not_applicable", reason: string | null) => {
      await db.execute(sql`
        UPDATE underwriting_condition_chases
        SET status = CASE WHEN ${status}::text IN ('sent','not_applicable') AND obligation_version <> ${snapObligationVersion} THEN 'owed' ELSE ${status}::text END,
            last_reason = ${reason}, updated_at = now(),
            next_check_at = CASE WHEN ${status}::text = 'owed' THEN now() + (${UNSENT_RECHECK_MINUTES}::int * interval '1 minute') ELSE NULL END,
            sent_at = CASE WHEN ${status}::text = 'sent' THEN now() ELSE sent_at END,
            sent_recipient_version = CASE WHEN ${status}::text = 'sent' THEN ${snapRecipientVersion} ELSE sent_recipient_version END,
            sent_obligation_version = CASE WHEN ${status}::text = 'sent' THEN ${snapObligationVersion} ELSE sent_obligation_version END
        WHERE id = ${row.id} AND status = 'sending'
      `);
    };

    try {
      // The current mailbox owner wins: re-read the deal's contact at claim time and version the change.
      const current = ((await db.execute(sql`
        SELECT c.id AS contact_id, c.email, NULLIF(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') AS name
        FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE d.id = ${row.deal_id}`)) as any).rows?.[0];
      const currentEmail = typeof current?.email === "string" ? current.email.trim() : "";
      let recipientEmail: string | null = row.recipient_email;
      let recipientName = row.recipient_name;
      if (!currentEmail) {
        // Fail closed: the current mailbox owner has no address (cleared, removed or the contact is gone). A saved
        // address is never used as a fallback; the clearance is versioned like any other recipient change.
        if (row.recipient_email) {
          snapRecipientVersion = row.recipient_version + 1;
          await db.execute(sql`UPDATE underwriting_condition_chases SET recipient_email = NULL, recipient_name = NULL,
            recipient_version = ${snapRecipientVersion}, updated_at = now() WHERE id = ${row.id} AND status = 'sending'`);
        }
        await settle("not_applicable", "no_recipient");
        result.notApplicable++;
        continue;
      }
      if (currentEmail.toLowerCase() !== String(row.recipient_email ?? "").toLowerCase()) {
        recipientEmail = currentEmail;
        recipientName = current.name ?? row.recipient_name;
        snapRecipientVersion = row.recipient_version + 1;
        await db.execute(sql`UPDATE underwriting_condition_chases SET recipient_email = ${recipientEmail}, recipient_name = ${recipientName},
          recipient_version = ${snapRecipientVersion}, updated_at = now() WHERE id = ${row.id} AND status = 'sending'`);
      }
      if (!recipientEmail) { await settle("not_applicable", "no_recipient"); result.notApplicable++; continue; }
      const open = await db.select({ conditionType: underwritingConditions.conditionType, description: underwritingConditions.description })
        .from(underwritingConditions)
        .where(and(eq(underwritingConditions.dealId, row.deal_id), eq(underwritingConditions.status, "pending"),
          eq(underwritingConditions.merchantVisible, true), sql`${underwritingConditions.supersededAt} IS NULL`))
        .orderBy(underwritingConditions.id);
      if (open.length === 0) { await settle("not_applicable", "nothing_outstanding"); result.notApplicable++; continue; }
      // Real adapter: the send is bound to the deal's own contact and a transactional purpose so the transport
      // applies the canonical contact/commercial authority instead of treating the message as contact-less.
      const chaseContactId = typeof current?.contact_id === "number" ? current.contact_id : undefined;
      const send = deps.sendEmail ?? (async (m) => (await import("./smtp-email")).sendSmtpEmail({ ...m, contactId: chaseContactId, commercialPurpose: "transactional_response" } as any));
      const outcome = (await send(buildChaseEmail(recipientEmail, recipientName, open))) as { success?: boolean; outcome?: string; error?: string } | undefined | null;
      if (outcome && outcome.success === true && outcome.outcome === "sent") {
        await settle("sent", null);
        result.sent++;
      } else if (outcome && outcome.success === false && outcome.outcome === "unsent") {
        // The provider proved nothing was transmitted: safe to retry later; the attempt stays counted.
        await settle("owed", `unsent:${safeProviderCode((outcome as any).code)}`);
        result.unsent++;
        result.stillOwed++;
      } else {
        // Uncertain, missing or malformed result: the message may have been delivered. Held, never resent.
        await db.execute(sql`UPDATE underwriting_condition_chases SET last_reason = 'unknown_outcome:uncertain', updated_at = now() WHERE id = ${row.id} AND status = 'sending'`);
        result.heldUnknown++;
      }
    } catch (err) {
      // The send may or may not have reached the provider: leave the claim in `sending` (unknown outcome, held).
      await db.execute(sql`UPDATE underwriting_condition_chases SET last_reason = ${`unknown_outcome:${chaseErrorCode(err)}`}, updated_at = now() WHERE id = ${row.id} AND status = 'sending'`);
      result.heldUnknown++;
    }
  }
  return result;
}

const escapeHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export function buildChaseEmail(email: string, name: string | null, conditions: Array<{ conditionType: string; description: string }>) {
  const greeting = name ? `Hi ${escapeHtml(name.split(" ")[0])}` : "Hello";
  const itemsHtml = conditions
    .map((c, i) => `<li style="margin-bottom:6px"><strong>${i + 1}. ${escapeHtml(c.conditionType.replace(/_/g, " "))}</strong><br/>${escapeHtml(c.description)}</li>`)
    .join("\n");
  return {
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
  };
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
