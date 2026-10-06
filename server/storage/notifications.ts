import {and,eq,inArray} from "drizzle-orm";
import {db} from "../db";
import {notifications,notificationPreferences,users,type InsertNotification,type InsertNotificationPreference,type NotificationPreference} from "@shared/schema";
import {listActorNotifications,countActorNotifications,acknowledgeActorNotifications,bindNotificationAudience} from "../services/notification-authority";

export class NotificationsStorage {
  async getNotifications():Promise<typeof notifications.$inferSelect[]> {
    throw new Error("An actor-scoped notification read is required");
  }
  getNotificationsPaginated(params:{limit:number;offset:number;category?:string;userId?:string}) {
    return listActorNotifications(params);
  }
  getNotificationsUnreadCount(userId?:string) {return countActorNotifications(userId);}
  async createNotification(input:InsertNotification) {
    const [notification]=await db.insert(notifications).values(await bindNotificationAudience(input)).returning();
    return notification;
  }
  markNotificationRead(id:number,userId?:string) {return acknowledgeActorNotifications(userId,"read",id);}
  async deleteNotification(id:number,userId?:string) {return (await acknowledgeActorNotifications(userId,"dismiss",id))>0;}
  clearOldReadNotifications(userId?:string) {return acknowledgeActorNotifications(userId,"dismiss",undefined,true);}
  markAllNotificationsRead(userId?:string) {return acknowledgeActorNotifications(userId,"read");}
  clearAllNotifications(userId?:string) {return acknowledgeActorNotifications(userId,"dismiss");}
  getNotificationPreferences(userId:string):Promise<NotificationPreference[]> {
    return db.select().from(notificationPreferences).where(eq(notificationPreferences.userId,userId));
  }
  async upsertNotificationPreference(pref:InsertNotificationPreference):Promise<NotificationPreference> {
    const existing=await db.select().from(notificationPreferences).where(and(
      eq(notificationPreferences.userId,pref.userId),eq(notificationPreferences.eventType,pref.eventType)));
    if(existing.length) {
      const updates:Partial<Pick<InsertNotificationPreference,"enabled"|"emailEnabled"|"digestDaily"|"digestWeekly">>={};
      if(typeof pref.enabled==="boolean") updates.enabled=pref.enabled;
      if(typeof pref.emailEnabled==="boolean") updates.emailEnabled=pref.emailEnabled;
      if(typeof pref.digestDaily==="boolean") updates.digestDaily=pref.digestDaily;
      if(typeof pref.digestWeekly==="boolean") updates.digestWeekly=pref.digestWeekly;
      if(!Object.keys(updates).length) return existing[0];
      const [updated]=await db.update(notificationPreferences).set(updates).where(eq(notificationPreferences.id,existing[0].id)).returning();
      return updated;
    }
    const [created]=await db.insert(notificationPreferences).values(pref).returning();
    return created;
  }
  getUsersByRole(roles:string[]) {
    return db.select({id:users.id,email:users.email,role:users.role,firstName:users.firstName,lastName:users.lastName})
      .from(users).where(inArray(users.role,roles));
  }
  getAllNotificationPreferencesByEvent(eventType:string):Promise<NotificationPreference[]> {
    return db.select().from(notificationPreferences).where(eq(notificationPreferences.eventType,eventType));
  }
}
