import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { messageTemplates, messageTemplateVersions } from "@shared/schema";
import { auditChange } from "./audit-change";
import { lintCopy, type CopyFinding } from "./message-copy-lint";
import { previewMessage } from "./message-token-registry";

/**
 * Four deliberately separate content/purpose commands exist for outbound wording:
 *  - save draft            -> writes only the draft row; live wording is untouched
 *  - publish content       -> promotes the draft to live wording as an immutable numbered version; never changes
 *                             isActive, workflow enablement, campaign state or any send capability
 *  - enable transactional  -> inbound-acknowledgements capability route (separate service)
 *  - activate campaign use -> setTemplateActive below; refuses wording that still fails the copy checks
 */

/** Safe metadata returned with a 409 so the editor can recover without overwriting anyone's work. No wording included. */
export interface DraftConflict {
  hasDraft: boolean;
  /** Identity of the draft that exists now; null when there is none. */
  draftToken: string | null;
  baseVersion: number | null;
  authorId: string | null;
  updatedAt: string | null;
  liveVersion: number;
}

export class TemplateVersionError extends Error {
  constructor(message: string, public status: number, public findings?: CopyFinding[], public conflict?: DraftConflict) { super(message); }
}

type DraftIdentityRow = { id: number; baseVersion: number | null; subject: string | null; body: string };

/**
 * Identity of a saved draft: row, the published version it was written against, and its exact wording. Save, discard and
 * publish compare it under the template lock, so a command acts on the saved content the operator last saw or fails with
 * 409. The same token is kept when the draft row is promoted, which lets a retried publish find its own receipt.
 */
export function draftToken(d: DraftIdentityRow | null | undefined): string | null {
  if (!d) return null;
  return createHash("sha256").update(JSON.stringify([d.id, d.baseVersion, d.subject ?? null, d.body])).digest("hex").slice(0, 24);
}

function conflictOf(live: number, d: (DraftIdentityRow & { authorId: string | null; updatedAt: Date | null }) | undefined): DraftConflict {
  return {
    hasDraft: !!d, draftToken: draftToken(d), baseVersion: d?.baseVersion ?? null, authorId: d?.authorId ?? null,
    updatedAt: d?.updatedAt ? d.updatedAt.toISOString() : null, liveVersion: live,
  };
}

function assertDraftIdentity(live: number, d: Parameters<typeof conflictOf>[1], expected: string | null | undefined, action: string) {
  if (expected === undefined) return; // in-process system callers that never held a draft view
  if (draftToken(d) !== expected) {
    throw new TemplateVersionError(
      `The draft changed since you opened it, so it was not ${action}. Reload the current draft or copy your changes first.`,
      409, undefined, conflictOf(live, d),
    );
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const lintTemplate = (subject: string | null | undefined, body: string) => lintCopy(`${subject ?? ""}\n${body}`, "template");

async function lockTemplate(tx: Tx, id: number) {
  const [t] = await tx.select().from(messageTemplates).where(eq(messageTemplates.id, id)).for("update");
  if (!t) throw new TemplateVersionError("Template not found", 404);
  return t;
}

/** Records the pre-existing live wording as a published version once, so history starts from what was really live. */
async function ensureBaseline(tx: Tx, t: typeof messageTemplates.$inferSelect) {
  await tx.insert(messageTemplateVersions).values({
    templateId: t.id, version: t.contentVersion, baseVersion: t.contentVersion, state: "published",
    subject: t.subject, body: t.body, authorId: null, publishedBy: null, publishedAt: t.updatedAt ?? new Date(),
  }).onConflictDoNothing();
}

export async function getTemplateWorkspace(templateId: number) {
  const [template] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, templateId));
  if (!template) throw new TemplateVersionError("Template not found", 404);
  const rows = await db.select().from(messageTemplateVersions).where(eq(messageTemplateVersions.templateId, templateId))
    .orderBy(desc(messageTemplateVersions.version));
  const draft = rows.find((r) => r.state === "draft") ?? null;
  const history = rows.filter((r) => r.state === "published");
  return {
    template,
    draft,
    draftToken: draftToken(draft),
    history,
    liveFindings: lintTemplate(template.subject, template.body),
    draftFindings: draft ? lintTemplate(draft.subject, draft.body) : [],
  };
}

export function previewTemplate(input: { subject?: string | null; body: string }) {
  const preview = previewMessage("template", input, "html");
  return {
    subject: preview.subject,
    html: preview.body,
    unresolved: preview.unresolved,
    personas: preview.personas,
    findings: lintTemplate(input.subject, input.body),
    note: "Rendered by the same renderer that sends stored templates, with sample values. Nothing is sent or stored by previewing.",
  };
}

