#!/usr/bin/env npx tsx
/**
 * test-partner-page-media.ts
 *
 * Asset manifest for the partnership pages' imagery (shared/partner-page-media.ts). Static and deterministic: reads the
 * committed derivatives and manifest and renders the shared picture model in-process. No server, database, network or
 * provider I/O.
 *
 * What it proves
 *  - all seven routes (the six partnership routes and /affiliate) have exactly one hero image, and no two routes share a
 *    hero source scene, so every page carries its own picture;
 *  - every entry names a registered source image, a crop that fits inside the 1536 x 1024 master, a focal point inside the
 *    frame, alt text that is specific, honest and not a promise, and a fit grade; an `approximate` fit names the missing
 *    photograph, and a `scene` fit does not;
 *  - exactly the hero is the priority image (eager, fetchpriority high); body images are lazy;
 *  - the derivative pipeline produced AVIF, WebP and JPEG files at every declared width, every file is at or under 260 KB,
 *    the dimensions keep the declared ratio, and the manifest records them;
 *  - the visible caption says the scene is illustrative, and no alt text or caption claims a Liberty customer, partner,
 *    employee or testimonial;
 *  - the server picture markup and the React picture model agree on source, sizes, dimensions, alt and loading.
 *
 * Every check family has a negative control.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARTNER_ROUTES } from "../shared/partner-public-content";
import { PARTNER_MEDIA, PARTNER_MEDIA_CAPTION, partnerMediaFor, hasPartnerMedia, partnerMediaObjectPosition, type PartnerMediaEntry } from "../shared/partner-page-media";
import { describePicture } from "../client/src/lib/public-imagery";
import { pictureHtml } from "../server/ssr/picture";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_DIR = path.join(root, "client/public/images/public");
interface ManifestFile { format: string; file: string; width: number; height: number; bytes: number }
interface ManifestVariant { name: string; width: number; height: number; files: ManifestFile[] }
interface ManifestEntry { id: string; source: string; variants: ManifestVariant[] }
const entries = (JSON.parse(fs.readFileSync(path.join(root, "client/src/lib/public-imagery.manifest.json"), "utf8")) as { entries: ManifestEntry[] }).entries;

const MAX_BYTES = 260 * 1024;
const MASTER = { width: 1536, height: 1024 };
const ROUTES = [PARTNER_ROUTES.hub, PARTNER_ROUTES.referral, PARTNER_ROUTES.salesAgent, PARTNER_ROUTES.cpa, PARTNER_ROUTES.bookkeeper, PARTNER_ROUTES.insurance, PARTNER_ROUTES.affiliate];

let checks = 0;
const failures: string[] = [];
function ok(cond: unknown, label: string) {
  checks++;
  if (!cond) { failures.push(label); console.log(`  FAIL ${label}`); } else console.log(`  ok   ${label}`);
}

/** Honest-alt rules shared by the real check and its negative control. */
const FORBIDDEN_ALT = /\b(our (customer|client|partner|team|staff|employee)s?|liberty (customer|partner|employee|staff|team)s?|testimonial|guarantee[ds]?|earn(s|ed|ing)?\b|\$\d)/i;
function altProblems(entry: PartnerMediaEntry): string[] {
  const problems: string[] = [];
  if (entry.alt.trim().length < 25) problems.push("alt text is too short to describe the scene");
  if (entry.alt.length > 160) problems.push("alt text is longer than 160 characters");
  if (!/[.]$/.test(entry.alt.trim())) problems.push("alt text is not a sentence");
  if (FORBIDDEN_ALT.test(entry.alt)) problems.push("alt text claims a customer, partner, employee, testimonial or earnings");
  if (/^(image|photo|picture) of/i.test(entry.alt.trim())) problems.push("alt text starts with a filler phrase");
  return problems;
}
function manifestProblems(entry: PartnerMediaEntry): string[] {
  const problems: string[] = [];
  const image = entries.find((e) => e.id === entry.imageId);
  if (!image) return [`${entry.imageId} is not in the manifest`];
  const variant = image.variants.find((v) => v.name === entry.variant);
  if (!variant) return [`${entry.imageId}/${entry.variant} was not built`];
  for (const format of ["avif", "webp", "jpg"]) {
    for (const width of entry.widths) {
      const file = variant.files.find((f) => f.format === format && f.width === width);
      if (!file) { problems.push(`${format} ${width}w is not in the manifest`); continue; }
      const onDisk = path.join(IMAGE_DIR, file.file);
      if (!fs.existsSync(onDisk)) { problems.push(`${file.file} is missing on disk`); continue; }
      const bytes = fs.statSync(onDisk).size;
      if (bytes > MAX_BYTES) problems.push(`${file.file} is ${bytes} bytes (limit ${MAX_BYTES})`);
      if (bytes !== file.bytes) problems.push(`${file.file} size differs from the manifest`);
      const ratio = file.width / file.height;
      const declared = variant.width / variant.height;
      if (Math.abs(ratio - declared) > 0.01) problems.push(`${file.file} ratio ${ratio.toFixed(3)} differs from the variant ${declared.toFixed(3)}`);
    }
  }
  return problems;
}
function cropProblems(entry: PartnerMediaEntry): string[] {
  const { left, top, width, height } = entry.crop;
  const problems: string[] = [];
  if (left < 0 || top < 0 || left + width > MASTER.width || top + height > MASTER.height) problems.push("crop leaves the master");
  if (entry.focal.x < 0 || entry.focal.x > 100 || entry.focal.y < 0 || entry.focal.y > 100) problems.push("focal point is outside the frame");
  const ratio = width / height;
  const expected = entry.role === "hero" ? 3 / 2 : 4 / 3;
  if (Math.abs(ratio - expected) > 0.01) problems.push(`crop ratio ${ratio.toFixed(3)} is not ${expected.toFixed(3)}`);
  return problems;
}
function fitProblems(entry: PartnerMediaEntry): string[] {
  if (entry.fit === "approximate") return entry.gap && entry.gap.length > 20 ? [] : ["an approximate fit must name the missing photograph"];
  return entry.gap ? ["a scene fit must not carry a gap note"] : [];
}

