/**
 * MI-02: Stub adapters for counties whose bulk/API availability is unverified.
 * These are registered in source_registry_adapters with status='unverified'.
 * normalize() throws — callers must check IMPLEMENTED_ADAPTER_KEYS before calling.
 */

import type { SourceAdapter } from "../adapter";

export const browardLbtAdapter: SourceAdapter = {
  adapterKey: "broward-lbt",
  sourceName: "Broward County Business Tax",
  bulkDownloadUrl: null, // unverified
  activeStatusMapping: {},
  mappingVersion: "unverified",
  requiredHeaders: [], // stub — no implementation
  normalize(_rawRow: Record<string, string>) {
    throw new Error("SOURCE_REGISTRY_ADAPTER_STUB: broward-lbt bulk/API availability unverified");
  },
};

export const palmBeachLbtAdapter: SourceAdapter = {
  adapterKey: "palm-beach-lbt",
  sourceName: "Palm Beach County Business Tax",
  bulkDownloadUrl: null, // unverified
  activeStatusMapping: {},
  mappingVersion: "unverified",
  requiredHeaders: [], // stub — no implementation
  normalize(_rawRow: Record<string, string>) {
    throw new Error("SOURCE_REGISTRY_ADAPTER_STUB: palm-beach-lbt bulk/API availability unverified");
  },
};
