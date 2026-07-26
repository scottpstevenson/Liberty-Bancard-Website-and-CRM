/**
 * Verify email design upgrade and send a test email.
 */
import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

async function main() {
  // Stats
  const stats = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN body LIKE '%max-width:600px%' THEN 1 END) as wrapped,
      COUNT(CASE WHEN body LIKE '%font-size:16px%' THEN 1 END) as has_16px,
      COUNT(CASE WHEN body LIKE '%background:#1e3a5f%' THEN 1 END) as navy_button,
      COUNT(CASE WHEN body LIKE '%background:#1a56db%' THEN 1 END) as old_blue_button,
      COUNT(CASE WHEN body LIKE '%letter-spacing%' THEN 1 END) as has_letter_spacing,
      COUNT(CASE WHEN body LIKE '%color:#1e3a5f%' THEN 1 END) as has_strong_color
    FROM sequence_steps
    WHERE action_type = 'email' AND body IS NOT NULL
  `);
  console.log("VERIFICATION STATS:", JSON.stringify(stats.rows[0], null, 2));

  // Spot-check 3 rows
  const rows = await db.execute(sql`
    SELECT id, LEFT(body, 700) as body_preview
    FROM sequence_steps
    WHERE id IN (1, 12, 15698)
  `);
  for (const r of rows.rows as any[]) {
    console.log(`\n--- Step ${r.id} ---\n${r.body_preview}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