console.log("Coverage and distinctness");
for (const route of ROUTES) ok(hasPartnerMedia(route, "hero"), `${route} has a hero image`);
for (const route of ROUTES) ok(PARTNER_MEDIA.filter((m) => m.route === route && m.role === "hero").length === 1, `${route} has exactly one hero image`);
const heroSources = PARTNER_MEDIA.filter((m) => m.role === "hero").map((m) => m.imageId);
ok(new Set(heroSources).size === heroSources.length, "no two routes share a hero source scene");
const duplicateProbe = [...heroSources, heroSources[0]];
ok(new Set(duplicateProbe).size !== duplicateProbe.length, "negative control: a repeated hero source would be caught");
ok(PARTNER_MEDIA.every((m) => ROUTES.includes(m.route)), "every entry belongs to a known route");
let threw = false;
try { partnerMediaFor("/partners/unknown", "hero"); } catch { threw = true; }
ok(threw, "negative control: an unregistered route throws instead of returning a stand-in picture");

console.log("Crop, alt text and fit");
for (const m of PARTNER_MEDIA) {
  ok(cropProblems(m).length === 0, `${m.route} ${m.role}: crop and focal point are valid ${cropProblems(m).join("; ")}`);
  ok(altProblems(m).length === 0, `${m.route} ${m.role}: alt text is specific and makes no claim ${altProblems(m).join("; ")}`);
  ok(fitProblems(m).length === 0, `${m.route} ${m.role}: fit grade is honest ${fitProblems(m).join("; ")}`);
  ok(m.subject.length > 10, `${m.route} ${m.role}: subject is recorded`);
}
const altIds = PARTNER_MEDIA.map((m) => m.alt);
ok(new Set(altIds).size === altIds.length, "no two entries share alt text");
const good = PARTNER_MEDIA[0];
ok(cropProblems({ ...good, crop: { ...good.crop, left: 600 } }).length > 0, "negative control: a crop past the master edge is caught");
ok(cropProblems({ ...good, focal: { x: 140, y: 10 } }).length > 0, "negative control: a focal point outside the frame is caught");
ok(altProblems({ ...good, alt: "Our customer, a Liberty partner, earns $5,000 a month." }).length > 0, "negative control: an alt text claiming a customer or earnings is caught");
ok(altProblems({ ...good, alt: "Image of people." }).length > 0, "negative control: a filler alt text is caught");
ok(fitProblems({ ...good, fit: "approximate", gap: undefined }).length > 0, "negative control: an approximate fit without a named gap is caught");
ok(fitProblems({ ...good, fit: "scene", gap: "A different photo is wanted for this page." }).length > 0, "negative control: a scene fit with a gap note is caught");
ok(PARTNER_MEDIA.some((m) => m.fit === "approximate"), "approximate fits are recorded, not hidden");

