import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { runContentSchedulerTick } from "../services/content-scheduler";
import { logAiCall } from "../services/ai-audit-logger";

const PILLARS = [
  "Cost & Pricing",
  "Programs",
  "Industry",
  "Compliance & Security",
] as const;

const SECTION_TYPES = ["paragraph", "heading", "list", "cta", "quote"] as const;

const draftSchema = z.object({
  pillar: z.enum(PILLARS).optional(),
  cluster: z.string().min(2).max(120).optional(),
  topic: z.string().min(3).max(200),
  keywords: z.array(z.string().min(1).max(120)).min(1).max(10),
  category: z.string().min(2).max(60).default("Education"),
  authorId: z.number().int().optional(),
  authorName: z.string().optional(),
  audience: z.string().optional(),
  internalLinks: z.array(z.object({ label: z.string(), href: z.string() })).max(10).optional(),
});

function isAdminOrManager(req: any) {
  const role = req.user?.role;
  return role === "admin" || role === "manager";
}

export function registerContentRoutes(app: Express) {
  // ── Authors ────────────────────────────────────────────────────────────────
  app.get("/api/authors", async (_req, res) => {
    const authors = await storage.listContentAuthors();
    res.json(authors);
  });

  app.get("/api/authors/:slug", async (req, res) => {
    const author = await storage.getContentAuthorBySlug(req.params.slug);
    if (!author) return res.status(404).json({ error: "Author not found" });
    res.json(author);
  });

  app.post("/api/authors", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    try {
      const author = await storage.createContentAuthor(req.body);
      res.json(author);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/authors/:id", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id);
    const author = await storage.updateContentAuthor(id, req.body);
    if (!author) return res.status(404).json({ error: "Author not found" });
    res.json(author);
  });

  // ── Editorial workflow: list, get, update, schedule, publish ──────────────
  app.get("/api/content/posts", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const status = req.query.status as string | undefined;
    const posts = await storage.getGeneratedBlogPosts(status);
    res.json(posts);
  });

  app.get("/api/content/posts/:id", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id);
    const post = await storage.getGeneratedBlogPost(id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  });

  app.patch("/api/content/posts/:id", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id);
    const updates = { ...req.body };
    if (updates.scheduledAt && typeof updates.scheduledAt === "string") {
      updates.scheduledAt = new Date(updates.scheduledAt);
    }
    if (updates.content && Array.isArray(updates.content)) {
      for (const sec of updates.content) {
        if (!SECTION_TYPES.includes(sec?.type)) {
          return res.status(400).json({ error: "Invalid section type: " + sec?.type });
        }
      }
    }
    const post = await storage.updateGeneratedBlogPost(id, updates);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  });

  app.post("/api/content/posts/:id/transition", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const id = parseInt(req.params.id);
    const status = String(req.body?.status || "");
    const allowed = ["draft", "needs_review", "scheduled", "published", "archived"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
    if (status === "published") {
      const post = await storage.publishBlogPost(id);
      if (!post) return res.status(404).json({ error: "Post not found" });
      return res.json(post);
    }
    const updates: any = { status };
    if (status === "scheduled") {
      const when = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
      if (!when || isNaN(when.getTime())) return res.status(400).json({ error: "scheduledAt required" });
      updates.scheduledAt = when;
    }
    const post = await storage.updateGeneratedBlogPost(id, updates);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  });

  // ── AI-assist drafting ────────────────────────────────────────────────────
  app.post("/api/content/draft", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { pillar, cluster, topic, keywords, category, authorId, authorName, audience, internalLinks } = parsed.data;

    try {
      const { OpenAI } = await import("openai");
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const internalLinkText = internalLinks?.length
        ? `\nWhere natural, weave references to these internal pages: ${internalLinks.map(l => `${l.label} (${l.href})`).join("; ")}.`
        : "";

      const prompt = `You are an expert payments-industry content writer for Liberty Bancard, a transparent interchange-plus merchant services provider. Draft a blog post on the topic: "${topic}".

Pillar: ${pillar || "General"}
Cluster: ${cluster || "General"}
Target keywords: ${keywords.join(", ")}
Audience: ${audience || "Small business owners and operators evaluating payment processors"}
Category: ${category}${internalLinkText}

Return ONLY valid JSON matching this schema (no markdown fences):
{
  "slug": "url-slug",
  "title": "Headline (≤ 65 chars)",
  "seoTitle": "SEO title with keyword (≤ 60 chars)",
  "excerpt": "1-2 sentence promo blurb",
  "metaDescription": "≤ 160 chars meta description",
  "readTime": "X min read",
  "keywords": "comma, separated, keywords",
  "content": [
    {"type":"paragraph","text":"..."},
    {"type":"heading","level":2,"text":"..."},
    {"type":"list","items":["...","..."]},
    {"type":"cta","text":"...","ctaText":"...","ctaHref":"/upload-statement"}
  ],
  "faqs": [{"question":"...","answer":"..."}]
}

Guidelines:
- 1,200-1,800 words of substantive expert content
- 4-6 H2 headings, at least one bulleted list, 3-5 FAQs
- End with a CTA to /upload-statement (or another internal link if more relevant)
- Be factual, specific, avoid unsubstantiated claims
- Plain text only inside fields; no markdown
- All ctaHref values must be relative paths starting with /`;

      const contentMessages = [{ role: "user" as const, content: prompt }];
      const { completion } = await logAiCall(
        { triggerType: "content-generation", actorType: (req as any).user?.role || "agent", actorId: (req as any).user?.id?.toString(), rawPrompt: JSON.stringify(contentMessages) },
        () => openai.chat.completions.create({
          model: "gpt-4o",
          messages: contentMessages,
          temperature: 0.7,
          response_format: { type: "json_object" },
        })
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) return res.status(502).json({ error: "AI returned empty response" });
      const data = JSON.parse(content);

      // Validation + sanitization
      if (!data.slug || !data.title || !Array.isArray(data.content) || data.content.length === 0) {
        return res.status(502).json({ error: "AI returned invalid blog structure" });
      }
      const slugRe = /^[a-z0-9-]+$/;
      if (!slugRe.test(data.slug) || data.slug.length > 200) {
        data.slug = String(data.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 200);
      }
      for (const sec of data.content) {
        if (!sec || !SECTION_TYPES.includes(sec.type)) {
          return res.status(502).json({ error: "AI returned invalid content section" });
        }
        if (sec.ctaHref && typeof sec.ctaHref === "string" && !sec.ctaHref.startsWith("/")) {
          sec.ctaHref = "/upload-statement";
        }
      }
      const faqs = Array.isArray(data.faqs)
        ? data.faqs.filter((f: any) => f && typeof f.question === "string" && typeof f.answer === "string").slice(0, 8)
        : null;

      const author = authorId ? await storage.getContentAuthor(authorId) : null;
      const now = new Date();
      const saved = await storage.createGeneratedBlogPost({
        slug: data.slug,
        title: data.title,
        excerpt: data.excerpt || "",
        category,
        author: authorName || author?.name || "Liberty Bancard Team",
        authorId: author?.id || null,
        readTime: data.readTime || "8 min read",
        publishDate: now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        publishedISO: now.toISOString(),
        modifiedISO: now.toISOString(),
        keywords: data.keywords || keywords.join(", "),
        metaDescription: data.metaDescription || data.excerpt || "",
        content: data.content,
        faqs,
        status: "needs_review",
        pillar: pillar || null,
        cluster: cluster || null,
        seoTitle: data.seoTitle || data.title,
        internalLinks: internalLinks || null,
        createdBy: (req.user as any)?.id || null,
      });

      res.json(saved);
    } catch (err: any) {
      console.error("[ContentDraft] Error:", err);
      res.status(500).json({ error: err.message || "AI drafting failed" });
    }
  });

  // ── Manual scheduler tick (admin-triggered) ───────────────────────────────
  app.post("/api/content/scheduler/tick", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const result = await runContentSchedulerTick();
    res.json(result);
  });

  // ── Content & Organic KPIs (for Operator dashboard tab) ───────────────────
  app.get("/api/content/kpis", isAuthenticated, async (req, res) => {
    if (!isAdminOrManager(req)) return res.status(403).json({ error: "Admin/Manager only" });
    const [allBlogs, allSocial] = await Promise.all([
      storage.getGeneratedBlogPosts(),
      storage.listSocialPosts(),
    ]);
    const blogPublished = allBlogs.filter(p => p.status === "published").length;
    const blogScheduled = allBlogs.filter(p => p.status === "scheduled").length;
    const blogDrafts = allBlogs.filter(p => p.status === "draft" || p.status === "needs_review").length;
    const socialPublished = allSocial.filter(p => p.status === "published" || p.status === "ready_to_publish").length;
    const socialScheduled = allSocial.filter(p => p.status === "scheduled").length;
    const socialDrafts = allSocial.filter(p => p.status === "draft" || p.status === "needs_review").length;
    const byPillar: Record<string, number> = {};
    for (const p of allBlogs) {
      if (p.pillar) byPillar[p.pillar] = (byPillar[p.pillar] || 0) + 1;
    }
    const upcomingBlog = allBlogs
      .filter(p => p.status === "scheduled" && p.scheduledAt)
      .sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!))
      .slice(0, 10)
      .map(p => ({ id: p.id, title: p.title, slug: p.slug, scheduledAt: p.scheduledAt, pillar: p.pillar }));
    const upcomingSocial = allSocial
      .filter(p => p.status === "scheduled" && p.scheduledAt)
      .sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!))
      .slice(0, 10)
      .map(p => ({ id: p.id, body: p.body.slice(0, 140), scheduledAt: p.scheduledAt, pillar: p.pillar }));
    res.json({
      blog: { published: blogPublished, scheduled: blogScheduled, drafts: blogDrafts, byPillar },
      social: { published: socialPublished, scheduled: socialScheduled, drafts: socialDrafts },
      upcomingBlog,
      upcomingSocial,
    });
  });
}
