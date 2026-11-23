/** Signed booking and ordered funnel evidence through production handlers on private PostgreSQL and Redis. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
process.env.GHL_LOCATION_ID = "fixture-liberty-location";
process.env.GHL_DEFAULT_CALENDAR_ID = "FixtureSalesCalendar";
process.env.GOOGLE_OFFLINE_UPLOAD_ENABLED = "false";

const h = await stage3BHttpFixture(async app => {
  (await import("../../server/routes/public")).registerPublicRoutes(app);
  (await import("../../server/routes/integrations")).registerIntegrationsRoutes(app);
  (await import("../../server/routes/sdr")).registerSdrRoutes(app);
  (await import("../../server/routes/deals")).registerDealsRoutes(app);
  (await import("../../server/routes/ai")).registerAiRoutes(app);
}, undefined, { backgroundProfile: "off" });

const q = async (sql: string, args: unknown[] = []) => (await h.pool.query(sql, args)).rows;
const first = async (sql: string, args: unknown[] = []) => (await q(sql, args))[0];
const tag = randomUUID();
const email = `booking.${tag}@example.test`;
const remoteContact = `fixture-contact-${tag}`;
const appointmentId = `fixture-booking-${tag}`;
let checks = 0;
function check(value: unknown, expected: unknown, label: string) {
  assert.deepEqual(value, expected, label);
  checks++;
  console.log(`PASS ${label}`);
}

async function deliver(body: unknown, authenticated = true) {
  const raw = JSON.stringify(body, null, 2);
  const response = await fetch(`${h.base}/api/webhooks/ghl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { "X-GHL-Signature": sign(null, Buffer.from(raw), privateKey).toString("base64") } : {}),
    },
    body: raw,
  });
  return { status: response.status, body: await response.json() };
}

try {
  const { storage } = await import("../../server/storage");
  await q("INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',42,'isolated booking certification') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=42");
  await storage.setSystemSetting("inbound_default_owner", { ownerUserId: h.userId("admin") });
  const business = await first("INSERT INTO businesses(canonical_name,normalized_name,record_class) VALUES($1,lower($1),'canonical') RETURNING id", [`Booking fixture ${tag}`]);
  const contact = await first(`INSERT INTO contacts(first_name,last_name,email,phone,business_id,ghl_contact_id,record_class)
    VALUES ('Booking','Fixture',$1,'+19545550147',$2,$3,'production') RETURNING id`, [email, business.id, remoteContact]);

  const lead = await h.request("anonymous", "POST", "/api/public/get-started", {
    goal: "lower fees", vertical: "Restaurant", monthlyVolume: "$5k-$15k", needTerminal: false,
    interestedIn0Percent: false, firstName: "Booking", lastName: "Fixture", email, phone: "+19545550147",
  }, false, { "Idempotency-Key": tag });
  check(lead.status, 201, "The public lead route accepts the synthetic inquiry");
  const request = await first("SELECT contact_id,deal_id,lifecycle_state FROM inbound_requests WHERE id=$1", [lead.body.requestReceipt]);
  check(request?.contact_id, contact.id, "The saved lead is linked to the exact fixture contact");
  check(request?.lifecycle_state, "accepted", "A real assignment and follow-up satisfy lead acceptance");
  const dealId = request.deal_id;

  const bookedAt = new Date().toISOString();
  const event = {
    type: "AppointmentCreate",
    locationId: process.env.GHL_LOCATION_ID,
    appointment: {
      id: appointmentId,
      contactId: remoteContact,
      calendarId: process.env.GHL_DEFAULT_CALENDAR_ID,
      appointmentStatus: "confirmed",
      source: "booking_widget",
      dateAdded: bookedAt,
      dateUpdated: bookedAt,
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
    },
  };
  check((await deliver(event, false)).status, 401, "An unsigned booking is refused");
  check((await deliver({ ...event, locationId: "other-location" })).body.applied, false, "Another location is outside the booking scope");
  check((await first("SELECT count(*)::int AS n FROM ghl_provider_event_receipts")).n, 0, "Auth and scope refusals write no receipts");
  const booked = await deliver(event);
  check(booked, { status: 200, body: { received: true, applied: true, outcome: "recorded" } }, "The signed marketplace booking is recorded");
  check((await deliver(event)).body.duplicate, true, "Exact redelivery is acknowledged without repeating effects");
  check((await deliver({ ...event, eventId: "fixture-redelivery-event" })).body.reason, "replay", "A second event identity cannot repeat an already booked appointment");
  check((await first("SELECT status FROM ghl_appointment_state WHERE appointment_id=$1", [appointmentId])).status, "booked", "The canonical appointment is available to CRM");
  check(await first("SELECT contact_id,deal_id,lifecycle_state FROM inbound_requests WHERE occurrence_key=$1", [`ghl:appointment_booked:${appointmentId}`]),
    { contact_id: contact.id, deal_id: dealId, lifecycle_state: "accepted" }, "Booking and lead share the same exact CRM journey");
  check((await first("SELECT count(*)::int n FROM conversion_journey_evidence WHERE source_type='ghl_appointment_booked' AND source_id=$1", [appointmentId])).n, 1,
    "Exactly one Engagement milestone comes from the verified booking");

  const secondDeal = await storage.createDeal({ contactId: contact.id, pipeline: "sales", stage: "New Lead" });
  const ambiguous = { ...event, appointment: { ...event.appointment, id: `${appointmentId}-ambiguous` } };
  check((await deliver(ambiguous)).body.outcome, "review_required", "Two open sales deals hold the booking link for review");
  check((await first("SELECT count(*)::int n FROM conversion_journey_evidence WHERE source_id=$1", [ambiguous.appointment.id])).n, 0, "Ambiguity creates no funnel observation");
  await q("UPDATE deals SET archived_at=now() WHERE id=$1", [secondDeal.id]);
  const unknown = { ...event, appointment: { ...event.appointment, id: `${appointmentId}-unlinked`, contactId: "unlinked-provider-contact" } };
  check((await deliver(unknown)).body.outcome, "review_required", "An unlinked provider contact stays in review");
  check((await first("SELECT deal_id FROM inbound_requests WHERE occurrence_key=$1", [`ghl:appointment_booked:${unknown.appointment.id}`])).deal_id, null,
    "An unlinked booking does not guess a deal");

  // Supporting statement and application facts are synthetic persisted domain records.
  const uploadToken = randomUUID();
  await q("INSERT INTO statement_requests(contact_id,deal_id,upload_token,upload_url,requested_at) VALUES($1,$2,$3,$4,timezone('UTC',clock_timestamp()))",
    [contact.id, dealId, uploadToken, "https://example.test/statement-fixture"]);
  const document = await first("INSERT INTO documents(contact_id,deal_id,type,file_name) VALUES($1,$2,'statement','fixture.pdf') RETURNING id", [contact.id, dealId]);
  await q(`INSERT INTO statement_upload_commands(request_id,request_fingerprint,operation_scope,owner_scope,contact_id,deal_id,document_id,status,completed_at)
    VALUES($1,$2,'statement_upload','fixture',$3,$4,$5,'succeeded',clock_timestamp())`, [randomUUID(), "a".repeat(64), contact.id, dealId, document.id]);

  await storage.updateDeal(dealId, { proposalToken: randomUUID(), savingsProposal: { plans: [] }, proposalStatus: "generated" });
  const delivery = await h.request("admin", "POST", `/api/deals/${dealId}/send-proposal`, {});
  check(delivery.status >= 400, true, "Proposal delivery does not succeed with egress denied and outbound paused");
  check((await first("SELECT proposal_email_sent_at FROM deals WHERE id=$1", [dealId])).proposal_email_sent_at, null,
    "A refused proposal has no sent timestamp or funnel credit");

  // Exercise the real sent-timestamp evidence writer with a simulated historical acceptance.
  // The fixture does not claim an email was delivered.
  await storage.updateDeal(dealId, { proposalEmailSentAt: new Date(), proposalStatus: "sent" });
  await q("INSERT INTO merchant_applications (contact_id,deal_id,status,submitted_at) VALUES($1,$2,'submitted',clock_timestamp())", [contact.id, dealId]);
  const won = await h.request("admin", "PUT", `/api/deals/${dealId}`, { stage: "Closed Won" });
  check(won.status, 200, "The registered deal-stage command closes the synthetic deal as won");

  const { readConversionFunnel } = await import("../../server/services/conversion-funnel");
  const { instantToBusinessInput } = await import("../../shared/business-time");
  const day = instantToBusinessInput(new Date()).slice(0, 10);
  const report = await readConversionFunnel({ start: day, end: day, breakdown: "vertical", limit: 50 });
  check(report.stages.map(stage => stage.count), [1, 1, 1, 1, 1, 1, 1], "All seven ordered stages report one journey");
  check((await first("SELECT state FROM outbound_pause_control WHERE id=1")).state, "paused", "Outbound remained paused throughout");
  check(h.externalCalls(), 0, "No external network calls, real sends or conversion uploads");
  console.log(`GHL booking projection and journey PASS (${checks} checks)`);
} finally {
  await h.close();
}
