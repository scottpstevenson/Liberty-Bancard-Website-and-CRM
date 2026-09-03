/**
 * maskMid — canonical MID masking helper (REV-05A).
 *
 * Rules:
 *   - null/undefined/empty → null
 *   - length ≤ 4  → fully masked (no digits exposed — value too short to
 *                    safely show a suffix without revealing the entire MID)
 *   - length  > 4 → asterisks for all but last 4 digits, then last 4
 *
 * Use this in EVERY route/service that returns a MID to a caller.
 * Never inline the masking expression — short MIDs would leak the full value.
 */
export function maskMid(mid: string | null | undefined): string | null {
  if (!mid) return null;
  if (mid.length <= 4) return "*".repeat(mid.length);
  return "*".repeat(mid.length - 4) + mid.slice(-4);
}

/**
 * redactMidPatternsFromText — replaces MID-like digit sequences (8–15 digits)
 * in free-form text with `[REDACTED-MID]`.
 *
 * Provider status messages (e.g. "Application approved. MID 123456789012")
 * and historical log entries may embed raw MIDs in string fields. This
 * function sanitizes those patterns before any such text is persisted or
 * returned in a response.
 *
 * Conservative approach: only redacts isolated digit runs of 8–15 characters
 * that are not part of a longer alphanumeric token (e.g. phone numbers are
 * acceptable collateral — they must not appear in processor messages anyway).
 */
export function redactMidPatternsFromText(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  // Matches 8–15 consecutive digits not adjacent to other word characters.
  return text.replace(/(?<!\w)\d{8,15}(?!\w)/g, "[REDACTED-MID]");
}

/**
 * sanitizeBoardingLog — strips or masks raw MID values from boarding log entries.
 *
 * Boarding log entries written before REV-05A may contain:
 *   - A top-level `mid` field (raw MID value) — removed and replaced with midMasked.
 *   - MID-bearing text in `message`, `event`, `error`, and similar string fields
 *     (e.g. "Application approved. MID 123456789012") — redacted via regex.
 *
 * Callers must sanitize the full log array before returning it in any response
 * AND before persisting it to the database.
 */
export function sanitizeBoardingLog(log: unknown[]): unknown[] {
  return log.map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const e = entry as Record<string, unknown>;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(e)) {
      if (key === "mid") {
        // Replace raw `mid` field with masked value.
        result["midMasked"] = (e["midMasked"] as string | undefined) ?? maskMid(value as string);
      } else if (typeof value === "string") {
        // Redact MID-like digit runs from all string fields (message, event, error, etc.).
        result[key] = redactMidPatternsFromText(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  });
}

/**
 * sanitizeLatestLogMessage — sanitize a single log message string before
 * returning it to callers (e.g. in /api/boarding/submissions latestLogMessage).
 */
export function sanitizeLatestLogMessage(msg: string | null | undefined): string | null {
  return redactMidPatternsFromText(msg);
}

/**
 * serializeDeal — canonical safe serializer for general deal responses.
 *
 * Call this on every deal object returned from GET /api/deals,
 * GET /api/deals/:id, and GET /api/contacts/:id/deals.
 *
 * It:
 *   1. Replaces `mid` with masked value and adds `hasMid` boolean.
 *   2. Sanitizes `boardingLog` (removes raw `mid` fields, redacts MID-like
 *      digit sequences from all string values in every log entry).
 *
 * Never spread a raw deal object into a response without going through here.
 */
export function serializeDeal(deal: Record<string, unknown>): Record<string, unknown> {
  const { mid, boardingLog, ...rest } = deal;
  const safeBoardingLog = Array.isArray(boardingLog)
    ? sanitizeBoardingLog(boardingLog)
    : boardingLog;
  return {
    ...rest,
    mid: maskMid(mid as string | null | undefined),
    hasMid: !!mid,
    boardingLog: safeBoardingLog,
  };
}

/**
 * redactProviderText — sanitize a provider-derived string before persisting
 * it into audit logs, notifications, or task descriptions.
 *
 * Provider responses may embed MID-like digit sequences in status messages
 * and error text. Always pass through this before any write.
 */
export function redactProviderText(text: string | null | undefined): string | null {
  return redactMidPatternsFromText(text);
}
