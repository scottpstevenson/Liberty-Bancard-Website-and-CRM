import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { contacts } from "@shared/schema";
import { canAccessOwner } from "./crm-object-access";
import { calendarPurposeOf, type CalendarPurpose } from "./ghl-calendar-purpose";
import { deriveCurrentAppointmentId, readOpenAppointments } from "./ghl-appointment-events";

/**
 * Read-only appointment detail for the Calendar drawer. Everything here comes from recorded state, never from a
 * provider call: the appointment's recorded occurrence (and whether it is the current meeting for its contact and
 * calendar purpose), the last recorded provider observation, and the durable state of booking commands that target it.
 * A command with no receipt is not shown as absent-by-default: `commands` lists only what was recorded.
 */
export type CommandState = "pending" | "accepted" | "unknown" | "refused";

export interface AppointmentDetail {
  appointmentId: string;
  recorded: boolean;
  occurrence: null | {
    status: string; startTime: string | null; endTime: string | null; purpose: CalendarPurpose;
    rescheduleCount: number; current: boolean; currentAppointmentId: string | null;
  };
  lastObservation: null | { eventAt: string; recordedAt: string };
  commands: Array<{ operation: string; state: CommandState; startedAt: string; settledAt: string | null }>;
}

export const APPOINTMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const COMMAND_STATE: Record<string, CommandState> = { started: "pending", accepted: "accepted", unknown: "unknown", refused: "refused" };
const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** Returns null when the actor may not see this appointment (agents only see appointments of contacts they may access). */
export async function readAppointmentDetail(
  appointmentId: string, user: { role?: string; email?: string | null } | undefined,
): Promise<AppointmentDetail | null> {
  const state = (await db.execute(sql`SELECT appointment_id, ghl_contact_id, calendar_id, status, start_time, end_time,
      reschedule_count, last_event_at, updated_at FROM ghl_appointment_state WHERE appointment_id = ${appointmentId}`)).rows[0] as
    | { ghl_contact_id: string | null; calendar_id: string | null; status: string; start_time: unknown; end_time: unknown;
        reschedule_count: number; last_event_at: unknown; updated_at: unknown } | undefined;
  const privileged = user?.role === "admin" || user?.role === "manager";
  if (!privileged) {
    if (!state?.ghl_contact_id) return null;
    const mapped = await db.select({ owner: contacts.assignedTo }).from(contacts).where(eq(contacts.ghlContactId, state.ghl_contact_id));
    if (!mapped.length || !mapped.every((c) => canAccessOwner(user, c.owner, false))) return null;
  }
  const receipts = (await pool.query(
    `SELECT channel, state, created_at, settled_at FROM followup_effect_receipts
      WHERE owner_kind = 'booking_command' AND (detail = $1 OR split_part(channel, ':', 2) = $1)
      ORDER BY created_at DESC LIMIT 10`, [appointmentId])).rows as Array<{ channel: string; state: string; created_at: unknown; settled_at: unknown }>;
  const commands = receipts.map((row) => ({
    operation: row.channel.replace(/^calendar_/, "").split(":")[0],
    state: COMMAND_STATE[row.state] ?? "unknown",
    startedAt: iso(row.created_at) ?? "",
    settledAt: iso(row.settled_at),
  }));
  if (!state) return { appointmentId, recorded: false, occurrence: null, lastObservation: null, commands };
  const purpose = calendarPurposeOf(state.calendar_id);
  let currentAppointmentId: string | null = null;
  if (state.ghl_contact_id) {
    currentAppointmentId = deriveCurrentAppointmentId(await readOpenAppointments(db, state.ghl_contact_id), calendarPurposeOf, purpose);
  }
  return {
    appointmentId, recorded: true,
    occurrence: {
      status: state.status, startTime: iso(state.start_time), endTime: iso(state.end_time), purpose,
      rescheduleCount: Number(state.reschedule_count ?? 0), current: currentAppointmentId === appointmentId, currentAppointmentId,
    },
    lastObservation: { eventAt: iso(state.last_event_at) ?? "", recordedAt: iso(state.updated_at) ?? "" },
    commands,
  };
}
