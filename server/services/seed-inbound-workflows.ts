import { storage } from "../storage";

const INBOUND_CLASSIFICATION_WORKFLOWS = [
  {
    name: "Inbound: Booking Intent",
    triggerConditions: { classification: "booking_intent" },
    actions: [
      {
        type: "create_task",
        title: "Send booking link — {{contact.firstName}} {{contact.lastName}} wants to book",
        assignedTo: "Scott Stevenson",
        priority: "high",
        dueHours: 1,
        description: "Contact replied with booking intent. Send them the calendar link immediately.",
      },
      {
        type: "send_notification",
        channel: "internal",
        title: "🗓️ Booking Intent from {{contact.firstName}} {{contact.lastName}}",
        message: "Contact has expressed intent to book a call. Task created — send the calendar link ASAP.",
        notificationType: "warning",
      },
    ],
  },
  {
    name: "Inbound: Positive Reply",
    triggerConditions: { classification: "positive_reply" },
    actions: [
      {
        type: "update_contact_tags",
        addTags: ["hot-lead"],
        removeTags: [],
      },
      {
        type: "send_notification",
        channel: "internal",
        title: "🔥 Hot Lead — {{contact.firstName}} {{contact.lastName}} replied positively",
        message: "Contact sent a positive reply. Tagged as hot-lead. Follow up within the hour.",
        notificationType: "warning",
      },
    ],
  },
  {
    name: "Inbound: Objection",
    triggerConditions: { classification: "objection" },
    actions: [
      {
        type: "enroll_sequence",
        sequenceName: "Objection Crusher",
      },
    ],
  },
  {
    name: "Inbound: Unsubscribe",
    triggerConditions: { classification: "unsubscribe" },
    actions: [
      {
        type: "update_contact_tags",
        addTags: ["unsubscribed"],
        removeTags: [],
      },
      {
        type: "pause_enrollments",
      },
    ],
  },
];

async function seedObjectionCrusherSequence(): Promise<void> {
  const sequences = await storage.getFollowUpSequences();
  const exists = sequences.some(
    (s) => s.name?.toLowerCase() === "objection crusher"
  );
  if (exists) return;

  const seq = await storage.createFollowUpSequence({
    name: "Objection Crusher",
    description: "Re-engagement sequence for contacts who replied with an objection. Addresses common barriers (cost, timing, current provider) with value-focused follow-ups.",
    triggerType: "inbound_classification",
    totalSteps: 3,
    status: "active",
  });

  await storage.createSequenceStep({
    sequenceId: seq.id,
    stepOrder: 1,
    actionType: "email",
    delayDays: 1,
    delayHours: 0,
    subject: "Quick question — {{contact.firstName}}",
    body: `<p>Hi {{contact.firstName}},</p>
<p>Completely understand — timing is everything in business.</p>
<p>A lot of our best clients felt the same way before they saw how much they were losing in unnecessary processing fees. On average, we save merchants <strong>$200–$600/month</strong> with zero disruption to their current setup.</p>
<p>Would it be worth a 10-minute call to see if the numbers make sense for you? No pressure — if it doesn't pencil out, I'll tell you straight.</p>
<p><a href="{{calendarLink}}">Grab a 10-minute slot here</a></p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply. Reply STOP to opt out.</p>`,
  });

  await storage.createSequenceStep({
    sequenceId: seq.id,
    stepOrder: 2,
    actionType: "email",
    delayDays: 4,
    delayHours: 0,
    subject: "Still thinking it over? Here's what others said.",
    body: `<p>Hi {{contact.firstName}},</p>
<p>I know you mentioned it's not the right time — I hear that a lot. Here's what changed for a few of our clients who felt the same way:</p>
<ul>
  <li>"We were paying 3.2% effective rate. Liberty brought us down to 1.9% in the first month." — Restaurant owner, Tampa</li>
  <li>"Switching took one afternoon. I wish I'd done it two years earlier." — Retail shop, Orlando</li>
</ul>
<p>When the timing does feel right, I'm here. No hard sell — just numbers that work for you.</p>
<p><a href="{{calendarLink}}">Book a quick call</a></p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Reply STOP to opt out.</p>`,
  });

  await storage.createSequenceStep({
    sequenceId: seq.id,
    stepOrder: 3,
    actionType: "email",
    delayDays: 10,
    delayHours: 0,
    subject: "Last note from me — {{contact.firstName}}",
    body: `<p>Hi {{contact.firstName}},</p>
<p>I don't want to keep filling your inbox. This will be my last note for now.</p>
<p>If things change and you'd like a second look at your processing costs, you know where to find us. We've helped hundreds of Florida businesses reduce fees and switch providers without any downtime.</p>
<p><a href="{{calendarLink}}">Whenever you're ready →</a></p>
<p>Wishing you and {{contact.companyName}} continued success.</p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Reply STOP to opt out at any time.</p>`,
  });

  console.log(`[Seed] Created "Objection Crusher" sequence (id=${seq.id}) with 3 steps`);
}

export async function seedInboundMessageWorkflows(): Promise<void> {
  try {
    await seedObjectionCrusherSequence();

    const existing = await storage.getWorkflowsByTrigger("inbound_message");

    for (const seed of INBOUND_CLASSIFICATION_WORKFLOWS) {
      const alreadyExists = existing.some(
        (w) =>
          w.name === seed.name ||
          (w.triggerConditions &&
            (w.triggerConditions as Record<string, any>).classification ===
              seed.triggerConditions.classification)
      );

      if (alreadyExists) {
        continue;
      }

      await storage.createWorkflow({
        name: seed.name,
        triggerType: "inbound_message",
        triggerConfig: null,
        triggerConditions: seed.triggerConditions,
        actions: seed.actions,
        enabled: true,
      });

      console.log(`[Seed] Created inbound_message workflow: "${seed.name}" [classification=${seed.triggerConditions.classification}]`);
    }
  } catch (err: any) {
    console.warn("[Seed] seedInboundMessageWorkflows failed (non-fatal):", err.message);
  }
}
