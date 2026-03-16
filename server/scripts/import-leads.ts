import pg from "pg";
import * as fs from "fs";
import * as path from "path";

const { Pool } = pg;
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface LeadRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  title: string;
  address: string;
  city: string;
  state: string;
  website: string;
  linkedinUrl: string;
  facebookUrl: string;
  industry: string;
  vertical: string;
  leadSource: string;
  employeeCount: number | null;
  annualRevenue: string;
  tags: string[];
  notes: string;
  rating: string;
  category: string;
}

function cleanPhone(phone: string): string {
  if (!phone) return "";
  return phone.replace(/[^0-9+]/g, "").replace(/^'?\+?1?/, "").replace(/^(\d{10})$/, "$1");
}

function normalizePhone(phone: string): string {
  const digits = cleanPhone(phone);
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function classifyVertical(industry: string, category: string, companyName: string, keywords: string = ""): string {
  const text = `${industry} ${category} ${companyName} ${keywords}`.toLowerCase();

  if (/restaurant|food|pizza|burger|taco|sushi|cafe|coffee|bakery|catering|bar\b|grill|diner|eatery|bistro|cuisine|kitchen/.test(text)) return "Restaurant";
  if (/auto|car |vehicle|mechanic|tire|collision|body shop|transmission|brake|oil change|lube|muffler|exhaust|towing|automotive/.test(text)) return "Auto";
  if (/retail|store|shop|boutique|gift|apparel|clothing|fashion|jewelry|shoe|furniture/.test(text)) return "Retail";
  if (/salon|spa|beauty|hair|nail|barber|cosmet|skincare|esthetic|waxing|lash|brow/.test(text)) return "Salon/Spa";
  if (/medical|doctor|physician|dental|dentist|chiropr|optom|pharma|clinic|hospital|healthcare|health care|urgent care|veterinar|vet\b/.test(text)) return "Healthcare";
  if (/fitness|gym|yoga|pilates|martial art|boxing|crossfit|personal train|recreation|swim|sport/.test(text)) return "Fitness/Recreation";
  if (/food|beverage|drink|juice|smoothie|ice cream|donut|wine|liquor|brewery/.test(text)) return "Food/Beverage";
  if (/construct|contractor|plumb|electric|hvac|roof|paint|landscap|concrete|mason|carpenter|remodel|renovati|flooring|handyman|paving|paver|excavat/.test(text)) return "Construction";
  if (/law\b|legal|attorney|lawyer/.test(text)) return "Legal";
  if (/account|cpa|bookkeep|tax prep/.test(text)) return "Accounting";
  if (/consult|professional service|management|staffing|recruit|hr\b|human resource/.test(text)) return "Professional Services";
  if (/e-commerce|ecommerce|online store|shopify|amazon/.test(text)) return "E-commerce";
  if (/transport|trucking|freight|logistics|moving|courier|delivery|shipping/.test(text)) return "Transportation";
  if (/real estate|realtor|property|mortgage|title company/.test(text)) return "Real Estate";
  if (/insurance/.test(text)) return "Insurance";
  if (/hotel|motel|lodging|hospitality|travel|tour/.test(text)) return "Hospitality";
  if (/clean|janitorial|laundry|dry clean|maid|housekeep/.test(text)) return "Cleaning Services";
  if (/print|sign |graphic design|marketing|advertis|media|photo|video|creative/.test(text)) return "Marketing/Media";
  if (/tech|software|it\b|information technology|web design|web develop|app develop/.test(text)) return "Technology";
  if (/education|school|tutor|training|academy|learning/.test(text)) return "Education";

  return "Other";
}

function splitName(fullName: string): [string, string] {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return [parts[0], ""];
  return [parts[0], parts.slice(1).join(" ")];
}

async function importGoogleMapsCSV(filePath: string, source: string): Promise<LeadRow[]> {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const rows: LeadRow[] = [];

  const wb = XLSX.read(content, { type: "string" });
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];

  for (const row of data) {
    const name = (row.Name || "").trim();
    if (!name) continue;
    const phone = normalizePhone(row.Telephone || "");
    const website = (row.Website || "").trim();

    if (!phone && !website) continue;

    const keyword = (row.Keyword || "").trim();
    const cityMatch = keyword.match(/in\s+(.+),\s+(.+)/);
    const city = cityMatch ? cityMatch[1] : "";
    const state = cityMatch ? cityMatch[2] : "Florida";

    rows.push({
      firstName: name,
      lastName: "",
      email: "",
      phone,
      companyName: name,
      title: "Owner",
      address: (row.Address || "").trim(),
      city,
      state,
      website,
      linkedinUrl: "",
      facebookUrl: "",
      industry: (row.Category || "").trim(),
      vertical: classifyVertical(row.Category || "", "", name, keyword),
      leadSource: source,
      employeeCount: null,
      annualRevenue: "",
      tags: ["google-maps-scrape"],
      notes: `Rating: ${row.Rating || "N/A"}, Reviews: ${row.Review_count || "N/A"}`,
      rating: (row.Rating || "").toString(),
      category: (row.Category || "").trim(),
    });
  }
  return rows;
}

async function importGoogleMapsXLSX(filePath: string, source: string): Promise<LeadRow[]> {
  const wb = XLSX.readFile(filePath);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];

  const rows: LeadRow[] = [];
  for (const row of data) {
    const name = (row.Name || "").trim();
    if (!name) continue;
    const phone = normalizePhone(row.Telephone || "");
    const website = (row.Website || "").trim();
    if (!phone && !website) continue;

    const keyword = (row.Keyword || "").trim();
    const cityMatch = keyword.match(/in\s+(.+),\s+(.+)/);
    const city = cityMatch ? cityMatch[1] : "";
    const state = cityMatch ? cityMatch[2] : "Florida";

    rows.push({
      firstName: name,
      lastName: "",
      email: "",
      phone,
      companyName: name,
      title: "Owner",
      address: (row.Address || "").trim(),
      city,
      state,
      website,
      linkedinUrl: "",
      facebookUrl: "",
      industry: (row.Category || "").trim(),
      vertical: classifyVertical(row.Category || "", "", name, keyword),
      leadSource: source,
      employeeCount: null,
      annualRevenue: "",
      tags: ["google-maps-scrape"],
      notes: `Rating: ${row.Rating || "N/A"}, Reviews: ${row.Review_count || "N/A"}`,
      rating: (row.Rating || "").toString(),
      category: (row.Category || "").trim(),
    });
  }
  return rows;
}