/** Images-off view: every image becomes a bordered alt-text placeholder, as in a client that blocks remote images. */
export const imagesOffHtml = (html: string) => html.replace(/<img\b[^>]*>/gi, (tag) => {
  const alt = /alt\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
  return `<span style="border:1px dashed #999;padding:2px 6px;font-size:12px;color:#555;">${alt ? `[image: ${alt}]` : "[image]"}</span>`;
});

export interface FinalMessagePreview {
  channel: "email" | "sms";
  subject: string | null;
  /** Exactly what the send path hands to the provider for an email: body plus the marketing compliance footer. */
  html: string;
  text: string;
  htmlImagesOff: string;
  sender: { mode: "provider_default" | "sender_policy" | "unknown"; address: string | null; name: string | null; note: string };
  replyTo: { mode: "not_set" | "sender_policy" | "unknown"; address: string | null; note: string };
  /** What the transport really sends. Plain text below is generated reference text unless textTransmitted is true. */
  transport: { name: "ghl_conversations" | "sfp_smtp" | "gmail_non_cold"; payloadFields: string[]; textTransmitted: boolean; note: string };
  /** Always true: the preview runs the real composers on sample data; it is not a delivery or a mail-client render. */
  simulation: true;
  logoCount: number;
  signaturePresent: boolean;
  signatureCount: number;
  footerCount: number;
  footer: { state: "applied" | "unavailable"; reason?: string };
  note: string;
}

/**
 * The final message as the stored-template send path assembles it. Uses the same footer renderer as the send (with a
 * sample unsubscribe link), so the previewed footer, plain-text part and sender facts are the real ones. When the
 * compliance prerequisites are missing the preview says so, because a real send would fail the same way.
 */
export async function previewTemplateFinal(input: { subject?: string | null; body: string; channel?: "email" | "sms" }) {
  const base = previewTemplate(input);
  if (input.channel !== "email") return { ...base, final: null as FinalMessagePreview | null };
  return { ...base, final: await buildFinalEmailPreview({ subject: base.subject, html: base.html }) };
}

/**
 * Final-email view shared by stored templates and workflow steps. It runs the same composer the transport uses
 * (renderEmailPartsForPurpose: one signature, one footer) and reads the payload fields from the same builder the
 * provider call uses, so what is shown is what is handed over. Sender facts the code cannot know are labelled unknown.
 */
export async function buildFinalEmailPreview(input: { subject: string | null; html: string }): Promise<FinalMessagePreview> {
  const { renderEmailPartsForPurpose, getCommercialComplianceConfig } = await import("./can-spam-footer");
  const { inspectPresentation } = await import("./email-presentation");
  const { buildGhlEmailPayload } = await import("./ghl");
  const loader = async () => {
    const real = await getCommercialComplianceConfig();
    return real.ok ? { ok: true as const, mailingAddress: real.mailingAddress, unsubscribeUrl: "https://libertybancard.com/unsubscribe?t=SAMPLE-TOKEN" } : real;
  };
  const sender: FinalMessagePreview["sender"] = {
    mode: "unknown", address: null, name: null,
    note: "Sent through the provider with its configured location sender. The From address is not stored here, so it is unknown to this preview.",
  };
  const replyTo: FinalMessagePreview["replyTo"] = {
    mode: "unknown", address: null,
    note: "No Reply-To is set by this wording. A sending path may supply one; it is not visible here.",
  };
  let html = input.html, text = "";
  let footer: FinalMessagePreview["footer"];
  let note = "Sample values and a sample unsubscribe link. Nothing is sent or stored by previewing.";
  try {
    const parts = await renderEmailPartsForPurpose({ html: input.html, purpose: "marketing_outreach", complianceLoader: loader });
    html = parts.html; text = parts.text; footer = { state: "applied" };
  } catch (err) {
    footer = { state: "unavailable", reason: err instanceof Error ? err.message : "COMPLIANCE_CONFIGURATION_UNAVAILABLE" };
    note = "The required compliance footer cannot be built, so a real send of this message would fail until that is configured.";
  }
  const facts = inspectPresentation(html);
  const payloadFields = Object.keys(buildGhlEmailPayload({ ghlContactId: "preview", subject: input.subject ?? "", html }));
  return {
    channel: "email", subject: input.subject, html, text, htmlImagesOff: imagesOffHtml(html), sender, replyTo, simulation: true,
    transport: {
      name: "ghl_conversations", payloadFields, textTransmitted: payloadFields.includes("text"),
      note: "The provider call carries an HTML body only. The plain text shown is generated reference text; it is not sent as a separate part.",
    },
    logoCount: facts.logoCount, signaturePresent: facts.signatureCount > 0, signatureCount: facts.signatureCount, footerCount: facts.footerCount,
    footer, note,
  };
}

