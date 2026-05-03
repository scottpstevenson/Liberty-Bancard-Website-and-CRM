import rateLimit from "express-rate-limit";

export const publicLeadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many submissions from this IP. Please wait a few minutes and try again.",
  },
});
