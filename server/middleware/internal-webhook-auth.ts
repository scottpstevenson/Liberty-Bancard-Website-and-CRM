import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

let warnedMissing = false;

export function requireInternalWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[InternalWebhook] INTERNAL_WEBHOOK_SECRET not set in production — rejecting request");
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!warnedMissing) {
      console.warn("[InternalWebhook] INTERNAL_WEBHOOK_SECRET not set — skipping verification (dev mode)");
      warnedMissing = true;
    }
    return next();
  }

  const provided = (req.header("x-internal-webhook-secret") || req.header("x-webhook-secret") || "").trim();
  if (!provided) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const expected = Buffer.from(secret);
    const got = Buffer.from(provided);
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}
