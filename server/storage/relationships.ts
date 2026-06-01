import { db } from "../db";
import {
  entityRelationships,
  type EntityRelationship,
  type InsertEntityRelationship,
  type EntityType,
} from "@shared/schema";
import { eq, and, or, isNull } from "drizzle-orm";

export class RelationshipsStorage {
  async getEntityRelationships(
    entityType: EntityType,
    entityId: number,
  ): Promise<EntityRelationship[]> {
    const results = await db
      .select()
      .from(entityRelationships)
      .where(
        or(
          and(
            eq(entityRelationships.sourceEntityType, entityType),
            eq(entityRelationships.sourceEntityId, entityId),
          ),
          and(
            eq(entityRelationships.targetEntityType, entityType),
            eq(entityRelationships.targetEntityId, entityId),
          ),
        ),
      );
    return results;
  }

  async createEntityRelationship(data: InsertEntityRelationship): Promise<EntityRelationship> {
    const [created] = await db
      .insert(entityRelationships)
      .values(data)
      .onConflictDoUpdate({
        target: [
          entityRelationships.sourceEntityType,
          entityRelationships.sourceEntityId,
          entityRelationships.targetEntityType,
          entityRelationships.targetEntityId,
          entityRelationships.relationshipType,
        ],
        set: {
          note: data.note,
          confidence: data.confidence,
          riskFlag: data.riskFlag,
          riskReason: data.riskReason,
          updatedAt: new Date(),
        },
      })
      .returning();
    return created;
  }

  async dismissEntityRelationship(
    id: number,
    dismissedBy: string,
    note?: string,
  ): Promise<EntityRelationship | undefined> {
    const [updated] = await db
      .update(entityRelationships)
      .set({
        dismissedAt: new Date(),
        dismissedBy,
        note: note || undefined,
        updatedAt: new Date(),
      })
      .where(eq(entityRelationships.id, id))
      .returning();
    return updated;
  }

  async getEntityRelationship(id: number): Promise<EntityRelationship | undefined> {
    const [rel] = await db
      .select()
      .from(entityRelationships)
      .where(eq(entityRelationships.id, id));
    return rel;
  }

  async deleteEntityRelationship(id: number): Promise<void> {
    await db.delete(entityRelationships).where(eq(entityRelationships.id, id));
  }

  async getRiskyRelationships(): Promise<EntityRelationship[]> {
    return db
      .select()
      .from(entityRelationships)
      .where(and(eq(entityRelationships.riskFlag, true), isNull(entityRelationships.dismissedAt)));
  }
}
