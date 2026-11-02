/**
 * Typed occurrence identity for GHL workflow handoffs (Stage 4C2).
 *
 * One appointment/call occurrence owns one handoff obligation. The same helper is used when the obligation is
 * dispatched, deferred, recovered and cancelled, so a cancellation that carries `canceledAppointmentId` finds exactly
 * the obligation the booking created. No identity means no occurrence: callers must treat `null` as "owns nothing" and
 * must never widen it into "every obligation of this workflow for the contact".
 */
export type OccurrenceMetadata = Readonly<Record<string, unknown>>;

const OCCURRENCE_FIELDS = ["appointmentId", "canceledAppointmentId", "appointmentDate", "meetingId", "callId"] as const;

export function occurrenceKeyOf(metadata: OccurrenceMetadata | null | undefined): string | null {
  if (!metadata) return null;
  for (const field of OCCURRENCE_FIELDS) {
    const value = metadata[field];
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text.length > 0) return text;
  }
  return null;
}
