import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { logAiCall } from "../services/ai-audit-logger";
import { serverError, safeMessage } from "../utils/server-error";

const createSchema = z.object({
  platform: z.string().min(1).max(20).default("linkedin"),
  body: z.string().min(1).max(3000),
  hashtags: z.array(z.string().min(1).max(60)).max(15).optional(),
  linkUrl: z.string().url().optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  authorId: z.number().int().optional().nullable(),
  authorName: z.string().optional().nullable(),
  pillar: z.string().optional().nullable(),
  cluster: z.string().optional().nullable(),
  status: z.enum(["draft", "needs_review", "scheduled", "published", "ready_to_publish", "archived"]).default("draft"),
  scheduledAt: z.string().datetime().optional().nullable(),
  reviewerNotes: z.string().optional().nullable(),
});

const generateSchema = z.object({
  pillar: z.string().optional(),
  topic: z.string().min(3).max(200),
  audience: z.string().optional(),
  tone: z.enum(["educational", "story", "data", "contrarian", "community"]).default("educational"),
  linkUrl: z.string().optional(),
  count: z.number().int().min(1).max(5).default(1),
});

function isAdminOrManager(req: any) {
  const role = req.user?.role;
  return role === "admin" || role === "manager";
}

export function registerSocialRoutes(app: Express) {
  app.get("/api/social/posts", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const status = req.query.status as string | undefined;
    const platform = req.query.platform as string | undefined;
    const posts = await storage.listSocialPosts({ status, platform });
    res.json(posts);
  });

  app.get("/api/social/posts/:id", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id as string);
    const post = await storage.getSocialPost(id);
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  });

  app.post("/api/social/posts", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const data: any = { ...parsed.data, createdBy: (req.user as any)?.id || null };
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt);
    const created = await storage.createSocialPost(data);
    res.json(created);
  });

  app.patch("/api/social/posts/:id", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id as string);
    const updates: any = { ...req.body };
    if (updates.scheduledAt && typeof updates.scheduledAt === "string") {
      updates.scheduledAt = new Date(updates.scheduledAt);
    }
    const post = await storage.updateSocialPost(id, updates);
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  });

  app.delete("/api/social/posts/:id", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id as string);
    await storage.deleteSocialPost(id);
    res.json({ success: true });
  });

  app.post("/api/social/posts/:id/publish", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id as string);
    const post = await storage.getSocialPost(id);
    if (!post) return res.status(404).json({ error: "Not found" });

    if (post.platform === "linkedin" && process.env.LINKEDIN_ACCESS_TOKEN) {
      // ── Outbound pause authority gate ─────────────────────────────────────
      // LinkedIn publication delivers public outbound content — must clear the
      // canonical pause authority before any network I/O.
      let _liInflightToken: string | undefined;
      let _liPauseEpoch: bigint | undefined;
      try {
        const { authorize, recheckEpoch } = await import("../services/outbound-pause-authority");
        const { registerInflight, deregisterInflight } = await import("../services/outbound-control-service");
        const decision = await authorize({});
        if (!decision.allowed) {
          console.warn(`[LinkedIn] Blocked by pause authority: ${decision.reasonCode}`);
          return res.status(503).json({ error: "Outbound paused", detail: decision.reasonCode });
        }
        const tokenId = crypto.randomUUID();
        await registerInflight(tokenId, decision.epoch);
        _liInflightToken = tokenId;
        _liPauseEpoch = decision.epoch;
        const epochOk = await recheckEpoch(decision.epoch);
        if (!epochOk) {
          deregisterInflight(tokenId);
          _liInflightToken = undefined;
          return res.status(503).json({ error: "Outbound paused", detail: "epoch changed before LinkedIn send" });
        }
      } catch (gateErr: any) {
        if (_liInflightToken) {
          const { deregisterInflight } = await import("../services/outbound-control-service");
          deregisterInflight(_liInflightToken);
        }
        console.error(`[LinkedIn] Pause authority gate error — fail closed: ${gateErr.message}`);
        return res.status(503).json({ error: "Outbound pause gate error", detail: gateErr.message });
      }

      try {
        const orgUrn = process.env.LINKEDIN_ORG_URN;
        const authorUrn = orgUrn || `urn:li:person:${process.env.LINKEDIN_PERSON_URN || "me"}`;

        const ugcPayload: any = {
          author: authorUrn,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text: post.body || "" },
              shareMediaCategory: "NONE",
            },
          },
          visibility: {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
          },
        };

        if ((post as any).linkUrl) {
          ugcPayload.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "ARTICLE";
          ugcPayload.specificContent["com.linkedin.ugc.ShareContent"].media = [
            {
              status: "READY",
              originalUrl: (post as any).linkUrl,
            },
          ];
        }

        const liRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
          },
          body: JSON.stringify(ugcPayload),
        });

        if (!liRes.ok) {
          const errText = await liRes.text();
          console.error(`[LinkedIn] UGC post failed (${liRes.status}): ${errText}`);
          return res.status(502).json({ error: "LinkedIn API error", detail: safeMessage(errText, "LinkedIn request failed") });
        }

        const liData = await liRes.json() as any;
        const linkedInPostId = liData.id || liData["id"] || null;

        const updated = await storage.updateSocialPost(id, {
          status: "published",
          publishedAt: new Date(),
        });
        return res.json({ post: updated, linkedInPostId, note: "Published to LinkedIn via UGC Posts API." });
      } catch (err: any) {
        console.error("[LinkedIn] Publish error:", err.message);
        return serverError(res, err);
      } finally {
        if (_liInflightToken) {
          const { deregisterInflight } = await import("../services/outbound-control-service");
          deregisterInflight(_liInflightToken);
        }
      }
    }

    // C-15 (#1626): "published" requires a confirmed 2xx provider response
    // from the LinkedIn ugcPosts API (handled above). Without a token there is
    // no provider evidence — mark ready_to_publish, not published.
    if (post.platform === "linkedin" && !process.env.LINKEDIN_ACCESS_TOKEN) {
      const updated = await storage.updateSocialPost(id, {
        status: "ready_to_publish",
      });
      return res.json({
        post: updated,
        awaitingProviderConfirmation: true,
        note: "Marked ready to publish — no LinkedIn token, so no provider-confirmed publish occurred. Set LINKEDIN_ACCESS_TOKEN (and optionally LINKEDIN_ORG_URN) to auto-publish, or publish manually and confirm.",
      });
    }

    const updated = await storage.updateSocialPost(id, {
      status: "ready_to_publish",
    });
    res.json({
      post: updated,
      awaitingProviderConfirmation: true,
      note: "Marked ready to publish. Use the copy button to share manually — status becomes 'published' only after a provider-confirmed publish.",
    });
  });

  app.post("/api/social/generate", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { pillar, topic, audience, tone, linkUrl, count } = parsed.data;
    try {
      const { OpenAI } = await import("openai");
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
      const prompt = `Generate ${count} LinkedIn post draft(s) for Liberty Bancard, a transparent interchange-plus merchant services provider helping small businesses cut credit card processing costs.

Topic: ${topic}
Pillar: ${pillar || "General"}
Tone: ${tone}
Audience: ${audience || "small business owners and ISOs"}
${linkUrl ? `Optional link to include: ${linkUrl}` : ""}

Each post should:
- Open with a strong hook in the first line (<= 100 chars)
- Be 600-1300 chars total
- Use 2-4 short paragraphs separated by single line breaks
- End with a single soft CTA (no spam, no all-caps)
- Use plain text only — no markdown, no emojis except 1 optional sparingly

Return ONLY JSON:
{
  "posts": [
    { "body": "...full post text...", "hashtags": ["#payments", "#smallbusiness"] }
  ]
}`;
      const socialMessages = [{ role: "user" as const, content: prompt }];
      const { completion } = await logAiCall(
        { triggerType: "social-generation", actorType: (req as any).user?.role || "agent", actorId: (req as any).user?.id?.toString(), rawPrompt: JSON.stringify(socialMessages) },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: socialMessages,
          response_format: { type: "json_object" },
        })
      );
      const content = completion.choices[0]?.message?.content;
      if (!content) return res.status(502).json({ error: "Empty AI response" });
      const data = JSON.parse(content);
      const posts = Array.isArray(data.posts) ? data.posts : [];
      if (!posts.length) return res.status(502).json({ error: "No posts returned" });
      const created = [];
      for (const p of posts.slice(0, count)) {
        if (typeof p?.body !== "string") continue;
        const row = await storage.createSocialPost({
          platform: "linkedin",
          body: p.body.slice(0, 3000),
          hashtags: Array.isArray(p.hashtags) ? p.hashtags.filter((h: any) => typeof h === "string").slice(0, 10) : null,
          linkUrl: linkUrl || null,
          status: "draft",
          pillar: pillar || null,
          createdBy: (req.user as any)?.id || null,
        });
        created.push(row);
      }
      res.json({ posts: created });
    } catch (err: any) {
      console.error("[SocialGenerate] Error:", err);
      serverError(res, err);
    }
  });
}
