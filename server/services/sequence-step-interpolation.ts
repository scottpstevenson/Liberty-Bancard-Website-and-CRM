import { assertRenderedLinksSafe } from "./message-token-registry";

/**
 * The substitution the sequence worker applies to a legacy (non-SFP-launch) step's subject and body, extracted so the
 * worker and the editor's "as sent" preview run the same code. Pure: no database, network or environment.
 */
export interface SequenceInterpolationValues {
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  industry: string;
  monthlyVolume: string;
  currentProcessor: string;
  recommendedProgram: string;
  recommendedTerminal: string;
  serviceType: string;
  estimatedVolume: string;
  agentName: string;
  agentEmail: string;
  agentPhone: string;
  businessName: string;
  /** Resolved first-party booking address, or null when sales booking is not configured (token stays unresolved and blocks). */
  calendarLink: string | null;
}

const SENSITIVE = /\{\{agentEmail\}\}|\{\{agentPhone\}\}|\{\{agent\w+\}\}/;

/**
 * @param where Context appended to a blocking error (the worker passes the enrollment and step; the preview passes the step).
 */
export function interpolateSequenceText(text: string | null | undefined, v: SequenceInterpolationValues, where: string): string {
  if (!text) return "";
  const booked = v.calendarLink
    ? text.replace(/\{\{calendarLink\}\}/g, v.calendarLink).replace(/\{\{custom_values\.booking_link\}\}/g, v.calendarLink)
    : text;
  const result = booked
    .replace(/\{\{firstName\}\}/g, v.firstName)
    .replace(/\{\{lastName\}\}/g, v.lastName)
    .replace(/\{\{companyName\}\}/g, v.companyName)
    .replace(/\{\{email\}\}/g, v.email)
    .replace(/\{\{contact\.firstName\}\}/g, v.firstName)
    .replace(/\{\{contact\.lastName\}\}/g, v.lastName)
    .replace(/\{\{contact\.companyName\}\}/g, v.companyName)
    .replace(/\{\{industry\}\}/g, v.industry)
    .replace(/\{\{monthlyVolume\}\}/g, v.monthlyVolume)
    .replace(/\{\{currentProcessor\}\}/g, v.currentProcessor)
    .replace(/\{\{recommendedProgram\}\}/g, v.recommendedProgram)
    .replace(/\{\{recommendedTerminal\}\}/g, v.recommendedTerminal)
    .replace(/\{\{serviceType\}\}/g, v.serviceType)
    .replace(/\{\{estimatedVolume\}\}/g, v.estimatedVolume)
    .replace(/\{\{agentName\}\}/g, v.agentName)
    .replace(/\{\{agentEmail\}\}/g, v.agentEmail)
    .replace(/\{\{agentPhone\}\}/g, v.agentPhone)
    .replace(/\{\{businessName\}\}/g, v.businessName)
    .replace(/\{\{contact\.vertical\}\}/g, v.industry)
    .replace(/\{\{vertical\}\}/g, v.industry);
  // Safety net (#1136): raw {{...}} template syntax that survived substitution is never sent.
  const remaining = result.match(/\{\{[^}]+\}\}/g);
  if (remaining) {
    const sensitive = remaining.filter((p) => SENSITIVE.test(p));
    if (sensitive.length) {
      console.error(`[Sequence Worker] BLOCKED outbound — sensitive unresolved placeholder(s) (${where}): ${sensitive.join(", ")}`);
      throw new Error(`Outbound blocked: unresolved sensitive placeholder(s) ${sensitive.join(", ")} in ${where}`);
    }
    throw new Error(`Outbound blocked: unresolved template placeholder(s) ${remaining.join(", ")} in ${where}`);
  }
  // Final link gate, identical to publication and the shared renderer.
  assertRenderedLinksSafe(result, [v.calendarLink]);
  return result;
}
