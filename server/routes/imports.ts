import type { Express } from "express";
import { isAuthenticated, isAdmin, isAffiliate, isDashboardUser } from "../replit_integrations/auth";
import rateLimit from "express-rate-limit";
import { storage } from "../storage";
import { logAiCall } from "../services/ai-audit-logger";
import { db, pool } from "../db";
import { z } from "zod";
import { authStorage } from "../replit_integrations/auth/storage";
import { contacts, users } from "@shared/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { INDUSTRY_SLUGS, LOCATION_CITIES, LOCATION_VERTICALS, STATIC_BLOG_SLUGS } from "@shared/blog-slugs";
import { getSerperUsage, isSerperConfigured } from "../services/serper";
import { autoEnrollFromTrigger } from "../services/sequence-worker";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { calculateQuizBonusFn, calculateRevenuePotentialFn, calculateSwitchabilityFn, calculateUnderwritingConfidenceFn, scoreContact } from "../services/lead-scoring";
import { generateDealBlueprint } from "../services/deal-blueprint";
import { routeContact } from "../services/smart-router";
import { importCordataEnrichment, importFullCorevt, isWorkerRunning, runDailyOutreach, startDailyOutreachWorker, stopDailyOutreachWorker } from "../services/daily-outreach";
import { getGhlSyncStatus } from "../services/ghl-sync";
import { runBulkFastClassification } from "../services/sunbiz-enrichment";
import { ingestBusiness, ingestBusinessFromContact } from "../services/sdr/dedupe";
import { syncFormSubmissionToGhl } from "../services/ghl-form-sync";
import { createContactGhlFirst, updateContactGhlFirst } from "../services/contact-writer";
import { parse } from "csv-parse/sync";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import { uploadLarge, trackReferral, normalizePhoneForImport, classifyVerticalForImport, sendConfirmationSms } from "./helpers";
import { recordPewcDecision } from "../services/consent-evidence";
import { evaluateContactability } from "../services/contactability";
import { syncAffiliateSignupToGhl } from "../services/ghl-form-sync";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";

