import PDFDocument from "pdfkit";
import type { Chargeback } from "@shared/schema";

interface AiPacket {
  rebuttalletter: string;
  evidenceChecklist: { item: string; status: "included" | "missing" | "partial"; notes?: string }[];
  winLikelihood: { estimate: string; rationale: string };
  reasonCodeContext: string;
  generatedAt: string;
  finalizedAt?: string;
  editedRebuttal?: string;
  merchantProfile?: {
    merchantName: string;
    address?: string;
    city?: string;
    state?: string;
    website?: string;
    vertical?: string;
    mid?: string;
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function statusColor(status: string): string {
  if (status === "included") return "#15803d";
  if (status === "partial") return "#d97706";
  return "#dc2626";
}

export interface ChargebackPdfContact {
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ChargebackPdfDeal {
  id: number;
  stage?: string | null;
  pipeline?: string | null;
  owner?: string | null;
}

export async function generateChargebackEvidencePdf(params: {
  chargeback: Chargeback;
  contact?: ChargebackPdfContact | null;
  deal?: ChargebackPdfDeal | null;
}): Promise<Buffer> {
  const { chargeback: cb, contact, deal } = params;
  const packet = (cb.aiEvidencePacket as AiPacket | null) || null;
  const mp = packet?.merchantProfile;

  const finalLetter = packet?.editedRebuttal || packet?.rebuttalletter || "No rebuttal letter has been drafted yet.";
  const checklist = packet?.evidenceChecklist || [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 50,
      info: {
        Title: `Chargeback Evidence Packet #${cb.id}`,
        Author: "Liberty Bancard",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const primaryHex = "#1e3a5f";

    // Header band
    doc.rect(0, 0, doc.page.width, 60).fill(primaryHex);
    doc.fillColor("#ffffff").fontSize(16).font("Helvetica-Bold").text("Chargeback Evidence Packet & Rebuttal Letter", 50, 20);
    doc.fontSize(9).font("Helvetica").fillColor("#dbe4ee").text(
      `Chargeback #${cb.id}${mp?.merchantName ? `  ·  ${mp.merchantName}` : ""}`,
      50,
      42
    );

    doc.y = 80;
    doc.fillColor("#111111");

    // Merchant / contact / deal info
    doc.font("Helvetica-Bold").fontSize(11).text("Merchant Information");
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(9.5).fillColor("#333333");
    const merchantName = mp?.merchantName || contact?.companyName || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || "Unknown Merchant";
    doc.text(`Merchant: ${merchantName}`);
    const addressLine = [mp?.address, [mp?.city, mp?.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    if (addressLine) doc.text(`Address: ${addressLine}`);
    if (mp?.website) doc.text(`Website: ${mp.website}`);
    if (mp?.vertical) doc.text(`Industry: ${mp.vertical}`);
    if (mp?.mid) doc.text(`MID: ${mp.mid}`);
    if (contact?.email) doc.text(`Contact Email: ${contact.email}`);
    if (contact?.phone) doc.text(`Contact Phone: ${contact.phone}`);
    if (deal) doc.text(`Deal: #${deal.id}${deal.stage ? ` — ${deal.stage}` : ""}${deal.pipeline ? ` (${deal.pipeline})` : ""}`);

    doc.moveDown(0.8);

    // Dispute metadata box
    const boxTop = doc.y;
    const rows: [string, string][] = [
      ["Reason Code", cb.reasonCode],
      ["Card Brand", cb.cardBrand],
      ["Dispute Amount", formatCurrency(cb.amount)],
      ["Transaction Date", formatDate(cb.transactionDate)],
      ["Response Deadline", formatDate(cb.responseDeadline)],
      ["Status", cb.status],
    ];
    if (packet?.winLikelihood?.estimate) rows.push(["Win Likelihood", packet.winLikelihood.estimate]);
    if (packet?.generatedAt) rows.push(["Packet Generated", new Date(packet.generatedAt).toLocaleString()]);
    if (packet?.finalizedAt) rows.push(["Finalized", new Date(packet.finalizedAt).toLocaleString()]);

    const boxHeight = 16 + rows.length * 13;
    doc.rect(50, boxTop, doc.page.width - 100, boxHeight).fillAndStroke("#f9f9f9", "#e5e5e5");
    doc.fillColor("#333333").fontSize(9);
    let rowY = boxTop + 8;
    for (const [label, value] of rows) {
      doc.font("Helvetica-Bold").text(`${label}: `, 60, rowY, { continued: true });
      doc.font("Helvetica").text(value);
      rowY += 13;
    }
    doc.y = boxTop + boxHeight + 16;

    // Dispute context
    if (packet?.reasonCodeContext) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryHex).text("Dispute Context");
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(9.5).fillColor("#333333").text(packet.reasonCodeContext, { align: "left" });
      doc.moveDown(0.8);
    }

    // Rebuttal letter
    doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryHex).text("Rebuttal Letter");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9.5).fillColor("#111111").text(finalLetter, { align: "left", lineGap: 2 });
    doc.moveDown(0.8);

    // Evidence checklist
    if (checklist.length > 0) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryHex).text("Evidence Checklist");
      doc.moveDown(0.3);

      const colX = { item: 50, status: 300, notes: 380 };
      const tableTop = doc.y;
      doc.rect(50, tableTop, doc.page.width - 100, 16).fill(primaryHex);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
      doc.text("Evidence Item", colX.item + 4, tableTop + 4, { width: colX.status - colX.item - 8 });
      doc.text("Status", colX.status + 4, tableTop + 4, { width: colX.notes - colX.status - 8 });
      doc.text("Notes", colX.notes + 4, tableTop + 4, { width: doc.page.width - 50 - colX.notes - 4 });

      let y = tableTop + 16;
      doc.font("Helvetica").fontSize(9);
      for (const item of checklist) {
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 50;
        }
        const itemHeight = Math.max(
          doc.heightOfString(item.item, { width: colX.status - colX.item - 8 }),
          doc.heightOfString(item.notes || "", { width: doc.page.width - 50 - colX.notes - 4 })
        ) + 8;
        doc.rect(50, y, doc.page.width - 100, itemHeight).stroke("#dddddd");
        doc.fillColor("#111111").text(item.item, colX.item + 4, y + 4, { width: colX.status - colX.item - 8 });
        doc.fillColor(statusColor(item.status)).font("Helvetica-Bold").text(
          item.status.charAt(0).toUpperCase() + item.status.slice(1),
          colX.status + 4,
          y + 4,
          { width: colX.notes - colX.status - 8 }
        );
        doc.font("Helvetica").fillColor("#333333").text(item.notes || "", colX.notes + 4, y + 4, { width: doc.page.width - 50 - colX.notes - 4 });
        y += itemHeight;
      }
      doc.y = y + 16;
    }

