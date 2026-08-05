import type { Express } from "express";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { db } from "../db";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { chargeCard, refundTransaction } from "../services/nmi-gateway";
import { serverError, safeMessage } from "../utils/server-error";

const chargeSchema = z.object({
  cardholderName: z.string().min(2, "Cardholder name is required"),
  cardNumber: z.string().min(13, "Card number is invalid").max(19),
  expMonth: z.string().regex(/^(0[1-9]|1[0-2])$/, "Invalid expiry month"),
  expYear: z.string().regex(/^\d{2,4}$/, "Invalid expiry year"),
  cvv: z.string().min(3, "CVV is required").max(4),
  billingZip: z.string().min(3, "Billing ZIP is required"),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a valid number (e.g. 50.00)"),
  memo: z.string().optional(),
});

const refundSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a valid number"),
});

function hasVirtualTerminalPermission(user: any): boolean {
  if (user?.role === "admin" || user?.role === "manager") return true;
  const permissions: string[] = user?.permissions || [];
  return permissions.includes("virtual_terminal");
}

function isSuperUser(user: any): boolean {
  return user?.role === "admin" || user?.role === "manager";
}

export function registerVirtualTerminalRoutes(app: Express) {
  app.post("/api/virtual-terminal/charge", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    if (!hasVirtualTerminalPermission(user)) {
      return res.status(403).json({ message: "You do not have Virtual Terminal access. Contact an admin to enable it." });
    }

    try {
      const input = chargeSchema.parse(req.body);
      const { virtualTerminalTransactions } = await import("@shared/schema");

      const result = await chargeCard({
        amount: input.amount,
        cardNumber: input.cardNumber,
        expMonth: input.expMonth,
        expYear: input.expYear,
        cvv: input.cvv,
        cardholderName: input.cardholderName,
        billingZip: input.billingZip,
        memo: input.memo,
      });

      const lastFour = input.cardNumber.replace(/\s/g, "").slice(-4);
      const cardType = detectCardType(input.cardNumber);

      const status = result.approved ? "approved" : "declined";

      const [txn] = await db.insert(virtualTerminalTransactions).values({
        gatewayTransactionId: result.gatewayTransactionId || null,
        authCode: result.authCode || null,
        status,
        amount: input.amount,
        refundedAmount: "0",
        cardType,
        lastFour,
        cardholderName: input.cardholderName,
        billingZip: input.billingZip,
        memo: input.memo || null,
        responseCode: result.responseCode || null,
        responseText: result.responseText || null,
        processedBy: user.id,
        rawResponse: result.rawResponse || null,
      }).returning();

      res.json({
        transaction: txn,
        approved: result.approved,
        authCode: result.authCode,
        gatewayTransactionId: result.gatewayTransactionId,
        responseCode: result.responseCode || null,
        responseText: result.responseText,
        sandboxMode: result.sandboxMode || false,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      }
      serverError(res, err);
    }
  });

  app.post("/api/virtual-terminal/refund/:transactionId", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    if (!hasVirtualTerminalPermission(user)) {
      return res.status(403).json({ message: "You do not have Virtual Terminal access." });
    }

    try {
      const input = refundSchema.parse(req.body);
      const { virtualTerminalTransactions } = await import("@shared/schema");

      const [txn] = await db.select().from(virtualTerminalTransactions).where(eq(virtualTerminalTransactions.id, Number(req.params.transactionId)));
      if (!txn) return res.status(404).json({ message: "Transaction not found" });
      if (!isSuperUser(user) && txn.processedBy !== user.id) {
        return res.status(403).json({ message: "You can only refund transactions you processed." });
      }
      if (txn.status !== "approved" && txn.status !== "partially_refunded") {
        return res.status(400).json({ message: "Only approved or partially refunded transactions can be refunded" });
      }

      const refundAmt = parseFloat(input.amount);
      const origAmt = parseFloat(txn.amount);
      const alreadyRefunded = parseFloat(txn.refundedAmount || "0");
      if (refundAmt > origAmt - alreadyRefunded) {
        return res.status(400).json({ message: `Refund amount exceeds refundable balance of $${(origAmt - alreadyRefunded).toFixed(2)}` });
      }

      let refundGatewayTxId = txn.gatewayTransactionId;
      let refundText = "Refund processed";
      let sandboxMode = false;

      if (txn.gatewayTransactionId && !txn.gatewayTransactionId.startsWith("SANDBOX-")) {
        const refundResult = await refundTransaction({
          gatewayTransactionId: txn.gatewayTransactionId,
          amount: input.amount,
        });
        if (!refundResult.success) {
          console.error("[VirtualTerminal] Refund failed:", refundResult.responseText);
          return res.status(500).json({ message: safeMessage(refundResult.responseText, "Refund failed") });
        }
        refundGatewayTxId = refundResult.gatewayTransactionId || txn.gatewayTransactionId;
        refundText = refundResult.responseText || "Refund processed";
        sandboxMode = refundResult.sandboxMode || false;
      } else {
        sandboxMode = true;
        refundText = "Refund processed (Sandbox Mode)";
      }

      const newRefunded = (alreadyRefunded + refundAmt).toFixed(2);
      const newStatus = parseFloat(newRefunded) >= origAmt ? "refunded" : "partially_refunded";

      const [updated] = await db.update(virtualTerminalTransactions)
        .set({
          status: newStatus,
          refundedAmount: newRefunded,
          refundedBy: user.id,
          refundedAt: new Date(),
        })
        .where(eq(virtualTerminalTransactions.id, txn.id))
        .returning();

      res.json({ transaction: updated, refundText, sandboxMode });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      serverError(res, err);
    }
  });

  app.get("/api/virtual-terminal/transactions", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    if (!hasVirtualTerminalPermission(user)) {
      return res.status(403).json({ message: "You do not have Virtual Terminal access." });
    }

    try {
      const { virtualTerminalTransactions } = await import("@shared/schema");
      const query = db.select().from(virtualTerminalTransactions);
      const transactions = isSuperUser(user)
        ? await query.orderBy(desc(virtualTerminalTransactions.createdAt)).limit(500)
        : await query.where(eq(virtualTerminalTransactions.processedBy, user.id)).orderBy(desc(virtualTerminalTransactions.createdAt)).limit(200);
      res.json(transactions);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.put("/api/admin/users/:id/permissions", requireRole("admin"), async (req, res) => {
    try {
      const { permissions } = req.body;
      if (!Array.isArray(permissions)) return res.status(400).json({ message: "permissions must be an array" });
      const { users } = await import("@shared/schema");
      const [existing] = await db.select().from(users).where(eq(users.id, String(req.params.id)));
      const [updated] = await db.update(users).set({ permissions, updatedAt: new Date() }).where(eq(users.id, String(req.params.id))).returning();
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { auditChange } = await import("../services/audit-change");
      auditChange({ actorType: "user", userId: (req.user as any)?.id ?? null, action: "user_permissions_changed",
        entityType: "user", entityKey: updated.id,
        before: existing ? { permissions: existing.permissions } : null,
        after: { permissions: updated.permissions } }).catch(() => {});
      const { passwordHash, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err: any) {
      serverError(res, err);
    }
  });
}

function detectCardType(cardNumber: string): string {
  const num = cardNumber.replace(/\s/g, "");
  if (/^4/.test(num)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(num)) return "mastercard";
  if (/^3[47]/.test(num)) return "amex";
  if (/^(6011|622|64[4-9]|65)/.test(num)) return "discover";
  if (/^35/.test(num)) return "jcb";
  return "unknown";
}
