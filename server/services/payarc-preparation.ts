import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import { merchantApplications } from "@shared/schema";
import {
  encryptField,
  decryptField,
  decryptProtectedFields,
} from "./merchant-protected-data";
import {
  validatePayarcPayload,
  payarcRequestSchema,
  payarcBirthDate,
} from "@shared/payarc-traditional";
export const PAYARC_PREP_FIELD = "payarcTraditionalPreparation";
/** Only these reviewed supplemental fields are writable. Bank/tax/SSN values come from protected application storage. */
export const PAYARC_EXTRA_FIELDS = [
  "RegisteredAddress",
  "RegisteredCity",
  "RegisteredState",
  "RegisteredZipCode",
  "StateOfIncorporation",
  "DiscountRateProgram",
  "Industry",
  "OwnershipType",
  "CustomerSupportNumber",
  "BusinessSummary",
] as const;
export function buildTraditionalPreparation(
  app: any,
  protectedFields: any,
  extras: any,
): Record<string, unknown> {
  const lead: Record<string, unknown> = {
    MerchantName: app.dba || app.legalBusinessName,
    LegalName: app.legalBusinessName,
    ContactFirstName: app.ownerFirstName,
    ContactLastName: app.ownerLastName,
    ContactEmail: app.ownerEmail,
    OfficeAddress: app.businessAddress,
    OfficeCity: app.businessCity,
    OfficeState: app.businessState,
    OfficeZipCode: app.businessZip,
    ContactPhoneNo: app.businessPhone,
    TaxId: protectedFields.ein,
    DateIncorporated: app.businessStartDate,
    BankAccountNo: protectedFields.bankAccountNumber,
    BankRoutingNo: protectedFields.bankRoutingNumber,
  };
  for (const k of PAYARC_EXTRA_FIELDS)
    if (extras[k] !== undefined) lead[k] = extras[k];
  if (app.website) lead.Website = app.website;
  for (const [key, value] of [
    ["TotalMonthlyProcessing", app.estimatedMonthlyVolume],
    ["AvgTicketValue", app.estimatedAvgTicket],
    ["HighTicketValue", app.highestTicket],
  ] as const)
    if (value !== null && value !== undefined && value !== "")
      lead[key] = Number(value);
  const owner = {
    Title: extras.OwnerTitle,
    FirstName: app.ownerFirstName,
    LastName: app.ownerLastName,
    Address: app.ownerAddress,
    City: app.ownerCity,
    State: app.ownerState,
    ZipCode: app.ownerZip,
    PhoneNo: app.ownerPhone,
    BirthDate: payarcBirthDate(protectedFields.ownerDob),
    SSN: protectedFields.ownerSsn,
    Email: app.ownerEmail,
    OwnershipPct: app.ownershipPercent,
  };
  // Additional owners must be reviewed through a complete provider mapping, never silently dropped.
  const additional = protectedFields.additionalOwners;
  if (additional != null && !Array.isArray(additional))
    throw Error("PAYARC_ADDITIONAL_OWNER_SHAPE_INVALID");
  const additionalOwners = (additional ?? []).map((a: any) => ({
    Title: a.title,
    FirstName: a.firstName,
    LastName: a.lastName,
    Address: a.address,
    City: a.city,
    State: a.state,
    ZipCode: a.zipCode ?? a.zip,
    PhoneNo: a.phone,
    BirthDate: payarcBirthDate(a.dob ?? a.dateOfBirth),
    SSN: a.ssn,
    Email: a.email,
    OwnershipPct: a.ownershipPercent,
  }));
  const program = lead.DiscountRateProgram;
  const pricingKey =
    program === "tiered"
      ? "TieredPricing"
      : program === "interchange"
        ? "InterchangePlusPricing"
        : "BlendedRatePricing";
  const payload = {
    Lead: lead,
    Owners: [owner, ...additionalOwners],
    ...(extras.Pricing ? { [pricingKey]: extras.Pricing } : {}),
  };
  const errors = validatePayarcPayload(payload);
  if (!extras.Pricing || !Object.keys(extras.Pricing).length)
    errors.push("Pricing:reviewed_pricing_required");
  if (errors.length)
    throw Object.assign(Error("PAYARC_PREPARATION_INCOMPLETE"), {
      fields: errors,
    });
  return payload;
}
export async function savePayarcPreparation(
  applicationId: number,
  extras: Record<string, unknown>,
  actor: string,
) {
  const allowed = new Set<string>([
    ...PAYARC_EXTRA_FIELDS,
    "OwnerTitle",
    "Pricing",
  ]);
  if (Object.keys(extras).some((k) => !allowed.has(k)))
    throw Error("PAYARC_PREPARATION_UNKNOWN_FIELD");
  return db.transaction(async (tx) => {
    const rows: any = await tx.execute(
      sql`SELECT * FROM merchant_applications WHERE id=${applicationId} FOR UPDATE`,
    );
    const raw = (rows.rows ?? rows)[0];
    if (!raw) throw Error("APPLICATION_NOT_FOUND");
    const [app] = await tx
      .select()
      .from(merchantApplications)
      .where(eq(merchantApplications.id, applicationId));
    const payload = buildTraditionalPreparation(
      app,
      decryptProtectedFields(app, {
        role: "system",
        purpose: "boarding_processor_submission",
      }),
      extras,
    );
    const ciphertext = encryptField(
      applicationId,
      PAYARC_PREP_FIELD,
      JSON.stringify(extras),
    );
    // The normal application revision fence invalidates any previously queued submission.
    const updated: any = await tx.execute(
      sql`UPDATE merchant_applications SET updated_at=clock_timestamp() WHERE id=${applicationId} RETURNING updated_at::text AS revision`,
    );
    const revision = (updated.rows ?? updated)[0].revision;
    await tx.execute(
      sql`INSERT INTO payarc_preparations(application_id,application_revision,payload_ciphertext,prepared_by) VALUES(${applicationId},${revision},${ciphertext},${actor}) ON CONFLICT(application_id) DO UPDATE SET application_revision=EXCLUDED.application_revision,payload_ciphertext=EXCLUDED.payload_ciphertext,prepared_by=EXCLUDED.prepared_by,prepared_at=now()`,
    );
    return { prepared: true };
  });
}
export async function readPayarcPreparation(
  applicationId: number,
  exec: any = db,
) {
  const result: any = await exec.execute(
    sql`SELECT p.payload_ciphertext FROM payarc_preparations p JOIN merchant_applications a ON a.id=p.application_id WHERE p.application_id=${applicationId} AND p.application_revision=a.updated_at::text`,
  );
  const row = (result.rows ?? result)[0];
  if (!row) throw Error("PAYARC_PREPARATION_REQUIRED_OR_STALE");
  const extras = JSON.parse(
    decryptField(applicationId, PAYARC_PREP_FIELD, row.payload_ciphertext),
  );
  const [app] = await exec
    .select()
    .from(merchantApplications)
    .where(eq(merchantApplications.id, applicationId));
  if (!app) throw Error("PAYARC_PREPARATION_APPLICATION_MISSING");
  return buildTraditionalPreparation(
    app,
    decryptProtectedFields(app, {
      role: "system",
      purpose: "boarding_processor_submission",
    }),
    extras,
  );
}
