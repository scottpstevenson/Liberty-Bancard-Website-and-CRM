/**
 * Wave 2 — Canonical PEWC (Prior Express Written Consent) disclosure constants.
 *
 * A single source of truth for disclosure text and version used across all
 * public forms that collect phone numbers. Any substantive change to the
 * disclosure language MUST bump PEWC_DISCLOSURE_VERSION so audit evidence
 * is traceable to the exact text shown to the consumer.
 */

export const PEWC_DISCLOSURE_VERSION = "v2026-06-25";

export const PEWC_CHANNELS_COVERED = [
  "sms",
  "calls_and_prerecorded_artificial_voice",
] as const;

/**
 * Full TCPA-compliant disclosure rendered inside PewcCheckbox.
 * This string is informational; the React component renders links
 * to /sms-terms and /tcpa-consent inline.
 */
export const PEWC_DISCLOSURE_TEXT =
  "I provide my express written consent (EWCA) for Liberty Bancard and its agents to contact me via autodialed or pre-recorded calls and automated text messages at the phone number provided. I understand this consent is not required to obtain any product or service. Msg & data rates may apply. Reply STOP to opt out at any time.";

/**
 * Short version used where space is limited (e.g. admin audit display).
 */
export const PEWC_DISCLOSURE_SHORT =
  "Express written consent for autodialed/pre-recorded calls and automated texts. Not required for service. Msg & data rates apply.";
