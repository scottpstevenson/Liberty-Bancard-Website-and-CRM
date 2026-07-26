/**
 * Email Design Upgrade — Task #1133
 *
 * Applies consistent, premium visual styling to all sequence email step bodies:
 * - Body text: 13px → 16px, line-height 1.7, color #2d2d2d
 * - Paragraph spacing: margin 0 0 16px 0
 * - Lists: 16px, 6px item spacing
 * - Strong emphasis: Liberty Bancard navy #1e3a5f
 * - Button: navy #1e3a5f, larger padding, 15px font, letter-spacing
 * - Wrapper: max-width 600px centered container
 *
 * No copy changes. No CTA URL changes. No signature changes.
 */

import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

// ── Styles ──────────────────────────────────────────────────────────────────

const P_STYLE =
  "font-size:16px;line-height:1.7;color:#2d2d2d;margin:0 0 16px 0;";
const UL_STYLE =
  "font-size:16px;line-height:1.7;color:#2d2d2d;padding-left:22px;margin:0 0 16px 0;";
const LI_STYLE = "margin-bottom:6px;font-size:16px;";
const STRONG_STYLE = "color:#1e3a5f;";
const CONTAINER_OPEN =
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">';
const CONTAINER_CLOSE = "</div>";

// ── Transform ────────────────────────────────────────────────────────────────

function upgradeBody(body: string | null): string | null {
  if (!body || !body.trim()) return body;

  let html = body;

  // 1. Plain text (no HTML tags) — wrap in a styled paragraph
  const isPlainText = !/<[a-z]/i.test(html);
  if (isPlainText) {
    html = `<p style="${P_STYLE}">${html}</p>`;
  } else {
    // 2. <p> tags without font-size → add upgrade styles
    //    Leave <p style="font-size:11px..."> (disclaimer) untouched
    html = html.replace(/<p(\s+style="([^"]*)")?>/gi, (match, _attr, existingStyle) => {
      const s = existingStyle || "";
      if (/font-size/.test(s)) return match; // preserve disclaimer and any hand-set font-size
      const merged = s ? `${P_STYLE}${s}` : P_STYLE;
      return `<p style="${merged}">`;
    });

    // 3. <ul> tags — add sizing & spacing
    html = html.replace(/<ul(\s+style="([^"]*)")?>/gi, (match, _attr, existingStyle) => {
      const s = existingStyle || "";
      if (/font-size/.test(s)) return match;
      const merged = s ? `${UL_STYLE}${s}` : UL_STYLE;
      return `<ul style="${merged}">`;
    });

    // 4. <ol> tags — same treatment
    html = html.replace(/<ol(\s+style="([^"]*)")?>/gi, (match, _attr, existingStyle) => {
      const s = existingStyle || "";
      if (/font-size/.test(s)) return match;
      const merged = s ? `${UL_STYLE}${s}` : UL_STYLE;
      return `<ol style="${merged}">`;
    });

    // 5. <li> tags
    html = html.replace(/<li(\s+style="([^"]*)")?>/gi, (match, _attr, existingStyle) => {
      const s = existingStyle || "";
      if (/font-size/.test(s)) return match;
      const merged = s ? `${LI_STYLE}${s}` : LI_STYLE;
      return `<li style="${merged}">`;
    });

    // 6. <strong> tags — add navy color
    html = html.replace(/<strong(\s+style="([^"]*)")?>/gi, (match, _attr, existingStyle) => {
      const s = existingStyle || "";
      if (/color/.test(s)) return match; // already has a color
      const merged = s ? `${STRONG_STYLE}${s}` : STRONG_STYLE;
      return `<strong style="${merged}">`;
    });

    // 7. Button <a> tags — update background, padding, add font-size + letter-spacing
    //    Matches any <a ... style="...background:#1a56db...">
    html = html.replace(
      /(<a\b[^>]*\bstyle=")([^"]*background:#1a56db[^"]*)(")/gi,
      (match, pre, style, post) => {
        let s = style;
        // Swap button color
        s = s.replace(/background:#1a56db/gi, "background:#1e3a5f");
        // Upgrade padding variants
        s = s.replace(/padding:10px 20px/gi, "padding:14px 28px");
        s = s.replace(/padding:12px 24px/gi, "padding:14px 28px");
        // Add font-size if missing
        if (!/font-size/.test(s)) s += ";font-size:15px";
        // Add letter-spacing if missing
        if (!/letter-spacing/.test(s)) s += ";letter-spacing:0.3px";
        // Clean double semicolons
        s = s.replace(/;;+/g, ";");
        return `${pre}${s}${post}`;
      }
    );
  }

  // 8. Wrap entire body in 600px container (idempotent check)
  const trimmed = html.trim();
  if (!trimmed.startsWith('<div style="max-width:600px')) {
    html = `${CONTAINER_OPEN}${html}${CONTAINER_CLOSE}`;
  }

  return html;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📧 Email design upgrade starting...\n");

  // Fetch all email steps with a body
  const result = await db.execute(sql`
    SELECT id, body, variant_b_body
    FROM sequence_steps
    WHERE action_type = 'email'
      AND body IS NOT NULL
    ORDER BY id
  `);

  const rows = result.rows as Array<{
    id: number;
    body: string | null;
    variant_b_body: string | null;
  }>;

  console.log(`Found ${rows.length} email steps to process.\n`);

  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const newBody = upgradeBody(row.body);
      const newVariantB = upgradeBody(row.variant_b_body);

      // Skip if nothing changed
      if (newBody === row.body && newVariantB === row.variant_b_body) {
        unchanged++;
        continue;
      }

      await db.execute(sql`
        UPDATE sequence_steps
        SET
          body = ${newBody},
          variant_b_body = ${newVariantB}
        WHERE id = ${row.id}
      `);

      updated++;
      if (updated <= 5) {
        console.log(`  ✓ Step ${row.id} updated`);
      } else if (updated === 6) {
        console.log("  ... (showing first 5 only)");
      }
    } catch (err) {
      errors++;
      console.error(`  ✗ Step ${row.id} ERROR:`, (err as Error).message);
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`   Updated:   ${updated}`);
  console.log(`   Unchanged: ${unchanged}`);
  console.log(`   Errors:    ${errors}`);
  console.log(`   Total:     ${rows.length}`);

  if (errors > 0) {
    console.error("\n❌ Some steps failed. Review errors above.");
    process.exit(1);
  } else {
    console.log("\n✅ Email design upgrade complete.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