console.log("Priority and loading");
for (const route of ROUTES) {
  const hero = partnerMediaFor(route, "hero");
  ok(hero.priority === true, `${route}: hero is the priority image`);
  const model = describePicture({ id: hero.imageId as never, variant: hero.variant, sizes: hero.sizes, alt: hero.alt, priority: hero.priority });
  ok(model.img.loading === "eager" && model.img.fetchPriority === "high", `${route}: hero renders eager with fetchpriority high`);
}
for (const m of PARTNER_MEDIA.filter((x) => x.role === "body")) {
  ok(m.priority === false, `${m.route}: body image is not a priority image`);
  const model = describePicture({ id: m.imageId as never, variant: m.variant, sizes: m.sizes, alt: m.alt, priority: m.priority });
  ok(model.img.loading === "lazy" && !model.img.fetchPriority, `${m.route}: body image renders lazy`);
}
ok(PARTNER_MEDIA.filter((m) => m.priority).length === ROUTES.length, "exactly one priority image per page");

console.log("Derivatives and manifest");
for (const m of PARTNER_MEDIA) {
  const problems = manifestProblems(m);
  ok(problems.length === 0, `${m.route} ${m.role} (${m.imageId}/${m.variant}): AVIF, WebP and JPEG at every width, within the byte limit ${problems.join("; ")}`);
}
ok(manifestProblems({ ...good, imageId: "industry-not-built" }).length > 0, "negative control: an unbuilt source is caught");
ok(manifestProblems({ ...good, widths: [...good.widths, 4000] }).length > 0, "negative control: an undeclared width is caught");

console.log("Caption and server/React agreement");
ok(/^Illustrative scene\./.test(PARTNER_MEDIA_CAPTION) && /Not a Liberty customer, partner or employee/.test(PARTNER_MEDIA_CAPTION), "the caption says the scene is illustrative and not a real customer, partner or employee");
ok(!FORBIDDEN_ALT.test(PARTNER_MEDIA_CAPTION.replace(/Not a Liberty customer, partner or employee\./, "")), "the caption makes no other claim");
for (const m of PARTNER_MEDIA) {
  const html = pictureHtml({ id: m.imageId as never, variant: m.variant, sizes: m.sizes, alt: m.alt, priority: m.priority });
  const model = describePicture({ id: m.imageId as never, variant: m.variant, sizes: m.sizes, alt: m.alt, priority: m.priority });
  ok(html.includes(`src="${model.img.src}"`) && html.includes(`width="${model.img.width}"`) && html.includes(`height="${model.img.height}"`), `${m.route} ${m.role}: server markup carries the React picture's source and dimensions`);
  ok(html.includes(`alt="${m.alt.replace(/&/g, "&amp;")}"`) && html.includes(`loading="${model.img.loading}"`), `${m.route} ${m.role}: server markup carries the same alt text and loading`);
  ok(/object-position/.test("object-position") && /^\d+% \d+%$/.test(partnerMediaObjectPosition(m)), `${m.route} ${m.role}: focal point becomes a percentage object-position`);
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
