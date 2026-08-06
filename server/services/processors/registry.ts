import type { IProcessorAdapter, AdapterHealthStatus, DailyStats } from "./IProcessorAdapter";
import { PayarcProcessorAdapter } from "./payarc.adapter";
import { MockProcessorAdapter } from "./mock.adapter";

interface AdapterRecord {
  adapter: IProcessorAdapter;
  enabled: boolean;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  callCount: number;
  errorCount: number;
}

const adapters = new Map<string, AdapterRecord>();

function initRegistry() {
  if (adapters.size > 0) return;

  const payarc = new PayarcProcessorAdapter();
  const mock = new MockProcessorAdapter();

  // Payarc is the system processor. Enable when PAYARC_API_KEY is set.
  // ENABLED_PROCESSORS can override (e.g. "mock" for dev, "payarc,mock" for both).
  const envList = (process.env.ENABLED_PROCESSORS || "payarc").toLowerCase().split(",").map(s => s.trim());

  const payarcEnabled = envList.includes("payarc");
  adapters.set("payarc", {
    adapter: payarc,
    enabled: payarcEnabled,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    callCount: 0,
    errorCount: 0,
  });

  // Mock: enabled in dev when no key is set, or explicitly listed
  const mockEnabled =
    envList.includes("mock") ||
    (process.env.NODE_ENV !== "production" && !process.env.PAYARC_API_KEY);

  if (mockEnabled && process.env.NODE_ENV === "production") {
    console.warn(
      "[Processor Registry] WARNING: Mock processor is ENABLED in production. " +
      "Set PAYARC_API_KEY to activate the real Payarc adapter.",
    );
  }

  adapters.set("mock", {
    adapter: mock,
    enabled: mockEnabled,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    callCount: 0,
    errorCount: 0,
  });
}

export function getProcessor(name?: string): IProcessorAdapter {
  initRegistry();

  const processorName = (name || process.env.DEFAULT_PROCESSOR || "payarc").toLowerCase();
  const record = adapters.get(processorName);

  if (record && record.enabled) {
    return createTrackedAdapter(processorName, record);
  }

  if (name) {
    throw new Error(
      `Processor adapter "${name}" is not registered or not enabled. Check ENABLED_PROCESSORS env var.`,
    );
  }

  // Fall through to first enabled adapter (payarc → mock)
  for (const [key, rec] of adapters.entries()) {
    if (rec.enabled) return createTrackedAdapter(key, rec);
  }

  throw new Error(
    "No processor adapters are enabled. Set PAYARC_API_KEY or ENABLED_PROCESSORS=mock.",
  );
}

export function getEnabledAdapterNames(): string[] {
  initRegistry();
  const results: string[] = [];
  for (const [name, record] of adapters.entries()) {
    if (record.enabled) results.push(name);
  }
  return results;
}

export function getDefaultProcessor(): IProcessorAdapter {
  return getProcessor();
}

function createTrackedAdapter(name: string, record: AdapterRecord): IProcessorAdapter {
  const handler: ProxyHandler<IProcessorAdapter> = {
    get(target, prop) {
      const value = (target as any)[prop];
      if (typeof value !== "function") return value;

      return async (...args: any[]) => {
        record.callCount++;
        try {
          const result = await value.apply(target, args);
          record.lastSuccessAt = new Date();
          return result;
        } catch (err: any) {
          record.errorCount++;
          record.lastErrorAt = new Date();
          record.lastError = err?.message ?? String(err);
          throw err;
        }
      };
    },
  };

  return new Proxy(record.adapter, handler);
}

export function getAllAdapterStatuses(): AdapterHealthStatus[] {
  initRegistry();
  const statuses: AdapterHealthStatus[] = [];

  for (const [name, record] of adapters.entries()) {
    const configured = isAdapterConfigured(name);
    const errorRate =
      record.callCount > 0 ? Math.round((record.errorCount / record.callCount) * 100) : 0;

    statuses.push({
      name: record.adapter.displayName,
      enabled: record.enabled,
      configured,
      lastSuccessAt: record.lastSuccessAt,
      lastErrorAt: record.lastErrorAt,
      lastError: record.lastError,
      callCount: record.callCount,
      errorCount: record.errorCount,
      errorRate,
    });
  }

  return statuses;
}

function isAdapterConfigured(name: string): boolean {
  switch (name) {
    case "payarc":
      return !!process.env.PAYARC_API_KEY;
    case "mock":
      return true;
    default:
      return false;
  }
}

export async function pingAllAdapters(): Promise<Record<string, boolean>> {
  initRegistry();
  const results: Record<string, boolean> = {};

  for (const [name, record] of adapters.entries()) {
    if (!record.enabled) {
      results[name] = false;
      continue;
    }
    try {
      results[name] = await record.adapter.ping();
      if (results[name]) record.lastSuccessAt = new Date();
    } catch (err: any) {
      results[name] = false;
      record.lastErrorAt = new Date();
      record.lastError = err?.message ?? String(err);
      record.errorCount++;
    }
  }

  return results;
}

export async function ingestMidDataForActiveMids(): Promise<{ processed: number; errors: number }> {
  const { storage } = await import("../../storage");
  let processed = 0;
  let errors = 0;

  try {
    const { data: allDeals } = await storage.getDeals({ limit: 500 });
    const activeMidDeals = allDeals.filter((d: any) => d.mid && d.boardingStatus === "approved");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 2);

    const endStr = endDate.toISOString().split("T")[0];
    const startStr = startDate.toISOString().split("T")[0];

    for (const deal of activeMidDeals) {
      if (!deal.mid) continue;
      try {
        const dealLog = (deal.boardingLog as any[]) || [];
        const submittedEntry = [...dealLog].reverse().find((e: any) => e.event === "submitted");
        const dealProcessorName = submittedEntry?.processor || undefined;
        const processor = dealProcessorName ? getProcessor(dealProcessorName) : getDefaultProcessor();
        const stats: DailyStats[] = await processor.getDailyStats(deal.mid, startStr, endStr);

        for (const stat of stats) {
          const existing = await storage.getMidDailyStatByMidAndDate(deal.mid, stat.date);
          const payload = {
            mid: deal.mid,
            dealId: deal.id,
            contactId: deal.contactId || undefined,
            date: stat.date,
            volume: stat.volume,
            txCount: stat.txCount,
            avgTicket: stat.avgTicket,
            effectiveRate: stat.effectiveRate,
            chargebackCount: stat.chargebackCount,
            chargebackAmount: stat.chargebackAmount,
            refundCount: stat.refundCount,
            fetchedAt: new Date(),
          };

          if (existing) {
            await storage.updateMidDailyStat(existing.id, payload);
          } else {
            await storage.createMidDailyStat(payload);
          }
        }

        const { checkAndUpdateMerchantHealthFromMidData } = await import("../processor-api");
        await checkAndUpdateMerchantHealthFromMidData(deal.id, deal.mid);
        processed++;
      } catch (err: any) {
        console.error(`[Registry Ingestion] Error for MID ${deal.mid}:`, err.message);
        errors++;
      }
    }

    console.log(`[Registry Ingestion] Processed ${processed} MIDs, ${errors} errors`);
  } catch (err: any) {
    console.error("[Registry Ingestion] Fatal error:", err.message);
    errors++;
  }

  return { processed, errors };
}
