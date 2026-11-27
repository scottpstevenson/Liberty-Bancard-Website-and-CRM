/** Signed booking and ordered funnel evidence through production handlers on private PostgreSQL and Redis. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
process.env.GHL_LOCATION_ID = "fixture-liberty-location";
process.env.GHL_DEFAULT_CALENDAR_ID = "FixtureSalesCalendar";
process.env.GOOGLE_OFFLINE_UPLOAD_ENABLED = "false";
process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED = "false";
// The public inquiry starts an optional AI blueprint. This fixture only owns the booking journey.
delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;

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

  const { processGhlBookingConsentChecks } = await import("../../server/services/ghl-booking-consent");
  const { processGhlBookingConfirmationSms } = await import("../../server/services/ghl-booking-sms");
  const { reconcileGhlBookingCancellations } = await import("../../server/services/ghl-booking-cancellation-sync");
  const { recordAdminAttestation } = await import("../../server/services/ghl-channel-probes");
  const { applyConsentCommand } = await import("../../server/services/consent-authority");
  const form = "fixture-sales-booking-form";
  const disclosure = "I agree to receive automated appointment confirmation texts from Liberty Bancard at the mobile number above. Message frequency: one confirmation text per opted-in appointment. This is optional and is not required to book or buy services. Message and data rates may apply. Reply STOP to opt out or HELP for help.";
  const submission = {
    id: "booking-form-" + tag, contactId: remoteContact, formId: form, createdAt: bookedAt,
    others: { internalSource: { type: "calendars", id: event.appointment.calendarId }, location_id: event.locationId,
      selected_slot: event.appointment.startTime, phone: "+19545550147", terms_and_conditions: disclosure },
  };
  const originalFetch = globalThis.fetch;
  let submissions: unknown[] = [];
  let formsReads = 0;
  let senderReads = 0;
  let providerRefuses = false;
  let providerDnd = false;
  const sender = "+13055550101";
  const campaign = "fixture_booking_campaign";
  const sent: Array<Record<string, unknown>> = [];
  type ProviderBooking = typeof event.appointment & { locationId: string; dateUpdated?: string };
  const providerBookings = new Map<string, ProviderBooking>([[appointmentId, { ...event.appointment, locationId: event.locationId }]]);
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== "https://services.leadconnectorhq.com") return originalFetch(input, init);
    if (url.pathname === "/conversations/messages") {
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      const message = JSON.parse(String(init?.body));
      assert.equal(message.fromNumber, sender);
      assert.equal(message.toNumber, submission.others.phone);
      assert.equal(message.contactId, remoteContact);
      assert.equal(message.type, "SMS");
      assert.equal(message.status, "pending");
      assert.match(message.message, /^Liberty Bancard: .+ Reply STOP to opt out\.$/);
      sent.push(message);
      return providerRefuses ? Response.json({}, { status: 503 }) : Response.json({ messageId: "fixture-accepted-message" });
    }
    assert.equal(init?.method ?? "GET", "GET");
    const appointmentPath = "/calendars/events/appointments/";
    if (url.pathname.startsWith(appointmentPath)) {
      senderReads++;
      const appointment = providerBookings.get(url.pathname.slice(appointmentPath.length));
      if (!appointment) return Response.json({}, { status: 404 });
      const startTime = new Date(Date.parse(appointment.startTime) - 5 * 3_600_000).toISOString().replace("Z", "-05:00");
      return Response.json({ appointment: { ...appointment, startTime } });
    }
    if (url.pathname === `/contacts/${remoteContact}`) {
      senderReads++;
      return Response.json({ contact: { id: remoteContact, locationId: event.locationId,
        phone: submission.others.phone, dnd: false, dndSettings: { SMS: { status: providerDnd ? "active" : "inactive" } } } });
    }
    assert.equal(url.pathname, "/forms/submissions");
    assert.equal(url.searchParams.get("formId"), form);
    assert.equal(url.searchParams.get("locationId"), event.locationId);
    formsReads++;
    return Response.json({ submissions: url.searchParams.get("q") === remoteContact ? submissions : [] });
  };
  const consentCheck = (id: string) => first("SELECT state,reason,consent_event_id FROM ghl_booking_sms_consent_checks WHERE appointment_id=$1", [id]);
  try {
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "fixture-forms-readonly";
    process.env.GHL_BOOKING_CONSENT_FORM_ID = form;
    process.env.GHL_BOOKING_CONFIRMATION_SMS_FROM = sender;
    process.env.GHL_BOOKING_CONFIRMATION_SMS_CAMPAIGN_ID = campaign;
    process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED_AT = bookedAt;
    // Hold unrelated test bookings intentionally sharing the main fixture slot.
    await q("UPDATE ghl_booking_sms_consent_checks SET next_check_at=now()+interval '1 hour' WHERE appointment_id<>$1", [appointmentId]);
    await processGhlBookingConsentChecks();
    check((await consentCheck(appointmentId)).state, "pending", "A booking webhook that beats the form submission leaves durable work");
    submissions = [submission];
    await q("UPDATE ghl_booking_sms_consent_checks SET next_check_at=now() WHERE appointment_id=$1", [appointmentId]);
    await processGhlBookingConsentChecks();
    const optIn = await consentCheck(appointmentId);
    check(optIn.state, "opted_in", "Delayed provider evidence records the exact booking opt-in while sending is off");
    check(await first("SELECT consented, purpose, evidence->>'appointmentId' AS appointment_id FROM consent_audit_logs WHERE id=$1", [optIn.consent_event_id]),
      { consented: true, purpose: "booking_confirmation", appointment_id: appointmentId }, "Consent evidence is restricted to this appointment");
    check((await first("SELECT consent_sms FROM contacts WHERE id=$1", [contact.id])).consent_sms, false, "A booking does not enable marketing SMS");
    await processGhlBookingConsentChecks();
    check(formsReads, 2, "Settled consent checks are not reprocessed");

    const next = { ...event, appointment: { ...event.appointment, id: appointmentId + "-unchecked",
      startTime: new Date(Date.parse(event.appointment.startTime) + 60 * 60_000).toISOString() } };
    await deliver(next);
    submissions = [{ ...submission, id: "unchecked-" + tag, others: { ...submission.others,
      selected_slot: next.appointment.startTime, terms_and_conditions: null } }];
    await processGhlBookingConsentChecks();
    check((await consentCheck(next.appointment.id)).state, "not_opted_in", "An unchecked form never inherits the previous booking's permission");
    check((await first("SELECT count(*)::int AS n FROM team_intake_alerts WHERE source_kind='ghl_booking' AND source_id=(SELECT id::text FROM inbound_requests WHERE occurrence_key=$1)", [`ghl:appointment_booked:${appointmentId}`])).n,
      1, "Redelivery leaves one internal booking alert");
    check((await first("SELECT count(*)::int AS n FROM followup_effect_receipts WHERE channel='sms' AND owner_kind='ghl_booking_confirmation'")).n,
      0, "Consent testing cannot dispatch a booking text");

    check((await processGhlBookingConfirmationSms()).state, "disabled", "Booking SMS is off even with a saved opt-in and sender settings");
    process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED = "true";
    await recordAdminAttestation({ gateKey: "ghl_sms_a2p_approved", attestedBy: "fixture", attestationNote: "Existing campaign" });
    check((await processGhlBookingConfirmationSms()).state, "carrier_approval_required", "A general A2P attestation cannot authorize booking SMS");
    await recordAdminAttestation({
      gateKey: `ghl_booking_confirmation_a2p:${event.locationId}:${sender}:${campaign}`,
      attestedBy: "fixture", attestationNote: "Approved booking use case and assigned sender in fixture",
    });
    const makeDue = (id: string) => q("UPDATE ghl_booking_sms_consent_checks SET next_check_at=now() WHERE appointment_id=$1", [id]);
    await makeDue(appointmentId);
    process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED_AT = new Date(Date.now() + 60_000).toISOString();
    check((await processGhlBookingConfirmationSms()).checked, 0, "Bookings predating activation are excluded");
    check(senderReads, 0, "The sender does no provider reads when the gates are closed");
    process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED_AT = bookedAt;
    process.env.GHL_BOOKING_CONFIRMATION_SMS_PILOT_TO = "";
    check((await processGhlBookingConfirmationSms()).state, "unconfigured", "A blank pilot recipient fails closed");
    process.env.GHL_BOOKING_CONFIRMATION_SMS_PILOT_TO = "+19545550199";
    const otherRecipient = await processGhlBookingConfirmationSms();
    check(otherRecipient.staffPilot, true, "The recovery heartbeat identifies pilot mode");
    check(otherRecipient.checked, 0, "An opted-in booking outside the pilot does not reach the sender");
    check(senderReads, 0, "A non-pilot booking does not trigger provider reads");
    process.env.GHL_BOOKING_CONFIRMATION_SMS_PILOT_TO = submission.others.phone;

    // Signed booking requests can predate the CRM contact link. The exact saved form consent binds the recipient.
    await q("UPDATE inbound_requests SET contact_id=NULL WHERE occurrence_key=$1", [`ghl:appointment_booked:${appointmentId}`]);
    const attempts = await Promise.all([processGhlBookingConfirmationSms(), processGhlBookingConfirmationSms()]);
    check(attempts.reduce((total, attempt) => total + (attempt.accepted ?? 0), 0), 1, "Concurrent recovery ticks accept one opted-in booking");
    check(sent.map(value => value.appointmentId), [appointmentId], "Only the exact booking with affirmative consent is texted");
    const receipt = (id: string) => first("SELECT state,detail FROM followup_effect_receipts WHERE effect_key=$1", [`ghl_booking_confirmation:${id}:sms`]);
    check(await receipt(appointmentId), { state: "accepted", detail: "fixture-accepted-message" }, "The CRM keeps HighLevel's message ID");
    await makeDue(appointmentId);
    check((await processGhlBookingConfirmationSms()).checked, 0, "A settled booking remains fenced on later ticks");
    delete process.env.GHL_BOOKING_CONFIRMATION_SMS_PILOT_TO;

    async function addOptedInBooking(suffix: string, hours: number) {
      const id = appointmentId + "-" + suffix;
      const startTime = new Date(Date.parse(event.appointment.startTime) + hours * 3_600_000).toISOString();
      const appointment = { ...event.appointment, id, startTime, locationId: event.locationId };
      providerBookings.set(id, appointment);
      check((await deliver({ ...event, appointment })).body.applied, true, "Records the signed " + suffix + " fixture");
      submissions = [{ ...submission, id: suffix + "-" + tag, others: { ...submission.others, selected_slot: startTime } }];
      await processGhlBookingConsentChecks();
      check((await consentCheck(id)).state, "opted_in", "Saves appointment-specific consent for " + suffix);
      await makeDue(id);
      return appointment;
    }

    const later = await addOptedInBooking("later", 2);
    providerBookings.set(later.id, { ...later, appointmentStatus: "cancelled" });
    check((await processGhlBookingConfirmationSms()).held, 1, "A cancelled provider appointment is held");
    providerBookings.set(later.id, later);
    providerDnd = true;
    await makeDue(later.id);
    check((await processGhlBookingConfirmationSms()).held, 1, "HighLevel SMS DND holds an opted-in booking");
    providerDnd = false;
    await q("UPDATE contacts SET phone='+19545550148' WHERE id=$1", [contact.id]);
    await makeDue(later.id);
    check((await processGhlBookingConfirmationSms()).held, 1, "A phone change invalidates the captured SMS permission");
    await q("UPDATE contacts SET phone=$1 WHERE id=$2", [submission.others.phone, contact.id]);
    providerRefuses = true;
    await makeDue(later.id);
    check((await processGhlBookingConfirmationSms()).unknown, 1, "An ambiguous provider response is recorded for review");
    check(await receipt(later.id), { state: "unknown", detail: "GHL_AMBIGUOUS_DISPATCH: booking confirmation HTTP 503" },
      "The CRM records the uncertain attempt");
    await makeDue(later.id);
    check((await processGhlBookingConfirmationSms()).checked, 0, "An uncertain attempt cannot be resent by recovery");
    providerRefuses = false;

    const stopped = await addOptedInBooking("stopped", 3);
    await applyConsentCommand({
      subject: { type: "contact", id: contact.id }, kind: "opt_out", channel: "sms",
      eventNamespace: "fixture_sms_stop", eventKey: tag, source: "fixture_sms",
      evidence: { keyword: "STOP", senderPhone: submission.others.phone },
    });
    check((await processGhlBookingConfirmationSms()).held, 1, "A later STOP blocks an already opted-in appointment");
    check(sent.map(value => value.appointmentId), [appointmentId, later.id], "Only authorized fixture attempts reached the provider mock");

    const cancellationTime = new Date(Date.parse(bookedAt) + 60_000).toISOString();
    const cancelled = { ...event.appointment, locationId: event.locationId, appointmentStatus: "cancelled", dateUpdated: cancellationTime };
    providerBookings.set(appointmentId, cancelled);
    providerBookings.set(later.id, { ...later, appointmentStatus: "cancelled", dateUpdated: bookedAt });
    providerBookings.set(stopped.id, { ...stopped, contactId: "different-contact", appointmentStatus: "cancelled", dateUpdated: cancellationTime });
    const sweep = await reconcileGhlBookingCancellations();
    check(sweep.state, "active", "The configured sales calendar can run cancellation recovery");
    check(sweep.canceled, 1, "Provider polling recovers the one verified cancellation without a webhook");
    const readStatus = async (id: string) => (await first("SELECT status FROM ghl_appointment_state WHERE appointment_id=$1", [id])).status;
    check(await readStatus(appointmentId), "canceled", "The CRM shows the recovered booking as canceled");
    check(await readStatus(later.id), "booked", "An older cancellation does not overwrite a newer booking fact");
    check(await readStatus(stopped.id), "booked", "A mismatched provider contact cannot cancel the CRM booking");
    check(await readStatus(ambiguous.appointment.id), "booked", "An unavailable provider record is not treated as a cancellation");
    const repeated = await reconcileGhlBookingCancellations();
    check(repeated.canceled, 0, "Repeated recovery does not process a settled cancellation again");
    check(await consentCheck(appointmentId), optIn, "Recovery preserves historical appointment consent");
    check(await receipt(appointmentId), { state: "accepted", detail: "fixture-accepted-message" }, "Recovery preserves the existing SMS receipt");
    check(sent.map(value => value.appointmentId), [appointmentId, later.id], "Cancellation recovery does not send any messages");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    delete process.env.GHL_BOOKING_CONSENT_FORM_ID;
    delete process.env.GHL_BOOKING_CONFIRMATION_SMS_PILOT_TO;
    process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED = "false";
  }

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