export function registerImportsRoutes(app: Express) {
  // === FULL COREVT IMPORT ===
  app.post("/api/sunbiz/import-corevt-full", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const maxRecords = Number(req.body.maxRecords) || Infinity;
    const onlyActive = req.body.onlyActive !== false;
    res.json({ message: `Full corevt import started (max: ${maxRecords === Infinity ? 'unlimited' : maxRecords}, active only: ${onlyActive})`, started: true });
    importFullCorevt({ maxRecords, onlyActive }).catch(err => console.error("[Import API] Error:", err));
  });

  app.get("/api/sunbiz/import-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("corevt_import_progress");
    const cordataProgress = await storage.getSystemSetting("cordata_import_progress");
    const entityCount = await storage.getSunbizEntityCount();
    res.json({ progress: progress || { status: "idle" }, cordataProgress: cordataProgress || { status: "idle" }, totalInDb: entityCount });
  });

  app.post("/api/sunbiz/import-cordata", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const maxRecords = req.body.maxRecords ? parseInt(req.body.maxRecords) : Infinity;
    const download = req.body.download !== false;
    res.json({ message: `Cordata import started (download: ${download}, max: ${maxRecords === Infinity ? 'unlimited' : maxRecords})`, started: true });
    importCordataEnrichment({ maxRecords, download }).catch(err => console.error("[Cordata Import API] Error:", err));
  });

  app.get("/api/sunbiz/cordata-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("cordata_import_progress");
    res.json({ progress: progress || { status: "idle" } });
  });

  app.post("/api/sunbiz/fast-classify", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    res.json({ message: "Bulk fast classification started for all pending entities.", started: true });
    runBulkFastClassification().catch(err => console.error("[FastClassify API] Error:", err));
  });

  app.get("/api/sunbiz/classify-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("bulk_classify_progress");
    res.json({ progress: progress || { status: "idle" } });
  });


  // === DAILY OUTREACH AUTOMATION ===
  app.post("/api/outreach/run-daily", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    res.json({ message: "Daily outreach cycle started.", started: true });
    runDailyOutreach().catch(err => console.error("[Daily Outreach API] Error:", err));
  });

  app.post("/api/outreach/start-worker", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const { isUsingMockRedis } = await import("../services/queue-connection");
    if (!isUsingMockRedis() || process.env.REDIS_URL) {
      return res.status(409).json({ message: "BullMQ queue scheduler is active. Use the Job Queue panel in the Operator Dashboard to manage queues. Legacy setInterval worker disabled to prevent duplicate execution." });
    }
    const intervalMinutes = Number(req.body.intervalMinutes) || 60;
    startDailyOutreachWorker(intervalMinutes);
    res.json({ message: `Outreach worker started (runs every ${intervalMinutes} minutes)`, started: true });
  });

  app.post("/api/outreach/stop-worker", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    stopDailyOutreachWorker();
    res.json({ message: "Outreach worker stopped", stopped: true });
  });

  app.get("/api/outreach/status", isAuthenticated, async (req, res) => {
    const [entityStats, verticalBreakdown, prospectStats, contactStats, dealStats, ghlStatus, importProgress, cordataProgress, enrichmentProgress, lastOutreachRun, workerStatus] = await Promise.all([
      storage.getSunbizAggregateStats(),
      storage.getSunbizVerticalBreakdown(),
      storage.getProspectAggregateStats(),
      storage.getContactAggregateStats(),
      storage.getDealAggregateStats(),
      getGhlSyncStatus(),
      storage.getSystemSetting("corevt_import_progress"),
      storage.getSystemSetting("cordata_import_progress"),
      storage.getSystemSetting("enrichment_progress"),
      storage.getSystemSetting("daily_outreach_last_run"),
      storage.getSystemSetting("outreach_worker_status"),
    ]);

    const campaigns = await storage.getCampaigns();
    const activeCampaigns = campaigns.filter(c => c.status === "active").length;

    const serperUsage = await getSerperUsage();

    res.json({
      entities: entityStats,
      prospects: prospectStats,
      contacts: contactStats,
      deals: dealStats,
      activeCampaigns,
      verticalBreakdown,
      ghlSync: ghlStatus,
      importProgress: importProgress || { status: "idle" },
      cordataProgress: cordataProgress || { status: "idle" },
      enrichmentProgress: enrichmentProgress || { status: "idle" },
      lastOutreachRun,
      workerRunning: isWorkerRunning(),
      workerStatus,
      serper: {
        configured: isSerperConfigured(),
        usage: serperUsage,
      },
    });
  });

  app.get("/api/blog/generated", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const status = req.query.status as string | undefined;
    const posts = await storage.getGeneratedBlogPosts(status);
    res.json(posts);
  });

  app.get("/api/blog/generated/published", async (_req, res) => {
    const posts = await storage.getGeneratedBlogPosts("published");
    res.json(posts);
  });

  app.post("/api/blog/generate", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { keywords, category, autoSchedule } = req.body;
      if (!keywords || !Array.isArray(keywords) || keywords.length === 0 || keywords.length > 10) {
        return res.status(400).json({ error: "Keywords array required (1-10 items)" });
      }
      const validCategories = ["Education", "Cost Savings", "Industry", "Programs", "Getting Started", "Technology", "Compliance", "Security"];
      const validCategory = validCategories.includes(category) ? category : "Education";

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const prompt = `Generate an SEO-optimized blog post for a payment processing company called Liberty Bancard. The post should target these keywords: ${keywords.map((k: string) => k.slice(0, 100)).join(", ")}. Category: ${validCategory}.

The company provides transparent, interchange-plus payment processing for small businesses. They offer free statement reviews, wholesale pricing, next-day funding, and cash discount programs.

Return a JSON object with this exact structure:
{
  "slug": "url-friendly-slug-from-title",
  "title": "SEO-Optimized Title (50-60 chars ideal)",
  "excerpt": "Compelling 1-2 sentence summary for blog listing page",
  "category": "${validCategory}",
  "author": "Liberty Bancard Team",
  "readTime": "X min read",
  "publishDate": "${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}",
  "publishedISO": "${new Date().toISOString()}",
  "modifiedISO": "${new Date().toISOString()}",
  "keywords": "comma, separated, target, keywords",
  "metaDescription": "Meta description under 160 characters",
  "content": [
    { "type": "paragraph", "text": "Opening paragraph..." },
    { "type": "heading", "level": 2, "text": "Section Title" },
    { "type": "paragraph", "text": "Section content..." },
    { "type": "list", "items": ["Point 1", "Point 2", "Point 3"] },
    { "type": "cta", "text": "CTA message", "ctaText": "Button Text", "ctaHref": "/upload-statement" }
  ],
  "faqs": [
    { "question": "Relevant FAQ question?", "answer": "Detailed answer..." },
    { "question": "Another FAQ?", "answer": "Answer..." },
    { "question": "Third FAQ?", "answer": "Answer..." }
  ]
}

Guidelines:
- Write 1000-1500 words of substantive, expert content
- Include 4-6 H2 headings
- Include at least one bulleted list
- End with a CTA pointing to /upload-statement
- Include 3-5 FAQ entries relevant to the article topic
- Be factual, specific, and avoid making unsubstantiated claims
- Use industry-specific data and examples
- Include disclaimers where appropriate
- Do NOT use markdown formatting in text fields
- Return ONLY valid JSON, no markdown code fences`;

      const importGenMessages = [{ role: "user" as const, content: prompt }];
      const { completion } = await logAiCall(
        { triggerType: "content-generation", actorType: (req as any).user?.role || "agent", actorId: (req as any).user?.id?.toString(), rawPrompt: JSON.stringify(importGenMessages) },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: importGenMessages,
          temperature: 0.7,
          response_format: { type: "json_object" },
        })
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "No response from AI" });
      }

      const postData = JSON.parse(content);

      if (!postData.slug || typeof postData.slug !== 'string' || !postData.title || typeof postData.title !== 'string' || !postData.content || !Array.isArray(postData.content) || postData.content.length === 0) {
        return res.status(500).json({ error: "AI returned invalid blog post structure" });
      }

      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(postData.slug) || postData.slug.length > 200) {
        postData.slug = postData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200);
      }

      for (const section of postData.content) {
        if (!section || typeof section !== 'object' || !['paragraph', 'heading', 'list', 'cta', 'quote'].includes(section.type)) {
          return res.status(500).json({ error: "AI returned invalid content section" });
        }
        if (section.ctaHref && typeof section.ctaHref === 'string' && !section.ctaHref.startsWith('/')) {
          section.ctaHref = '/upload-statement';
        }
      }

      if (postData.faqs && Array.isArray(postData.faqs)) {
        postData.faqs = postData.faqs.filter((f: { question?: unknown; answer?: unknown }) => f && typeof f.question === 'string' && typeof f.answer === 'string').slice(0, 10);
      } else {
        postData.faqs = null;
      }

      let scheduledAt: Date | undefined;
      let status = "draft";
      if (autoSchedule) {
        const scheduled = await storage.getScheduledBlogPosts();
        const lastScheduled = scheduled.length > 0 ? new Date(scheduled[scheduled.length - 1].scheduledAt!) : new Date();
        const nextDate = new Date(lastScheduled);
        nextDate.setDate(nextDate.getDate() + (Math.random() < 0.5 ? 3 : 4));
        nextDate.setHours(9, 0, 0, 0);
        scheduledAt = nextDate;
        status = "scheduled";
      }

      const saved = await storage.createGeneratedBlogPost({
        slug: postData.slug,
        title: postData.title,
        excerpt: postData.excerpt || "",
        category: postData.category || validCategory,
        author: postData.author || "Liberty Bancard Team",
        readTime: postData.readTime || "5 min read",
        publishDate: postData.publishDate || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        publishedISO: postData.publishedISO || new Date().toISOString(),
        modifiedISO: postData.modifiedISO || new Date().toISOString(),
        keywords: postData.keywords || keywords.join(", "),
        metaDescription: postData.metaDescription || postData.excerpt || "",
        content: postData.content,
        faqs: postData.faqs || null,
        status,
        scheduledAt: scheduledAt || null,
        createdBy: (req.user as any)?.id || null,
      });

      res.json(saved);
    } catch (err: any) {
      console.error("Blog generation error:", err);
      res.status(500).json({ error: err.message || "Blog generation failed" });
    }
  });

  app.patch("/api/blog/generated/:id/publish", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid post ID" });
    const post = await storage.publishBlogPost(id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  });

  app.patch("/api/blog/generated/:id/schedule", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid post ID" });
    const { scheduledAt } = req.body;
    if (!scheduledAt || typeof scheduledAt !== 'string') return res.status(400).json({ error: "scheduledAt ISO string required" });
    const date = new Date(scheduledAt);
    if (isNaN(date.getTime()) || date <= new Date()) return res.status(400).json({ error: "scheduledAt must be a valid future date" });
    const post = await storage.updateGeneratedBlogPost(id, {
      status: "scheduled",
      scheduledAt: date,
    });
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  });

  app.delete("/api/blog/generated/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid post ID" });
    await storage.deleteGeneratedBlogPost(id);
    res.json({ success: true });
  });

  app.get("/sitemap.xml", async (_req, res) => {
    const baseUrl = "https://libertybancard.com";
    const today = new Date().toISOString().split("T")[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <sitemap><loc>${baseUrl}/sitemap-core.xml</loc><lastmod>${today}</lastmod></sitemap>\n`;
    xml += `  <sitemap><loc>${baseUrl}/sitemap-blog.xml</loc><lastmod>${today}</lastmod></sitemap>\n`;
    xml += `  <sitemap><loc>${baseUrl}/sitemap-locations.xml</loc><lastmod>${today}</lastmod></sitemap>\n`;
    xml += `  <sitemap><loc>${baseUrl}/sitemap-compare.xml</loc><lastmod>${today}</lastmod></sitemap>\n`;
    xml += `</sitemapindex>`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  });

  app.get("/sitemap-core.xml", async (_req, res) => {
    const baseUrl = "https://libertybancard.com";
    const today = new Date().toISOString().split("T")[0];

    const publicPages: Array<{ url: string; priority: string; changefreq: string }> = [
      { url: "/", priority: "1.0", changefreq: "weekly" },
      { url: "/get-started", priority: "0.9", changefreq: "monthly" },
      { url: "/upload-statement", priority: "0.9", changefreq: "monthly" },
      { url: "/free-analysis", priority: "0.9", changefreq: "monthly" },
      { url: "/free-analysis-guaranteed", priority: "0.9", changefreq: "monthly" },
      { url: "/0-percent-processing", priority: "0.9", changefreq: "monthly" },
      { url: "/beat-square-stripe", priority: "0.8", changefreq: "monthly" },
      { url: "/free-smart-terminal", priority: "0.9", changefreq: "monthly" },
      { url: "/about-contact", priority: "0.7", changefreq: "monthly" },
      { url: "/estimate", priority: "0.8", changefreq: "monthly" },
      { url: "/support", priority: "0.6", changefreq: "monthly" },
      { url: "/merchant-application", priority: "0.8", changefreq: "monthly" },
      { url: "/savings-calculator", priority: "0.8", changefreq: "monthly" },
      { url: "/compare-rates", priority: "0.8", changefreq: "monthly" },
      { url: "/blog", priority: "0.8", changefreq: "weekly" },
      { url: "/faq", priority: "0.9", changefreq: "monthly" },
      { url: "/affiliate", priority: "0.7", changefreq: "monthly" },
      { url: "/why-liberty-bancard", priority: "0.8", changefreq: "monthly" },
      { url: "/shop", priority: "0.8", changefreq: "monthly" },
      { url: "/case-studies", priority: "0.8", changefreq: "monthly" },
      { url: "/testimonials", priority: "0.8", changefreq: "monthly" },
      { url: "/testimonials/submit", priority: "0.5", changefreq: "monthly" },
      { url: "/integrations", priority: "0.8", changefreq: "monthly" },
      ...INDUSTRY_SLUGS.map(slug => ({ url: `/industries/${slug}`, priority: "0.8", changefreq: "monthly" })),
      { url: "/privacy-policy", priority: "0.3", changefreq: "yearly" },
      { url: "/terms", priority: "0.3", changefreq: "yearly" },
      { url: "/cookie-policy", priority: "0.3", changefreq: "yearly" },
      { url: "/advertising-disclosure", priority: "0.2", changefreq: "yearly" },
      { url: "/accessibility", priority: "0.3", changefreq: "yearly" },
      { url: "/sms-terms", priority: "0.2", changefreq: "yearly" },
      { url: "/esign-consent", priority: "0.2", changefreq: "yearly" },
      { url: "/surcharging-disclosure", priority: "0.3", changefreq: "yearly" },
      { url: "/merchant-policies", priority: "0.2", changefreq: "yearly" },
      { url: "/regulatory-notices", priority: "0.2", changefreq: "yearly" },
      { url: "/security-compliance", priority: "0.3", changefreq: "yearly" },
      { url: "/do-not-sell", priority: "0.2", changefreq: "yearly" },
      { url: "/data-processing-agreement", priority: "0.2", changefreq: "yearly" },
      { url: "/responsible-ai", priority: "0.2", changefreq: "yearly" },
      { url: "/testimonials-disclosure", priority: "0.2", changefreq: "yearly" },
      { url: "/law-enforcement", priority: "0.2", changefreq: "yearly" },
      { url: "/dispute-resolution", priority: "0.2", changefreq: "yearly" },
      { url: "/data-retention", priority: "0.2", changefreq: "yearly" },
      { url: "/tcpa-consent", priority: "0.2", changefreq: "yearly" },
      { url: "/refund-policy", priority: "0.3", changefreq: "yearly" },
      { url: "/california-privacy", priority: "0.3", changefreq: "yearly" },
      { url: "/ada-compliance", priority: "0.3", changefreq: "yearly" },
      { url: "/help", priority: "0.7", changefreq: "monthly" },
    ];

    const helpArticles: { category: string; slugs: string[] }[] = [
      { category: "getting-started", slugs: ["setting-up-your-merchant-account", "running-your-first-transaction", "connecting-your-pos-system", "understanding-your-pricing", "next-day-funding-setup"] },
      { category: "billing-statements", slugs: ["reading-your-monthly-statement", "understanding-processing-fees", "disputing-a-charge-on-your-statement", "managing-chargebacks", "understanding-refunds-and-credits"] },
      { category: "technical-support", slugs: ["terminal-troubleshooting", "gateway-setup-configuration", "resolving-batch-settlement-issues", "wifi-and-network-connectivity", "contactless-and-nfc-troubleshooting"] },
      { category: "account-management", slugs: ["updating-business-information", "adding-users-and-permissions", "changing-your-processing-settings", "adding-a-new-location", "closing-or-pausing-your-account"] },
      { category: "compliance-security", slugs: ["pci-compliance-basics", "protecting-customer-data", "fraud-prevention-tips", "handling-a-data-breach", "understanding-emv-and-liability-shift"] },
      { category: "general-faq", slugs: ["what-is-payment-processing", "how-long-does-approval-take", "what-are-interchange-fees", "do-i-need-a-contract", "what-is-a-merchant-id", "can-i-accept-amex", "what-is-a-cash-discount-program", "how-to-read-your-rate", "what-is-next-day-funding", "how-to-switch-processors", "what-is-pci-compliance"] },
    ];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const page of publicPages) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}${page.url}</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
      xml += `    <priority>${page.priority}</priority>\n`;
      xml += `  </url>\n`;
    }

    for (const group of helpArticles) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/help/${group.category}</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.6</priority>\n`;
      xml += `  </url>\n`;
      for (const slug of group.slugs) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/help/${group.category}/${slug}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>monthly</changefreq>\n`;
        xml += `    <priority>0.5</priority>\n`;
        xml += `  </url>\n`;
      }
    }

    xml += `</urlset>`;
    res.set("Content-Type", "application/xml");
    res.send(xml);
  });

  app.get("/sitemap-blog.xml", async (_req, res) => {
    const baseUrl = "https://libertybancard.com";
    const today = new Date().toISOString().split("T")[0];
    const blogSlugs = STATIC_BLOG_SLUGS;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const slug of blogSlugs) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/blog/${slug}</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;
    }

    const publishedDbPosts = await storage.getGeneratedBlogPosts("published");
    const staticSlugSet = new Set(blogSlugs);
    for (const dbPost of publishedDbPosts) {
      if (!staticSlugSet.has(dbPost.slug)) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/blog/${dbPost.slug}</loc>\n`;
        xml += `    <lastmod>${dbPost.publishedAt ? dbPost.publishedAt.toISOString().split("T")[0] : today}</lastmod>\n`;
        xml += `    <changefreq>monthly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
      }
    }

    xml += `</urlset>`;
    res.set("Content-Type", "application/xml");
    res.send(xml);
  });

  app.post("/api/affiliate/signup", publicLeadRateLimit, async (req, res) => {
    try {
      const { firstName, lastName, email, phone, companyName, website, howHeard, password } = req.body;
      if (!firstName || typeof firstName !== "string" || firstName.length > 100) {
        return res.status(400).json({ message: "Valid first name is required." });
      }
      if (!email || typeof email !== "string" || !email.includes("@") || email.length > 200) {
        return res.status(400).json({ message: "Valid email is required." });
      }
      if (!phone || typeof phone !== "string" || phone.length > 30) {
        return res.status(400).json({ message: "Valid phone number is required." });
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      const existing = await storage.getPartnerByEmail(email.toLowerCase());
      if (existing) {
        return res.status(409).json({ message: "An affiliate account with this email already exists." });
      }
      const existingUser = await authStorage.getUserByEmail(email.toLowerCase());
      if (existingUser) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }
      let code = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        code = (firstName.slice(0, 3) + (lastName?.slice(0, 3) || "") + Math.random().toString(36).slice(2, 6)).toLowerCase().replace(/[^a-z0-9]/g, "");
        const dup = await storage.getPartnerByCode(code);
        if (!dup) break;
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const partner = await storage.createPartner({
        companyName: (companyName || `${firstName} ${lastName || ""}`.trim()).slice(0, 200),
        contactName: `${firstName} ${lastName || ""}`.trim().slice(0, 200),
        email: email.toLowerCase().slice(0, 200),
        phone: phone.slice(0, 30),
        passwordHash,
        partnerType: "affiliate",
        affiliateCode: code,
        status: "active",
        commissionPercent: 10,
        website: website ? String(website).slice(0, 500) : null,
        howHeard: howHeard ? String(howHeard).slice(0, 500) : null,
      });
      const user = await authStorage.upsertUser({
        email: email.toLowerCase(),
        firstName,
        lastName: lastName || "",
        passwordHash,
        role: "affiliate",
        authProvider: "local",
      });
      const affiliateContact = await createContactGhlFirst({
        firstName,
        lastName: lastName || "",
        email: email.toLowerCase(),
        phone,
        companyName: companyName || undefined,
        status: "Active",
        tags: ["src_website", "affiliate"],
      }).catch(() => null);

      if (affiliateContact) {
        syncFormSubmissionToGhl({
          contactId: affiliateContact.id,
          leadSource: "affiliate",
          formData: {
            lb_referral_code: partner.affiliateCode || "",
          },
        }).catch(err => console.error("GHL affiliate sync error:", err));
        if (affiliateContact.ghlContactId) {
          const { enrollInGhlWorkflow } = await import("../services/ghl-workflows");
          enrollInGhlWorkflow({ workflowKey: "affiliate_welcome", ghlContactId: affiliateContact.ghlContactId, metadata: { affiliateCode: partner.affiliateCode || code, partnerId: partner.id } }).catch(err =>
            console.error("[Affiliate] GHL affiliate_welcome enrollment error:", err)
          );
        }
      }
      syncAffiliateSignupToGhl({
        firstName,
        lastName: lastName || "",
        email,
        phone,
        companyName: companyName || undefined,
        affiliateCode: partner.affiliateCode || code,
      }).catch(err => console.error("GHL affiliate sync error:", err));

      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.status(201).json({
            message: "Welcome to the Liberty Bancard Affiliate Program!",
            affiliateCode: partner.affiliateCode,
          });
        }
        return res.status(201).json({
          message: "Welcome to the Liberty Bancard Affiliate Program!",
          affiliateCode: partner.affiliateCode,
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const affiliateLoginRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { message: "Too many login attempts, please try again later." } });
  app.post("/api/affiliate/login", affiliateLoginRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
      }
      const partner = await storage.getPartnerByEmail(email.toLowerCase());
      if (!partner || !partner.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const valid = await bcrypt.compare(password, partner.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      if (partner.status !== "active") {
        return res.status(403).json({ message: "Your affiliate account is not active." });
      }
      let user = await authStorage.getUserByEmail(email.toLowerCase());
      if (!user) {
        const nameParts = (partner.contactName || "").split(" ");
        user = await authStorage.upsertUser({
          email: email.toLowerCase(),
          firstName: nameParts[0] || "Affiliate",
          lastName: nameParts.slice(1).join(" ") || "",
          passwordHash: partner.passwordHash,
          role: "affiliate",
          authProvider: "local",
        });
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: "Login failed." });
        }
        return res.json({
          affiliateCode: partner.affiliateCode,
          name: partner.contactName,
          email: partner.email,
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/affiliate/session", isAffiliate, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByEmail(user.email);
      if (!partner) {
        return res.status(404).json({ message: "Affiliate account not found." });
      }
      return res.json({
        affiliateCode: partner.affiliateCode,
        name: partner.contactName,
        email: partner.email,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/affiliate/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  app.get("/api/affiliate/stats/:code", isAffiliate, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByCode(req.params.code as string);
      if (!partner) return res.status(404).json({ message: "Affiliate not found." });
      if (user.role !== "admin" && partner.email !== user.email) {
        return res.status(403).json({ message: "Access denied." });
      }
      const referralsList = await storage.getReferralsByPartner(partner.id);
      const pending = referralsList.filter(r => r.status === "pending" || r.status === "contacted").length;
      const qualified = referralsList.filter(r => r.status === "qualified").length;
      const converted = referralsList.filter(r => r.status === "converted" || r.status === "paid").length;
      const totalEarnings = referralsList.filter(r => r.status === "paid").reduce((sum, r) => sum + parseFloat(r.incentiveAmount || "0"), 0);
      const pendingEarnings = referralsList.filter(r => r.status === "converted").reduce((sum, r) => sum + parseFloat(r.incentiveAmount || "0"), 0);
      res.json({
        affiliate: {
          name: partner.contactName,
          code: partner.affiliateCode,
          commissionPercent: partner.commissionPercent,
          status: partner.status,
          joinedAt: partner.createdAt,
        },
        stats: {
          totalClicks: partner.totalClicks || 0,
          totalReferrals: referralsList.length,
          pending,
          qualified,
          converted,
          conversionRate: referralsList.length > 0 ? Math.round((converted / referralsList.length) * 100) : 0,
          totalEarnings: totalEarnings.toFixed(2),
          pendingEarnings: pendingEarnings.toFixed(2),
        },
        recentReferrals: referralsList.slice(0, 20).map(r => ({
          id: r.id,
          status: r.status,
          date: r.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/affiliate/public/:code", async (req, res) => {
    try {
      const partner = await storage.getPartnerByCode(req.params.code);
      if (!partner || partner.status !== "active") {
        return res.status(404).json({ message: "Affiliate not found" });
      }
      res.json({
        name: partner.contactName,
        company: partner.companyName || undefined,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/affiliate/track-click", publicLeadRateLimit, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Code required" });
      const partner = await storage.getPartnerByCode(code);
      if (!partner) return res.status(404).json({ message: "Invalid affiliate code" });
      await storage.updatePartner(partner.id, { totalClicks: (partner.totalClicks || 0) + 1 } as any);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/public/free-analysis", async (req, res) => {
    try {
      const {
        businessType, industry, monthlyVolume, currentProcessor,
        painPoint, painPoints: painPointsArr,
        firstName, lastName, email, phone, companyName,
        consentSms, consentEmail, pewcConsent: pewcConsentRaw, referralCode, promoCode,
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
      } = req.body;

      if (!firstName || !email) {
        return res.status(400).json({ message: "First name and email are required." });
      }

      const sanitizedPromo = promoCode
        ? promoCode.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20)
        : undefined;

      const resolvedPainPoints: string[] = Array.isArray(painPointsArr) ? painPointsArr
        : painPoint ? (typeof painPoint === "string" ? painPoint.split(",").map((s: string) => s.trim()) : [painPoint])
        : [];

      const industryMap: Record<string, string> = {
        "restaurant": "Restaurant", "retail": "Retail",
        "healthcare": "Medical/Dental/Medspa", "medical": "Medical/Dental/Medspa",
        "automotive": "Automotive", "home-services": "Home Services", "home_services": "Home Services",
        "ecommerce": "E-commerce", "e-commerce": "E-commerce", "other": "Other",
      };
      const normalizedIndustry = industryMap[(industry || "other").toLowerCase().replace(/[^a-z-]/g, "")] || industry || "Other";

      const volumeRanges: Record<string, number> = {
        "under-5k": 2500, "5k-15k": 10000, "15k-50k": 32500,
        "50k-150k": 100000, "150k-plus": 200000,
        "Under $5,000": 2500, "$5,000 - $10,000": 7500,
        "$5,000 - $15,000": 10000, "$10,001 - $25,000": 17500,
        "$15,000 - $50,000": 32500, "$25,001 - $50,000": 37500,
        "$50,000 - $150,000": 100000, "$50,001+": 75000,
        "$150,000+": 200000, "Not sure": 15000,
      };
      const volumeNum = volumeRanges[monthlyVolume] || parseFloat((monthlyVolume || "0").replace(/[^0-9.]/g, "")) || 15000;
      let estimatedSavings = 0;
      let recommendedProgram = "Wholesale";
      let recommendedTerminal = "Clover Flex 3";

      const processorRates: Record<string, number> = {
        "square": 2.6, "stripe": 2.9, "toast": 2.49, "clover": 2.6,
        "clover_go": 2.6, "bank-processor": 2.5, "bank_processor": 2.5,
        "paypal": 2.7, "shopify": 2.6, "other": 2.5, "none": 3.0,
      };
      const processorKey = (currentProcessor || "other").toLowerCase().replace(/[^a-z_-]/g, "");
      const currentRate = processorRates[processorKey] || processorRates[processorKey.replace(/-/g, "_")] || 2.5;
      const ourRate = 1.59;
      const rateDiff = (currentRate - ourRate) / 100;
      estimatedSavings = Math.round(volumeNum * rateDiff * 12);

      if (volumeNum > 10000) {
        recommendedProgram = "0% Processing (Dual Pricing)";
        estimatedSavings = Math.round(volumeNum * (currentRate / 100) * 12);
      } else if (volumeNum > 5000) {
        recommendedProgram = "Wholesale Interchange+";
      }

      const terminalMap: Record<string, string> = {
        "Restaurant": "Clover Station Duo", "Retail": "Clover Mini 3",
        "Home Services": "SwipeSimple B250", "Automotive": "PAX A920",
        "Medical/Dental/Medspa": "Dejavoo QD4", "E-commerce": "Clover Flex 3",
      };
      recommendedTerminal = terminalMap[normalizedIndustry] || "Clover Flex 3";

      const industryTag = `vertical_${(normalizedIndustry || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`;
      const tags = ["src_quiz", "lead_free_analysis", industryTag];
      if (sanitizedPromo) tags.push(`promo_${sanitizedPromo.toLowerCase()}`);
      if (utmSource) tags.push(`utm_src_${utmSource}`);
      if (utmMedium) tags.push(`utm_med_${utmMedium}`);
      if (utmCampaign) tags.push(`utm_camp_${utmCampaign}`);

      let contact: Awaited<ReturnType<typeof createContactGhlFirst>> | Awaited<ReturnType<typeof storage.getContactByEmail>> & { _ghlSyncPending?: boolean };
      try {
        contact = await createContactGhlFirst({
          firstName,
          lastName: lastName || "",
          email,
          phone: phone || "",
          companyName: companyName || undefined,
          vertical: normalizedIndustry || undefined,
          monthlyVolume: monthlyVolume || undefined,
          currentProvider: currentProcessor || undefined,
          primaryOfferPath: recommendedProgram,
          consentSms: consentSms === true,
          consentEmail: consentEmail === true,
          utmSource: utmSource || undefined,
          utmMedium: utmMedium || undefined,
          utmCampaign: utmCampaign || undefined,
          utmContent: utmContent || undefined,
          utmTerm: utmTerm || undefined,
          landingPage: "/free-analysis",
          promoCode: sanitizedPromo,
          painPoints: resolvedPainPoints.length > 0 ? resolvedPainPoints : undefined,
          estimatedResidual: estimatedSavings ? String(estimatedSavings) : undefined,
          status: "New",
          tags,
        });
      } catch (createErr: any) {
        if (createErr?.code === "23505" && (createErr?.constraint?.includes("email") || createErr?.message?.includes("contacts_email_unique_idx"))) {
          const existing = await storage.getContactByEmail(email);
          if (!existing) throw createErr;
          contact = existing;
        } else {
          throw createErr;
        }
      }

      const pewcConsent = pewcConsentRaw === true;
      if (pewcConsent) {
        recordPewcDecision({
          contactId: contact.id,
          checked: true,
          source: "free_analysis_quiz",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "free_analysis" },
        }).catch(err => console.error("[FreeAnalysis] PEWC record error:", err));
      }

      const quizNotes = [
        `Quiz Results:`,
        `Business Type: ${businessType || "N/A"}`,
        `Industry: ${normalizedIndustry || "N/A"}`,
        `Monthly Volume: ${monthlyVolume || "N/A"}`,
        `Current Processor: ${currentProcessor || "N/A"}`,
        `Pain Points: ${resolvedPainPoints.length > 0 ? resolvedPainPoints.join(", ") : "N/A"}`,
        `Estimated Annual Savings: $${estimatedSavings.toLocaleString()}`,
        `Recommended Program: ${recommendedProgram}`,
        `Recommended Terminal: ${recommendedTerminal}`,
        sanitizedPromo ? `Promo Code: ${sanitizedPromo}` : null,
      ].filter(Boolean).join("\n");

      const deal = await storage.createDeal({
        contactId: contact.id,
        pipeline: "sales",
        stage: "New Lead",
        offerPath: recommendedProgram,
        notes: quizNotes,
        leadSource: "free_analysis_quiz",
        promoCode: sanitizedPromo,
        terminalRecommendation: recommendedTerminal,
        recommendedProgram,
        totalVolume: monthlyVolume || undefined,
      });

      await storage.createNotification({
        channel: "#sales",
        title: "New Quiz Lead",
        message: `New quiz lead: ${firstName} ${lastName || ""} from ${normalizedIndustry || "Unknown"}, est. savings $${estimatedSavings.toLocaleString()}${sanitizedPromo ? ` (promo: ${sanitizedPromo})` : ""}`,
        type: "alert",
        metadata: {
          contactId: contact.id,
          dealId: deal.id,
          industry,
          estimatedSavings,
          monthlyVolume,
        },
      });

      trackReferral(referralCode, `${firstName} ${lastName || ""}`, email, phone, companyName).catch(err => console.error("Referral tracking error:", err));

      ingestBusinessFromContact(contact.id, "ghl_form", "free_analysis_quiz").catch(err => console.warn("[Quiz] Business ingest failed:", err));

      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint gen error:", err));

      (async () => {
        try {
          const searchName = companyName || `${firstName} ${lastName || ""}`;
          const matches = await storage.searchSunbizEntitiesByNameCity(searchName);
          if (matches.length > 0) {
            const match = matches[0];
            const enrichUpdates: Record<string, any> = {};
            if (match.vertical && !contact.vertical) enrichUpdates.vertical = match.vertical;
            if (match.ownerName) enrichUpdates.notes = `${contact.notes || ""}\nSunbiz Match: ${match.entityName} (Filing: ${match.filingNumber || "N/A"})`.trim();
            const existingTags = contact.tags || [];
            enrichUpdates.tags = [...existingTags, "sunbiz_matched"];
            if (match.aiSummary) {
              enrichUpdates.notes = `${enrichUpdates.notes || contact.notes || ""}\nSunbiz AI: ${match.aiSummary}`.trim();
            }
            await updateContactGhlFirst(contact.id, enrichUpdates);
            await storage.updateSunbizEntity(match.id, {
              tags: [...(match.tags || []), "quiz_lead_linked"],
              notes: `${match.notes || ""}\nLinked to quiz contact #${contact.id} (${firstName} ${lastName || ""})`.trim(),
            });
          }
        } catch (err) {
          console.error("Sunbiz match error:", err);
        }
      })();

      triggerWorkflowsByEvent("form_submitted", {
        entityType: "contact",
        entityId: contact.id,
        contactId: contact.id,
        dealId: deal.id,
      }, { formType: "free_analysis" }).catch(err => console.error("Workflow trigger error:", err));

      autoEnrollFromTrigger("form_submitted", {
        contactId: contact.id,
        dealId: deal.id,
        formType: "free_analysis",
      }).catch(err => console.error("Auto-enroll error:", err));

      autoEnrollFromTrigger("quiz_completed", {
        contactId: contact.id,
        dealId: deal.id,
      }).catch(err => console.error("Auto-enroll quiz error:", err));

      if (pewcConsent && phone) {
        evaluateContactability({ contactId: contact.id, channel: "sms", campaignType: "confirmation", mode: "enforcement" })
          .then(r => { if (r.allowed) sendConfirmationSms(contact.id, firstName, "free_analysis_quiz", deal.id).catch(err => console.error("Confirm SMS error:", err)); })
          .catch(err => console.error("[FreeAnalysis] Contactability check error:", err));
      }

      syncFormSubmissionToGhl({
        contactId: contact.id,
        dealId: deal.id,
        leadSource: "free_analysis",
        formData: {
          lb_estimated_savings: `$${estimatedSavings.toLocaleString()}`,
          lb_recommended_program: recommendedProgram,
          lb_business_type: businessType || "",
        },
      }).catch(err => console.error("GHL form sync error:", err));

      storage.createReviewQueueItem({
        sourceType: "quiz",
        sourceId: contact.id,
        status: "pending",
        checklistState: {},
        metadata: {
          contactName: `${firstName} ${lastName || ""}`.trim(),
          firstName,
          lastName: lastName || "",
          email,
          phone: phone || "",
          companyName: companyName || undefined,
          industry: normalizedIndustry,
          vertical: normalizedIndustry,
          monthlyVolume,
          currentProcessor,
          painPoints: resolvedPainPoints,
          recommendedProgram,
          estimatedSavings,
          source: "free_analysis",
          utmSource: utmSource || undefined,
          utmCampaign: utmCampaign || undefined,
          contactId: contact.id,
          dealId: deal.id,
        },
      }).catch((err: any) => console.error("[ReviewQueue] Free-analysis enqueue failed:", err.message));

      res.status(201).json({
        success: true,
        contactId: contact.id,
        dealId: deal.id,
        estimatedSavings,
        recommendedProgram,
        recommendedTerminal,
        monthlyVolume: monthlyVolume || "0",
      });
    } catch (err: any) {
      console.error("Free analysis submission error:", err);
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/affiliate/referral", publicLeadRateLimit, async (req, res) => {
    try {
      const { affiliateCode, name, email, phone, company, source } = req.body;
      if (!affiliateCode || !name || !email) {
        return res.status(400).json({ message: "Affiliate code, name, and email are required." });
      }
      const partner = await storage.getPartnerByCode(affiliateCode);
      if (!partner) return res.status(404).json({ message: "Invalid affiliate code." });
      const referral = await storage.createReferral({
        partnerId: partner.id,
        referredName: name,
        referredEmail: email,
        referredPhone: phone || null,
        referredCompany: company || null,
        status: "pending",
        incentiveType: "commission",
        notes: source ? `Source: ${source}` : null,
      });
      await storage.updatePartner(partner.id, { totalReferrals: (partner.totalReferrals || 0) + 1 } as any);
      res.status(201).json({ success: true, referralId: referral.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === MASS SCORING ===
  app.post("/api/contacts/mass-score", isDashboardUser, async (req, res) => {
    const batchSize = 500;
    let totalScored = 0;
    const tierCounts = { hot: 0, warm: 0, cold: 0, unqualified: 0 };

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM contacts WHERE archived_at IS NULL AND (last_scored_at IS NULL OR last_scored_at < NOW() - INTERVAL '24 hours')`
      );
      const totalContacts = parseInt(countResult.rows[0].cnt, 10);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendProgress({ type: "start", totalContacts });

      let lastId = 0;
      while (true) {
        const batchResult = await pool.query(
          `SELECT id FROM contacts WHERE archived_at IS NULL AND (last_scored_at IS NULL OR last_scored_at < NOW() - INTERVAL '24 hours') AND id > $1 ORDER BY id LIMIT $2`,
          [lastId, batchSize]
        );

        if (batchResult.rows.length === 0) break;

        for (const row of batchResult.rows) {
          lastId = row.id;
          try {
            const contact = await storage.getContact(row.id);
            if (!contact) continue;

            const contactDeals = await storage.getDealsByContact(row.id);
            const primaryDeal = contactDeals[0] || null;

            const revPotential = calculateRevenuePotentialFn(contact, primaryDeal);
            const switchability = calculateSwitchabilityFn(contact);
            const uwConfidence = calculateUnderwritingConfidenceFn(contact, primaryDeal);
            const quizBonus = calculateQuizBonusFn(contact);

            const engagementScore = 5;

            const total = revPotential.score + switchability.score + uwConfidence.score + engagementScore + quizBonus.score;
            const tier = total >= 70 ? "hot" : total >= 45 ? "warm" : total >= 20 ? "cold" : "unqualified";
            tierCounts[tier]++;

            await updateContactGhlFirst(row.id, {
              leadScore: total,
              revPotentialScore: revPotential.score,
              switchabilityScore: switchability.score,
              uwConfidenceScore: uwConfidence.score,
              engagementScore: engagementScore,
              scoreBreakdown: {
                revPotential: { score: revPotential.score, max: 30, factors: revPotential.factors },
                switchability: { score: switchability.score, max: 25, factors: switchability.factors },
                uwConfidence: { score: uwConfidence.score, max: 25, factors: uwConfidence.factors },
                engagement: { score: engagementScore, max: 20, factors: { default: 5 } },
                quizBonus: { score: quizBonus.score, max: 20, factors: quizBonus.factors },
                total,
                tier,
              },
              lastScoredAt: new Date(),
            });

            totalScored++;
          } catch (err) {
            console.error(`Mass scoring failed for contact ${row.id}:`, err);
          }
        }

        sendProgress({ type: "progress", scored: totalScored, total: totalContacts, tierCounts });
      }

      sendProgress({ type: "complete", totalScored, tierCounts });
      res.end();
    } catch (err: any) {
      console.error("Mass scoring error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        res.end();
      }
    }
  });


  // === MASS DEAL CREATION ===
  app.post("/api/contacts/mass-create-deals", isDashboardUser, async (req, res) => {
    const batchSize = 500;
    let dealsCreated = 0;
    let skipped = 0;

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM contacts c WHERE c.archived_at IS NULL AND c.lead_score >= 45 AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id)`
      );
      const totalEligible = parseInt(countResult.rows[0].cnt, 10);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendProgress({ type: "start", totalEligible });

      let lastId = 0;
      while (true) {
        const batchResult = await pool.query(
          `SELECT c.id, c.lead_score, c.vertical, c.monthly_volume, c.lead_source, c.first_name, c.last_name, c.company_name
           FROM contacts c
           WHERE c.archived_at IS NULL AND c.lead_score >= 45
             AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id)
             AND c.id > $1
           ORDER BY c.id
           LIMIT $2`,
          [lastId, batchSize]
        );

        if (batchResult.rows.length === 0) break;

        for (const row of batchResult.rows) {
          lastId = row.id;
          try {
            const score = row.lead_score || 0;
            const isHot = score >= 70;
            const stage = isHot ? "New Lead" : "Nurture / Not Now";
            const merchantTier = isHot ? "Strategic" : score >= 50 ? "Growth" : "Starter";

            await storage.createDeal({
              contactId: row.id,
              pipeline: "sales",
              stage,
              priorityScore: score,
              merchantTier,
              leadSource: row.lead_source || "imported",
              totalVolume: row.monthly_volume || null,
              notes: `Auto-created from mass scoring. Contact: ${row.first_name} ${row.last_name}${row.company_name ? ` (${row.company_name})` : ""}. Score: ${score}, Tier: ${isHot ? "hot" : "warm"}.`,
            });
            dealsCreated++;
          } catch (err) {
            console.error(`Deal creation failed for contact ${row.id}:`, err);
            skipped++;
          }
        }

        sendProgress({ type: "progress", created: dealsCreated, skipped, total: totalEligible });
      }

      sendProgress({ type: "complete", dealsCreated, skipped });
      res.end();
    } catch (err: any) {
      console.error("Mass deal creation error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        res.end();
      }
    }
  });


  // === DEDUPLICATE CONTACTS ===
  app.post("/api/contacts/deduplicate", async (req, res) => {
    try {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const duplicates = await storage.findDuplicateContacts();
      sendProgress({ type: "start", duplicateGroups: duplicates.length });

      let merged = 0;
      let errors = 0;

      for (const group of duplicates) {
        try {
          const sorted = group.contacts.sort((a, b) => {
            const aCompleteness = [a.email, a.phone, a.companyName, a.vertical, a.monthlyVolume, a.leadScore].filter(Boolean).length;
            const bCompleteness = [b.email, b.phone, b.companyName, b.vertical, b.monthlyVolume, b.leadScore].filter(Boolean).length;
            if (bCompleteness !== aCompleteness) return bCompleteness - aCompleteness;
            return (b.leadScore || 0) - (a.leadScore || 0);
          });

          const primary = sorted[0];
          for (let i = 1; i < sorted.length; i++) {
            await storage.mergeContacts(primary.id, sorted[i].id, { actorType: "system" });
            merged++;
          }
        } catch (err) {
          console.error("Merge error:", err);
          errors++;
        }
      }

      sendProgress({ type: "complete", duplicateGroups: duplicates.length, merged, errors });
      res.end();
    } catch (err: any) {
      console.error("Deduplication error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        res.end();
      }
    }
  });


  // === CSV IMPORT PIPELINE ===
  app.get("/api/csv-imports", isAuthenticated, async (req, res) => {
    const imports = await storage.getCsvImports();
    res.json(imports);
  });

  app.get("/api/csv-imports/stats", isAuthenticated, async (req, res) => {
    try {
      const imports = await storage.getCsvImports();
      const totalImports = imports.length;
      const totalRecordsImported = imports.reduce((sum, i) => sum + (i.newRecords || 0), 0);
      const totalDuplicatesSkipped = imports.reduce((sum, i) => sum + (i.duplicatesSkipped || 0), 0);
      const totalDealsCreated = imports.reduce((sum, i) => sum + (i.dealsCreated || 0), 0);
      const totalHot = imports.reduce((sum, i) => sum + (i.hotLeads || 0), 0);
      const totalWarm = imports.reduce((sum, i) => sum + (i.warmLeads || 0), 0);

      const allVerticals: Record<string, number> = {};
      for (const imp of imports) {
        const breakdown = imp.verticalBreakdown as Record<string, number> | null;
        if (breakdown) {
          for (const [v, count] of Object.entries(breakdown)) {
            allVerticals[v] = (allVerticals[v] || 0) + count;
          }
        }
      }

      res.json({
        totalImports,
        totalRecordsImported,
        totalDuplicatesSkipped,
        totalDealsCreated,
        totalHot,
        totalWarm,
        verticalBreakdown: allVerticals,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/affiliate/leaderboard", isAffiliate, async (_req, res) => {
    try {
      const leaders = await storage.getAffiliateLeaderboard();
      res.json(leaders.map((p, idx) => ({
        rank: idx + 1,
        name: p.contactName || p.companyName,
        referrals: p.totalReferrals || 0,
        conversions: p.totalConversions || 0,
        earnings: p.totalPayouts || "0",
      })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/affiliate/commission-report/:code", isAffiliate, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByCode(req.params.code as string);
      if (!partner) return res.status(404).json({ message: "Affiliate not found." });
      if (user.role !== "admin" && partner.email !== user.email) {
        return res.status(403).json({ message: "Access denied." });
      }
      const allReferrals = await storage.getReferralsByPartner(partner.id);
      const tiers = await storage.getCommissionTiers();
      const converted = allReferrals.filter(r => r.status === "converted" || r.status === "paid");

      function getCommissionForReferralCount(count: number): string {
        if (tiers.length === 0) return "100";
        for (const tier of tiers) {
          if (count >= tier.minReferrals && (tier.maxReferrals === null || count <= tier.maxReferrals)) {
            return tier.commissionAmount;
          }
        }
        return tiers[tiers.length - 1]?.commissionAmount || "100";
      }

      const monthlyBreakdown: Record<string, any[]> = {};
      let grandTotal = 0;
      for (const ref of converted) {
        const date = ref.createdAt ? new Date(ref.createdAt) : new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (!monthlyBreakdown[monthKey]) monthlyBreakdown[monthKey] = [];
        const commAmt = ref.commissionAmount || ref.incentiveAmount || getCommissionForReferralCount(converted.length);
        const amtNum = parseFloat(commAmt) || 0;
        grandTotal += amtNum;
        monthlyBreakdown[monthKey].push({
          referralId: ref.id,
          merchantName: ref.referredCompany || ref.referredName || "Unknown",
          signupDate: ref.createdAt,
          status: ref.status,
          commissionAmount: commAmt,
        });
      }

      const report = Object.entries(monthlyBreakdown)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([month, entries]) => ({
          month,
          entries,
          total: entries.reduce((sum: number, e: any) => sum + parseFloat(e.commissionAmount || "0"), 0).toFixed(2),
        }));

      res.json({
        affiliate: { name: partner.contactName, code: partner.affiliateCode },
        tiers,
        currentTierReferrals: converted.length,
        currentCommissionRate: getCommissionForReferralCount(converted.length),
        report,
        totalEarnings: grandTotal.toFixed(2),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/commission-tiers", async (_req, res) => {
    try {
      const tiers = await storage.getCommissionTiers();
      res.json(tiers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/commission-tiers", isAdmin, async (req, res) => {
    try {
      const { minReferrals, maxReferrals, commissionAmount, label } = req.body;
      const min = Number(minReferrals) || 1;
      const max = maxReferrals ? Number(maxReferrals) : null;
      const amount = parseFloat(String(commissionAmount || "100"));
      if (min < 1) return res.status(400).json({ message: "Min referrals must be at least 1." });
      if (max !== null && max < min) return res.status(400).json({ message: "Max referrals must be >= min referrals." });
      if (isNaN(amount) || amount <= 0) return res.status(400).json({ message: "Commission amount must be a positive number." });
      const tier = await storage.createCommissionTier({
        minReferrals: min,
        maxReferrals: max,
        commissionAmount: amount.toString(),
        label: label || null,
      }, { actorType: "user", userId: (req.user as any)?.id ?? null });
      res.status(201).json(tier);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/commission-tiers/:id", isAdmin, async (req, res) => {
    try {
      const updated = await storage.updateCommissionTier(Number(req.params.id), req.body, { userId: (req.user as any)?.id ?? null });
      if (!updated) return res.status(404).json({ message: "Tier not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/commission-tiers/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteCommissionTier(Number(req.params.id), { actorType: "user", userId: (req.user as any)?.id ?? null });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/csv-imports/:id", isAuthenticated, async (req, res) => {
    const record = await storage.getCsvImport(Number(req.params.id));
    if (!record) return res.status(404).json({ message: "Not found" });
    res.json(record);
  });

  app.post("/api/leads/import-csv", isAuthenticated, uploadLarge.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const filePath = req.file.path;
      const fileName = req.file.originalname || "upload.csv";

      let csvContent: string;
      try {
        csvContent = fs.readFileSync(filePath, "utf-8");
      } finally {
        try { fs.unlinkSync(filePath); } catch {}
      }

      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        relax_quotes: true,
      }) as Record<string, string>[];

      if (records.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or could not be parsed" });
      }

      const headers = Object.keys(records[0]).map(h => h.toLowerCase().trim());
      let sourceFormat = "custom";
      if (headers.some(h => /^(name|telephone|category|rating|review_count|keyword|address)$/i.test(h))) {
        sourceFormat = "google_maps_outscraper";
      } else if (headers.some(h => /^(first name|last name|company|title|email|mobile phone|corporate phone|person linkedin url|industry)$/i.test(h.replace(/_/g, " ")))) {
        sourceFormat = "apollo_lead_list";
      }

      const importRecord = await storage.createCsvImport({
        fileName,
        sourceFormat,
        totalRows: records.length,
        importSource: (req.body.importSource as string) || sourceFormat,
        status: "processing",
        importedBy: (req.body.importedBy as string) || "system",
      });

      const existingEmails = await db.select({ email: sql<string>`LOWER(TRIM(email))` }).from(contacts).where(and(ne(contacts.email, ""), sql`email IS NOT NULL`));
      const existingPhones = await db.select({ phone: contacts.phone }).from(contacts).where(and(ne(contacts.phone, ""), sql`phone IS NOT NULL`));
      const existingCompanies = await db.select({ name: sql<string>`LOWER(TRIM(company_name))` }).from(contacts).where(and(sql`company_name IS NOT NULL`, ne(contacts.companyName, "")));

      const emailSet = new Set<string>();
      for (const row of existingEmails) { if (row.email) emailSet.add(row.email); }
      const phoneSet = new Set<string>();
      for (const row of existingPhones) {
        const norm = normalizePhoneForImport(row.phone || "");
        if (norm && norm.length >= 10) phoneSet.add(norm);
      }
      const companySet = new Set<string>();
      for (const row of existingCompanies) { if (row.name) companySet.add(row.name); }

      const googleMapsColumnMap: Record<string, string> = {
        "name": "companyName", "telephone": "phone", "phone": "phone",
        "category": "industry", "rating": "rating", "review_count": "reviewCount",
        "reviews": "reviewCount", "keyword": "keyword", "address": "address",
        "website": "website", "city": "city", "state": "state",
      };

      const apolloColumnMap: Record<string, string> = {
        "first_name": "firstName", "first name": "firstName", "firstname": "firstName",
        "last_name": "lastName", "last name": "lastName", "lastname": "lastName",
        "email": "email", "email_address": "email",
        "mobile_phone": "phone", "mobile phone": "phone", "corporate_phone": "phone", "corporate phone": "phone", "phone": "phone",
        "company": "companyName", "company_name": "companyName", "company name": "companyName",
        "title": "title", "industry": "industry", "keywords": "keywords",
        "#_employees": "employeeCount", "# employees": "employeeCount", "employees": "employeeCount",
        "annual_revenue": "annualRevenue", "annual revenue": "annualRevenue",
        "company_address": "address", "company address": "address", "address": "address",
        "city": "city", "company_city": "city", "company city": "city",
        "state": "state", "company_state": "state", "company state": "state",
        "website": "website",
        "person_linkedin_url": "linkedinUrl", "person linkedin url": "linkedinUrl",
        "facebook_url": "facebookUrl", "facebook url": "facebookUrl",
      };

      const genericColumnMap: Record<string, string> = {
        ...apolloColumnMap, ...googleMapsColumnMap,
        "business_name": "companyName", "business name": "companyName", "business": "companyName",
        "dba": "dba", "doing_business_as": "dba",
        "owner_first_name": "firstName", "owner_first": "firstName", "contact_first_name": "firstName",
        "owner_last_name": "lastName", "owner_last": "lastName", "contact_last_name": "lastName",
        "owner_email": "ownerEmail", "contact_email": "email",
        "owner_phone": "ownerPhone", "contact_phone": "phone",
        "street": "address", "street_address": "address",
        "zip": "zip", "zipcode": "zip", "zip_code": "zip", "postal": "zip", "postal_code": "zip",
        "vertical": "vertical", "type": "vertical",
        "volume": "monthlyVolume", "estimated_volume": "monthlyVolume", "monthly_volume": "monthlyVolume",
        "processor": "currentProvider", "current_processor": "currentProvider",
        "employee_count": "employeeCount", "year_established": "yearEstablished", "established": "yearEstablished",
        "google_rating": "rating", "google_reviews": "reviewCount",
        "lead_source": "leadSource", "source": "leadSource",
        "notes": "notes", "tags": "tags",
      };

      const columnMap = sourceFormat === "google_maps_outscraper" ? { ...genericColumnMap, ...googleMapsColumnMap }
        : sourceFormat === "apollo_lead_list" ? { ...genericColumnMap, ...apolloColumnMap }
        : genericColumnMap;

      let inserted = 0;
      let duplicatesSkipped = 0;
      let invalidRows = 0;
      let errors = 0;
      const verticalCounts: Record<string, number> = {};
      let hotLeads = 0;
      let warmLeads = 0;
      let coldLeads = 0;
      let dealsCreated = 0;
      const insertedContactIds: number[] = [];

      const batchSize = 100;
      const contactInserts: any[] = [];

      for (const record of records) {
        const mapped: Record<string, string> = {};
        for (const [csvCol, value] of Object.entries(record)) {
          const normCol = csvCol.toLowerCase().trim().replace(/\s+/g, "_");
          const field = columnMap[normCol] || columnMap[csvCol.toLowerCase().trim()];
          if (field && value) mapped[field] = value.trim();
        }

        let companyName = mapped.companyName || "";
        let firstName = mapped.firstName || "";
        let lastName = mapped.lastName || "";
        const email = (mapped.email || "").toLowerCase().trim();
        let phone = normalizePhoneForImport(mapped.phone || "");
        const website = mapped.website || "";

        if (sourceFormat === "google_maps_outscraper" && companyName && !firstName) {
          firstName = companyName;
        }

        if (!companyName && !email && !phone) { invalidRows++; continue; }
        if (!firstName && !companyName) { invalidRows++; continue; }

        let isDuplicate = false;
        if (email && emailSet.has(email)) isDuplicate = true;
        else if (phone && phone.length >= 10 && phoneSet.has(phone)) isDuplicate = true;
        else if (companyName && companySet.has(companyName.toLowerCase())) isDuplicate = true;

        if (isDuplicate) { duplicatesSkipped++; continue; }

        if (email) emailSet.add(email);
        if (phone && phone.length >= 10) phoneSet.add(phone);
        if (companyName) companySet.add(companyName.toLowerCase());

        const industry = mapped.industry || mapped.vertical || "";
        const keywords = mapped.keywords || mapped.keyword || "";
        const vertical = classifyVerticalForImport(industry, "", companyName, keywords);

        verticalCounts[vertical] = (verticalCounts[vertical] || 0) + 1;

        const ratingStr = mapped.rating || "";
        const reviewCount = mapped.reviewCount || "";
        const noteParts = [];
        if (ratingStr) noteParts.push(`Rating: ${ratingStr}`);
        if (reviewCount) noteParts.push(`Reviews: ${reviewCount}`);
        if (mapped.notes) noteParts.push(mapped.notes);

        const tags = ["csv-import", sourceFormat.replace(/_/g, "-")];
        if (mapped.tags) tags.push(...mapped.tags.split(",").map(t => t.trim()).filter(Boolean));

        const rating = parseFloat(ratingStr) || 0;
        const reviews = parseInt(reviewCount) || 0;
        const description = `${mapped.notes || ""} ${mapped.keywords || mapped.keyword || ""} ${companyName}`.toLowerCase();

        if (sourceFormat === "google_maps_outscraper") {
          if (vertical === "Auto" || /auto|repair|mechanic|tire|collision|body shop|transmission|brake/i.test(description)) {
            if (rating >= 4.3) tags.push("quality-high-rating");
            if (reviews >= 20) tags.push("quality-reviews-20+");
            if (/independent|owner/i.test(description)) tags.push("quality-independent");
            if (/service menu|oil change|brake|transmission|engine|diagnostic/i.test(description)) tags.push("quality-service-menu");
            if (/multiple|multi.?bay|2 location|3 location/i.test(description)) tags.push("quality-multi-bay");
            if (/financing|fleet/i.test(description)) tags.push("quality-financing-fleet");
            if (rating >= 4.3 && reviews >= 20) tags.push("priority-outreach");
          }

          if (vertical === "Salon/Spa" || /med.?spa|medspa|aesthetic|botox|filler|laser|body.?contour/i.test(description)) {
            if (/membership|package|monthly/i.test(description)) tags.push("quality-memberships");
            if (/book|booking|appointment|schedule/i.test(description)) tags.push("quality-online-booking");
            if (/instagram|ig\b|@/i.test(description)) tags.push("quality-instagram-active");
            if (reviews >= 50) tags.push("quality-reviews-50+");
            if (/multiple provider|staff|team|np\b|pa\b|physician/i.test(description)) tags.push("quality-multi-provider");
            if (/botox|filler|laser|weight.?loss|body.?sculpt|coolsculpt/i.test(description)) tags.push("quality-aesthetic-services");
            if (reviews >= 50 && /membership|package/i.test(description)) tags.push("priority-outreach");
          }

          if (vertical === "Healthcare" || /dental|dentist|chiro|optom|podiatr|dermat|urgent care|pt\b|physical therapy|behavioral/i.test(description)) {
            if (/private|independent|solo|owner/i.test(description)) tags.push("quality-private-practice");
            if (/multiple provider|staff|team|associate|partner/i.test(description)) tags.push("quality-multi-provider");
            if (/text.?to.?pay|online pay|patient portal|digital/i.test(description)) tags.push("quality-text-to-pay");
            if (reviews >= 30) tags.push("quality-reviews-30+");
            if (/payment plan|financing|care.?credit/i.test(description)) tags.push("quality-payment-plans");
            if (/private.?pay|cash.?pay|self.?pay|cosmetic|elective/i.test(description)) tags.push("quality-private-pay");
            if (reviews >= 30 && /private|independent/i.test(description)) tags.push("priority-outreach");
          }
        }

        contactInserts.push({
          firstName: firstName || companyName || "Unknown",
          lastName: lastName || "",
          email: email || "",
          phone: phone || "",
          companyName: companyName || "",
          title: mapped.title || (sourceFormat === "google_maps_outscraper" ? "Owner" : null),
          address: mapped.address || null,
          city: mapped.city || null,
          state: mapped.state || null,
          website: website || null,
          linkedinUrl: mapped.linkedinUrl || null,
          facebookUrl: mapped.facebookUrl || null,
          industry: industry || null,
          vertical: vertical || null,
          leadSource: mapped.leadSource || sourceFormat,
          employeeCount: mapped.employeeCount ? parseInt(mapped.employeeCount) || null : null,
          annualRevenue: mapped.annualRevenue || null,
          tags,
          notes: noteParts.join("; ") || null,
          status: "New",
          monthlyVolume: mapped.monthlyVolume || null,
          currentProvider: mapped.currentProvider || null,
        });
      }

      for (let i = 0; i < contactInserts.length; i += batchSize) {
        const batch = contactInserts.slice(i, i + batchSize);
        try {
          const result = await db.insert(contacts).values(batch).onConflictDoNothing().returning();
          inserted += result.length;
          for (const r of result) {
            insertedContactIds.push(r.id);
            const { auditChange } = await import("../services/audit-change");
            auditChange({ actorType: "system", action: "contact_created", entityType: "contact", entityId: r.id, before: null, after: r as unknown as Record<string, unknown> }).catch(() => {});
          }

          for (const r of result) {
            try {
              const scoreResult = await scoreContact(r.id);
              if (scoreResult) {
                const tier = (scoreResult as any)?.tier || (scoreResult as any)?.breakdown?.tier;
                if (tier === "hot") {
                  hotLeads++;
                  await storage.createDeal({
                    contactId: r.id,
                    pipeline: "sales",
                    stage: "New Lead",
                    leadSource: sourceFormat,
                    notes: `Auto-created from CSV import: ${fileName}`,
                  });
                  dealsCreated++;
                } else if (tier === "warm") {
                  warmLeads++;
                } else {
                  coldLeads++;
                }
              }
            } catch (scoreErr) {
              coldLeads++;
            }
          }
        } catch (batchErr: any) {
          for (const single of batch) {
            try {
              const [result] = await db.insert(contacts).values(single).onConflictDoNothing().returning();
              if (result) {
                inserted++;
                insertedContactIds.push(result.id);
                const { auditChange } = await import("../services/audit-change");
                auditChange({ actorType: "system", action: "contact_created", entityType: "contact", entityId: result.id, before: null, after: result as unknown as Record<string, unknown> }).catch(() => {});
                try {
                  await scoreContact(result.id);
                } catch {}
              }
            } catch {
              errors++;
            }
          }
        }
      }

      let businessesLinked = 0;
      if (insertedContactIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        const newContacts = await db.select().from(contacts)
          .where(inArray(contacts.id, insertedContactIds));
        for (const rc of newContacts) {
          if (!rc.companyName) continue;
          try {
            const bizResult = await ingestBusiness({
              name: rc.companyName,
              website: rc.website,
              phone: rc.phone,
              email: rc.email,
              address: rc.address,
              city: rc.city,
              state: rc.state,
              vertical: rc.vertical,
              industryPrimary: rc.industry,
              facebookUrl: rc.facebookUrl,
              sourceType: sourceFormat,
              sourceLabel: `csv_import_${importRecord.id}`,
              importBatchId: `csv_${importRecord.id}`,
              contactId: rc.id,
            });
            await db.update(contacts)
              .set({ businessId: bizResult.businessId })
              .where(eq(contacts.id, rc.id));
            const { auditChange } = await import("../services/audit-change");
            auditChange({ actorType: "system", action: "contact_business_linked", entityType: "contact", entityId: rc.id, before: null, after: { businessId: bizResult.businessId } }).catch(() => {});
            businessesLinked++;
          } catch (bizErr) {
            console.warn(`[CSV Import] Business ingest failed for ${rc.companyName}:`, bizErr);
          }
        }
      }

      await storage.updateCsvImport(importRecord.id, {
        newRecords: inserted,
        duplicatesSkipped: duplicatesSkipped,
        errorsCount: errors,
        verticalBreakdown: verticalCounts,
        status: "completed",
        completedAt: new Date(),
        dealsCreated,
        hotLeads,
        warmLeads,
        coldLeads,
      });

      const updatedImport = await storage.getCsvImport(importRecord.id);

      res.status(201).json({
        import: updatedImport,
        inserted,
        duplicatesSkipped,
        invalidRows,
        errors,
        dealsCreated,
        verticalBreakdown: verticalCounts,
        sourceFormat,
      });
    } catch (err: any) {
      console.error("CSV import error:", err);
      try {
        const failedImports = await storage.getCsvImports();
        const processingImport = failedImports.find(i => i.status === "processing");
        if (processingImport) {
          await storage.updateCsvImport(processingImport.id, { status: "failed" });
        }
      } catch {}
      res.status(500).json({ message: err.message || "Import failed" });
    }
  });

}
