import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { upload } from "./helpers";
import { parse } from "csv-parse/sync";
import { sendGhlInternalNotification } from "../services/ghl";
import { sql, eq, isNotNull } from "drizzle-orm";
import { serverError } from "../utils/server-error";

function parseNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/[$,\s]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function detectColumnMap(headers: string[]): Record<string, string> {
  const lower = headers.map(h => h.toLowerCase().trim());
  const find = (...keys: string[]) => {
    for (const k of keys) {
      const idx = lower.findIndex(h => h.includes(k));
      if (idx !== -1) return headers[idx];
    }
    return "";
  };
  return {
    mid: find("mid", "merchant id", "merchant_id", "account number", "account") || "",
    merchantName: find("dba", "merchant name", "merchant_name", "business name") || "",
    volume: find("volume", "net sales", "gross sales", "sales vol") || "",
    grossResidual: find("gross residual", "gross_residual", "total residual") || "",
    netResidual: find("net residual", "net_residual", "net") || "",
    transactions: find("transactions", "txn count", "txn_count", "transaction count", "trans count", "item count", "items") || "",
    processingCost: find("processing cost", "processing_cost", "interchange", "fees", "cost", "expense") || "",
  };
}

async function parseFileBuffer(buffer: Buffer, mimetype: string): Promise<Record<string, string>[]> {
  const xlsxMimes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];
  const isXlsx = xlsxMimes.includes(mimetype) ||
    mimetype === "application/octet-stream";

  if (isXlsx) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    return rows.map(r => {
      const out: Record<string, string> = {};
      for (const k of Object.keys(r)) {
        out[k] = String(r[k] ?? "");
      }
      return out;
    });
  }

  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
  return records;
}

