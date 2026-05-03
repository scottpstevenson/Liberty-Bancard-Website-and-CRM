import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { upload } from "./helpers";
import { parse } from "csv-parse/sync";
import { sendGhlEmailForMerchant } from "../services/ghl";

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
  app.post("/api/residuals/import", isAuthenticated, upload.single("file"), async (req, res) => {
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
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/residuals/imports", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (user?.role !== "admin" && user?.role !== "manager") {
        return res.status(403).json({ message: "Admin or manager role required" });
      }
      const imports = await storage.getResidualImports();
      res.json(imports);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/residuals/imports/:id", isAuthenticated, async (req, res) => {
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/residuals/imports/:id/confirm", isAuthenticated, async (req, res) => {
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

      const rows = await storage.getResidualImportRows(importRecord.id);

      for (const row of rows) {
        if (row.isMatched && row.matchedDealId) {
          await storage.createMerchantResidual({
            reportId: null,
            dealId: row.matchedDealId,
            contactId: null,
            merchantMid: row.mid,
            merchantName: row.merchantName || "",
            month: importRecord.month,
            volume: row.volume || "0",
            transactions: 0,
            revenue: row.grossResidual || "0",
            cost: "0",
            netRevenue: row.netResidual || "0",
            agentId: row.agentId || null,
            agentCommission: "0",
            volumeChange: null,
            revenueChange: null,
            flags: row.varianceStatus !== "in_range" ? [row.varianceStatus ?? "flagged"] : [],
          });
        }
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
          sendGhlEmailForMerchant({
            email: adminEmail,
            subject: `[Liberty Bancard] Residual Variance Alert — ${importRecord.month} (${flaggedRows.length} flagged)`,
            body: emailBody,
          }).catch(err => {
            console.warn("[Residuals] Variance alert email failed:", err.message);
          }),
        ]);
      }

      const confirmed = await storage.updateResidualImport(importRecord.id, {
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedBy: user.id || user.email || "admin",
      });

      res.json(confirmed);
    } catch (err: any) {
      console.error("[Residuals Confirm]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/residuals/imports/:id", isAuthenticated, async (req, res) => {
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
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/residuals/imports/:importId/rows/:rowId/match", isAuthenticated, async (req, res) => {
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
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/residuals/imports/:id/settings", isAuthenticated, async (req, res) => {
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
      res.status(500).json({ message: err.message });
    }
  });
}
