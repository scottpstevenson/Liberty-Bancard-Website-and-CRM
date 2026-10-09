/** Browser-local calendar window. End is the first instant of the next month,
 * never the last day's midnight or an inclusive next-month boundary. */
export function isCalendarStartInWindow(value: Date, start: Date, exclusiveEnd: Date): boolean {
  const time = value.getTime(), first = start.getTime(), end = exclusiveEnd.getTime();
  return Number.isFinite(time) && Number.isFinite(first) && Number.isFinite(end) &&
    end > first && time >= first && time < end;
}
