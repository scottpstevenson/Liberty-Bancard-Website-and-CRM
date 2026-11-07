/**
 * One bounded tick of the website email lifecycle lane. Everything here is default closed:
 *   1. admission   — evaluates held website intents against the CURRENT lane configuration (a closed lane admits nothing)
 *   2. mailbox     — polls the Gmail mailbox ONLY when an admin has opened the reader (otherwise no provider call is made)
 *   3. warm sends  — claims only enrollments carrying an active admission marker; every send re-checks pause, stop,
 *                    capacity and contactability inside its own fence
 * Each stage fails independently and reports a typed outcome; a stage error never skips a later stage's own gates.
 */
import { processWebsiteLifecycleIntents } from "./website-email-lane-store";
import { processWebsiteWarmEnrollments } from "./website-email-runtime";
import { pollMailboxOnce, type ReaderTally } from "./gmail-mailbox-reader";

export interface WebsiteEmailTickResult {
  admission: Awaited<ReturnType<typeof processWebsiteLifecycleIntents>> | { error: string };
  mailbox: ReaderTally | { error: string };
  warm: Awaited<ReturnType<typeof processWebsiteWarmEnrollments>> | { error: string };
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");

export class WebsiteEmailCapabilityInactiveError extends Error {
  constructor(readonly capability: { selected: boolean; workerActive: boolean; activeProfile: string }) {
    super("The website email capability is not selected and running in this process; the tick refuses to run.");
    this.name = "WebsiteEmailCapabilityInactiveError";
  }
}

/** The tick runs only inside a process whose selected background profile owns the website-email worker. */
export async function defaultCapabilityCheck(): Promise<{ selected: boolean; workerActive: boolean; activeProfile: string }> {
  const [{ getWorkerCapabilityStatus }, { QUEUE_NAMES }] = await Promise.all([import("./queue-manager"), import("./queue-names")]);
  return getWorkerCapabilityStatus(QUEUE_NAMES.WEBSITE_EMAIL);
}

export async function runWebsiteEmailTick(
  deps: { capabilityCheck?: typeof defaultCapabilityCheck } = {},
): Promise<WebsiteEmailTickResult> {
  const capability = await (deps.capabilityCheck ?? defaultCapabilityCheck)();
  if (!capability.selected || !capability.workerActive) throw new WebsiteEmailCapabilityInactiveError(capability);
  const admission = await processWebsiteLifecycleIntents().catch((error) => ({ error: errorName(error) }));
  const mailbox = await pollMailboxOnce().catch((error) => ({ error: errorName(error) }));
  const warm = await processWebsiteWarmEnrollments().catch((error) => ({ error: errorName(error) }));
  return { admission, mailbox, warm };
}
