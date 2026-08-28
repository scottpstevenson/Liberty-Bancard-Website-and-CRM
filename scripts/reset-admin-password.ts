/**
 * Permanently disabled. Credential reset must use the authenticated,
 * purpose-bound auth-action route; this legacy helper never imports the DB or
 * performs a mutation.
 */
console.error("This legacy reset helper is disabled.");
process.exit(1);