export async function saveDraft(
  templateId: number,
  /** expectedDraftToken: null = "I saw no draft"; a token = "I saw this draft"; undefined = unchecked (system callers). */
  input: { subject: string | null; body: string; baseVersion: number; expectedDraftToken?: string | null },
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const t = await lockTemplate(tx, templateId);
    if (input.baseVersion !== t.contentVersion) {
      throw new TemplateVersionError("The published wording changed since you opened it. Reopen the template before saving.", 409);
    }
    const [existing] = await tx.select().from(messageTemplateVersions)
      .where(and(eq(messageTemplateVersions.templateId, templateId), eq(messageTemplateVersions.state, "draft"))).for("update");
    assertDraftIdentity(t.contentVersion, existing, input.expectedDraftToken, "saved");
    let draft;
    if (existing) {
      [draft] = await tx.update(messageTemplateVersions).set({
        subject: input.subject, body: input.body, baseVersion: t.contentVersion, authorId: actorId, updatedAt: new Date(),
      }).where(eq(messageTemplateVersions.id, existing.id)).returning();
    } else {
      [draft] = await tx.insert(messageTemplateVersions).values({
        templateId, version: null, baseVersion: t.contentVersion, state: "draft",
        subject: input.subject, body: input.body, authorId: actorId,
      }).returning();
    }
    await auditChange({
      userId: actorId, action: "message_template_draft_saved", entityType: "message_template", entityId: templateId,
      details: { baseVersion: t.contentVersion, liveWordingChanged: false, replacedDraftToken: draftToken(existing) },
    }, tx);
    return { ...draft, draftToken: draftToken(draft) };
  });
}

export async function discardDraft(templateId: number, actorId: string, opts: { expectedDraftToken?: string | null } = {}) {
  return db.transaction(async (tx) => {
    const t = await lockTemplate(tx, templateId);
    const [current] = await tx.select().from(messageTemplateVersions)
      .where(and(eq(messageTemplateVersions.templateId, templateId), eq(messageTemplateVersions.state, "draft"))).for("update");
    assertDraftIdentity(t.contentVersion, current, opts.expectedDraftToken, "discarded");
    if (!current) return { discarded: 0 };
    await tx.delete(messageTemplateVersions).where(eq(messageTemplateVersions.id, current.id));
    await auditChange({
      userId: actorId, action: "message_template_draft_discarded", entityType: "message_template", entityId: templateId,
      details: { discardedDraftToken: draftToken(current) },
    }, tx);
    return { discarded: 1 };
  });
}

/** Promotes the saved draft to live wording. Does not touch isActive or anything that sends. */
export async function publishDraft(
  templateId: number,
  input: { expectedVersion: number; expectedDraftToken?: string | null },
  actorId: string | null,
  actorType: "user" | "system" = "user",
) {
  return db.transaction(async (tx) => {
    const t = await lockTemplate(tx, templateId);
    if (input.expectedDraftToken && input.expectedVersion + 1 === t.contentVersion) {
      // A lost response after a committed publish: the promoted row keeps the draft's identity, so the retry gets its own receipt.
      const [promoted] = await tx.select().from(messageTemplateVersions).where(and(
        eq(messageTemplateVersions.templateId, templateId), eq(messageTemplateVersions.version, t.contentVersion), eq(messageTemplateVersions.state, "published"),
      ));
      if (promoted && promoted.baseVersion === input.expectedVersion && draftToken(promoted) === input.expectedDraftToken) {
        return { ...t, replayed: true as const };
      }
    }
    if (input.expectedVersion !== t.contentVersion) {
      throw new TemplateVersionError("The published wording changed since you opened it. Reopen the template before publishing.", 409);
    }
    const [draft] = await tx.select().from(messageTemplateVersions)
      .where(and(eq(messageTemplateVersions.templateId, templateId), eq(messageTemplateVersions.state, "draft"))).for("update");
    if (!draft) throw new TemplateVersionError("Save a draft before publishing.", 409, undefined, conflictOf(t.contentVersion, undefined));
    assertDraftIdentity(t.contentVersion, draft, input.expectedDraftToken, "published");
    if (draft.baseVersion !== t.contentVersion) {
      throw new TemplateVersionError("The draft was written against older wording. Save it again before publishing.", 409);
    }
    const findings = lintTemplate(draft.subject, draft.body);
    if (findings.length) {
      throw new TemplateVersionError("The draft still contains wording that cannot be sent. Fix these before publishing.", 422, findings);
    }
    await ensureBaseline(tx, t);
    const next = t.contentVersion + 1;
    const now = new Date();
    await tx.update(messageTemplateVersions).set({
      state: "published", version: next, publishedBy: actorId, publishedAt: now, updatedAt: now,
    }).where(eq(messageTemplateVersions.id, draft.id));
    const [updated] = await tx.update(messageTemplates).set({
      subject: draft.subject, body: draft.body, contentVersion: next, updatedAt: now,
    }).where(eq(messageTemplates.id, templateId)).returning();
    await auditChange({
      userId: actorType === "user" ? actorId : null, actorType, actorId, action: "message_template_content_published",
      entityType: "message_template", entityId: templateId,
      before: { version: t.contentVersion, subject: t.subject, body: t.body },
      after: { version: next, subject: draft.subject, body: draft.body },
      details: { isActiveUnchanged: updated.isActive, draftToken: draftToken(draft) },
    }, tx);
    return { ...updated, replayed: false as const };
  });
}

