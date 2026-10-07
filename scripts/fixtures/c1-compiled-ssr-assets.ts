import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import type {Express} from "express";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";

/**
 * The guarded fixture must remain NODE_ENV=test. The real SSR source therefore
 * emits its development assets even though this candidate serves a compiled
 * client. Substitute only that exact asset preamble at the fixture boundary.
 * Production SSR, page markup, CSS layers, auth and API responses are unchanged.
 */
export function compiledSsrHtml(body:unknown, tags:string):unknown {
  if(typeof body!=="string" || !body.includes('src="/src/main.tsx"'))return body;
  return body.replace(
    /<script type="module" src="\/@vite\/client"><\/script>\s*<script type="module">\s*import RefreshRuntime from "\/@react-refresh";[\s\S]*?<\/script>\s*<script type="module" src="\/src\/main\.tsx"><\/script>/,
    tags,
  );
}

export async function installC1CompiledSsrAssets(app:Express) {
  // The HTTP fixture owns a descendant Redis namespace; the runner's exact
  // top-level prefix predicate intentionally does not apply after construction.
  await assertDisposableTestInfrastructure({
    operation:"C1 compiled SSR asset adapter",requireRedis:true,reserveRedisNamespace:false,
  });
  const html=await readFile(path.resolve("dist/public/index.html"),"utf8");
  const scripts=html.match(/<script[^>]+src="\/assets\/[^"]+\.js"[^>]*><\/script>/g)??[];
  const links=html.match(/<link[^>]+href="\/assets\/[^"]+\.css"[^>]*>/g)??[];
  assert.ok(scripts.length && links.length,"Current compiled scripts and styles are mandatory");
  const tags=[...links,...scripts].join("\n");
  app.use((_req,res,next)=>{
    const send=res.send.bind(res);
    res.send=(body:any)=>send(compiledSsrHtml(body,tags));
    next();
  });
}
