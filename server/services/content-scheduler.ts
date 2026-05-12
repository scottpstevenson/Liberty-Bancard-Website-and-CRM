import { storage } from "../storage";

const TICK_MS = 5 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export async function runContentSchedulerTick(): Promise<{ blogsPublished: number; socialPublished: number }> {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const acquired = await acquireJobLock(JOB_NAMES.CONTENT_SCHEDULER);
  if (!acquired) return { blogsPublished: 0, socialPublished: 0 };

  const now = new Date();
  let blogsPublished = 0;
  let socialPublished = 0;

  try {
    const dueBlogs = await storage.getDueScheduledBlogPosts(now);
    for (const post of dueBlogs) {
      try {
        await storage.publishBlogPost(post.id);
        blogsPublished++;
        console.log(`[ContentScheduler] Published blog post: ${post.slug}`);
      } catch (err: any) {
        console.error(`[ContentScheduler] Failed to publish blog ${post.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[ContentScheduler] Blog tick error:", err.message);
  }

  try {
    const dueSocial = await storage.getDueScheduledSocialPosts(now);
    for (const post of dueSocial) {
      try {
        // LinkedIn API integration is feature-flagged off by default;
        // when disabled we mark posts as "ready_to_publish" so an operator
        // can copy/paste manually from /dashboard/social.
        const enableAutoPublish = process.env.LINKEDIN_AUTO_PUBLISH === "true";
        if (enableAutoPublish && post.platform === "linkedin") {
          // Stub: actual LinkedIn API publish would happen here.
          await storage.updateSocialPost(post.id, {
            status: "published",
            publishedAt: new Date(),
          });
        } else {
          await storage.updateSocialPost(post.id, {
            status: "ready_to_publish",
          });
        }
        socialPublished++;
        console.log(`[ContentScheduler] Promoted social post #${post.id}`);
      } catch (err: any) {
        console.error(`[ContentScheduler] Failed to promote social ${post.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[ContentScheduler] Social tick error:", err.message);
  }

  await releaseJobLock(JOB_NAMES.CONTENT_SCHEDULER, true);
  return { blogsPublished, socialPublished };
}

export function startContentScheduler() {
  if (timer) return;
  console.log("[ContentScheduler] Starting (5 min tick)");
  // Initial tick after a short delay so startup isn't blocked.
  setTimeout(() => { runContentSchedulerTick().catch(() => {}); }, 30_000);
  timer = setInterval(() => { runContentSchedulerTick().catch(() => {}); }, TICK_MS);
}

export function stopContentScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