async function import43kLeads(filePath: string): Promise<LeadRow[]> {
  const wb = XLSX.readFile(filePath);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];

  const rows: LeadRow[] = [];
  for (const row of data) {
    const s = (v: any) => (v == null ? "" : String(v).trim());
    const firstName = s(row["First Name"]);
    const lastName = s(row["Last Name"]);
    const email = s(row["Email"]);
    const phone = normalizePhone(s(row["Mobile Phone"]) || s(row["Corporate Phone"]));
    const company = s(row["Company"]) || s(row["Company Name for Emails"]);

    if (!email && !phone) continue;
    if (!firstName && !company) continue;

    const industry = s(row["Industry"]);
    const keywords = s(row["Keywords"]);
    const employees = row["# Employees"] ? parseInt(String(row["# Employees"])) : null;

    rows.push({
      firstName: firstName || company,
      lastName,
      email,
      phone,
      companyName: company,
      title: s(row["Title"]),
      address: s(row["Company Address"]),
      city: s(row["City"]) || s(row["Company City"]),
      state: s(row["State"]) || s(row["Company State"]),
      website: s(row["Website"]),
      linkedinUrl: s(row["Person Linkedin Url"]),
      facebookUrl: s(row["Facebook Url"]),
      industry,
      vertical: classifyVertical(industry, "", company, keywords),
      leadSource: "43k-lead-file",
      employeeCount: employees,
      annualRevenue: s(row["Annual Revenue"]),
      tags: ["lead-file-import"],
      notes: "",
      rating: "",
      category: "",
    });
  }
  return rows;
}

async function importCCLeadsJune(filePath: string): Promise<LeadRow[]> {
  const wb = XLSX.readFile(filePath);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];

  const rows: LeadRow[] = [];
  for (const row of data) {
    const s = (v: any) => (v == null ? "" : String(v).trim());
    const firstName = s(row["First Name"]);
    const lastName = s(row["Last Name"]);
    const email = s(row["Email"]);
    const phone = normalizePhone(s(row["Corporate Phone"]));
    const company = s(row["Company Name"]);

    if (!email && !phone) continue;
    if (!firstName && !company) continue;

    rows.push({
      firstName: firstName || company,
      lastName,
      email,
      phone,
      companyName: company,
      title: s(row["Title"]),
      address: s(row["Company Address"]),
      city: s(row["City"]) || s(row["Company City"]),
      state: s(row["State"]) || s(row["Company State"]),
      website: s(row["Website"]),
      linkedinUrl: s(row["Person Linkedin Url"]),
      facebookUrl: "",
      industry: s(row["Industry"]),
      vertical: classifyVertical(s(row["Industry"]), "", company),
      leadSource: "cc-leads-june",
      employeeCount: null,
      annualRevenue: "",
      tags: ["cc-leads"],
      notes: "",
      rating: "",
      category: "",
    });
  }
  return rows;
}

