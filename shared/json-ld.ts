/**
 * Serialize JSON-LD for an HTML script element.
 *
 * JSON is data, but HTML parsers still terminate a script element at a
 * literal "</script". Escaping the HTML-sensitive characters and line
 * separators keeps database-backed values inside the JSON-LD data block in
 * both server-rendered and client-rendered pages.
 */
export function serializeJsonLd(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("JSON-LD values must be JSON-serializable");
  }

  return serialized
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}