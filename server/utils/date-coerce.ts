export class DateValidationError extends Error {
  public readonly field: string;
  constructor(field: string, value: string) {
    super(`Invalid date value for field "${field}": "${value}"`);
    this.name = "DateValidationError";
    this.field = field;
  }
}

export function coerceDateFields<T extends Record<string, unknown>>(
  updates: T,
  fields: string[],
): T {
  const result = { ...updates } as Record<string, unknown>;
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (isNaN(parsed.getTime())) {
        throw new DateValidationError(field, value);
      }
      result[field] = parsed;
    }
  }
  return result as T;
}
