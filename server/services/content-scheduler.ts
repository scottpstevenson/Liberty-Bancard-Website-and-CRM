import { storage } from "../storage";

const TICK_MS = 5 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export async function runContentSchedulerTick(): Promise<{ blogsPublished: number; socialPublished: number }> {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const lockToken = await acquireJobLock(JOB_NAMES.CONTENT_SCHEDULER);
  if (!lockToken) return { blogsPublished: 0, socialPublished: 0 };

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
          // LinkedIn UGC Posts API (#198) — requires LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN
          const token = process.env.LINKEDIN_ACCESS_TOKEN;
          const authorUrn = process.env.LINKEDIN_AUTHOR_URN; // e.g. "urn:li:organization:123456"
          if (!token || !authorUrn) {
            console.warn(`[ContentScheduler] LinkedIn auto-publish skipped — LINKEDIN_ACCESS_TOKEN or LINKEDIN_AUTHOR_URN not set`);
            await storage.updateSocialPost(post.id, { status: "ready_to_publish" });
          } else {
            try {
              const payload = {
                author: authorUrn,
                lifecycleState: "PUBLISHED",
                specificContent: {
                  "com.linkedin.ugc.ShareContent": {
                    shareCommentary: { text: (post as any).content ?? (post as any).text ?? "" },
                    shareMediaCategory: "NONE",
                  },
                },
                visibility: {
                  "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
                },
              };
              const liRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "X-Restli-Protocol-Version": "2.0.0",
                },
                body: JSON.stringify(payload),
              });
              if (!liRes.ok) {
                const errText = await liRes.text();
                throw new Error(`LinkedIn API ${liRes.status}: ${errText}`);
              }
              const liJson = await liRes.json() as any;
              const externalId: string | undefined = liJson?.id ?? liJson?.value?.id;
              await storage.updateSocialPost(post.id, {
                status: "published",
                publishedAt: new Date(),
                ...(externalId ? { externalPostId: externalId } : {}),
              });
              console.log(`[ContentScheduler] LinkedIn post published for #${post.id}${externalId ? ` — id: ${externalId}` : ""}`);
            } catch (liErr: any) {
              console.error(`[ContentScheduler] LinkedIn publish failed for #${post.id}:`, liErr.message);
              await storage.updateSocialPost(post.id, { status: "ready_to_publish" });
            }
          }
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

  await releaseJobLock(JOB_NAMES.CONTENT_SCHEDULER, true, undefined, lockToken);
  return { blogsPublished, socialPublished };
}

export function startContentScheduler() {
  if (timer) return;
  console.log("[ContentScheduler] Starting (5 min tick)");
  // Initial tick after a short delay so startup isn't blocked.
  setTimeout(() => { runContentSchedulerTick().catch((err: Error) => console.error("[ContentScheduler] Initial tick error:", err.message)); }, 30_000);
  timer = setInterval(() => { runContentSchedulerTick().catch((err: Error) => console.error("[ContentScheduler] Tick error:", err.message)); }, TICK_MS);
}

export function stopContentScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