async function importAutomotiveLeads(filePath: string): Promise<LeadRow[]> {
  const wb = XLSX.readFile(filePath);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];

  const rows: LeadRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r || !r[0]) continue;

    const businessName = (r[0] || "").toString().trim();
    const address = (r[3] || "").toString().trim();
    const contactName = (r[4] || "").toString().trim();
    const notes = (r[5] || "").toString().trim();
    const device = (r[6] || "").toString().trim();
    const processor = (r[7] || "").toString().trim();
    const surcharge = (r[9] || "").toString().trim();
    const volume = (r[10] || "").toString().trim();

    const [firstName, lastName] = contactName ? splitName(contactName) : [businessName, ""];

    const cityStateMatch = address.match(/,\s*([^,]+),\s*([A-Z]{2})\s+\d/);
    const city = cityStateMatch ? cityStateMatch[1].trim() : "";
    const state = cityStateMatch ? cityStateMatch[2] : "FL";

    rows.push({
      firstName,
      lastName,
      email: "",
      phone: "",
      companyName: businessName,
      title: "",
      address,
      city,
      state,
      website: "",
      linkedinUrl: "",
      facebookUrl: "",
      industry: "Automotive",
      vertical: "Auto",
      leadSource: "cc-leads-automotive",
      employeeCount: null,
      annualRevenue: "",
      tags: ["cc-leads", "automotive"],
      notes: [
        notes ? `Notes: ${notes}` : "",
        device ? `Device: ${device}` : "",
        processor ? `Current Processor: ${processor}` : "",
        surcharge ? `Surcharge: ${surcharge}` : "",
        volume ? `Monthly Volume: ${volume}` : "",
      ].filter(Boolean).join("; "),
      rating: "",
      category: "Automotive",
    });
  }
  return rows;
}

async function import26kBrands(filePath: string): Promise<LeadRow[]> {
  const wb = XLSX.readFile(filePath);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];

  const rows: LeadRow[] = [];
  for (const row of data) {
    const allEmails = (
      row["All Email Addresses"] ||
      row["Contact URL Email Addresses"] ||
      row["Homepage Email Addresses"] ||
      row["About URL Email Addresses"] ||
      ""
    ).toString().trim();

    if (!allEmails) continue;

    const emails = allEmails.split(/[,;\s]+/).filter((e: string) => e.includes("@"));
    if (emails.length === 0) continue;

    const domain = (row["Domain"] || "").toString().trim();
    const url = (row["URL"] || "").toString().trim();
    const name = (row["Name"] || domain || "").toString().trim();
    const facebook = (row["Domain Facebook Profile"] || row["Url Facebook Profile"] || "").toString().trim();
    const twitter = (row["Domain Twitter Profile"] || "").toString().trim();
    const linkedin = (row["Domain LinkedIn Profile"] || row["Url LinkedIn Profile"] || "").toString().trim();

    for (const email of emails.slice(0, 2)) {
      rows.push({
        firstName: name || email.split("@")[0],
        lastName: "",
        email: email.toLowerCase().trim(),
        phone: "",
        companyName: name || domain,
        title: "",
        address: "",
        city: "",
        state: "",
        website: url || `https://${domain}`,
        linkedinUrl: linkedin,
        facebookUrl: facebook,
        industry: "",
        vertical: "Other",
        leadSource: "26k-brands",
        employeeCount: null,
        annualRevenue: "",
        tags: ["brand-leads"],
        notes: "",
        rating: "",
        category: "",
      });
    }
  }
  return rows;
}