    // Win likelihood
    if (packet?.winLikelihood) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryHex).text("Win Likelihood Assessment");
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111111").text(packet.winLikelihood.estimate, { continued: true });
      doc.font("Helvetica").text(` — ${packet.winLikelihood.rationale}`);
      doc.moveDown(0.8);
    }

    // Supporting notes
    if (cb.notes) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryHex).text("Supporting Notes");
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(9.5).fillColor("#333333").text(cb.notes);
      doc.moveDown(0.8);
    }

    // Evidence file references (names/labels only — never raw storage paths/keys)
    const evidenceFiles = (cb.evidenceFiles as { name: string; uploadedAt: string }[] | null) || [];
    if (evidenceFiles.length > 0) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryHex).text("Attached Evidence References");
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(9.5).fillColor("#333333");
      for (const f of evidenceFiles) {
        doc.text(`• ${f.name}${f.uploadedAt ? ` (uploaded ${formatDate(f.uploadedAt)})` : ""}`);
      }
      doc.moveDown(0.8);
    }

    // Footer
    doc.fontSize(8).fillColor("#777777").text(
      `Generated by Liberty Bancard AI Chargeback Copilot on ${new Date().toLocaleString()} · For internal use only. Verify all evidence before submission.`,
      50,
      doc.page.height - 40,
      { align: "center", width: doc.page.width - 100 }
    );

    doc.end();
  });
}
