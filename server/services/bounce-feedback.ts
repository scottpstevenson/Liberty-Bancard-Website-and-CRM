import { db } from "../db";
import { contacts, systemSettings, identityPerformanceDaily } from "@shared/schema";
import { eq, and, isNull, or, ne, gte } from "drizzle-orm";
import { storage } from "../storage";

const BOUNCE_SETTING_KEY = "bounce_feedback_last_run";

async function getLastRun(): Promise<Date> {
  try {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, BOUNCE_SETTING_KEY));
    if (row?.value && typeof row.value === "object" && (row.value as any).at) {
      return new Date((row.value as any).at);
    }
  } catch {
    // fallback
  }
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

async function setLastRun(): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(systemSettings)
    .values({ key: BOUNCE_SETTING_KEY, value: { at: now }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: { at: now }, updatedAt: new Date() } });
}

export async function runBounceFeedback(): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;

  try {
    const lastRun = await getLastRun();

    // Early-exit optimisation: skip expensive queries if no performance records
    // show any bounces since lastRun.
    const recentPerf = await db.select().from(identityPerformanceDaily)
      .where(gte(identityPerformanceDaily.date, lastRun))
      .catch(() => [] as any[]);

    if (!recentPerf.length) {
      await setLastRun();
      return { updated, skipped };
    }

    const identitiesWithBounces = recentPerf.filter((p: any) => (p.bounced || 0) > 0);
    if (!identitiesWithBounces.length) {
      await setLastRun();
      return { updated, skipped };
    }

    const bouncedRows = await db.execute(
      `SELECT to_email, MIN(sending_identity_id) as sending_identity_id
       FROM outbound_messages
       WHERE status = 'bounced' AND sent_at >= $1
       GROUP BY to_email`,
      [lastRun]
    ).catch(() => ({ rows: [] as any[] }));

    if (!(bouncedRows as any).rows?.length) {
      await setLastRun();
      return { updated, skipped };
    }

    const bouncedEmails = new Map<string, number>();
    for (const row of (bouncedRows as any).rows || []) {
      if (row.to_email) bouncedEmails.set(row.to_email.toLowerCase(), row.sending_identity_id);
    }

    const activeContacts = await db.select({
      id: contacts.id,
      email: contacts.email,
      emailStatus: contacts.emailStatus,
    }).from(contacts).where(
      and(
        isNull(contacts.archivedAt),
        or(isNull(contacts.emailStatus), ne(contacts.emailStatus, "bounced")),
      )
    );

    for (const contact of activeContacts) {
      if (!contact.email) continue;
      const identityId = bouncedEmails.get(contact.email.toLowerCase());
      if (identityId === undefined) { skipped++; continue; }

      await db.update(contacts)
        .set({ emailStatus: "bounced", contactBouncedAt: new Date(), updatedAt: new Date() } as any)
        .where(eq(contacts.id, contact.id));

      await storage.createAuditLog({
        action: "contact_email_bounced",
        entityType: "contact",
        entityId: contact.id,
        actorType: "system",
        details: {
          email: contact.email,
          sendingIdentityId: identityId,
          detectedAt: new Date().toISOString(),
          previousStatus: contact.emailStatus || "active",
        },
      });

      updated++;
    }

    await setLastRun();
    if (updated > 0) {
      console.log(`[BounceFeedback] Marked ${updated} contacts as bounced`);
    }
  } catch (err) {
    console.error("[BounceFeedback] Error:", err);
  }

  return { updated, skipped };
}

export function scoreDecisionMaker(title: string | null | undefined): { isDecisionMaker: boolean; confidence: number } {
  if (!title) return { isDecisionMaker: false, confidence: 0 };
  const t = title.toLowerCase();
  if (/\b(owner|ceo|chief executive|president|founder|co-founder|principal|proprietor)\b/.test(t)) {
    return { isDecisionMaker: true, confidence: 95 };
  }
  if (/\b(managing (member|partner|director)|partner|gm|general manager)\b/.test(t)) {
    return { isDecisionMaker: true, confidence: 80 };
  }
  if (/\b(director|vp|vice president|head of|controller)\b/.test(t)) {
    return { isDecisionMaker: true, confidence: 60 };
  }
  if (/\b(manager|supervisor|lead)\b/.test(t)) {
    return { isDecisionMaker: false, confidence: 40 };
  }
  return { isDecisionMaker: false, confidence: 0 };
}
