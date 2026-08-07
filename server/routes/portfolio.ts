import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { pool, db } from "../db";
import { deals } from "@shared/schema";
import { eq } from "drizzle-orm";
import { serverError } from "../utils/server-error";

/**
 * Portfolio API — returns each rep's assigned merchants with health signals.
 *
 * Ownership contract: a contact appears in an agent's portfolio when either:
 *   (a) the agent owns ANY active deal for that contact, OR
 *   (b) contacts.assigned_to = the agent's email (even with no deal yet).
 *
 * The latest deal's signals (nextFollowUp, stage) are fetched via a LEFT JOIN
 * so that dealless-but-assigned contacts still appear. ownerEmail falls back to
 * contacts.assigned_to when no deal exists.
 *
 * Scoping rules:
 *   agent   → contacts where any deal.owner = email  OR  assigned_to = email
 *   manager → all contacts (deal exists OR assigned_to set), optionally narrowed
 *             by ?owner= which applies the same OR logic
 *   admin   → same as manager
 */
export function registerPortfolioRoutes(app: Express) {
  app.get("/api/portfolio", isDashboardUser, async (req, res) => {
    try {
      const user = req.user as any;
      const rawRole: string = user?.role ?? "";
      const email: string = user?.email ?? "";

      // Only known dashboard roles are allowed; anything else is treated as agent
      // (most restrictive) to prevent unknown roles from seeing all contacts.
      const validRoles = new Set(["admin", "manager", "agent"]);
      const role: string = validRoles.has(rawRole) ? rawRole : "agent";

      const sort = (req.query.sort as string) || "risk";
      // manager/admin can pass ?owner=<email> to narrow to one rep's portfolio
      const ownerFilter = req.query.owner ? String(req.query.owner) : null;

      const orderClause =
        sort === "lastContact"
          ? `c.last_contacted_at DESC NULLS LAST`
          : sort === "nextFollowUp"
          ? `latest_deal.next_follow_up ASC NULLS LAST`
          : `risk_order ASC, mhs.churn_score DESC NULLS LAST`;

      // Build WHERE conditions and parameterised values
      const conditions: string[] = ["c.archived_at IS NULL"];
      const params: any[] = [];
      let paramIdx = 1;

      if (role === "agent") {
        // Include contacts where the agent owns ANY active deal OR is directly assigned.
        conditions.push(`
          (
            c.assigned_to = $${paramIdx}
            OR EXISTS (
              SELECT 1 FROM deals d
              WHERE d.contact_id = c.id
                AND d.owner = $${paramIdx}
                AND d.archived_at IS NULL
            )
          )
        `);
        params.push(email);
        paramIdx++;
      } else if (ownerFilter) {
        // manager/admin narrowing to one rep — same OR logic.
        conditions.push(`
          (
            c.assigned_to = $${paramIdx}
            OR EXISTS (
              SELECT 1 FROM deals d
              WHERE d.contact_id = c.id
                AND d.owner = $${paramIdx}
                AND d.archived_at IS NULL
            )
          )
        `);
        params.push(ownerFilter);
        paramIdx++;
      } else {
        // admin/manager with no filter: all contacts that have any deal or any assignment.
        conditions.push(`(latest_deal.contact_id IS NOT NULL OR c.assigned_to IS NOT NULL)`);
      }

      const whereClause = conditions.join(" AND ");

      // paramIdx already consumed by ownership WHERE conditions above; track next slot
      const userEmailParam = `$${paramIdx}`;
      params.push(email);
      paramIdx++;

      const sql = `
        SELECT
          c.id,
          c.first_name                         AS "firstName",
          c.last_name                          AS "lastName",
          c.company_name                       AS "companyName",
          c.email,
          c.phone,
          c.last_contacted_at                  AS "lastContactedAt",
          c.assigned_to                        AS "assignedTo",
          COALESCE(mhs.risk_tier, 'Unknown')   AS "riskTier",
          COALESCE(mhs.churn_score, 0)         AS "churnScore",
          latest_deal.id                       AS "dealId",
          COALESCE(latest_deal.owner, c.assigned_to) AS "ownerEmail",
          latest_deal.next_follow_up           AS "nextFollowUp",
          latest_deal.stage                    AS "dealStage",
          latest_deal.pipeline                 AS "dealPipeline",
          user_deal.id                         AS "userDealId",
          COALESCE(tc.open_count, 0)::int      AS "openTickets",
          COALESCE(tk.open_count, 0)::int      AS "openTasks",
          CASE COALESCE(mhs.risk_tier, 'Unknown')
            WHEN 'Critical' THEN 1
            WHEN 'High'     THEN 2
            WHEN 'Medium'   THEN 3
            WHEN 'Low'      THEN 4
            ELSE 5
          END AS risk_order
        FROM contacts c
        -- latest deal per contact for signals only; LEFT so dealless-assigned contacts appear
        LEFT JOIN (
          SELECT DISTINCT ON (contact_id)
            id, contact_id, owner, next_follow_up, stage, pipeline
          FROM deals
          WHERE archived_at IS NULL
          ORDER BY contact_id, created_at DESC
        ) latest_deal ON latest_deal.contact_id = c.id
        -- the logged-in user's most recent deal for this contact (used for editability)
        LEFT JOIN LATERAL (
          SELECT id
          FROM deals d_user
          WHERE d_user.contact_id = c.id
            AND d_user.owner = ${userEmailParam}
            AND d_user.archived_at IS NULL
          ORDER BY d_user.created_at DESC
          LIMIT 1
        ) user_deal ON true
        LEFT JOIN LATERAL (
          SELECT risk_tier, churn_score
          FROM merchant_health_scores
          WHERE contact_id = c.id
          ORDER BY computed_at DESC
          LIMIT 1
        ) mhs ON true
        LEFT JOIN (
          SELECT contact_id, COUNT(*)::int AS open_count
          FROM tickets
          WHERE status NOT IN ('Closed', 'Resolved')
            AND contact_id IS NOT NULL
          GROUP BY contact_id
        ) tc ON tc.contact_id = c.id
        LEFT JOIN (
          SELECT contact_id, COUNT(*)::int AS open_count
          FROM tasks
          WHERE status IN ('pending', 'open')
            AND contact_id IS NOT NULL
            AND deleted_at IS NULL
          GROUP BY contact_id
        ) tk ON tk.contact_id = c.id
        WHERE ${whereClause}
        ORDER BY ${orderClause}
        LIMIT 500
      `;

      const { rows } = await pool.query(sql, params);

      // Compute editableDealId: agents may only PATCH their own deal;
      // admins/managers may PATCH the latest deal (PUT guard allows it).
      const data = rows.map(({ risk_order, userDealId, ...rest }: any) => ({
        ...rest,
        editableDealId: (role === "agent") ? (userDealId ?? null) : (rest.dealId ?? null),
      }));

      const critical = data.filter((r: any) => r.riskTier === "Critical").length;
      const high = data.filter((r: any) => r.riskTier === "High").length;
      const totalOpenTickets = data.reduce((s: number, r: any) => s + (r.openTickets ?? 0), 0);
      const totalOpenTasks = data.reduce((s: number, r: any) => s + (r.openTasks ?? 0), 0);

      res.json({
        data,
        summary: { total: data.length, critical, high, totalOpenTickets, totalOpenTasks },
      });
    } catch (err: any) {
      console.error("[portfolio] error:", err.message);
      serverError(res, err);
    }
  });

  /**
   * PATCH /api/portfolio/deals/:dealId/suppress-vas-upsell
   * Allows a rep, manager, or admin to opt a merchant out of the Day-30
   * automatic VAS sequence enrollment. Pass { suppressed: true, reason? } to
   * suppress, { suppressed: false } to lift the suppression.
   *
   * Agents may only suppress deals they own; admins/managers can suppress any.
   */
  app.patch(
    "/api/portfolio/deals/:dealId/suppress-vas-upsell",
    isDashboardUser,
    async (req, res) => {
      try {
        const dealId = parseInt(req.params.dealId, 10);
        if (!dealId || isNaN(dealId)) {
          return res.status(400).json({ message: "Invalid dealId" });
        }

        const user = req.user as any;
        const role: string = user?.role ?? "agent";
        const email: string = user?.email ?? "";

        // Load deal to check ownership
        const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
        if (!deal) {
          return res.status(404).json({ message: "Deal not found" });
        }

        // Agents may only modify their own deals
        if (role === "agent" && deal.owner !== email) {
          return res.status(403).json({ message: "You may only manage suppression for your own deals" });
        }

        const { suppressed, reason } = req.body as { suppressed: boolean; reason?: string };

        if (suppressed) {
          await db
            .update(deals)
            .set({
              vasUpsellSuppressedAt: new Date(),
              vasUpsellSuppressedReason: reason || `Suppressed by ${email}`,
            } as any)
            .where(eq(deals.id, dealId));
        } else {
          await db
            .update(deals)
            .set({
              vasUpsellSuppressedAt: null,
              vasUpsellSuppressedReason: null,
            } as any)
            .where(eq(deals.id, dealId));
        }

        const { storage } = await import("../storage");
        await storage.createAuditLog({
          action: suppressed ? "vas_upsell_suppressed" : "vas_upsell_suppression_lifted",
          entityType: "deal",
          entityId: dealId,
          actorType: "user",
          details: { suppressed, reason: reason || null, actor: email, contactId: deal.contactId },
        });

        res.json({ ok: true, dealId, suppressed, vasUpsellSuppressedAt: suppressed ? new Date() : null });
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );

  /**
   * GET /api/portfolio/owners — for manager/admin dropdowns to pick a rep
   */
  app.get(
    "/api/portfolio/owners",
    isDashboardUser,
    requireRole("admin", "manager"),
    async (_req, res) => {
      try {
        const { rows } = await pool.query(`
          SELECT DISTINCT email FROM (
            SELECT owner AS email
            FROM deals
            WHERE owner IS NOT NULL AND owner <> '' AND archived_at IS NULL
            UNION
            SELECT assigned_to AS email
            FROM contacts
            WHERE assigned_to IS NOT NULL AND assigned_to <> '' AND archived_at IS NULL
          ) combined
          ORDER BY email
        `);
        res.json(rows.map((r: any) => r.email));
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );
}
