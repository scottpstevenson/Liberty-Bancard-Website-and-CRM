import { db } from "../db";
import { rateReviewRequests, type RateReviewRequest, type InsertRateReviewRequest } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export class RateReviewStorage {
  async createRateReviewRequest(data: InsertRateReviewRequest): Promise<RateReviewRequest> {
    const [row] = await db.insert(rateReviewRequests).values(data).returning();
    return row;
  }

  async getRateReviewRequest(id: number): Promise<RateReviewRequest | undefined> {
    const [row] = await db.select().from(rateReviewRequests).where(eq(rateReviewRequests.id, id));
    return row;
  }

  async getRateReviewRequestByStatementUploadCommandId(commandId: string): Promise<RateReviewRequest | undefined> {
    const [row] = await db
      .select()
      .from(rateReviewRequests)
      .where(eq(rateReviewRequests.statementUploadCommandId, commandId));
    return row;
  }

  async getRateReviewRequestsByContact(contactId: number): Promise<RateReviewRequest[]> {
    return db
      .select()
      .from(rateReviewRequests)
      .where(eq(rateReviewRequests.contactId, contactId))
      .orderBy(desc(rateReviewRequests.createdAt));
  }

  async getOpenRateReviewsByContact(contactId: number): Promise<RateReviewRequest[]> {
    const rows = await db
      .select()
      .from(rateReviewRequests)
      .where(eq(rateReviewRequests.contactId, contactId))
      .orderBy(desc(rateReviewRequests.createdAt));
    return rows.filter(r => r.status !== "resolved");
  }

  async updateRateReviewRequest(id: number, data: Partial<InsertRateReviewRequest>): Promise<RateReviewRequest | undefined> {
    const [row] = await db
      .update(rateReviewRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rateReviewRequests.id, id))
      .returning();
    return row;
  }
}
