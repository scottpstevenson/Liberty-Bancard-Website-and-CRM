import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { pool, db } from "../db";
import { deals } from "@shared/schema";
import { eq } from "drizzle-orm";
import { serverError } from "../utils/server-error";

/**
 * Portfolio API — returns activated merchants with health signals.
 *
 * Membership requires a distinct production, non-archived contact with at
 * least one active MID whose activation timestamp is present. Assignment/deals
 * scope visibility, but neither one creates merchant membership.
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
      const parsedLimit = Number(req.query.limit ?? 100);
      const parsedOffset = Number(req.query.offset ?? 0);
      if (!Number.isSafeInteger(parsedLimit) || !Number.isSafeInteger(parsedOffset) || parsedLimit < 1 || parsedLimit > 500 || parsedOffset < 0) {
        return res.status(400).json({ code: "INVALID_PAGINATION", message: "limit and offset must be valid whole numbers" });
      }
      // manager/admin can pass ?owner=<email> to narrow to one rep's portfolio
      const ownerFilter = req.query.owner ? String(req.query.owner) : null;

      const orderClause =
        sort === "lastContact"
          ? `c.last_contacted_at DESC NULLS LAST`
          : sort === "nextFollowUp"
          ? `latest_deal.next_follow_up ASC NULLS LAST`
          : `risk_order ASC, mhs.churn_score DESC NULLS LAST`;

      // Build WHERE conditions and parameterised values
      const conditions: string[] = [
        "c.archived_at IS NULL",
        "c.record_class = 'production'",
        `EXISTS (
          SELECT 1 FROM merchant_mids eligible_mid
          WHERE eligible_mid.contact_id = c.id
            AND eligible_mid.status = 'active'
            AND eligible_mid.activated_at IS NOT NULL
        )`,
      ];
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
                 AND d.record_class = 'production'
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
                 AND d.record_class = 'production'
            )
          )
        `);
        params.push(ownerFilter);
        paramIdx++;
      }

      const whereClause = conditions.join(" AND ");
      const scopeParams = [...params];

      // paramIdx already consumed by ownership WHERE conditions above; track next slot
      const userEmailParam = `$${paramIdx}`;
      params.push(email);
      paramIdx++;
      const limitParam = `$${paramIdx}`;
      params.push(parsedLimit);
      paramIdx++;
      const offsetParam = `$${paramIdx}`;
      params.push(parsedOffset);
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
           mid_counts.active_mid_count::int     AS "activeMidCount",
           COUNT(*) OVER()::int                 AS portfolio_total,
           COUNT(*) FILTER (WHERE COALESCE(mhs.risk_tier, 'Unknown') = 'Critical') OVER()::int AS portfolio_critical,
           COUNT(*) FILTER (WHERE COALESCE(mhs.risk_tier, 'Unknown') = 'High') OVER()::int AS portfolio_high,
           COALESCE(SUM(COALESCE(tc.open_count, 0)) OVER(), 0)::int AS portfolio_open_tickets,
           COALESCE(SUM(COALESCE(tk.open_count, 0)) OVER(), 0)::int AS portfolio_open_tasks,
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
           WHERE archived_at IS NULL AND record_class = 'production'
           ORDER BY contact_id, updated_at DESC NULLS LAST, id DESC
        ) latest_deal ON latest_deal.contact_id = c.id
         JOIN LATERAL (
           SELECT COUNT(*) AS active_mid_count
           FROM merchant_mids mm
           WHERE mm.contact_id = c.id AND mm.status = 'active' AND mm.activated_at IS NOT NULL
         ) mid_counts ON true
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
         ORDER BY ${orderClause}, c.id ASC
         LIMIT ${limitParam} OFFSET ${offsetParam}
      `;

       const client = await pool.connect();
       let rows: any[] = [];
       let aggregate: any = {};
       let asOf: Date;
       try {
         await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
         const aggregateResult = await client.query(`
           WITH eligible AS MATERIALIZED (
             SELECT c.id
             FROM contacts c
             WHERE ${whereClause}
           )
           SELECT
             (SELECT COUNT(*)::int FROM eligible) AS total,
             (SELECT COUNT(*)::int FROM merchant_mids mm JOIN eligible e ON e.id=mm.contact_id
               WHERE mm.status='active' AND mm.activated_at IS NOT NULL) AS active_mid_count,
             (SELECT COUNT(*)::int FROM eligible e WHERE COALESCE((
               SELECT risk_tier FROM merchant_health_scores WHERE contact_id=e.id ORDER BY computed_at DESC LIMIT 1
             ), 'Unknown')='Critical') AS critical,
             (SELECT COUNT(*)::int FROM eligible e WHERE COALESCE((
               SELECT risk_tier FROM merchant_health_scores WHERE contact_id=e.id ORDER BY computed_at DESC LIMIT 1
             ), 'Unknown')='High') AS high,
             (SELECT COUNT(*)::int FROM tickets t JOIN eligible e ON e.id=t.contact_id
               WHERE t.status NOT IN ('Closed','Resolved')) AS open_tickets,
             (SELECT COUNT(*)::int FROM tasks t JOIN eligible e ON e.id=t.contact_id
               WHERE t.status IN ('pending','open') AND t.deleted_at IS NULL) AS open_tasks,
             CURRENT_TIMESTAMP AS as_of
         `, scopeParams);
         aggregate = aggregateResult.rows[0] ?? {};
         asOf = aggregate.as_of;
         ({ rows } = await client.query(sql, params));
         await client.query("COMMIT");
       } catch (error) {
         await client.query("ROLLBACK").catch(() => {});
         throw error;
       } finally {
         client.release();
       }

      // Compute editableDealId: agents may only PATCH their own deal;
      // admins/managers may PATCH the latest deal (PUT guard allows it).
      const data = rows.map(({ risk_order, userDealId, portfolio_total, portfolio_critical, portfolio_high, portfolio_open_tickets, portfolio_open_tasks, ...rest }: any) => ({
        ...rest,
        editableDealId: (role === "agent") ? (userDealId ?? null) : (rest.dealId ?? null),
      }));

      res.json({
        data,
        total: aggregate.total ?? 0,
        limit: parsedLimit,
        offset: parsedOffset,
        filters: { owner: ownerFilter, sort },
        scope: role === "agent" ? "owned" : ownerFilter ? "owner_filtered" : "all",
        asOf: new Date(asOf!).toISOString(),
        summary: {
          total: aggregate.total ?? 0,
          activeMidCount: aggregate.active_mid_count ?? 0,
          critical: aggregate.critical ?? 0,
          high: aggregate.high ?? 0,
          totalOpenTickets: aggregate.open_tickets ?? 0,
          totalOpenTasks: aggregate.open_tasks ?? 0,
        },
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
        const dealId = parseInt(req.params["dealId"] as string, 10);
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
