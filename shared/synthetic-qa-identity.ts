/** A narrow legacy QA signature, not a heuristic based on a person's name.
 * All three independent fixture markers are required. Keep the records for
 * audit; do not let a mistaken production class make them revenue inventory. */
export function syntheticQaIdentitySql(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("QA_SQL_ALIAS_INVALID");
  return `(lower(btrim(concat_ws(' ',${alias}.first_name,${alias}.last_name)))='liberty qatest'
    AND lower(coalesce(${alias}.email,'')) ~ '^no-email-[0-9a-f-]+@no-email[.]libertybancard[.]internal$'
    AND right(regexp_replace(coalesce(${alias}.phone,''),'[^0-9]','','g'),7) ~ '^55501[0-9]{2}$')`;
}