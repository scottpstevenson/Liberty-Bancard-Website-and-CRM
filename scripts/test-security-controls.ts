#!/usr/bin/env tsx
/**
 * Deterministic CSP, CORS, JSON-LD, and HTML-producer regression suite.
 * This suite creates an isolated Express app and does not use the project DB,
 * providers, or the application bootstrap.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  createSecurityMiddleware,
  getScriptSources,
  isDeniedCorsOriginError,
  PRODUCTION_SCRIPT_SOURCES,
} from "../server/lib/security";
import { serializeJsonLd } from "../shared/json-ld";
import { ssrHtmlShell } from "../server/ssrShared";

let failures = 0;

function check(condition: unknown, message: string): void {
  try {
    assert.ok(condition, message);
    console.log(`  ✓ ${message}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${error instanceof Error ? error.message : message}`);
  }
}

async function withSecurityFixture(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  const { helmet, cors } = createSecurityMiddleware(
    ["https://allowed.example"],
    "production",
  );
  app.use(helmet);
  app.use(cors);
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!isDeniedCorsOriginError(error)) return next(error);
    return res.status(403).json({ message: "CORS origin denied" });
  });
  app.all("/resource", (_req, res) => res.status(200).json({ ok: true }));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to determine security fixture port");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function findJsonLdProducers(directory: string): string[] {
  const producers: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      producers.push(...findJsonLdProducers(fullPath));
    } else if (/\.(?:ts|tsx|html)$/.test(entry)) {
      const source = readFileSync(fullPath, "utf8");
      if (source.includes("application/ld+json")) {
        producers.push(path.relative(process.cwd(), fullPath));
      }
    }
  }
  return producers.sort();
}

async function main(): Promise<void> {
  console.log("\n══ CSP, CORS, JSON-LD Security Controls ═══════════════════════\n");

  console.log("── 1. CSP policy boundary ────────────────────────────────────");
  const productionScripts = getScriptSources("production");
  const developmentScripts = getScriptSources("development");
  check(
    !productionScripts.includes("'unsafe-inline'"),
    "production script-src excludes unsafe-inline",
  );
  check(
    developmentScripts.includes("'unsafe-inline'"),
    "development script-src retains only the HMR inline compatibility exception",
  );
  check(
    JSON.stringify(productionScripts) === JSON.stringify(PRODUCTION_SCRIPT_SOURCES),
    "production script-src matches the reviewed source-backed allowlist",
  );
  for (const exactSource of [
    "*.leadconnectorhq.com",
    "*.ghl.io",
    "www.googletagmanager.com",
    "connect.facebook.net",
  ]) {
    check(productionScripts.includes(exactSource), `production script-src includes ${exactSource}`);
  }
  for (const removedSource of [
    "*.googletagmanager.com",
    "*.google-analytics.com",
    "*.facebook.com",
    "fonts.googleapis.com",
  ]) {
    check(!productionScripts.includes(removedSource), `production script-src excludes unused ${removedSource}`);
  }

  console.log("\n── 2. CORS behavior and security-header ordering ─────────────");
  await withSecurityFixture(async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/resource`, {
      headers: { Origin: "https://allowed.example" },
    });
    check(allowed.status === 200, "allowed credentialed GET returns 200");
    check(
      allowed.headers.get("access-control-allow-origin") === "https://allowed.example",
      "allowed GET returns the exact allow-origin header",
    );
    check(
      allowed.headers.get("access-control-allow-credentials") === "true",
      "allowed GET preserves credentialed CORS behavior",
    );

    const deniedOrigin = "https://denied.example";
    const denied = await fetch(`${baseUrl}/resource`, {
      headers: { Origin: deniedOrigin },
    });
    const deniedBody = await denied.text();
    check(denied.status === 403, "denied GET returns deliberate 403");
    check(
      denied.headers.get("access-control-allow-origin") === null,
      "denied GET has no allow-origin header",
    );
    check(!deniedBody.includes(deniedOrigin), "denied GET does not reflect the rejected origin");
    check(
      denied.headers.get("content-security-policy")?.includes("script-src") === true,
      "denied GET still receives Helmet CSP headers",
    );
    check(
      denied.headers.get("x-content-type-options") === "nosniff",
      "denied GET still receives standard Helmet headers",
    );

    const deniedOptions = await fetch(`${baseUrl}/resource`, {
      method: "OPTIONS",
      headers: {
        Origin: deniedOrigin,
        "Access-Control-Request-Method": "GET",
      },
    });
    const deniedOptionsBody = await deniedOptions.text();
    check(deniedOptions.status === 403, "denied OPTIONS returns deliberate 403");
    check(
      deniedOptions.headers.get("access-control-allow-origin") === null,
      "denied OPTIONS has no allow-origin header",
    );
    check(!deniedOptionsBody.includes(deniedOrigin), "denied OPTIONS does not reflect the rejected origin");
    check(
      deniedOptions.headers.get("content-security-policy")?.includes("script-src") === true,
      "denied OPTIONS still receives Helmet CSP headers",
    );

    const serverToServer = await fetch(`${baseUrl}/resource`);
    check(serverToServer.status === 200, "no-origin server-to-server GET remains allowed");
  });

  console.log("\n── 3. JSON-LD serialization ──────────────────────────────────");
  const hostile = "</script><script>globalThis.__jsonLdPwned = true</script><>&\u2028\u2029";
  const serialized = serializeJsonLd({ value: hostile });
  check(!serialized.includes("</script"), "JSON-LD serializer cannot emit a literal script boundary");
  check(!serialized.includes("<"), "JSON-LD serializer escapes <");
  check(!serialized.includes(">"), "JSON-LD serializer escapes >");
  check(!serialized.includes("&"), "JSON-LD serializer escapes &");
  check(!serialized.includes("\u2028"), "JSON-LD serializer escapes U+2028");
  check(!serialized.includes("\u2029"), "JSON-LD serializer escapes U+2029");
  check(
    (JSON.parse(serialized) as { value: string }).value === hostile,
    "JSON-LD serialization round-trips hostile data",
  );

  const renderedShell = ssrHtmlShell({
    title: "Security test",
    description: "JSON-LD hostile-data test",
    canonical: "/security-test",
    schemaJsons: [{ value: hostile }],
    body: "<main>safe</main>",
  });
  check(
    !renderedShell.includes("<script>globalThis.__jsonLdPwned"),
    "shared SSR shell does not render hostile JSON-LD as executable markup",
  );
  check(
    !renderedShell.includes("</script><script>globalThis.__jsonLdPwned"),
    "shared SSR shell does not permit JSON-LD script breakout",
  );

  console.log("\n── 4. HTML producer coverage and inline-script guard ─────────");
  const jsonLdProducers = [
    ...findJsonLdProducers(path.resolve(process.cwd(), "client/src")),
    ...findJsonLdProducers(path.resolve(process.cwd(), "server")),
  ];
  check(jsonLdProducers.length > 0, "JSON-LD producer discovery found active renderers");
  for (const producer of jsonLdProducers) {
    const source = readProjectFile(producer);
    check(source.includes("serializeJsonLd"), `${producer} uses the canonical JSON-LD serializer`);
    check(
      !/<script[\s\S]{0,250}application\/ld\+json[\s\S]{0,300}JSON\.stringify/.test(source),
      `${producer} has no raw JSON.stringify JSON-LD interpolation`,
    );
  }

  const publicHtmlProducers = [
    "server/routes/glossary.ts",
    "server/ssr/location-html.ts",
    "server/ssr/competitor-ssr.ts",
    "server/routes/widget.ts",
    "server/routes/public.ts",
    "server/routes/ssr-routes.ts",
    "server/static.ts",
    "server/vite.ts",
    "client/index.html",
  ];
  const executableInlineScript = /<script\b(?![^>]*\bsrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi;
  for (const producer of publicHtmlProducers) {
    const matches = readProjectFile(producer).match(executableInlineScript) ?? [];
    check(matches.length === 0, `${producer} has no inline executable script`);
  }

  const sharedSsr = readProjectFile("server/ssrShared.ts");
  check(
    sharedSsr.includes("SECURITY: DEVELOPMENT_ONLY_INLINE_SCRIPT") &&
      sharedSsr.includes("if (isProd)") &&
      sharedSsr.includes('import RefreshRuntime from "/@react-refresh"'),
    "shared SSR documents the development-only React Refresh inline exception",
  );
  for (const [producer, marker] of [
    ["widget preview", "server/routes/widget.ts"],
    ["unsubscribe HTML", "server/routes/public.ts"],
    ["SPA/static fallback", "server/static.ts"],
    ["development Vite transformation", "server/vite.ts"],
  ] as const) {
    check(readProjectFile(marker).length > 0, `${producer} is enumerated by this producer-family guard`);
  }
  const preDeployGate = readProjectFile("scripts/pre-deploy.ts");
  const releaseIdentityVerifier = readProjectFile("scripts/verify-release-identity.ts");
  check(
    preDeployGate.includes('spawnSync("git", ["rev-parse", "HEAD"]') &&
      releaseIdentityVerifier.includes('spawnSync("git", ["rev-parse", "HEAD"]'),
    "release identity checks bind RELEASE_SHA to the checked-out tested commit",
  );

  console.log("\n══════════════════════════════════════════════════════════════");
  if (failures === 0) {
    console.log(" ✓ CSP/CORS/JSON-LD SECURITY CONTROLS PASSED\n");
    return;
  }
  console.error(` ✗ ${failures} security control assertion(s) failed\n`);
  process.exitCode = 1;
}

await main();
