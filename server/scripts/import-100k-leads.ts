import pg from "pg";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { recordContactIdentityObservationsForPgContacts } from "../services/contact-identity";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function normalizePhone(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function classifyVertical(industry: string, companyName: string, keywords: string = ""): string {
  const text = `${industry} ${companyName} ${keywords}`.toLowerCase();

  if (/restaurant|food |pizza|burger|taco|sushi|cafe|coffee|bakery|catering|bar\b|grill|diner|eatery|bistro|cuisine|kitchen/.test(text)) return "Restaurant";
  if (/auto|car |vehicle|mechanic|tire|collision|body shop|transmission|brake|oil change|lube|muffler|exhaust|towing|automotive/.test(text)) return "Auto";
  if (/retail|store|shop\b|boutique|gift|apparel|clothing|fashion|jewelry|shoe|furniture/.test(text)) return "Retail";
  if (/salon|spa\b|beauty|hair\b|nail\b|barber|cosmet|skincare|esthetic|waxing|lash\b|brow\b|med spa|medical spa|medspa/.test(text)) return "Salon/Spa";
  if (/medical|doctor|physician|dental|dentist|chiropr|optom|pharma|clinic|hospital|healthcare|health care|urgent care|veterinar|vet\b|plastic surg|dermatol|orthoped/.test(text)) return "Healthcare";
  if (/fitness|gym\b|yoga|pilates|martial art|boxing|crossfit|personal train|recreation|swim|sport/.test(text)) return "Fitness/Recreation";
  if (/food|beverage|drink|juice|smoothie|ice cream|donut|wine|liquor|brewery/.test(text)) return "Food/Beverage";
  if (/construct|contractor|plumb|electric|hvac|roof|paint|landscap|concrete|mason|carpenter|remodel|renovati|flooring|handyman|paving|paver|excavat/.test(text)) return "Construction";
  if (/law\b|legal|attorney|lawyer/.test(text)) return "Legal";
  if (/account|cpa\b|bookkeep|tax prep/.test(text)) return "Accounting";
  if (/consult|professional service|management consulting|staffing|recruit|human resource/.test(text)) return "Professional Services";
  if (/e-commerce|ecommerce|online store|shopify/.test(text)) return "E-commerce";
  if (/transport|trucking|freight|logistics|moving|courier|delivery|shipping/.test(text)) return "Transportation";
  if (/real estate|realtor|property|mortgage|title company/.test(text)) return "Real Estate";
  if (/insurance/.test(text)) return "Insurance";
  if (/hotel|motel|lodging|hospitality|travel|tour|resort|vacation|leisure/.test(text)) return "Hospitality";
  if (/clean|janitorial|laundry|dry clean|maid|housekeep/.test(text)) return "Cleaning Services";
  if (/print|sign |graphic design|marketing|advertis|media|photo|video|creative/.test(text)) return "Marketing/Media";
  if (/tech|software|it\b|information technology|web design|web develop|app develop/.test(text)) return "Technology";
  if (/education|school|tutor|training|academy|learning/.test(text)) return "Education";
  if (/machine|equipment|manufactur|industrial/.test(text)) return "Manufacturing";

  return "Other";
}

async function main() {
  console.log("=== 100K Lead Import (with dedup) ===\n");

  const existingCount = await pool.query("SELECT COUNT(*) FROM contacts");
  console.log(`Existing contacts: ${existingCount.rows[0].count}`);

  console.log("Loading existing emails and phones for dedup...");
  const existingEmails = await pool.query(
    "SELECT LOWER(TRIM(email)) as email FROM contacts WHERE email IS NOT NULL AND email != ''"
  );
  const existingPhones = await pool.query(
    "SELECT phone FROM contacts WHERE phone IS NOT NULL AND phone != ''"
  );

  const emailSet = new Set<string>();
  for (const row of existingEmails.rows) {
    if (row.email) emailSet.add(row.email);
  }
  const phoneSet = new Set<string>();
  for (const row of existingPhones.rows) {
    const norm = normalizePhone(row.phone);
    if (norm && norm.length >= 10) phoneSet.add(norm);
  }
  console.log(`  Existing unique emails: ${emailSet.size}`);
  console.log(`  Existing unique phones: ${phoneSet.size}`);

  console.log("\nParsing 100K lead file...");
  const filePath = "attached_assets/100k_leads_-_Liberty_Bancard_1773280412639.csv";
  const data = parse(fs.readFileSync(filePath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
  console.log(`  Rows in file: ${data.length}`);

  const s = (v: any) => (v == null ? "" : String(v).trim());

  let parsed = 0;
  let dupEmail = 0;
  let dupPhone = 0;
  let dupInFile = 0;
  let noContact = 0;
  const fileEmailsSeen = new Set<string>();
  const filePhonesSeen = new Set<string>();

  const values: any[][] = [];

  for (const row of data) {
    const firstName = s(row["First Name"]);
    const lastName = s(row["Last Name"]);
    const email = s(row["Email"]).toLowerCase();
    const phone = normalizePhone(s(row["Mobile Phone"]) || s(row["Corporate Phone"]));
    const company = s(row["Company"]) || s(row["Company Name for Emails"]);

    if (!email && !phone) { noContact++; continue; }
    if (!firstName && !company) { noContact++; continue; }

    if (email) {
      if (emailSet.has(email)) { dupEmail++; continue; }
      if (fileEmailsSeen.has(email)) { dupInFile++; continue; }
      fileEmailsSeen.add(email);
      emailSet.add(email);
    } else if (phone && phone.length >= 10) {
      if (phoneSet.has(phone)) { dupPhone++; continue; }
      if (filePhonesSeen.has(phone)) { dupInFile++; continue; }
      filePhonesSeen.add(phone);
      phoneSet.add(phone);
    }

    const industry = s(row["Industry"]);
    const keywords = s(row["Keywords"]);
    const employees = row["# Employees"] ? parseInt(String(row["# Employees"])) : null;
    const vertical = classifyVertical(industry, company, keywords);

    values.push([
      firstName || company,
      lastName,
      email,
      phone,
      company,
      s(row["Title"]),
      s(row["Company Address"]),
      s(row["City"]) || s(row["Company City"]),
      s(row["State"]) || s(row["Company State"]),
      s(row["Website"]),
      s(row["Person Linkedin Url"]),
      s(row["Facebook Url"]),
      industry,
      vertical,
      "100k-lead-file",
      employees,
      s(row["Annual Revenue"]),
      ["lead-file-import"],
      "",
      "New",
    ]);
    parsed++;
  }

  console.log(`\nParsed: ${parsed} unique new leads`);
  console.log(`  Skipped - duplicate email (already in DB): ${dupEmail}`);
  console.log(`  Skipped - duplicate phone (already in DB): ${dupPhone}`);
  console.log(`  Skipped - duplicate within file: ${dupInFile}`);
  console.log(`  Skipped - no contact info: ${noContact}`);

  console.log("\nInserting into database...");
  let inserted = 0;
  let errors = 0;
  const batchSize = 100;

  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize);
    const params: any[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      const ph = row.map((_: any, j: number) => `$${paramIdx + j}`).join(", ");
      placeholders.push(`(${ph})`);
      params.push(...row);
      paramIdx += row.length;
    }

    try {
      const client = await pool.connect();
      try {
      await client.query("BEGIN");
      const result = await client.query(`
        INSERT INTO contacts (
          first_name, last_name, email, phone, company_name,
          title, address, city, state, website,
          linkedin_url, facebook_url, industry, vertical, lead_source,
          employee_count, annual_revenue, tags, notes, status
        ) VALUES ${placeholders.join(", ")}
        ON CONFLICT DO NOTHING RETURNING id, email, phone
      `, params);
      await recordContactIdentityObservationsForPgContacts(client, result.rows, "csv_import", "import-100k-leads");
      await client.query("COMMIT");
      inserted += result.rowCount || 0;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (err: any) {
      for (const row of batch) {
        try {
          const client = await pool.connect();
          try {
          await client.query("BEGIN");
          const result = await client.query(`
            INSERT INTO contacts (
              first_name, last_name, email, phone, company_name,
              title, address, city, state, website,
              linkedin_url, facebook_url, industry, vertical, lead_source,
              employee_count, annual_revenue, tags, notes, status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            ON CONFLICT DO NOTHING RETURNING id, email, phone
          `, row);
          await recordContactIdentityObservationsForPgContacts(client, result.rows, "csv_import", "import-100k-leads");
          await client.query("COMMIT");
          inserted += result.rowCount || 0;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        } catch (e: any) {
          errors++;
        }
      }
    }

    if ((i + batchSize) % 10000 === 0 || i + batchSize >= values.length) {
      console.log(`  Progress: ${Math.min(i + batchSize, values.length)}/${values.length} (${inserted} inserted, ${errors} errors)`);
    }
  }

  const finalCount = await pool.query("SELECT COUNT(*) FROM contacts");
  console.log(`\n=== Import Complete ===`);
  console.log(`New leads inserted: ${inserted}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total contacts now: ${finalCount.rows[0].count}`);

  const verticalStats = await pool.query(`
    SELECT vertical, COUNT(*) as count 
    FROM contacts 
    WHERE lead_source = '100k-lead-file'
    GROUP BY vertical 
    ORDER BY count DESC 
    LIMIT 25
  `);
  console.log("\nVertical Distribution (100K import):");
  for (const row of verticalStats.rows) {
    console.log(`  ${row.vertical || "Unclassified"}: ${row.count}`);
  }

  const sourceStats = await pool.query(`
    SELECT lead_source, COUNT(*) as count 
    FROM contacts 
    WHERE lead_source IS NOT NULL
    GROUP BY lead_source 
    ORDER BY count DESC
  `);
  console.log("\nAll Sources:");
  for (const row of sourceStats.rows) {
    console.log(`  ${row.lead_source}: ${row.count}`);
  }

  await pool.end();
}

main().catch(console.error);