async function bulkInsert(leads: LeadRow[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const batchSize = 100;

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const lead of batch) {
      const params = [
        lead.firstName || "Unknown",
        lead.lastName || "",
        lead.email || "",
        lead.phone || "",
        lead.companyName || "",
        lead.title || null,
        lead.address || null,
        lead.city || null,
        lead.state || null,
        lead.website || null,
        lead.linkedinUrl || null,
        lead.facebookUrl || null,
        lead.industry || null,
        lead.vertical || null,
        lead.leadSource || null,
        lead.employeeCount || null,
        lead.annualRevenue || null,
        lead.tags || null,
        lead.notes || null,
        "New",
      ];
      values.push(...params);
      const ph = params.map((_, j) => `$${paramIdx + j}`).join(", ");
      placeholders.push(`(${ph})`);
      paramIdx += params.length;
    }

    const query = `
      INSERT INTO contacts (
        first_name, last_name, email, phone, company_name,
        title, address, city, state, website,
        linkedin_url, facebook_url, industry, vertical, lead_source,
        employee_count, annual_revenue, tags, notes, status
      ) VALUES ${placeholders.join(", ")}
      ON CONFLICT DO NOTHING
    `;

    try {
      const result = await pool.query(query, values);
      inserted += result.rowCount || 0;
    } catch (err: any) {
      console.error(`Batch error at index ${i}:`, err.message);
      for (const lead of batch) {
        try {
          await pool.query(`
            INSERT INTO contacts (
              first_name, last_name, email, phone, company_name,
              title, address, city, state, website,
              linkedin_url, facebook_url, industry, vertical, lead_source,
              employee_count, annual_revenue, tags, notes, status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            ON CONFLICT DO NOTHING
          `, [
            lead.firstName || "Unknown", lead.lastName || "", lead.email || "",
            lead.phone || "", lead.companyName || "", lead.title || null,
            lead.address || null, lead.city || null, lead.state || null,
            lead.website || null, lead.linkedinUrl || null, lead.facebookUrl || null,
            lead.industry || null, lead.vertical || null, lead.leadSource || null,
            lead.employeeCount || null, lead.annualRevenue || null,
            lead.tags || null, lead.notes || null, "New",
          ]);
          inserted++;
        } catch (e: any) {
          skipped++;
        }
      }
    }

    if ((i + batchSize) % 5000 === 0 || i + batchSize >= leads.length) {
      console.log(`  Progress: ${Math.min(i + batchSize, leads.length)}/${leads.length} (${inserted} inserted, ${skipped} skipped)`);
    }
  }

  return { inserted, skipped };
}

