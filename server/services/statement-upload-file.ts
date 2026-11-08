/**
 * Statement file admission. Decides, from the bytes themselves, whether an upload is a statement we can retain and
 * which real media type to record. The declared multipart type and the filename extension are caller-controlled, so
 * neither is trusted: a JPG or PNG photo is retained as an image, never relabelled as a PDF.
 *
 * Pure and dependency-free so the public route can run it BEFORE it claims an occurrence, creates a contact or
 * stores an object, and so tests can exercise it without a database.
 */

/** Same ceiling as the shared document upload middleware. */
export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024;

export type StatementMimeType = "application/pdf" | "image/jpeg" | "image/png";

export type StatementFileVerdict =
  | { ok: true; mimeType: StatementMimeType; sizeBytes: number }
  | { ok: false; status: 400 | 413 | 415; code: "STATEMENT_FILE_REQUIRED" | "STATEMENT_FILE_TOO_LARGE" | "STATEMENT_FILE_TYPE_UNSUPPORTED" };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Media type of the bytes, or null when they are not a PDF, JPEG or PNG. */
export function sniffStatementMimeType(bytes: Buffer): StatementMimeType | null {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return null;
  // The PDF specification allows the header anywhere in the first 1024 bytes.
  if (bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  return null;
}

export function inspectStatementFile(file: { buffer?: Buffer | null } | null | undefined): StatementFileVerdict {
  const bytes = file?.buffer;
  if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { ok: false, status: 400, code: "STATEMENT_FILE_REQUIRED" };
  }
  if (bytes.length > STATEMENT_MAX_BYTES) return { ok: false, status: 413, code: "STATEMENT_FILE_TOO_LARGE" };
  const mimeType = sniffStatementMimeType(bytes);
  if (!mimeType) return { ok: false, status: 415, code: "STATEMENT_FILE_TYPE_UNSUPPORTED" };
  return { ok: true, mimeType, sizeBytes: bytes.length };
}
