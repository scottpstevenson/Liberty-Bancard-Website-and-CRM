import webpush from "web-push";
import fs from "fs";
import path from "path";

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

interface PushSubscriptionRecord {
  userId: number;
  subscription: webpush.PushSubscription;
}

const subscriptions: PushSubscriptionRecord[] = [];

export function saveSubscription(userId: number, subscription: webpush.PushSubscription) {
  const idx = subscriptions.findIndex(
    (s) => s.userId === userId && s.subscription.endpoint === subscription.endpoint
  );
  if (idx === -1) {
    subscriptions.push({ userId, subscription });
  } else {
    subscriptions[idx].subscription = subscription;
  }
  console.log(`[Push] Saved subscription for user ${userId}. Total: ${subscriptions.length}`);
}

export function removeSubscription(userId: number, endpoint: string) {
  const before = subscriptions.length;
  const idx = subscriptions.findIndex(
    (s) => s.userId === userId && s.subscription.endpoint === endpoint
  );
  if (idx !== -1) subscriptions.splice(idx, 1);
  console.log(`[Push] Removed subscription. Before: ${before}, after: ${subscriptions.length}`);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export async function sendPushToUser(userId: number, payload: PushPayload) {
  initWebPush();
  const userSubs = subscriptions.filter((s) => s.userId === userId);
  if (!userSubs.length) return;

  const msg = JSON.stringify(payload);
  const results = await Promise.allSettled(
    userSubs.map((s) => webpush.sendNotification(s.subscription, msg))
  );

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const err = r.reason as any;
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        subscriptions.splice(
          subscriptions.findIndex((sub) => sub.subscription.endpoint === userSubs[i].subscription.endpoint),
          1
        );
      }
    }
  });
}

export async function sendPushToAllReps(payload: PushPayload) {
  initWebPush();
  if (!subscriptions.length) return;

  const msg = JSON.stringify(payload);
  const toRemove: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, msg);
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          toRemove.push(s.subscription.endpoint);
        }
      }
    })
  );

  toRemove.forEach((endpoint) => {
    const idx = subscriptions.findIndex((s) => s.subscription.endpoint === endpoint);
    if (idx !== -1) subscriptions.splice(idx, 1);
  });
}