export function registerResidualsRoutes(app: Express) {
  app.post("/api/residuals/import", requireRole("admin", "manager"), upload.single("file"), async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin" && user?.role !== "manager") {
        return res.status(403).json({ message: "Admin or manager role required" });
      }
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { month, varianceThresholdPct, varianceThresholdAmt } = req.body;
      if (!month) {
        return res.status(400).json({ message: "month is required (YYYY-MM format)" });
      }

      const thresholdPct = parseNum(varianceThresholdPct) || 5;
      const thresholdAmt = parseNum(varianceThresholdAmt) || 50;

      const records = await parseFileBuffer(req.file.buffer, req.file.mimetype);
      if (records.length === 0) {
        return res.status(400).json({ message: "File contains no data rows" });
      }

      const headers = Object.keys(records[0]);
      const colMap = detectColumnMap(headers);

      const { merchantProfiles, merchantResiduals, deals, agentMerchants, companies } = await import("@shared/schema");

      const [allProfiles, allMerchants, allDeals, allAgentMerchants, allCompanies] = await Promise.all([
        db.select().from(merchantProfiles),
        db.select().from(merchantResiduals),
        db.select().from(deals),
        db.select().from(agentMerchants),
        db.select().from(companies),
      ]);

      const dealMap = new Map<number, typeof allDeals[0]>();
      for (const d of allDeals) {
        dealMap.set(d.id, d);
      }

      // dealId -> agentMerchant record for agent attribution on deals without residual history
      const dealToAgentMerchant = new Map<number, typeof allAgentMerchants[0]>();
      for (const am of allAgentMerchants) {
        dealToAgentMerchant.set(am.dealId, am);
      }

      // companyId -> company for merchant name lookups
      const companyMap = new Map<number, typeof allCompanies[0]>();
      for (const c of allCompanies) {
        companyMap.set(c.id, c);
      }

      const midToProfile = new Map<string, typeof allProfiles[0]>();
      for (const p of allProfiles) {
        if (p.merchantMid) midToProfile.set(p.merchantMid.trim().toLowerCase(), p);
      }

      const midToResidual = new Map<string, typeof allMerchants[0][]>();
      for (const r of allMerchants) {
        if (r.merchantMid) {
          const key = r.merchantMid.trim().toLowerCase();
          if (!midToResidual.has(key)) midToResidual.set(key, []);
          midToResidual.get(key)!.push(r);
        }
      }

      // Index deals and agentMerchants by MID for direct matches when there
      // is no merchantProfile or residual history yet.
      const midToDeal = new Map<string, typeof allDeals[0]>();
      for (const d of allDeals) {
        if (d.mid) midToDeal.set(d.mid.trim().toLowerCase(), d);
      }

      const midToAgentMerchant = new Map<string, typeof allAgentMerchants[0]>();
      for (const am of allAgentMerchants) {
        if (am.mid) midToAgentMerchant.set(am.mid.trim().toLowerCase(), am);
      }

      const importRecord = await storage.createResidualImport({
        month,
        fileName: req.file.originalname,
        status: "pending",
        importedBy: user.id || user.email || "admin",
        totalRows: 0,
        matchedRows: 0,
        unmatchedRows: 0,
        flaggedRows: 0,
        totalGrossResidual: "0",
        totalNetResidual: "0",
        totalVariance: "0",
        varianceThresholdPct: thresholdPct,
        varianceThresholdAmt: thresholdAmt,
      });

      const rowsToInsert: import("@shared/schema").InsertResidualImportRow[] = [];
      let matched = 0;
      let unmatched = 0;
      let flagged = 0;
      let totalGross = 0;
      let totalNet = 0;
      let totalVariance = 0;

      for (const record of records) {
        const mid = colMap.mid ? (record[colMap.mid] || "").trim() : "";
        if (!mid) continue;

        const merchantName = colMap.merchantName ? record[colMap.merchantName] || "" : "";
        const volume = colMap.volume ? parseNum(record[colMap.volume]) : 0;
        const grossResidual = colMap.grossResidual ? parseNum(record[colMap.grossResidual]) : 0;
        const netResidual = colMap.netResidual ? parseNum(record[colMap.netResidual]) : grossResidual;

        // Parse transactions and processing cost from the file if available.
        // Absent or empty cells produce null.  Any cell that cannot be
        // interpreted as a complete valid number also produces null — we never
        // fabricate a count or cost from a prefix of a malformed value.

        // Transactions: must be a whole integer after stripping commas/spaces.
        // "12abc", "12.9", "N/A", "" → null.  "1,234" → 1234.
        const parsedTransactions: number | null = (() => {
          const rawTxn = colMap.transactions ? record[colMap.transactions] : undefined;
          if (rawTxn === undefined || rawTxn === null) return null;
          const trimmed = String(rawTxn).trim();
          if (trimmed === "") return null;
          const stripped = trimmed.replace(/[,\s]/g, "");
          // Accept only a complete signed integer — no decimal point, no trailing text.
          if (!/^-?\d+$/.test(stripped)) return null;
          const n = Number(stripped);
          return isFinite(n) ? n : null;
        })();

        // Processing cost: must be a complete decimal currency value after
        // normalising accounting-negative parentheses and stripping $, commas.
        // "123abc", "N/A", "1.2.3" → null.  "(123.45)" → "-123.45".
        const parsedProcessingCost: string | null = (() => {
          const rawCost = colMap.processingCost ? record[colMap.processingCost] : undefined;
          if (rawCost === undefined || rawCost === null) return null;
          const trimmed = String(rawCost).trim();
          if (trimmed === "") return null;
          // Normalise accounting-negative parentheses: (123.45) → -123.45
          const normalised = /^\([\d,.\s]+\)$/.test(trimmed)
            ? "-" + trimmed.slice(1, -1)
            : trimmed;
          const stripped = normalised.replace(/[$,\s]/g, "");
          // Accept only a complete signed decimal — no trailing text, no exponent form.
          if (!/^-?\d+(\.\d+)?$/.test(stripped)) return null;
          const n = Number(stripped);
          return isFinite(n) ? n.toFixed(2) : null;
        })();

        totalGross += grossResidual;
        totalNet += netResidual;

        const midKey = mid.toLowerCase();
        const matchedProfile = midToProfile.get(midKey);
        const matchedResiduals = midToResidual.get(midKey) || [];
        const latestResidual = matchedResiduals.sort((a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        )[0];
        const matchedDeal = midToDeal.get(midKey);
        const matchedAgentMerchant = midToAgentMerchant.get(midKey);

        const isMatched = !!(matchedProfile || latestResidual || matchedDeal || matchedAgentMerchant);

        // Compute expected residual: prefer deal.estimatedNetProfitMonthly from the
        // linked deal record; fall back to most recent residual history; then 0.
        let expectedResidual = 0;
        const linkedDealId =
          matchedProfile?.dealId ??
          latestResidual?.dealId ??
          matchedDeal?.id ??
          matchedAgentMerchant?.dealId ??
          null;
        if (linkedDealId) {
          const deal = dealMap.get(linkedDealId);
          if (deal?.estimatedNetProfitMonthly) {
            expectedResidual = parseNum(deal.estimatedNetProfitMonthly);
          }
        }
        if (expectedResidual === 0 && latestResidual) {
          expectedResidual = parseNum(latestResidual.netRevenue);
        }

        const variance = isMatched ? netResidual - expectedResidual : 0;
        const variancePct = expectedResidual !== 0 ? (variance / expectedResidual) * 100 : 0;

        let varianceStatus = "in_range";
        if (isMatched) {
          const absVariance = Math.abs(variance);
          const absPct = expectedResidual !== 0 ? Math.abs(variancePct) : 0;
          // Flag if the dollar threshold is exceeded (always), or if the pct threshold
          // is exceeded when we have an expected value to compare against.
          const exceedsPct = expectedResidual !== 0 && absPct > thresholdPct;
          const exceedsAmt = absVariance > thresholdAmt;
          if (exceedsPct || exceedsAmt) {
            varianceStatus = variance < 0 ? "under" : "over";
            flagged++;
          }
        }

        totalVariance += variance;

        // Agent attribution: prefer prior residual, then agentMerchants by deal, then 0
        let agentId: number | null = null;
        let agentName: string | null = null;
        const candidateAgentId = latestResidual?.agentId ??
          (linkedDealId ? dealToAgentMerchant.get(linkedDealId)?.agentId ?? null : null);
        if (candidateAgentId) {
          agentId = candidateAgentId;
          const agent = await storage.getAgent(candidateAgentId);
          if (agent) agentName = `${agent.firstName} ${agent.lastName}`;
        }

        // Merchant name: prefer file value, then company DBA/legal name from linked deal/profile, then MID
        let resolvedMerchantName = merchantName;
        if (!resolvedMerchantName && linkedDealId) {
          const linkedDeal = dealMap.get(linkedDealId);
          if (linkedDeal?.companyId) {
            const company = companyMap.get(linkedDeal.companyId);
            if (company) resolvedMerchantName = company.dba || company.legalName || "";
          }
        }
        if (!resolvedMerchantName && matchedProfile?.companyId) {
          const company = companyMap.get(matchedProfile.companyId);
          if (company) resolvedMerchantName = company.dba || company.legalName || "";
        }

        rowsToInsert.push({
          importId: importRecord.id,
          mid,
          merchantName: resolvedMerchantName || mid,
          volume: String(volume),
          grossResidual: String(grossResidual),
          netResidual: String(netResidual),
          expectedResidual: String(expectedResidual),
          variance: String(variance.toFixed(2)),
          variancePct: String(variancePct.toFixed(2)),
          varianceStatus,
          isMatched,
          matchedDealId: linkedDealId,
          matchedProfileId: matchedProfile?.id ?? null,
          agentId,
          agentName,
          transactions: parsedTransactions,
          processingCost: parsedProcessingCost,
          rawData: record,
        });

        if (isMatched) matched++;
        else unmatched++;
      }

      await storage.createResidualImportRowsBulk(rowsToInsert);

      const updated = await storage.updateResidualImport(importRecord.id, {
        totalRows: rowsToInsert.length,
        matchedRows: matched,
        unmatchedRows: unmatched,
        flaggedRows: flagged,
        totalGrossResidual: totalGross.toFixed(2),
        totalNetResidual: totalNet.toFixed(2),
        totalVariance: totalVariance.toFixed(2),
      });

      res.status(201).json(updated);
    } catch (err: any) {
      console.error("[Residuals Import]", err);
      serverError(res, err);
    }
  });

  app.get("/api/residuals/imports", requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin" && user?.role !== "manager") {
        return res.status(403).json({ message: "Admin or manager role required" });
      }
      const imports = await storage.getResidualImports();
      res.json(imports);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/residuals/imports/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin" && user?.role !== "manager") {
        return res.status(403).json({ message: "Admin or manager role required" });
      }
      const importRecord = await storage.getResidualImport(Number(req.params.id));
      if (!importRecord) return res.status(404).json({ message: "Not found" });
      const rows = await storage.getResidualImportRows(importRecord.id);
      res.json({ ...importRecord, rows });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/residuals/imports/:id/confirm", requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin" && user?.role !== "manager") {
        return res.status(403).json({ message: "Admin or manager role required" });
      }

      const importRecord = await storage.getResidualImport(Number(req.params.id));
      if (!importRecord) return res.status(404).json({ message: "Not found" });
      if (importRecord.status === "confirmed") {
        return res.status(400).json({ message: "Import already confirmed" });
      }

      // ── Compute commissions before entering the lock (reads only, no writes) ──
      const rows = await storage.getResidualImportRows(importRecord.id);

      // Cache agent and deal/partnerOrg lookups to avoid redundant DB hits per row
      const agentCache = new Map<number, { commissionSplitPercent: number } | null>();
      const dealCache = new Map<number, { partnerOrgId: number | null } | null>();
      const partnerOrgCache = new Map<number, { commissionRate: number } | null>();

      type ResidualPayload = { row: typeof rows[0]; agentCommission: string; partnerCommission: string };
      const residualsToInsert: ResidualPayload[] = [];

      for (const row of rows) {
        if (row.isMatched && row.matchedDealId) {
          // --- Agent commission ---
          let agentCommission = "0";
          if (row.agentId) {
            if (!agentCache.has(row.agentId)) {
              const agent = await storage.getAgent(row.agentId);
              agentCache.set(row.agentId, agent ? { commissionSplitPercent: agent.commissionSplitPercent ?? 50 } : null);
            }
            const agentData = agentCache.get(row.agentId);
            if (agentData) {
              const netResidual = parseFloat(row.netResidual || "0");
              const splitPct = agentData.commissionSplitPercent;
              const computed = netResidual * (splitPct / 100);
              agentCommission = Math.max(0, computed).toFixed(2);
            }
          }

          // --- Partner org commission ---
          let partnerCommission = "0";
          if (!dealCache.has(row.matchedDealId)) {
            const deal = await storage.getDeal(row.matchedDealId);
            dealCache.set(row.matchedDealId, deal ? { partnerOrgId: deal.partnerOrgId ?? null } : null);
          }
          const dealData = dealCache.get(row.matchedDealId);
          if (dealData?.partnerOrgId) {
            const orgId = dealData.partnerOrgId;
            if (!partnerOrgCache.has(orgId)) {
              const org = await storage.getPartnerOrg(orgId);
              partnerOrgCache.set(orgId, org ? { commissionRate: org.commissionRate ?? 10 } : null);
            }
            const orgData = partnerOrgCache.get(orgId);
            if (orgData) {
              const grossResidual = parseFloat(row.grossResidual || "0");
              const computed = grossResidual * (orgData.commissionRate / 100);
              partnerCommission = Math.max(0, computed).toFixed(2);
            }
          }

          residualsToInsert.push({ row, agentCommission, partnerCommission });
        }
      }

      // ── Serialized, atomic write phase ─────────────────────────────────────────
      // pg_advisory_xact_lock serializes concurrent confirmation requests for this import.
      // It is transaction-scoped: automatically released when the transaction commits or rolls
      // back — no separate unlock call needed, no pool-connection mismatch risk.
      // All writes (residual inserts + status flip) are inside the same transaction, so a
      // partial failure leaves no orphaned rows.
      const { db: dbConn } = await import("../db");
      const userId = user.id || user.email || "admin";

      const confirmed = await dbConn.transaction(async (tx) => {
        // Acquire xact-level advisory lock — blocks until no other tx holds it.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${importRecord.id})`);

        // Re-verify status inside the lock (catches the race between initial check and lock).
        const { rows: statusRows } = await tx.execute(sql`
          SELECT status FROM residual_imports WHERE id = ${importRecord.id} FOR UPDATE
        `);
        if ((statusRows[0] as any)?.status === "confirmed") {
          throw Object.assign(new Error("Import already confirmed"), { alreadyConfirmed: true });
        }

        // Insert residuals idempotently within the transaction.
        // ON CONFLICT DO NOTHING on the (import_id, merchant_mid) partial unique index
        // is the last line of defence against duplicate rows.
        for (const { row, agentCommission, partnerCommission } of residualsToInsert) {
          // Use parsed transactions/cost from the import row; keep NULL when the
          // processor file omitted the column rather than forcing a zero.
          const txnCount: number | null = (row as any).transactions ?? null;
          const procCost: string | null = (row as any).processingCost ?? null;

          await tx.execute(sql`
            INSERT INTO merchant_residuals
              (report_id, import_id, deal_id, contact_id, merchant_mid, merchant_name, month,
               volume, transactions, revenue, cost, net_revenue, agent_id, agent_commission,
               partner_commission, volume_change, revenue_change, flags, created_at)
            VALUES
              (NULL, ${importRecord.id}, ${row.matchedDealId}, NULL, ${row.mid}, ${row.merchantName || ""},
               ${importRecord.month}, ${row.volume || "0"}, ${txnCount}, ${row.grossResidual || "0"}, ${procCost},
               ${row.netResidual || "0"}, ${row.agentId || null}, ${agentCommission}, ${partnerCommission},
               NULL, NULL, ${(row.varianceStatus !== "in_range" ? [row.varianceStatus ?? "flagged"] : [])},
               NOW())
            ON CONFLICT (import_id, merchant_mid) WHERE import_id IS NOT NULL DO NOTHING
          `);
        }

        // Conditionally flip status to confirmed (WHERE status = 'pending' as safety net).
        await tx.execute(sql`
          UPDATE residual_imports
          SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = ${userId}
          WHERE id = ${importRecord.id} AND status = 'pending'
        `);

        // Return the updated record from within the transaction.
        const { rows: updatedRows } = await tx.execute(sql`
          SELECT * FROM residual_imports WHERE id = ${importRecord.id}
        `);
        return updatedRows[0] ?? null;
      }).catch((err: any) => {
        if (err?.alreadyConfirmed) {
          return { __alreadyConfirmed: true } as const;
        }
        throw err;
      });

      if (confirmed && (confirmed as any).__alreadyConfirmed) {
        return res.status(400).json({ message: "Import already confirmed" });
      }

      const flaggedRows = rows.filter(r => r.varianceStatus !== "in_range" && r.isMatched);

      if (flaggedRows.length > 0) {
        const flaggedSummary = flaggedRows.slice(0, 10).map(r =>
          `<tr>
            <td style="padding:4px 8px;border:1px solid #ddd;">${r.mid}</td>
            <td style="padding:4px 8px;border:1px solid #ddd;">${r.merchantName || "—"}</td>
            <td style="padding:4px 8px;border:1px solid #ddd;">$${parseFloat(r.expectedResidual || "0").toFixed(2)}</td>
            <td style="padding:4px 8px;border:1px solid #ddd;">$${parseFloat(r.netResidual || "0").toFixed(2)}</td>
            <td style="padding:4px 8px;border:1px solid #ddd;color:${r.varianceStatus === "under" ? "#dc2626" : "#ea580c"};">
              ${parseFloat(r.variance || "0") >= 0 ? "+" : ""}$${parseFloat(r.variance || "0").toFixed(2)} (${parseFloat(r.variancePct || "0").toFixed(1)}%)
            </td>
            <td style="padding:4px 8px;border:1px solid #ddd;">${r.varianceStatus === "under" ? "Under" : "Over"}</td>
          </tr>`
        ).join("");

        const emailBody = `
          <h2 style="color:#1e3a5f;">Residual Variance Alert — ${importRecord.month}</h2>
          <p>${flaggedRows.length} MID(s) exceeded variance thresholds
            (>${importRecord.varianceThresholdPct}% or >$${importRecord.varianceThresholdAmt})
            in the <strong>${importRecord.month}</strong> reconciliation
            (<em>${importRecord.fileName}</em>).</p>
          <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">MID</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Merchant</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Expected</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Actual</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Variance</th>
                <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Status</th>
              </tr>
            </thead>
            <tbody>${flaggedSummary}</tbody>
          </table>
          ${flaggedRows.length > 10 ? `<p style="color:#666;font-size:12px;">...and ${flaggedRows.length - 10} more. Log in to review the full reconciliation.</p>` : ""}
          <p style="margin-top:16px;color:#666;font-size:12px;">
            This alert was generated by Liberty Bancard Residual Reconciliation.
          </p>
        `;

        const adminEmail = process.env.ADMIN_EMAIL || "scott@libertybancard.com";

        await Promise.allSettled([
          storage.createNotification({
            channel: "internal",
            recipientId: user.id || "admin",
            title: `Residual Variance Alert — ${importRecord.month}`,
            message: `${flaggedRows.length} MID(s) exceeded variance thresholds in the ${importRecord.month} reconciliation.`,
            type: "warning",
            read: false,
            metadata: { importId: importRecord.id, month: importRecord.month, flaggedCount: flaggedRows.length },
          }),
          sendGhlInternalNotification({
            email: adminEmail,
            subject: `[Liberty Bancard] Residual Variance Alert — ${importRecord.month} (${flaggedRows.length} flagged)`,
            body: emailBody,
          }).catch(err => {
            console.warn("[Residuals] Variance alert email failed:", err.message);
          }),
        ]);
      }

      res.json(confirmed);
    } catch (err: any) {
      console.error("[Residuals Confirm]", err);
      serverError(res, err);
    }
  });

  /**
   * GET /api/residuals/imports/:id/reconciliation
   * #1445 — Compare the CSV row count (stored at import time) against the actual DB row count.
   * Returns a ✓ reconciled badge or a mismatch warning for display in the import history table.
   */
  app.get("/api/residuals/imports/:id/reconciliation", requireRole("admin", "manager"), async (req, res) => {
    try {
      const importId = Number(req.params.id);
      if (!Number.isFinite(importId) || importId <= 0) {
        return res.status(400).json({ message: "Invalid import ID" });
      }

      const importRecord = await storage.getResidualImport(importId);
      if (!importRecord) return res.status(404).json({ message: "Import not found" });

      // Count actual rows stored for this import
      const countResult = await db.execute(
        sql`SELECT COUNT(*) AS cnt FROM residual_import_rows WHERE import_id = ${importId}`,
      );
      const dbRowCount = Number((countResult.rows?.[0] as any)?.cnt ?? 0);
      const csvRowCount = importRecord.totalRows ?? 0;

      res.json({
        importId,
        csvRowCount,
        dbRowCount,
        reconciled: dbRowCount === csvRowCount && csvRowCount > 0,
        difference: dbRowCount - csvRowCount,
        status: importRecord.status,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/residuals/imports/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin" && user?.role !== "manager") {
        return res.status(403).json({ message: "Admin or manager role required" });
      }
      const importRecord = await storage.getResidualImport(Number(req.params.id));
      if (!importRecord) return res.status(404).json({ message: "Not found" });
      await storage.deleteResidualImport(importRecord.id);
      res.status(204).send();
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.patch("/api/residuals/imports/:importId/rows/:rowId/match", requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin" && user?.role !== "manager") {
        return res.status(403).json({ message: "Admin or manager role required" });
      }

      const importId = Number(req.params.importId);
      const rowId = Number(req.params.rowId);
      const { dealId } = req.body;
      if (!dealId || isNaN(Number(dealId))) {
        return res.status(400).json({ message: "dealId is required" });
      }

      const importRecord = await storage.getResidualImport(importId);
      if (!importRecord) return res.status(404).json({ message: "Import not found" });
      if (importRecord.status === "confirmed") {
        return res.status(400).json({ message: "Cannot modify a confirmed import" });
      }

      const row = await storage.getResidualImportRow(rowId);
      if (!row || row.importId !== importId) {
        return res.status(404).json({ message: "Row not found" });
      }

      const deal = await storage.getDeal(Number(dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const { merchantProfiles, agentMerchants, companies } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [profile] = await db.select().from(merchantProfiles).where(eq(merchantProfiles.dealId, deal.id));
      const [agentMerchant] = await db.select().from(agentMerchants).where(eq(agentMerchants.dealId, deal.id));

      let merchantName = row.merchantName || "";
      if (deal.companyId) {
        const [company] = await db.select().from(companies).where(eq(companies.id, deal.companyId));
        if (company) merchantName = company.dba || company.legalName || merchantName;
      }

      let expectedResidual = 0;
      if (deal.estimatedNetProfitMonthly) {
        expectedResidual = parseNum(deal.estimatedNetProfitMonthly);
      }

      const netResidual = parseNum(row.netResidual);
      const variance = netResidual - expectedResidual;
      const variancePct = expectedResidual !== 0 ? (variance / expectedResidual) * 100 : 0;

      const thresholdPct = importRecord.varianceThresholdPct ?? 5;
      const thresholdAmt = importRecord.varianceThresholdAmt ?? 50;
      let varianceStatus = "in_range";
      const exceedsPct = expectedResidual !== 0 && Math.abs(variancePct) > thresholdPct;
      const exceedsAmt = Math.abs(variance) > thresholdAmt;
      if (exceedsPct || exceedsAmt) {
        varianceStatus = variance < 0 ? "under" : "over";
      }

      let agentId: number | null = null;
      let agentName: string | null = null;
      if (agentMerchant?.agentId) {
        agentId = agentMerchant.agentId;
        const agent = await storage.getAgent(agentMerchant.agentId);
        if (agent) agentName = `${agent.firstName} ${agent.lastName}`;
      }

      const updatedRow = await storage.updateResidualImportRow(rowId, {
        isMatched: true,
        matchedDealId: deal.id,
        matchedProfileId: profile?.id ?? null,
        merchantName: merchantName || row.mid,
        expectedResidual: String(expectedResidual),
        variance: variance.toFixed(2),
        variancePct: variancePct.toFixed(2),
        varianceStatus,
        agentId,
        agentName,
      });

      // Persist the MID on the merchant profile so future imports auto-match
      // via the midToProfile lookup. Always overwrite — the admin's manual
      // link is the source of truth for this profile's MID going forward.
      if (profile) {
        await db.update(merchantProfiles).set({ merchantMid: row.mid, updatedAt: new Date() }).where(eq(merchantProfiles.id, profile.id));
      }
      // If no merchantProfile exists for the deal, future auto-matching will
      // still work once this import is confirmed, because the confirm step
      // calls createMerchantResidual(dealId, mid) which seeds the
      // midToResidual lookup used by the importer.

      // Recompute import-level aggregate counts based on previous row state
      const wasFlagged = row.varianceStatus && row.varianceStatus !== "in_range" && row.isMatched;
      const isFlaggedNow = varianceStatus !== "in_range";
      const prevVariance = parseNum(row.variance);
      const varianceDelta = variance - (row.isMatched ? prevVariance : 0);

      await storage.updateResidualImport(importId, {
        matchedRows: (importRecord.matchedRows ?? 0) + (row.isMatched ? 0 : 1),
        unmatchedRows: Math.max(0, (importRecord.unmatchedRows ?? 0) - (row.isMatched ? 0 : 1)),
        flaggedRows: (importRecord.flaggedRows ?? 0) + (isFlaggedNow ? 1 : 0) - (wasFlagged ? 1 : 0),
        totalVariance: (parseNum(importRecord.totalVariance) + varianceDelta).toFixed(2),
      });

      res.json(updatedRow);
    } catch (err: any) {
      console.error("[Residuals Match]", err);
      serverError(res, err);
    }
  });

  app.patch("/api/residuals/imports/:id/settings", requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin role required" });
      }
      const { varianceThresholdPct, varianceThresholdAmt } = req.body;
      const updated = await storage.updateResidualImport(Number(req.params.id), {
        varianceThresholdPct: varianceThresholdPct !== undefined ? Number(varianceThresholdPct) : undefined,
        varianceThresholdAmt: varianceThresholdAmt !== undefined ? Number(varianceThresholdAmt) : undefined,
      });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Payout Ledger Routes ────────────────────────────────────────────────

  // Agent sees their own payouts
  app.get("/api/payouts/my", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const rows = await storage.getAgentPayoutsForUser(user.id);
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Admin/manager sees all payouts (filterable by month and status)
  app.get("/api/payouts", requireRole("admin", "manager"), async (req, res) => {
    const VALID_STATUSES = new Set(["pending", "approved", "paid"]);
    try {
      const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
      if (statusRaw && !VALID_STATUSES.has(statusRaw)) {
        return res.status(400).json({ message: "Invalid status filter. Must be one of: pending, approved, paid" });
      }
      const month = typeof req.query.month === "string" ? req.query.month : undefined;
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ message: "Invalid month filter. Must be YYYY-MM format" });
      }
      const rows = await storage.getAgentPayouts({
        status: statusRaw || undefined,
        periodMonth: month || undefined,
      });
      res.json(rows);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Admin generates payout rows for a given YYYY-MM period
  app.post("/api/payouts/generate/:month", requireRole("admin"), async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin role required" });
      }
      const month = String(req.params.month ?? "");
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ message: "month must be YYYY-MM format" });
      }
      const rows = await storage.generatePayoutsForMonth(month);
      res.status(201).json({ generated: rows.length, rows });
    } catch (err: any) {
      console.error("[Payouts Generate]", err);
      serverError(res, err);
    }
  });

  // Admin approves a payout — enforces pending → approved atomically.
  // The WHERE id=? AND status='pending' predicate is part of the UPDATE itself,
  // so concurrent requests cannot both pass validation.
  app.patch("/api/payouts/:id/approve", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid payout id" });
      // Verify row exists first so we can distinguish 404 from 409.
      const payout = await storage.getAgentPayout(id);
      if (!payout) return res.status(404).json({ message: "Payout not found" });
      // Atomic conditional update: only succeeds if status is still 'pending'.
      const updated = await storage.transitionPayoutStatus(id, "pending", "approved", {});
      if (!updated) {
        return res.status(409).json({
          message: `Cannot approve: payout is already '${payout.status}'. Only pending payouts can be approved.`,
          currentStatus: payout.status,
        });
      }
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Admin marks a payout as paid — enforces approved → paid atomically.
  app.patch("/api/payouts/:id/mark-paid", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid payout id" });
      // Verify row exists first so we can distinguish 404 from 409.
      const payout = await storage.getAgentPayout(id);
      if (!payout) return res.status(404).json({ message: "Payout not found" });
      const { notes } = req.body;
      // Atomic conditional update: only succeeds if status is still 'approved'.
      const updated = await storage.transitionPayoutStatus(id, "approved", "paid", {
        paidAt: new Date(),
        notes: notes || payout.notes || undefined,
      });
      if (!updated) {
        return res.status(409).json({
          message: `Cannot mark as paid: payout is '${payout.status}'. Only approved payouts can be marked paid.`,
          currentStatus: payout.status,
        });
      }
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/residuals/by-partner", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { merchantResiduals, deals, partnerOrganizations } = await import("@shared/schema");
      const rows = await db
        .select({
          orgId: partnerOrganizations.id,
          orgName: partnerOrganizations.name,
          orgSlug: partnerOrganizations.slug,
          totalGrossResidual: sql<string>`COALESCE(SUM(${merchantResiduals.revenue}::numeric), 0)`,
          totalNetResidual: sql<string>`COALESCE(SUM(${merchantResiduals.netRevenue}::numeric), 0)`,
          totalPartnerCommission: sql<string>`COALESCE(SUM(${merchantResiduals.partnerCommission}::numeric), 0)`,
          activeMerchants: sql<number>`COUNT(DISTINCT ${merchantResiduals.dealId})`,
        })
        .from(merchantResiduals)
        .innerJoin(deals, eq(deals.id, merchantResiduals.dealId))
        .innerJoin(partnerOrganizations, eq(partnerOrganizations.id, deals.partnerOrgId))
        .where(sql`${deals.partnerOrgId} IS NOT NULL`)
        .groupBy(partnerOrganizations.id, partnerOrganizations.name, partnerOrganizations.slug)
        .orderBy(sql`SUM(${merchantResiduals.netRevenue}::numeric) DESC`);

      res.json(rows);
    } catch (err: any) {
      console.error("[Residuals ByPartner]", err);
      serverError(res, err);
    }
  });
}
