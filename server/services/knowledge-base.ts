/**
 * Liberty Bancard Knowledge Base Service
 *
 * Handles chunking, embedding, retrieval (RAG), source management,
 * versioning, publishing, and rollback for the AI assistant.
 *
 * Embeddings stored as jsonb float arrays — no pgvector dependency.
 * Cosine similarity computed in JS over the top-K fetched chunks.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface KnowledgeSource {
  id: number;
  title: string;
  sourceType: string;
  status: string;
  audience: string;
  content: string;
  metadata: Record<string, unknown> | null;
  version: number;
  publishedAt: Date | null;
  lastIndexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeChunk {
  id: number;
  sourceId: number;
  chunkIndex: number;
  content: string;
  embedding: number[] | null;
  tokenCount: number | null;
}

export interface RetrievedChunk {
  sourceId: number;
  chunkId: number;
  title: string;
  audience: string;
  content: string;
  relevance: number;
}

// Max ~400 words per chunk (≈500 tokens), 50-word overlap
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 1536;

function wordChunk(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + CHUNK_SIZE).join(" "));
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function getOpenAI() {
  const { OpenAI } = await import("openai");
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = await getOpenAI();
  const response = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  return response.data.map(d => d.embedding);
}

// ── Source CRUD ─────────────────────────────────────────────────────────────

export async function listKnowledgeSources(opts?: {
  status?: string;
  audience?: string;
}): Promise<KnowledgeSource[]> {
  let q = `SELECT * FROM knowledge_sources WHERE 1=1`;
  const params: unknown[] = [];
  if (opts?.status) { q += ` AND status = $${params.length + 1}`; params.push(opts.status); }
  if (opts?.audience) { q += ` AND audience = $${params.length + 1}`; params.push(opts.audience); }
  q += ` ORDER BY updated_at DESC`;
  const { rows } = await db.execute(sql.raw(q.replace(/\$(\d+)/g, (_: string, n: string) => `$${n}`)));
  return (rows as any[]).map(rowToSource);
}

export async function getKnowledgeSource(id: number): Promise<KnowledgeSource | null> {
  const { rows } = await db.execute(sql`SELECT * FROM knowledge_sources WHERE id = ${id}`);
  return rows.length ? rowToSource(rows[0]) : null;
}

export async function createKnowledgeSource(data: {
  title: string;
  sourceType: string;
  status: string;
  audience: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<KnowledgeSource> {
  const { rows } = await db.execute(sql`
    INSERT INTO knowledge_sources (title, source_type, status, audience, content, metadata)
    VALUES (${data.title}, ${data.sourceType}, ${data.status}, ${data.audience},
            ${data.content}, ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb)
    RETURNING *
  `);
  return rowToSource(rows[0]);
}

export async function updateKnowledgeSource(id: number, data: Partial<{
  title: string;
  status: string;
  audience: string;
  content: string;
  metadata: Record<string, unknown>;
}>): Promise<KnowledgeSource | null> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];

  if (data.title !== undefined) { sets.push(`title = $${params.length + 1}`); params.push(data.title); }
  if (data.status !== undefined) { sets.push(`status = $${params.length + 1}`); params.push(data.status); }
  if (data.audience !== undefined) { sets.push(`audience = $${params.length + 1}`); params.push(data.audience); }
  if (data.content !== undefined) { sets.push(`content = $${params.length + 1}`); params.push(data.content); }
  if (data.metadata !== undefined) { sets.push(`metadata = $${params.length + 1}::jsonb`); params.push(JSON.stringify(data.metadata)); }

  params.push(id);
  const q = `UPDATE knowledge_sources SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`;
  const { rows } = await (db as any).execute({ sql: q, params });
  return rows.length ? rowToSource(rows[0]) : null;
}

export async function publishSource(id: number): Promise<KnowledgeSource | null> {
  const { rows } = await db.execute(sql`
    UPDATE knowledge_sources
    SET status = 'published', published_at = NOW(), version = version + 1, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `);
  return rows.length ? rowToSource(rows[0]) : null;
}

export async function archiveSource(id: number): Promise<void> {
  await db.execute(sql`
    UPDATE knowledge_sources SET status = 'archived', updated_at = NOW() WHERE id = ${id}
  `);
}

export async function deleteKnowledgeSource(id: number): Promise<void> {
  await db.execute(sql`DELETE FROM knowledge_sources WHERE id = ${id}`);
}

// ── Indexing ─────────────────────────────────────────────────────────────────

export async function indexSource(sourceId: number): Promise<{ chunksWritten: number }> {
  const source = await getKnowledgeSource(sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  // Delete old chunks
  await db.execute(sql`DELETE FROM knowledge_chunks WHERE source_id = ${sourceId}`);

  const rawChunks = wordChunk(source.content);
  if (rawChunks.length === 0) return { chunksWritten: 0 };

  // Embed in batches of 50
  const BATCH = 50;
  let written = 0;
  for (let b = 0; b < rawChunks.length; b += BATCH) {
    const batch = rawChunks.slice(b, b + BATCH);
    let embeddings: number[][] = [];
    try {
      embeddings = await embedTexts(batch);
    } catch (e: any) {
      // Graceful degradation — store chunks without embeddings if OpenAI unavailable
      embeddings = batch.map(() => []);
      console.warn(`[KB] Embedding batch failed for source ${sourceId}: ${e.message}`);
    }
    for (let i = 0; i < batch.length; i++) {
      const emb = embeddings[i]?.length ? embeddings[i] : null;
      await db.execute(sql`
        INSERT INTO knowledge_chunks (source_id, chunk_index, content, embedding, token_count)
        VALUES (${sourceId}, ${b + i}, ${batch[i]}, ${emb ? JSON.stringify(emb) : null}::jsonb,
                ${Math.ceil(batch[i].length / 4)})
      `);
      written++;
    }
  }

  await db.execute(sql`
    UPDATE knowledge_sources SET last_indexed_at = NOW(), updated_at = NOW() WHERE id = ${sourceId}
  `);

  return { chunksWritten: written };
}

export async function reindexAll(): Promise<{ sources: number; chunks: number }> {
  const { rows } = await db.execute(sql`SELECT id FROM knowledge_sources WHERE status = 'published'`);
  let totalChunks = 0;
  for (const row of rows as any[]) {
    const result = await indexSource(row.id);
    totalChunks += result.chunksWritten;
  }
  return { sources: rows.length, chunks: totalChunks };
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export async function retrieveChunks(opts: {
  query: string;
  audience: "public" | "merchant" | "staff";
  topK?: number;
  minRelevance?: number;
}): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? 5;
  const minRelevance = opts.minRelevance ?? 0.25;

  // Determine which audiences the user can access
  const allowedAudiences = getAllowedAudiences(opts.audience);

  // Embed the query
  let queryEmbedding: number[] = [];
  try {
    const [emb] = await embedTexts([opts.query]);
    queryEmbedding = emb;
  } catch (e: any) {
    console.warn(`[KB] Query embedding failed: ${e.message}`);
    // Fall back to keyword search
    return keywordFallback(opts.query, allowedAudiences, topK);
  }

  // Fetch all published chunks for accessible audiences (capped at 1000 for performance)
  const placeholders = allowedAudiences.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await (db as any).execute({
    sql: `SELECT kc.id, kc.source_id, kc.chunk_index, kc.content, kc.embedding,
                 ks.title, ks.audience
          FROM knowledge_chunks kc
          JOIN knowledge_sources ks ON ks.id = kc.source_id
          WHERE ks.status = 'published'
            AND ks.audience = ANY(ARRAY[${placeholders}]::text[])
            AND kc.embedding IS NOT NULL
          ORDER BY kc.id
          LIMIT 1000`,
    params: allowedAudiences,
  });

  // Rank by cosine similarity
  const scored: Array<RetrievedChunk & { _score: number }> = [];
  for (const row of rows as any[]) {
    let emb: number[];
    try {
      emb = typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding;
    } catch { continue; }
    if (!Array.isArray(emb) || emb.length !== EMBED_DIMS) continue;
    const sim = cosineSimilarity(queryEmbedding, emb);
    if (sim >= minRelevance) {
      scored.push({
        sourceId: row.source_id,
        chunkId: row.id,
        title: row.title,
        audience: row.audience,
        content: row.content,
        relevance: Math.round(sim * 100) / 100,
        _score: sim,
      });
    }
  }

  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, topK).map(({ _score: _, ...rest }) => rest);
}

async function keywordFallback(
  query: string,
  audiences: string[],
  topK: number
): Promise<RetrievedChunk[]> {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (words.length === 0) return [];

  const pattern = words.slice(0, 5).join("|");
  const placeholders = audiences.map((_, i) => `$${i + 2}`).join(", ");
  const { rows } = await (db as any).execute({
    sql: `SELECT kc.id, kc.source_id, kc.content, ks.title, ks.audience
          FROM knowledge_chunks kc
          JOIN knowledge_sources ks ON ks.id = kc.source_id
          WHERE ks.status = 'published'
            AND ks.audience = ANY(ARRAY[${placeholders}]::text[])
            AND kc.content ~* $1
          LIMIT ${topK}`,
    params: [pattern, ...audiences],
  });

  return (rows as any[]).map(row => ({
    sourceId: row.source_id,
    chunkId: row.id,
    title: row.title,
    audience: row.audience,
    content: row.content,
    relevance: 0.3,
  }));
}

function getAllowedAudiences(audience: "public" | "merchant" | "staff"): string[] {
  // Each tier can access its own level and all less-privileged levels
  const map: Record<string, string[]> = {
    public: ["public"],
    merchant: ["public", "merchant"],
    staff: ["public", "merchant", "staff", "all"],
  };
  return map[audience] ?? ["public"];
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getKnowledgeStats(): Promise<{
  totalSources: number;
  publishedSources: number;
  totalChunks: number;
  indexedSources: number;
  openaiConfigured: boolean;
}> {
  const { rows } = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_sources,
      COUNT(*) FILTER (WHERE status = 'published')::int as published_sources,
      COUNT(*) FILTER (WHERE last_indexed_at IS NOT NULL AND status = 'published')::int as indexed_sources,
      (SELECT COUNT(*)::int FROM knowledge_chunks) as total_chunks
    FROM knowledge_sources
  `);
  const r = rows[0] as any;
  return {
    totalSources: r.total_sources ?? 0,
    publishedSources: r.published_sources ?? 0,
    totalChunks: r.total_chunks ?? 0,
    indexedSources: r.indexed_sources ?? 0,
    openaiConfigured: !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  };
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function rowToSource(row: any): KnowledgeSource {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    status: row.status,
    audience: row.audience,
    content: row.content,
    metadata: row.metadata ?? null,
    version: row.version,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    lastIndexedAt: row.last_indexed_at ? new Date(row.last_indexed_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
