type EventTimes = { startTime: string; endTime: string };
type ReplacementTimes = { startTime: string; durationMinutes: number };

/** Browser-local dates, matching the Calendar's displayed date/time semantics. */
export function localCalendarDateAtTime(day: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Choose a valid date and start time.");
  }
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(year, month - 1, date, hours, minutes);
  if (year < 100 || result.getFullYear() !== year || result.getMonth() !== month - 1
      || result.getDate() !== date || result.getHours() !== hours || result.getMinutes() !== minutes) {
    throw new Error("This date or local time does not exist. Choose another.");
  }
  return result;
}

export function moveCalendarEventToDate(
  original: EventTimes, day: string, replacement?: ReplacementTimes,
): EventTimes {
  const start = new Date(original.startTime);
  const end = new Date(original.endTime);
  const startValid = Number.isFinite(start.getTime());
  const originalDuration = end.getTime() - start.getTime();
  const time = startValid
    ? `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`
    : replacement?.startTime;
  if (!time) throw new Error("Choose a replacement start time for the invalid event.");
  const moved = localCalendarDateAtTime(day, time);
  if (startValid) moved.setSeconds(start.getSeconds(), start.getMilliseconds());
  const replacementMinutes = replacement?.durationMinutes;
  const duration = startValid && Number.isFinite(originalDuration) && originalDuration > 0
    ? originalDuration
    : replacementMinutes !== undefined && Number.isInteger(replacementMinutes)
      && replacementMinutes > 0 && replacementMinutes <= 10080
      ? replacementMinutes * 60_000 : NaN;
  if (!Number.isFinite(duration)) throw new Error("Enter a positive replacement duration (1–10080 minutes).");
  const movedEnd = new Date(moved.getTime() + duration);
  if (!Number.isFinite(movedEnd.getTime()) || movedEnd <= moved) throw new Error("Event end must follow its start.");
  return { startTime: moved.toISOString(), endTime: movedEnd.toISOString() };
}
