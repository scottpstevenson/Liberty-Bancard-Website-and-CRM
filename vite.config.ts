import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Allow a single server-side GHL_BOOKING_URL env var to drive the public
// "Book a Call" CTA without requiring a separate VITE_GHL_BOOKING_URL.
// Vite replaces import.meta.env.VITE_GHL_BOOKING_URL at build/dev time with
// GHL_BOOKING_URL when the VITE_ form is absent.
const bookingUrl =
  process.env.VITE_GHL_BOOKING_URL ||
  process.env.GHL_BOOKING_URL ||
  "";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    headers: {
      "Cache-Control": "no-store",
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  define: {
    // Inject GHL_BOOKING_URL so operators only need one env var.
    // If VITE_GHL_BOOKING_URL is already set, it takes precedence at runtime
    // because Vite inlines VITE_* vars before this define runs.
    ...(bookingUrl
      ? { "import.meta.env.VITE_GHL_BOOKING_URL": JSON.stringify(bookingUrl) }
      : {}),
  },
});
