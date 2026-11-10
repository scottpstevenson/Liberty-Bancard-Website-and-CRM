#!/usr/bin/env npx tsx
/**
 * test-wd-media-contract.ts
 *
 * W-D media suite (supplied asset pack, imagery registry/builder/budget, Home hero, cards, payment-setup
 * and statement-anatomy blocks, deep-page placements). Static and deterministic: no server, no database,
 * no network, no provider I/O. It reads the committed source, the generated manifest and the generated
 * derivatives, and renders the React and server emitters in-process.
 *
 * What it proves
 *  - provenance: every one of the 13 supplied masters is in the repository, unmodified (sha256 equals the
 *    pack manifest), the generation records are present, every generated registry record carries the
 *    pack asset id, the same sha256, `generated` provenance and `owner-review-pending` approval, and none
 *    is recorded as a licensed photograph or an actual merchant;
 *  - the image budget measures the image the Home hero really renders (a selector that points at an unused
 *    file is rejected), the mobile 720 px WebP is <= 120 KiB, every derivative is <= 260 KiB and exists on
 *    disk with the manifest's byte count;
 *  - Home copy: the literal hero (eyebrow, two-part heading, body, two actions, desktop-only helper
 *    lines), no retired compliance line, five industry cards that point at existing routes with distinct
 *    registered images;
 *  - placements: the hero is the only eager, high-priority image; the five cards, the terminal (only
 *    inside the payment-setup block) and the statement anatomy appear exactly where the contract says;
 *    reserve assets (07-10) are not on Home; deep pages carry their own images with the illustrative note;
 *  - React and server pictures are the same picture: parsed source/img attributes are equal for the
 *    hero, a card and the terminal, and a mismatched `sizes` is detected;
 *  - the terminal keeps real alpha, its flattened JPEG fallback is white, nothing rotates or skews it, and
 *    no new promotional art, alt text or content names a device manufacturer.
 *
 * Every check family has a negative control.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import sharp from "sharp";

import {
  PUBLIC_IMAGE_RECORDS,
  describePicture,
  type PictureArgs,
  type PublicImageId,
} from "../client/src/lib/public-imagery";
import {
  HOME_HERO,
  HOME_HERO_IMAGE,
  HOME_INDUSTRIES_SECTION,
  HOME_PAYMENT_CONTEXTS,
  HOME_SAMPLE_REVIEW,
} from "../shared/public-home-content";
import { HOME_VISUAL_BROWSER_SVG, HOME_VISUAL_PHONE_SVG } from "../shared/public-home-visuals";
import { INDUSTRY_CONTENT, INDUSTRY_HERO_IMAGES, INDUSTRY_HERO_PICTURE } from "../shared/public-industry-content";
import { PUBLIC_INDUSTRIES } from "../shared/public-industries";
import { WHY_LIBERTY_PAGE } from "../shared/public-why-liberty";
import { HERO_MOBILE_BUDGET, PER_FILE_MAX_BYTES, budgetProblems, heroSelectorProblems, type BudgetEntry, type HeroBudgetSelector } from "./lib/public-image-budget";
import { getHomeHtml } from "../server/ssr/home";
import { getIndustryHtml } from "../server/ssr/industries";
import { getOverviewPageHtml } from "../server/ssr/overview-pages";
import { pictureHtml } from "../server/ssr/picture";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sha256 = (rel: string): string => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");

let assertions = 0;
let negativeControls = 0;
const failures: string[] = [];

function ensure(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
function passes(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  assertions++;
  try {
    const result = fn();
    if (result instanceof Promise) return result.catch((err: Error) => void failures.push(`${name}: ${err.message}`));
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
  }
}
function negative(name: string, fn: () => void): void {
  negativeControls++;
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  if (!rejected) failures.push(`negative control not rejected: ${name}`);
}
async function negativeAsync(name: string, fn: () => Promise<void>): Promise<void> {
  negativeControls++;
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  if (!rejected) failures.push(`negative control not rejected: ${name}`);
}

const decode = (s: string): string =>
  s
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// ── Fixtures read once ───────────────────────────────────────────────────────

const PACK_DIR = "docs/media/w-d-asset-pack-2026-11-10";
const MASTER_DIR = "client/src/assets/images/w-d";
interface PackAsset { id: string; master: string; sha256: string }
const pack = JSON.parse(read(`${PACK_DIR}/asset-manifest.json`)) as { assets: PackAsset[] };
interface ManifestFile { format: "avif" | "webp" | "jpg"; file: string; width: number; height: number; bytes: number }
interface ManifestEntry { id: string; source: string; sourceSha256: string; variants: { name: string; width: number; height: number; files: ManifestFile[] }[] }
const manifest = JSON.parse(read("client/src/lib/public-imagery.manifest.json")) as { entries: ManifestEntry[] };
const PUBLIC_DIR = "client/public/images/public";
const homeHtml = getHomeHtml();

// ── Provenance ───────────────────────────────────────────────────────────────

const assertMasters = (assets: readonly PackAsset[], hashOf: (rel: string) => string, exists: (rel: string) => boolean): void => {
  ensure(assets.length === 13, `pack manifest lists ${assets.length} assets, expected 13`);
  for (const asset of assets) {
    const rel = `${MASTER_DIR}/${path.basename(asset.master)}`;
    ensure(exists(rel), `${asset.id}: master ${rel} is not in the repository`);
    ensure(hashOf(rel) === asset.sha256, `${asset.id}: master differs from the supplied original (sha256 mismatch)`);
  }
};
passes("all 13 supplied masters are in the repository, byte-identical to the pack manifest", () =>
  assertMasters(pack.assets, sha256, (rel) => fs.existsSync(path.join(ROOT, rel))),
);
negative("a master that was re-saved or modified", () => assertMasters(pack.assets, (rel) => (rel.includes("02-restaurant") ? "0".repeat(64) : sha256(rel)), () => true));
negative("a master that is missing", () => assertMasters(pack.assets, sha256, (rel) => !rel.includes("13-terminal")));
negative("a pack that lost an asset", () => assertMasters(pack.assets.slice(1), sha256, () => true));

passes("pack provenance records are kept in the repository", () => {
  for (const f of ["asset-manifest.json", "generation-record.json", "quality-receipt.json", "W-D-ASSET-HANDOFF.md"]) {
    ensure(fs.existsSync(path.join(ROOT, PACK_DIR, f)), `${PACK_DIR}/${f} is missing`);
  }
});

const assertRegistryProvenance = (records: Record<string, (typeof PUBLIC_IMAGE_RECORDS)[PublicImageId]>, entries: readonly ManifestEntry[]): void => {
  const generated = Object.values(records).filter((r) => r.provenance === "generated");
  ensure(generated.length === 11, `expected 11 generated records (10 scenes/process + terminal), found ${generated.length}`);
  for (const record of generated) {
    const g = record.generation;
    ensure(!!g, `${record.id}: generated record has no generation block`);
    const asset = pack.assets.find((a) => a.id === g!.assetId);
    ensure(!!asset, `${record.id}: asset ${g!.assetId} is not in the pack manifest`);
    ensure(g!.sha256 === asset!.sha256, `${record.id}: registry sha256 differs from the pack manifest`);
    ensure(g!.approval === "owner-review-pending", `${record.id}: approval is ${g!.approval}`);
    ensure(fs.existsSync(path.join(ROOT, g!.record)), `${record.id}: generation record ${g!.record} is missing`);
    const entry = entries.find((e) => e.id === record.id);
    ensure(!!entry, `${record.id}: not in the derivative manifest`);
    ensure(entry!.sourceSha256 === asset!.sha256, `${record.id}: derivatives were built from a different file than the supplied master`);
    ensure(!/licen[cs]ed|actual merchant|real customer|our (team|staff|customers?)/i.test(`${record.alt} ${record.note}`), `${record.id}: record claims a licence, a real merchant or Liberty staff`);
  }
  for (const record of Object.values(records)) {
    if (record.provenance !== "generated") ensure(!record.generation, `${record.id}: only generated artwork carries a generation block`);
    ensure(record.provenance === "generated" || record.provenance === "unverified", `${record.id}: provenance ${record.provenance} is not an allowed value`);
  }
};
passes("registry: every generated image carries pack id, sha256, owner-review-pending and no licence claim", () =>
  assertRegistryProvenance(PUBLIC_IMAGE_RECORDS, manifest.entries),
);
negative("a generated record marked as a licensed photograph", () =>
  assertRegistryProvenance({ ...PUBLIC_IMAGE_RECORDS, "industry-dental": { ...PUBLIC_IMAGE_RECORDS["industry-dental"], note: "Licensed photograph of an actual merchant." } }, manifest.entries),
);
negative("a generated record whose sha256 differs from the supplied master", () =>
  assertRegistryProvenance(
    { ...PUBLIC_IMAGE_RECORDS, "industry-retail": { ...PUBLIC_IMAGE_RECORDS["industry-retail"], generation: { ...PUBLIC_IMAGE_RECORDS["industry-retail"].generation!, sha256: "f".repeat(64) } } },
    manifest.entries,
  ),
);
negative("a generated record approved without owner review", () =>
  assertRegistryProvenance(
    { ...PUBLIC_IMAGE_RECORDS, "home-hero-merchant": { ...PUBLIC_IMAGE_RECORDS["home-hero-merchant"], generation: { ...PUBLIC_IMAGE_RECORDS["home-hero-merchant"].generation!, approval: "approved" as never } } },
    manifest.entries,
  ),
);
negative("derivatives built from a different file than the master", () =>
  assertRegistryProvenance(PUBLIC_IMAGE_RECORDS, manifest.entries.map((e) => (e.id === "industry-dental" ? { ...e, sourceSha256: "a".repeat(64) } : e))),
);

passes("alt text describes the visible scene without naming people, customers or staff", () => {
  for (const record of Object.values(PUBLIC_IMAGE_RECORDS)) {
    ensure(record.alt.length >= 12 && record.alt.length <= 140, `${record.id}: alt length ${record.alt.length}`);
    ensure(!/^(image|photo|picture|graphic) of\b/i.test(record.alt), `${record.id}: alt starts with a redundant "image of"`);
    if (record.provenance === "generated" && record.id !== "equipment-concept-terminal-upright") {
      ensure(!/liberty|testimonial|founder|scott|our /i.test(record.alt), `${record.id}: alt makes an identity claim`);
    }
  }
});
negative("alt text that identifies the founder", () => {
  ensure(!/liberty|testimonial|founder|scott|our /i.test("Liberty founder Scott at the counter"), "identity claim present");
});

// ── Budget ───────────────────────────────────────────────────────────────────

passes("budget: the shipped manifest meets the hero and per-file limits", () => {
  const problems = budgetProblems(manifest.entries as BudgetEntry[]);
  ensure(problems.length === 0, problems.join("; "));
  ensure(HERO_MOBILE_BUDGET.maxBytes === 120 * 1024 && PER_FILE_MAX_BYTES === 260 * 1024, "budget thresholds were relaxed from 120 KiB / 260 KiB");
  ensure(HERO_MOBILE_BUDGET.width === 720 && HERO_MOBILE_BUDGET.format === "webp", "the hero budget no longer measures the 720 px WebP");
});
passes("budget: the selector measures the image the Home hero renders", () => {
  const problems = heroSelectorProblems(HERO_MOBILE_BUDGET, { id: HOME_HERO_IMAGE.id, mobileVariant: HOME_HERO_IMAGE.mobile.variant });
  ensure(problems.length === 0, problems.join("; "));
  ensure(new RegExp(`/images/public/${HOME_HERO_IMAGE.id}-${HOME_HERO_IMAGE.mobile.variant}-\\d+\\.jpg`).test(homeHtml), "server Home does not render the budgeted hero image");
});
negative("a selector pointed at the retired hero file", () => {
  const stale: HeroBudgetSelector = { ...HERO_MOBILE_BUDGET, id: "hero-terminal-tap" };
  const problems = [...heroSelectorProblems(stale, { id: HOME_HERO_IMAGE.id, mobileVariant: HOME_HERO_IMAGE.mobile.variant }), ...budgetProblems(manifest.entries as BudgetEntry[], stale)];
  ensure(problems.length === 0, problems.join("; "));
});
negative("a selector pointed at a variant the hero does not use", () => {
  const problems = heroSelectorProblems({ ...HERO_MOBILE_BUDGET, variant: "desktop" }, { id: HOME_HERO_IMAGE.id, mobileVariant: HOME_HERO_IMAGE.mobile.variant });
  ensure(problems.length === 0, problems.join("; "));
});
negative("a selector pointed at a width the builder does not produce", () => {
  const problems = budgetProblems(manifest.entries as BudgetEntry[], { ...HERO_MOBILE_BUDGET, width: 721 });
  ensure(problems.length === 0, problems.join("; "));
});
negative("a hero WebP over 120 KiB", () => {
  const fat = (manifest.entries as BudgetEntry[]).map((e) =>
    e.id === HERO_MOBILE_BUDGET.id
      ? { ...e, variants: e.variants.map((v) => (v.name === "mobile" ? { ...v, files: v.files.map((f) => (f.format === "webp" && f.width === 720 ? { ...f, bytes: 121 * 1024 } : f)) } : v)) }
      : e,
  );
  const problems = budgetProblems(fat);
  ensure(problems.length === 0, problems.join("; "));
});
negative("a derivative over 260 KiB", () => {
  const fat = (manifest.entries as BudgetEntry[]).map((e, i) => (i === 3 ? { ...e, variants: e.variants.map((v) => ({ ...v, files: v.files.map((f, j) => (j === 0 ? { ...f, bytes: 300 * 1024 } : f)) })) } : e));
  const problems = budgetProblems(fat);
  ensure(problems.length === 0, problems.join("; "));
});

passes("derivatives exist on disk with the manifest byte counts and none is a raw master", () => {
  let files = 0;
  for (const entry of manifest.entries) {
    for (const variant of entry.variants) {
      ensure(new Set(variant.files.map((f) => f.width)).size >= 2, `${entry.id}/${variant.name} offers fewer than two widths`);
      for (const f of variant.files) {
        const rel = `${PUBLIC_DIR}/${f.file}`;
        ensure(fs.existsSync(path.join(ROOT, rel)), `${f.file} is in the manifest but not on disk`);
        ensure(fs.statSync(path.join(ROOT, rel)).size === f.bytes, `${f.file} byte count differs from the manifest (rebuild the images)`);
        ensure(f.bytes <= PER_FILE_MAX_BYTES, `${f.file} is ${f.bytes} bytes`);
        files++;
      }
    }
  }
  ensure(files > 100, `only ${files} derivatives found`);
  const ids = new Set(manifest.entries.map((e) => e.id));
  for (const retired of ["hero-terminal-tap", "industry-healthcare", "how-statement-review", "industry-home-services"]) {
    ensure(!ids.has(retired), `${retired} is still in the manifest`);
    ensure(!fs.readdirSync(path.join(ROOT, PUBLIC_DIR)).some((f) => f.startsWith(`${retired}-`)), `${retired} derivatives were not removed`);
  }
});
negative("a manifest file missing from disk", () => {
  ensure(fs.existsSync(path.join(ROOT, PUBLIC_DIR, "home-hero-merchant-mobile-721.webp")), "missing");
});

// ── Home copy and cards ──────────────────────────────────────────────────────

const homeText = (html: string): string => decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

const assertHomeHero = (html: string): void => {
  const text = homeText(html);
  ensure(HOME_HERO.eyebrow === "PAYMENTS FOR YOUR BUSINESS", "eyebrow changed");
  ensure(HOME_HERO.heading === "Know what you\u2019re paying. See your options.", "heading changed");
  ensure(HOME_HERO.body === "Understand your processing costs, compare payment options, and get personal guidance for your business.", "hero body changed");
  ensure(HOME_HERO.primary.label === "Get a free statement review" && HOME_HERO.primary.href === "/upload-statement#statement-review-form", "primary action changed");
  ensure(HOME_HERO.secondary.label === "Find the right payment setup" && HOME_HERO.secondary.href === "/about-contact#inquiry", "secondary action changed");
  ensure(HOME_HERO.desktopHelper === "Free review. No obligation to switch.", "desktop helper changed");
  ensure(HOME_HERO.desktopQualification === "Pricing, equipment and eligibility are confirmed during review.", "desktop qualification changed");
  for (const piece of [HOME_HERO.eyebrow, HOME_HERO.headingFirst, HOME_HERO.headingSecond, HOME_HERO.body, HOME_HERO.primary.label, HOME_HERO.secondary.label, HOME_HERO.desktopHelper, HOME_HERO.desktopQualification]) {
    ensure(text.includes(piece), `Home HTML does not show "${piece}"`);
  }
  ensure(html.includes(`href="${HOME_HERO.primary.href}"`) && html.includes(`href="${HOME_HERO.secondary.href}"`), "Home hero actions do not link to the contract destinations");
  ensure(!("compliance" in HOME_HERO), "retired hero compliance line is back");
  for (const helper of [HOME_HERO.desktopHelper, HOME_HERO.desktopQualification]) {
    const tag = html.match(new RegExp(`<p class="([^"]*)">${helper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p>`));
    ensure(!!tag && /ssr-md-only/.test(tag[1]), `helper "${helper}" is not desktop-only in the server document`);
  }
  ensure(html.match(/<h1\b/g)?.length === 1, "Home does not have exactly one h1");
  const hero = html.slice(html.indexOf('data-home-section="hero"'), html.indexOf('data-home-section="solutions"'));
  ensure(!/No savings claims without statement review|Eligibility, underwriting/i.test(hero), "the retired compliance line is back in the hero");
};
passes("Home hero carries the contract copy, actions and desktop-only helper lines", () => assertHomeHero(homeHtml));
negative("Home hero without the qualification line", () => assertHomeHero(homeHtml.replace(HOME_HERO.desktopQualification, "")));
negative("Home hero with a helper line shown on phones", () => assertHomeHero(homeHtml.replace(/ssr-hero-helper ssr-md-only/, "ssr-hero-helper")));
negative("Home hero with the old compliance line restored", () =>
  assertHomeHero(homeHtml.replace("</section>", "<p>No savings claims without statement review.</p></section>")),
);

const assertIndustryCards = (entries: readonly { slug: string; image: string; title: string; bestFor?: string }[]): void => {
  ensure(entries.length === 5, `Home shows ${entries.length} industry cards, expected 5`);
  ensure(entries.map((e) => e.title).join("|") === "Restaurant|Dental|Med spa|Automotive|Retail", "card order or labels changed");
  const slugs = new Set(PUBLIC_INDUSTRIES.map((i) => i.slug));
  ensure(new Set(entries.map((e) => e.image)).size === 5, "two cards share an image");
  for (const e of entries) {
    ensure(slugs.has(e.slug), `${e.slug} is not an existing industry route`);
    ensure(INDUSTRY_CONTENT.some((c) => c.slug === e.slug), `${e.slug} has no industry page template`);
    ensure(e.image in PUBLIC_IMAGE_RECORDS, `${e.image} is not a registered image`);
    ensure(INDUSTRY_HERO_IMAGES[e.slug] === e.image, `${e.slug}: the card image and the page image differ`);
  }
};
passes("Home has five image cards that point at existing industry routes with distinct registered images", () =>
  assertIndustryCards(HOME_INDUSTRIES_SECTION.entries),
);
negative("a card pointing at an invented /home-services route", () =>
  assertIndustryCards(HOME_INDUSTRIES_SECTION.entries.map((e, i) => (i === 4 ? { ...e, slug: "home-services-payment-processing" } : e))),
);
negative("two cards sharing one photograph", () =>
  assertIndustryCards(HOME_INDUSTRIES_SECTION.entries.map((e, i) => (i === 1 ? { ...e, image: "industry-restaurant" } : e))),
);
negative("a sixth card", () => assertIndustryCards([...HOME_INDUSTRIES_SECTION.entries, { slug: "legal-payment-processing", image: "industry-retail", title: "Legal", bestFor: "" }]));
negative("a card with an unregistered image", () => assertIndustryCards(HOME_INDUSTRIES_SECTION.entries.map((e, i) => (i === 0 ? { ...e, image: "industry-restaurant-v2" } : e))));

// ── Placements ───────────────────────────────────────────────────────────────

interface Tag { tag: string; attrs: [string, string][] }
const parsePicture = (html: string): Tag[] =>
  [...html.matchAll(/<(picture|source|img)\b([^>]*)>/g)].map((m) => ({
    tag: m[1],
    attrs: [...m[2].matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)]
      .filter((a) => a[1] !== "class" && a[1] !== "data-testid")
      .map((a): [string, string] => [a[1].toLowerCase(), decode(a[2])]),
  }));
const imgTags = (html: string): string[] => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]).filter((t) => /src="\/images\/public\//.test(t));
const idOf = (tag: string): string => (tag.match(/src="\/images\/public\/(.+?)-(?:card|mobile|desktop|product|wide)-\d+\.jpg"/) ?? [])[1] ?? "";

const assertHomePlacements = (html: string): void => {
  const imgs = imgTags(html);
  const ids = imgs.map(idOf);
  ensure(imgs.length === 7, `Home shows ${imgs.length} images, expected hero + 5 cards + terminal`);
  ensure(ids[0] === "home-hero-merchant", "the first image is not the hero");
  const cards = HOME_INDUSTRIES_SECTION.entries.map((e) => e.image);
  for (const id of cards) ensure(ids.filter((x) => x === id).length === 1, `${id} does not appear exactly once`);
  ensure(ids.filter((x) => x === "equipment-concept-terminal-upright").length === 1, "the terminal concept (asset 13) does not appear exactly once");
  ensure(imgs.filter((t) => /loading="eager"/.test(t)).length === 1 && /loading="eager"/.test(imgs[0]), "the hero is not the only eager image");
  ensure(imgs.filter((t) => /fetchpriority="high"/.test(t)).length === 1 && /fetchpriority="high"/.test(imgs[0]), "the hero is not the only high-priority image");
  for (const t of imgs.slice(1)) ensure(/loading="lazy"/.test(t), `${idOf(t)} is not lazy-loaded`);
  for (const t of imgs) ensure(/width="\d+" height="\d+"/.test(t), `${idOf(t)} has no intrinsic dimensions`);
  const contexts = html.slice(html.indexOf('class="ssr-contexts"'), html.indexOf('data-home-section="industries"'));
  ensure(imgTags(contexts).map(idOf).join() === "equipment-concept-terminal-upright", "the terminal appears outside the payment-setup block");
  ensure(!/<img[^>]*equipment-concept-terminal/.test(html.slice(0, html.indexOf('class="ssr-contexts"'))), "the terminal appears before the payment-setup block");
  // Reserve assets stay off Home.
  for (const id of ["industry-field-services", "industry-ecommerce", "industry-professional-services", "process-review-hands", "industry-healthcare", "hero-terminal-tap"]) {
    ensure(!html.includes(`/images/public/${id}-`), `${id} is on Home but belongs elsewhere or is retired`);
  }
  // Asset 12: three live-text contexts with one terminal; asset 11: live-text statement anatomy.
  const text = homeText(html);
  for (const c of HOME_PAYMENT_CONTEXTS.contexts) ensure(text.includes(c.title) && text.includes(c.body), `payment context ${c.id} is missing live text`);
  ensure(text.includes(HOME_PAYMENT_CONTEXTS.caption), "payment contexts caption missing");
  ensure(html.includes("<svg") && html.includes(HOME_VISUAL_PHONE_SVG) && html.includes(HOME_VISUAL_BROWSER_SVG), "mobile/online visuals are not the shared static SVGs");
  for (const row of HOME_SAMPLE_REVIEW.rows) ensure(text.includes(row.label) && text.includes(row.heading) && text.includes(row.note), `statement anatomy row ${row.label} is missing`);
  ensure(text.includes(HOME_SAMPLE_REVIEW.stamp) && text.includes(HOME_SAMPLE_REVIEW.label) && text.includes(HOME_SAMPLE_REVIEW.documentNote), "statement anatomy is not labelled illustrative");
  ensure(text.includes(HOME_INDUSTRIES_SECTION.illustrativeNote), "the photos-are-illustrative note is missing from the industry cards");
  ensure(!/<img[^>]*(\.svg|11-statement|12-payment)/.test(html), "a raw SVG master is embedded as an image");
};
passes("Home places the hero, five cards, payment contexts (with the terminal) and statement anatomy exactly once each", () => assertHomePlacements(homeHtml));
negative("a second eager image on Home", () => assertHomePlacements(homeHtml.replace(/loading="lazy"/, 'loading="eager"')));
negative("a second high-priority image on Home", () => assertHomePlacements(homeHtml.replace(/loading="lazy"/, 'fetchpriority="high" loading="lazy"')));
negative("the terminal outside the payment-setup block", () =>
  assertHomePlacements(homeHtml.replace('<div class="ssr-frame">', `<div class="ssr-frame"><img src="/images/public/equipment-concept-terminal-upright-product-440.jpg" srcset="" sizes="80px" width="440" height="660" alt="" loading="lazy" decoding="async">`)),
);
negative("a reserve photograph on Home", () =>
  assertHomePlacements(homeHtml.replace("</main>", `<img src="/images/public/industry-ecommerce-card-480.jpg" width="480" height="360" alt="" loading="lazy"></main>`).replace("</body>", `<img src="/images/public/industry-ecommerce-card-480.jpg" width="480" height="360" alt="" loading="lazy"></body>`)),
);
negative("an image without intrinsic dimensions", () => assertHomePlacements(homeHtml.replace(/(<img src="\/images\/public\/[^>]*?) width="\d+" height="\d+"/, "$1")));
negative("payment contexts without live text", () => assertHomePlacements(homeHtml.split(HOME_PAYMENT_CONTEXTS.contexts[1].body).join("")));

passes("hero art direction: phones get the mobile crop, from 1024px the desktop crop; both are preloadable", () => {
  const hero = describePicture({ id: HOME_HERO_IMAGE.id, variant: HOME_HERO_IMAGE.mobile.variant, sizes: HOME_HERO_IMAGE.mobile.sizes, artDirection: [HOME_HERO_IMAGE.desktop], priority: true });
  ensure(hero.sources[0].media === "(min-width: 1024px)" && /desktop/.test(hero.sources[0].srcSet), "desktop art-direction source is not first");
  ensure(hero.sources.some((s) => !s.media && s.type === "image/avif") && hero.sources.some((s) => !s.media && s.type === "image/webp"), "mobile AVIF/WebP sources missing");
  ensure(/mobile/.test(hero.img.srcSet) && hero.img.loading === "eager" && hero.img.fetchPriority === "high", "the img fallback is not the eager mobile JPEG");
  ensure(/-720\.webp 720w/.test(hero.sources.find((s) => !s.media && s.type === "image/webp")!.srcSet), "the 720 px WebP is not offered to phones");
});
negative("a lazy image carrying fetchpriority", () => {
  const lazy = describePicture({ id: "industry-retail", variant: "card", sizes: "96px" });
  ensure(lazy.img.loading === "eager" || !!lazy.img.fetchPriority, "lazy image is correctly lazy");
});

// ── React and server render the same picture ─────────────────────────────────

(globalThis as unknown as { React: typeof React }).React = React;
const { PublicImage } = await import("../client/src/components/public/PublicImage");
const { HomeIndustries } = await import("../client/src/components/home/HomeIndustries");
const { HomeSolutions } = await import("../client/src/components/home/HomeSolutions");
const { HomeHero } = await import("../client/src/components/home/HomeHero");
const { SampleReviewCard } = await import("../client/src/components/home/SampleReviewCard");
const renderInRouter = (element: React.ReactElement): string => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/", children: element }));

const assertSamePicture = (a: string, b: string): void => {
  const left = JSON.stringify(parsePicture(a));
  const right = JSON.stringify(parsePicture(b));
  ensure(left === right, `React and server pictures differ:\n  react:  ${left.slice(0, 300)}\n  server: ${right.slice(0, 300)}`);
};
const PARITY_CASES: { name: string; args: PictureArgs }[] = [
  { name: "hero", args: { id: HOME_HERO_IMAGE.id, variant: HOME_HERO_IMAGE.mobile.variant, sizes: HOME_HERO_IMAGE.mobile.sizes, artDirection: [HOME_HERO_IMAGE.desktop], priority: true } },
  { name: "industry card", args: { id: "industry-dental", variant: HOME_INDUSTRIES_SECTION.cardImage.variant, sizes: HOME_INDUSTRIES_SECTION.cardImage.sizes } },
  { name: "terminal", args: { id: HOME_PAYMENT_CONTEXTS.terminalImage.id, variant: HOME_PAYMENT_CONTEXTS.terminalImage.variant, sizes: HOME_PAYMENT_CONTEXTS.terminalImage.sizes } },
  { name: "process inset", args: { id: "process-review-hands", variant: "wide", sizes: "(min-width: 1024px) 440px, calc(100vw - 32px)" } },
];
for (const c of PARITY_CASES) {
  passes(`React and server render the same ${c.name} picture`, () => assertSamePicture(renderToStaticMarkup(React.createElement(PublicImage, c.args)), pictureHtml(c.args)));
}
negative("a server picture with a different sizes attribute", () =>
  assertSamePicture(renderToStaticMarkup(React.createElement(PublicImage, PARITY_CASES[1].args)), pictureHtml({ ...PARITY_CASES[1].args, sizes: "100vw" })),
);
negative("a server hero that lost its priority", () =>
  assertSamePicture(renderToStaticMarkup(React.createElement(PublicImage, PARITY_CASES[0].args)), pictureHtml({ ...PARITY_CASES[0].args, priority: false })),
);
negative("a server card with a different alt text", () =>
  assertSamePicture(renderToStaticMarkup(React.createElement(PublicImage, PARITY_CASES[1].args)), pictureHtml({ ...PARITY_CASES[1].args, alt: "Dentist" })),
);

passes("hydrated Home renders the same eight placements as the server document", () => {
  const hero = renderInRouter(React.createElement(HomeHero));
  const industries = renderInRouter(React.createElement(HomeIndustries));
  const solutions = renderInRouter(React.createElement(HomeSolutions));
  const review = renderInRouter(React.createElement(SampleReviewCard));
  ensure(imgTags(hero).length === 1 && /loading="eager"/.test(imgTags(hero)[0]) && /fetchpriority="high"/i.test(imgTags(hero)[0]), "React hero is not the single eager, high-priority image");
  ensure(idOf(imgTags(hero)[0]) === HOME_HERO_IMAGE.id, "React hero renders a different image than the budget selector measures");
  ensure(imgTags(industries).map(idOf).join() === HOME_INDUSTRIES_SECTION.entries.map((e) => e.image).join(), "React industry cards differ from the contract order");
  ensure(imgTags(industries).every((t) => /loading="lazy"/.test(t)), "a React card is not lazy");
  ensure(imgTags(solutions).map(idOf).join() === "equipment-concept-terminal-upright", "React solutions block does not show exactly the terminal concept");
  ensure(imgTags(review).length === 0, "the statement anatomy embeds an image instead of live text");
  const reviewText = homeText(review);
  for (const row of HOME_SAMPLE_REVIEW.rows) ensure(reviewText.includes(row.label) && reviewText.includes(row.heading) && reviewText.includes(row.note), `React statement row ${row.label} missing`);
  ensure(solutions.includes(HOME_VISUAL_PHONE_SVG) && solutions.includes(HOME_VISUAL_BROWSER_SVG), "React Mobile/Online visuals differ from the shared SVGs");
  ensure(/md:block/.test(hero) && hero.includes(HOME_HERO.desktopHelper) && hero.includes(HOME_HERO.desktopQualification), "React helper lines are not desktop-only");
  ensure(hero.match(/<h1\b/g)?.length === 1, "React hero does not have exactly one h1");
});
negative("a hydrated Home whose statement anatomy embeds an image", () => {
  const review = renderInRouter(React.createElement(SampleReviewCard)) + `<img src="/images/public/process-review-hands-wide-480.jpg" width="480" height="320" alt="">`;
  ensure(imgTags(review).length === 0, "embeds an image");
});

// ── Deep pages ───────────────────────────────────────────────────────────────

const assertIndustryPage = (slug: string, html: string): void => {
  const expected = INDUSTRY_HERO_IMAGES[slug];
  const imgs = imgTags(html);
  if (!expected) {
    ensure(imgs.length === 0, `${slug} shows an image although none fits it`);
    return;
  }
  ensure(imgs.length === 1 && idOf(imgs[0]) === expected, `${slug} does not show exactly ${expected}`);
  ensure(/loading="eager"/.test(imgs[0]), `${slug}: the hero image is not the page's eager image`);
  ensure(html.includes(INDUSTRY_HERO_PICTURE.caption), `${slug}: the illustrative caption is missing`);
  ensure(INDUSTRY_HERO_PICTURE.caption === "Illustrative photo. It does not show a Liberty customer.", "caption wording changed");
};
passes("every industry page shows its own illustrative image, or none where none fits", () => {
  for (const industry of INDUSTRY_CONTENT) assertIndustryPage(industry.slug, getIndustryHtml(industry.slug)!);
  const pictured = INDUSTRY_CONTENT.filter((i) => INDUSTRY_HERO_IMAGES[i.slug]).map((i) => i.slug);
  ensure(pictured.length === 8, `${pictured.length} industry pages carry an image, expected 8`);
  for (const [slug, id] of Object.entries(INDUSTRY_HERO_IMAGES)) {
    ensure(INDUSTRY_CONTENT.some((c) => c.slug === slug), `${slug} is not an industry page`);
    ensure(id in PUBLIC_IMAGE_RECORDS, `${slug} names unregistered image ${id}`);
  }
  ensure(!getIndustryHtml("healthcare-payment-processing")!.includes("/images/public/"), "healthcare shows a retired or ill-fitting image");
});
negative("an industry page showing another industry's image", () =>
  assertIndustryPage("dental-payment-processing", getIndustryHtml("dental-payment-processing")!.replace(/industry-dental-/g, "industry-retail-")),
);
negative("an industry page that lost its illustrative caption", () =>
  assertIndustryPage("restaurant-payment-processing", getIndustryHtml("restaurant-payment-processing")!.replace(INDUSTRY_HERO_PICTURE.caption, "")),
);
negative("an image forced onto a page it does not fit", () =>
  assertIndustryPage("legal-payment-processing", getIndustryHtml("legal-payment-processing")!.replace("</main>", `<img src="/images/public/industry-professional-services-card-480.jpg" width="480" height="360" alt="">`) + `<img src="/images/public/industry-professional-services-card-480.jpg" width="480" height="360" alt="">`),
);

passes("Why Liberty carries the review-process image once, lazy, captioned as illustrative", () => {
  const html = getOverviewPageHtml(WHY_LIBERTY_PAGE);
  const imgs = imgTags(html);
  ensure(imgs.length === 1 && idOf(imgs[0]) === "process-review-hands", "Why Liberty does not show exactly the review-process image once");
  ensure(/loading="lazy"/.test(imgs[0]) && !/fetchpriority/.test(imgs[0]), "the process image is not lazy");
  const media = WHY_LIBERTY_PAGE.sections.find((s) => s.media)?.media;
  ensure(!!media && /does not show Liberty staff or a customer/.test(media.caption) && html.includes(media.caption), "the process image caption does not say it is not Liberty staff or a customer");
  ensure(html.indexOf("review-process") < html.indexOf("process-review-hands"), "the image is not inside the process section");
});
negative("a process image without its caption", () => {
  const html = getOverviewPageHtml(WHY_LIBERTY_PAGE);
  const media = WHY_LIBERTY_PAGE.sections.find((s) => s.media)!.media!;
  ensure(html.replace(media.caption, "").includes(media.caption), "caption removed");
});

passes("deep pages respect the contract: hero asset on Home only, no new image on the upload form, no invented routes", () => {
  for (const file of ["client/src/pages/UploadStatement.tsx", "client/src/pages/FreeStatementReview.tsx"]) {
    if (fs.existsSync(path.join(ROOT, file))) ensure(!/PublicImage|home-hero-merchant/.test(read(file)), `${file} carries a W-D image and could delay the mobile form`);
  }
  const heroUses = [...[...fs.readdirSync(path.join(ROOT, "client/src"), { recursive: true }) as string[]]
    .filter((f) => /\.(tsx|ts)$/.test(f))
    .map((f) => path.join("client/src", f))
    .filter((f) => read(f).includes("home-hero-merchant"))];
  ensure(heroUses.every((f) => /public-imagery|HomeHero|home-content/.test(f) || /home-hero-merchant/.test(read(f))), "unexpected hero use");
  ensure(!fs.readdirSync(path.join(ROOT, "client/src/pages")).some((f) => /HomeServices/i.test(f)), "a /home-services page was created");
});

// ── Terminal: alpha, orientation, no manufacturer art ────────────────────────

const assertTerminalOrientation = (sources: readonly string[]): void => {
  for (const source of sources) {
    ensure(!/rotate|skew|-rotate-|matrix\(|perspective\(/i.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")), "terminal markup rotates, skews or tilts the device");
  }
};
passes("the terminal is never rotated, skewed or overlaid", () => {
  const css = read("server/ssrShared.ts");
  const terminalCss = css.slice(css.indexOf(".ssr-ctx-term"), css.indexOf(".ssr-ctx-term") + 200);
  assertTerminalOrientation([read("client/src/components/home/HomePaymentContexts.tsx"), terminalCss]);
  ensure(!/liberty-terminal-tap|terminal-tilt/.test(read("client/src/components/home/HomePaymentContexts.tsx") + homeHtml), "the earlier diagonal device is back");
});
negative("a rotated terminal", () => assertTerminalOrientation([`<div class="-rotate-12"><PublicImage id="equipment-concept-terminal-upright" /></div>`]));
negative("a skewed terminal in CSS", () => assertTerminalOrientation([".ssr-ctx-term { transform: skewY(-6deg); }"]));

await passes("terminal derivatives keep real alpha and a white flattened fallback", async () => {
  const entry = manifest.entries.find((e) => e.id === "equipment-concept-terminal-upright");
  ensure(!!entry, "terminal is not in the manifest");
  const variant = entry!.variants.find((v) => v.name === "product")!;
  const corner = async (file: string): Promise<[number, number, number, number]> => {
    const { data, info } = await sharp(path.join(ROOT, PUBLIC_DIR, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2], data[3]].map((v) => v) as [number, number, number, number];
  };
  for (const format of ["avif", "webp"] as const) {
    for (const f of variant.files.filter((x) => x.format === format)) {
      const meta = await sharp(path.join(ROOT, PUBLIC_DIR, f.file)).metadata();
      ensure(meta.hasAlpha === true, `${f.file} lost its alpha channel`);
      const [, , , alpha] = await corner(f.file);
      ensure(alpha === 0, `${f.file} corner is not transparent (alpha ${alpha}); a halo would show on navy`);
    }
  }
  for (const f of variant.files.filter((x) => x.format === "jpg")) {
    const [r, g, b] = await corner(f.file);
    ensure(r >= 250 && g >= 250 && b >= 250, `${f.file} fallback is not flattened to white (${r},${g},${b})`);
  }
  const master = fs.readFileSync(path.join(ROOT, MASTER_DIR, "13-terminal-upright.png"));
  ensure([4, 6].includes(master[25]), "the terminal master has no alpha channel");
  ensure(variant.height > variant.width, "the terminal crop is not upright");
});
await negativeAsync("a terminal fallback flattened onto black", async () => {
  const flat = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).jpeg().toBuffer();
  const { data } = await sharp(flat).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  ensure(data[0] >= 250, "not white");
});

const assertNoManufacturerArt = (strings: readonly string[]): void => {
  for (const s of strings) ensure(!/dejavoo/i.test(s), "new promotional art or its text names Dejavoo");
};
passes("no new promotional art, alt text or Home content shows a manufacturer name", () => {
  const generated = Object.values(PUBLIC_IMAGE_RECORDS).filter((r) => r.provenance === "generated");
  assertNoManufacturerArt([...generated.map((r) => `${r.alt} ${r.note} ${r.label ?? ""}`), JSON.stringify(HOME_PAYMENT_CONTEXTS), JSON.stringify(HOME_SAMPLE_REVIEW), HOME_VISUAL_PHONE_SVG, HOME_VISUAL_BROWSER_SVG, homeText(homeHtml)]);
});
negative("alt text naming a manufacturer on new art", () => assertNoManufacturerArt(["Dejavoo terminal on the counter"]));

passes("SVG illustrations are static, text-free and script-free", () => {
  for (const svg of [HOME_VISUAL_PHONE_SVG, HOME_VISUAL_BROWSER_SVG]) {
    ensure(!/<script|on\w+=|href=|xlink:|<text|<image|<foreignObject/i.test(svg), "an SVG carries script, a link, text or an embedded image");
    ensure(/aria-hidden="true"/.test(svg) && /viewBox="0 0 96 144"/.test(svg), "an SVG is not decorative with a fixed viewBox");
  }
});
negative("an SVG with an external link", () => {
  ensure(!/href=/.test(`<svg><a href="https://example.com"></a></svg>`), "link present");
});

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`W-D media contract: ${assertions} assertions, ${negativeControls} negative controls, ${failures.length} failure(s)`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log("PASS");
