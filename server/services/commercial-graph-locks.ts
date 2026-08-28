import { sql } from "drizzle-orm";

export type CommercialGraphNodeType = "contact" | "deal" | "prospect" | "company" | "business";
export type CommercialGraphEdgeType =
  | "contact_business"
  | "contact_redirect"
  | "identity"
  | "legacy_company_business"
  | "relationship";

export type CommercialGraphNode = { type: CommercialGraphNodeType; id: number };

const TYPE_RANK: Record<CommercialGraphNodeType, number> = {
  contact: 1,
  deal: 2,
  prospect: 3,
  company: 4,
  business: 5,
};

function uniqueNodes(nodes: readonly CommercialGraphNode[]): CommercialGraphNode[] {
  return [...new Map(nodes.map((node) => [`${node.type}:${node.id}`, node])).values()]
    .sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.id - b.id);
}

async function advisoryLock(tx: any, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 1700))`);
}

/** CRO-02 total order step 1: typed subject nodes. */
export async function lockCommercialGraphNodes(tx: any, nodes: readonly CommercialGraphNode[]) {
  for (const node of uniqueNodes(nodes)) {
    await advisoryLock(tx, `cro02:v1:node:${node.type}:${node.id}`);
  }
}

/** CRO-02 total order step 2: edge-membership sentinels for each endpoint. */
export async function lockCommercialGraphMembershipSets(
  tx: any,
  nodes: readonly CommercialGraphNode[],
  edges: readonly CommercialGraphEdgeType[],
) {
  const keys = [...new Set(edges.flatMap((edge) =>
    uniqueNodes(nodes).map((node) => `cro02:v1:membership-set:${edge}:${node.type}:${node.id}`),
  ))].sort();
  for (const key of keys) await advisoryLock(tx, key);
}

/** Acquire all advisory fences before revision rows or domain rows. */
export async function lockCommercialGraph(
  tx: any,
  nodes: readonly CommercialGraphNode[],
  edges: readonly CommercialGraphEdgeType[],
) {
  await lockCommercialGraphNodes(tx, nodes);
  await lockCommercialGraphMembershipSets(tx, nodes, edges);
}