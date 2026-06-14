import webpush from "web-push";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { pushSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const KEYS_FILE = path.join(process.cwd(), ".local", "vapid-keys.json");

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let _vapidKeys: VapidKeys | null = null;

function loadOrGenerateVapidKeys(): VapidKeys {
  if (_vapidKeys) return _vapidKeys;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    _vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
    return _vapidKeys;
  }

  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
      if (data.publicKey && data.privateKey) {
        _vapidKeys = data;
        return _vapidKeys!;
      }
    }
  } catch {
  }

  const keys = webpush.generateVAPIDKeys();
  _vapidKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };

  try {
    fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
    fs.writeFileSync(KEYS_FILE, JSON.stringify(_vapidKeys, null, 2));
  } catch (e) {
    console.warn("[Push] Could not persist VAPID keys:", e);
  }

  console.log("[Push] Generated new VAPID keys");
  return _vapidKeys!;
}

function initWebPush() {
  const keys = loadOrGenerateVapidKeys();
  webpush.setVapidDetails(
    "mailto:admin@libertybancard.com",
    keys.publicKey,
    keys.privateKey
  );
  return keys;
}

export function getVapidPublicKey(): string {
  return loadOrGenerateVapidKeys().publicKey;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export async function saveSubscription(userId: string, subscription: webpush.PushSubscription) {
  const { keys } = subscription as any;
  const auth = keys?.auth || "";
  const p256dh = keys?.p256dh || "";

  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: subscription.endpoint,
      auth,
      p256dh,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        auth,
        p256dh,
      },
    });

  console.log(`[Push] Saved subscription for user ${userId}: ${subscription.endpoint.slice(0, 60)}…`);
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint)
      )
    );
  console.log(`[Push] Removed subscription for user ${userId}`);
}

async function getUserSubscriptions(userId: string): Promise<webpush.PushSubscription[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  return rows.map((r) => ({
    endpoint: r.endpoint,
    keys: { auth: r.auth, p256dh: r.p256dh },
  }));
}

async function getAllSubscriptions(): Promise<Array<{ userId: number; subscription: webpush.PushSubscription }>> {
  const rows = await db.select().from(pushSubscriptions);
  return rows.map((r) => ({
    userId: r.userId,
    subscription: {
      endpoint: r.endpoint,
      keys: { auth: r.auth, p256dh: r.p256dh },
    },
  }));
}

async function removeStaleSubscription(endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  console.log(`[Push] Removed stale subscription: ${endpoint.slice(0, 60)}…`);
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  initWebPush();
  const subs = await getUserSubscriptions(userId);
  if (!subs.length) return;

  const msg = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s, msg))
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      const err = r.reason as any;
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await removeStaleSubscription(subs[i].endpoint);
      }
    }
  }
}

export async function sendPushToAllReps(payload: PushPayload) {
  initWebPush();
  const allSubs = await getAllSubscriptions();
  if (!allSubs.length) return;

  const msg = JSON.stringify(payload);
  await Promise.allSettled(
    allSubs.map(async ({ subscription }) => {
      try {
        await webpush.sendNotification(subscription, msg);
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await removeStaleSubscription(subscription.endpoint);
        }
      }
    })
  );
}