/**
 * System convergence of reviewed wording as ONE atomic step under the template lock: the live version must still be the
 * one the change was computed from, no operator draft may exist, and the new wording is published as the next immutable
 * version without ever creating a draft row. A draft an operator saves at any moment is therefore either already
 * visible here (conflict, left intact) or saved afterwards against the new version; it can never be overwritten,
 * consumed or published by the system.
 */
export async function publishSystemWording(
  templateId: number,
  input: { expectedVersion: number; subject: string | null; body: string },
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const t = await lockTemplate(tx, templateId);
    if (input.expectedVersion !== t.contentVersion) {
      throw new TemplateVersionError("The published wording changed since the change was computed.", 409);
    }
    const [draft] = await tx.select({ id: messageTemplateVersions.id }).from(messageTemplateVersions)
      .where(and(eq(messageTemplateVersions.templateId, templateId), eq(messageTemplateVersions.state, "draft"))).for("update");
    if (draft) throw new TemplateVersionError("An administrator draft exists; not overwritten.", 409);
    const findings = lintTemplate(input.subject, input.body);
    if (findings.length) throw new TemplateVersionError("The reviewed wording still contains text that cannot be sent.", 422, findings);
    await ensureBaseline(tx, t);
    const next = t.contentVersion + 1;
    const now = new Date();
    await tx.insert(messageTemplateVersions).values({
      templateId, version: next, baseVersion: t.contentVersion, state: "published", subject: input.subject, body: input.body,
      authorId: null, publishedBy: actorId, publishedAt: now, updatedAt: now,
    });
    const [updated] = await tx.update(messageTemplates).set({
      subject: input.subject, body: input.body, contentVersion: next, updatedAt: now,
    }).where(eq(messageTemplates.id, templateId)).returning();
    await auditChange({
      userId: null, actorType: "system", actorId, action: "message_template_content_published",
      entityType: "message_template", entityId: templateId,
      before: { version: t.contentVersion, subject: t.subject, body: t.body },
      after: { version: next, subject: input.subject, body: input.body },
      details: { isActiveUnchanged: updated.isActive, via: "system_convergence" },
    }, tx);
    return updated;
  });
}

/** Campaign/operator use of a template. Deactivation is always allowed; activation needs clean live wording. */
export async function setTemplateActive(templateId: number, active: boolean, actorId: string) {
  return db.transaction(async (tx) => {
    const t = await lockTemplate(tx, templateId);
    if (active) {
      const findings = lintTemplate(t.subject, t.body);
      if (findings.length) {
        throw new TemplateVersionError("The published wording still contains text that cannot be sent. Publish corrected wording first.", 422, findings);
      }
    }
    if ((t.isActive ?? false) === active) return t;
    const [updated] = await tx.update(messageTemplates).set({ isActive: active, updatedAt: new Date() })
      .where(eq(messageTemplates.id, templateId)).returning();
    await auditChange({
      userId: actorId, action: active ? "message_template_activated" : "message_template_deactivated",
      entityType: "message_template", entityId: templateId, details: { contentVersion: t.contentVersion },
    }, tx);
    return updated;
  });
}
