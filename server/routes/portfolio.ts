import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { pool } from "../db";
import { serverError } from "../utils/server-error";

/**
 * Portfolio API — returns each rep's assigned merchants with health signals.
 *
 * Ownership contract: a contact appears in an agent's portfolio when the agent
 * owns ANY active deal for that contact (not just the latest). This ensures a
 * rep retains a merchant in their portfolio even after a newer deal is created
 * by someone else. The latest deal's signals (nextFollowUp, stage) are fetched
 * in a separate join.
 *
 * The contacts table has an assigned_to column (added by Task #1270), but the
 * portfolio intentionally scopes by deals.owner so it surfaces merchants a rep
 * actively worked. Follow-up task #1311 will additionally surface contacts that
 * are assigned to a rep via contacts.assigned_to but have no deal yet.
 *
 * Scoping rules:
 *   agent   → contacts where any deal.owner = their email
 *   manager → all contacts with at least one active deal (or narrow by ?owner=)
 *   admin   → same as manager
 */
export function registerPortfolioRoutes(app: Express) {
  app.get("/api/portfolio", isDashboardUser, async (req, res) => {
    try {
      const user = req.user as any;
      const role: string = user?.role ?? "agent";
      const email: string = user?.email ?? "";

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
        // Include this contact only if the agent owns ANY active deal for it.
        conditions.push(`
          EXISTS (
            SELECT 1 FROM deals d
            WHERE d.contact_id = c.id
              AND d.owner = $${paramIdx}
              AND d.archived_at IS NULL
          )
        `);
        params.push(email);
        paramIdx++;
      } else if (ownerFilter) {
        // manager/admin filtering to a specific rep — same EXISTS predicate.
        conditions.push(`
          EXISTS (
            SELECT 1 FROM deals d
            WHERE d.contact_id = c.id
              AND d.owner = $${paramIdx}
              AND d.archived_at IS NULL
          )
        `);
        params.push(ownerFilter);
        paramIdx++;
      }
      // When no ownerFilter: admin/manager sees all contacts with any deal
      // (guaranteed by the INNER JOIN on latest_deal below).

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
          COALESCE(mhs.risk_tier, 'Unknown')   AS "riskTier",
          COALESCE(mhs.churn_score, 0)         AS "churnScore",
          latest_deal.id                       AS "dealId",
          latest_deal.owner                    AS "ownerEmail",
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
        -- latest deal per contact for signals only (owner of latest deal shown in UI)
        INNER JOIN (
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
   * GET /api/portfolio/owners — for manager/admin dropdowns to pick a rep
   */
  app.get(
    "/api/portfolio/owners",
    isDashboardUser,
    requireRole("admin", "manager"),
    async (_req, res) => {
      try {
        const { rows } = await pool.query(`
          SELECT DISTINCT owner AS email
          FROM deals
          WHERE owner IS NOT NULL AND owner <> '' AND archived_at IS NULL
          ORDER BY owner
        `);
        res.json(rows.map((r: any) => r.email));
      } catch (err: any) {
        serverError(res, err);
      }
    }
  );
}
