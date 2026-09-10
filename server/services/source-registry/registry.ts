/**
 * MI-02: Source Registry — adapter registry and lookup
 */

import type { SourceAdapter } from "./adapter";
import { dbprHrAdapter } from "./adapters/dbpr-hr";
import { dbprAbtAdapter } from "./adapters/dbpr-abt";
import { dbprCosAdapter } from "./adapters/dbpr-cos";
import { dbprBarAdapter } from "./adapters/dbpr-bar";
import { mdadeLbtAdapter } from "./adapters/mdade-lbt";
import { browardLbtAdapter, palmBeachLbtAdapter } from "./adapters/stubs";

const ADAPTERS: SourceAdapter[] = [
  dbprHrAdapter,
  dbprAbtAdapter,
  dbprCosAdapter,
  dbprBarAdapter,
  mdadeLbtAdapter,
  browardLbtAdapter,
  palmBeachLbtAdapter,
];

const ADAPTER_MAP = new Map<string, SourceAdapter>(
  ADAPTERS.map((a) => [a.adapterKey, a])
);

export function getAdapter(adapterKey: string): SourceAdapter | undefined {
  return ADAPTER_MAP.get(adapterKey);
}

export function getAllAdapters(): SourceAdapter[] {
  return ADAPTERS;
}

/** Adapters that have real implementations (non-stubs) */
export const IMPLEMENTED_ADAPTER_KEYS = new Set([
  "dbpr-hr",
  "dbpr-abt",
  "dbpr-cos",
  "dbpr-bar",
  "mdade-lbt",
]);

/**
 * Temporarily registers an adapter for testing purposes.
 * Call _unregisterFromTesting() to clean up after the test.
 * MUST NOT be called in production code paths.
 */
export function _registerForTesting(adapter: SourceAdapter): void {
  ADAPTER_MAP.set(adapter.adapterKey, adapter);
  IMPLEMENTED_ADAPTER_KEYS.add(adapter.adapterKey);
}

/**
 * Removes a test-registered adapter from the in-memory registry.
 * Safe to call even if the adapter was never registered.
 */
export function _unregisterFromTesting(adapterKey: string): void {
  ADAPTER_MAP.delete(adapterKey);
  IMPLEMENTED_ADAPTER_KEYS.delete(adapterKey);
}
