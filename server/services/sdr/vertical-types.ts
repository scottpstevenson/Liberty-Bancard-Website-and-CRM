export const VERTICAL_SOURCES = [
  "operator_override",
  "discovery_enrichment",
  "import_classification",
  "website_form",
  "ghl_sync",
  "legacy_unknown",
] as const;

export type VerticalSource = typeof VERTICAL_SOURCES[number];
