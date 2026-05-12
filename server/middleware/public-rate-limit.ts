import rateLimit from "express-rate-limit";

export const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many webhook requests from this IP. Please slow down.",
  },
});

export const verifyEmailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many verification attempts from this IP. Please wait a few minutes and try again.",
  },
});

export const publicLeadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many submissions from this IP. Please wait a few minutes and try again.",
  },
});

export const merchantAuthRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many login attempts from this IP. Please wait a few minutes and try again.",
  },
  // Allow loopback requests to bypass the limiter outside production so the
  // role-guard smoke test (scripts/smoke-role-guards.ts) can authenticate
  // repeatedly without tripping a 429. Production traffic is unaffected.
  skip: (req) => {
    if (process.env.NODE_ENV === "production") return false;
    const ip = req.ip ?? "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
});
