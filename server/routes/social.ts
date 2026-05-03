import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";

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
    const id = parseInt(req.params.id);
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
    const id = parseInt(req.params.id);
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
    const id = parseInt(req.params.id);
    await storage.deleteSocialPost(id);
    res.json({ success: true });
  });

  app.post("/api/social/posts/:id/publish", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id);
    const post = await storage.getSocialPost(id);
    if (!post) return res.status(404).json({ error: "Not found" });

    const enableAutoPublish = process.env.LINKEDIN_AUTO_PUBLISH === "true";
    if (enableAutoPublish && post.platform === "linkedin" && process.env.LINKEDIN_ACCESS_TOKEN) {
      // Real LinkedIn API call would go here; left as a stub so the route behaves
      // deterministically. Operators copy/paste from the composer until enabled.
      const updated = await storage.updateSocialPost(id, {
        status: "published",
        publishedAt: new Date(),
      });
      return res.json({ post: updated, note: "Marked published (LinkedIn API stub)." });
    }

    const updated = await storage.updateSocialPost(id, {
      status: "published",
      publishedAt: new Date(),
    });
    res.json({ post: updated, note: "Marked published manually. Use the copy button to share on LinkedIn." });
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
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        response_format: { type: "json_object" },
      });
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
      res.status(500).json({ error: err.message || "Generation failed" });
    }
  });
}
