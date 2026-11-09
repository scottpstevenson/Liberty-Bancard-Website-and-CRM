/**
 * The statement uploader's admission limits, in one dependency-free module. The server's byte/type admission
 * (server/services/statement-upload-file.ts) derives its ceiling from here, and the public form generates its file
 * picker, size check and helper text from the same values, so the page can never promise a format or size the server
 * would refuse. Admission itself sniffs the bytes; the extensions below only steer the file picker.
 */
export const STATEMENT_UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxLabel: "10 MB",
  typesLabel: "PDF, JPEG or PNG",
  accept: ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg",
} as const;

/** "PDF, JPEG or PNG, up to 10 MB" — the one sentence every surface uses for what can be sent. */
export const STATEMENT_UPLOAD_HELPER = `${STATEMENT_UPLOAD_LIMITS.typesLabel}, up to ${STATEMENT_UPLOAD_LIMITS.maxLabel}`;
