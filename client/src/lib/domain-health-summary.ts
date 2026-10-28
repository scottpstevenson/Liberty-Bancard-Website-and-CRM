import { averageKnown } from "@shared/rate-evidence";

export interface DomainIdentityInput {
  domain: string;
  isActive: boolean | null;
  warmupStatus: string | null;
  effectiveDailyLimit: number;
  sentToday?: number | null;
  healthScore: number | null;
}

export interface DomainSummaryRow {
  domain: string;
  count: number;
  active: number;
  capacity: number;
  sent: number;
  /** Average of the KNOWN scores only; null when no identity on the domain has a score. A real 0 is preserved. */
  avgHealth: number | null;
  knownHealth: number;
}

export function summarizeDomains(identities: DomainIdentityInput[]): DomainSummaryRow[] {
  const byDomain = new Map<string, DomainIdentityInput[]>();
  for (const i of identities) byDomain.set(i.domain, [...(byDomain.get(i.domain) ?? []), i]);
  return Array.from(byDomain.entries()).map(([domain, list]) => {
    const health = averageKnown(list.map((i) => i.healthScore));
    return {
      domain,
      count: list.length,
      active: list.filter((i) => i.isActive && (i.warmupStatus === "warm" || i.warmupStatus === "warming")).length,
      capacity: list.reduce((a, i) => a + (i.effectiveDailyLimit || 0), 0),
      sent: list.reduce((a, i) => a + (i.sentToday || 0), 0),
      avgHealth: health.average,
      knownHealth: health.known,
    };
  });
}