async function main() {
  console.log("=== Lead Import Script ===\n");

  const existingCount = await pool.query("SELECT COUNT(*) FROM contacts");
  console.log(`Existing contacts: ${existingCount.rows[0].count}\n`);

  const allLeads: LeadRow[] = [];

  console.log("1. Importing Google Maps CSV (2,479 rows)...");
  const gmCSV = await importGoogleMapsCSV(
    "attached_assets/Google_Maps_Listings_Scraper__by_Keywords__1773178604832.csv",
    "google-maps-csv"
  );
  console.log(`   Parsed ${gmCSV.length} leads`);
  allLeads.push(...gmCSV);

  console.log("2. Importing Google Maps XLSX (1,155 rows)...");
  const gmXLSX = await importGoogleMapsXLSX(
    "attached_assets/Google_Maps_Listings_Scraper__by_Keywords__1773178588624.xlsx",
    "google-maps-xlsx"
  );
  console.log(`   Parsed ${gmXLSX.length} leads`);
  allLeads.push(...gmXLSX);

  console.log("3. Importing 43K Lead File...");
  const leads43k = await import43kLeads(
    "attached_assets/43k_Lead_file_-_Liberty_Bancard_1773178644632.csv"
  );
  console.log(`   Parsed ${leads43k.length} leads`);
  allLeads.push(...leads43k);

  console.log("4. Importing CC Leads June 10 (9,327 rows)...");
  const ccJune = await importCCLeadsJune(
    "attached_assets/CC_Leads_-_june_10_1773178680284.xlsx"
  );
  console.log(`   Parsed ${ccJune.length} leads`);
  allLeads.push(...ccJune);

  console.log("5. Importing Automotive Leads (385 rows)...");
  const autoLeads = await importAutomotiveLeads(
    "attached_assets/Credit_Card_Leads_-_Automotive_1773178687431.xlsx"
  );
  console.log(`   Parsed ${autoLeads.length} leads`);
  allLeads.push(...autoLeads);

  console.log("6. Importing 26K Brands (emails only)...");
  const brands = await import26kBrands(
    "attached_assets/26k_Brands!_(SMG_Social_Leads)__1773178636426.xlsx"
  );
  console.log(`   Parsed ${brands.length} leads with emails`);
  allLeads.push(...brands);

  console.log(`\nTotal parsed: ${allLeads.length} leads`);

  console.log("\nDeduplicating...");
  const seen = new Set<string>();
  const unique: LeadRow[] = [];
  for (const lead of allLeads) {
    const emailKey = lead.email ? lead.email.toLowerCase().trim() : "";
    const phoneKey = lead.phone ? normalizePhone(lead.phone) : "";
    const companyKey = lead.companyName ? lead.companyName.toLowerCase().trim().slice(0, 50) : "";

    let key = "";
    if (emailKey) {
      key = `e:${emailKey}`;
    } else if (phoneKey && phoneKey.length >= 10) {
      key = `p:${phoneKey}`;
    } else if (companyKey) {
      key = `c:${companyKey}`;
    } else {
      continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(lead);
  }
  console.log(`After dedup: ${unique.length} unique leads (${allLeads.length - unique.length} duplicates removed)`);

  console.log("\nInserting into database...");
  const { inserted, skipped } = await bulkInsert(unique);

  console.log("\nBridging imported contacts to businesses...");
  const unbridged = await pool.query(`
    SELECT id, company_name, website, phone, email, address, city, state, 
           vertical, industry, facebook_url, lead_source
    FROM contacts 
    WHERE business_id IS NULL AND company_name IS NOT NULL AND company_name != '' AND company_name != 'Unknown'
    ORDER BY id
  `);
  console.log(`  Found ${unbridged.rows.length} contacts without a business link`);

  let bizCreated = 0, bizMerged = 0, bizErrors = 0;
  for (const row of unbridged.rows) {
    try {
      const normalizedName = row.company_name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\b(llc|inc|corp|ltd|co|company|enterprises?|group|services?|solutions?)\b/g, "").replace(/\s+/g, " ").trim();
      const domain = row.website ? row.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : null;
      const phone10 = row.phone ? row.phone.replace(/[^0-9]/g, "").replace(/^1(\d{10})$/, "$1") : null;

      const existingBiz = await pool.query(`
        SELECT id FROM businesses 
        WHERE ($1::text IS NOT NULL AND website_domain = $1)
           OR ($2::text IS NOT NULL AND main_phone = $2)
           OR (normalized_name = $3 AND city = $4 AND state = $5)
        LIMIT 1
      `, [domain, phone10 && phone10.length === 10 ? phone10 : null, normalizedName, row.city, row.state]);

      let businessId: number;
      if (existingBiz.rows.length > 0) {
        businessId = existingBiz.rows[0].id;
        bizMerged++;
      } else {
        const newBiz = await pool.query(`
          INSERT INTO businesses (canonical_name, normalized_name, website_domain, main_phone, main_email,
            street_address, city, state, vertical, industry_primary, facebook_url,
            last_source_type, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'new', NOW(), NOW())
          RETURNING id
        `, [row.company_name, normalizedName, domain, phone10, row.email,
            row.address, row.city, row.state, row.vertical, row.industry, row.facebook_url,
            row.lead_source || "csv_import"]);
        businessId = newBiz.rows[0].id;
        bizCreated++;
      }

      await pool.query(`UPDATE contacts SET business_id = $1 WHERE id = $2`, [businessId, row.id]);

      await pool.query(`
        INSERT INTO lead_sources (business_id, source_type, source_label, contact_id, discovered_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [businessId, row.lead_source || "csv_import", `import_${row.id}`, row.id]);
    } catch (bizErr: any) {
      bizErrors++;
      if (bizErrors <= 5) console.warn(`  Business bridge error for contact ${row.id}:`, bizErr.message);
    }
  }
  console.log(`  Businesses created: ${bizCreated}, merged: ${bizMerged}, errors: ${bizErrors}`);

  const finalCount = await pool.query("SELECT COUNT(*) FROM contacts");
  const bizCount = await pool.query("SELECT COUNT(*) FROM businesses");
  console.log(`\n=== Import Complete ===`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total contacts now: ${finalCount.rows[0].count}`);
  console.log(`Total businesses now: ${bizCount.rows[0].count}`);

  const verticalStats = await pool.query(`
    SELECT vertical, COUNT(*) as count 
    FROM contacts 
    WHERE lead_source IS NOT NULL
    GROUP BY vertical 
    ORDER BY count DESC 
    LIMIT 20
  `);
  console.log("\nVertical Distribution (imported leads):");
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
  console.log("\nBy Source:");
  for (const row of sourceStats.rows) {
    console.log(`  ${row.lead_source}: ${row.count}`);
  }

  await pool.end();
}

main().catch(console.error);
