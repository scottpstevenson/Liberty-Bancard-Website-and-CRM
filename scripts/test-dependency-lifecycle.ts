#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

type Result = { name: string; status: "pass" | "optional-skip"; detail: string };
const results: Result[] = [];

async function required(name: string, probe: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await probe();
    results.push({ name, status: "pass", detail: "required runtime/build probe completed" });
  } catch (error) {
    throw new Error(`${name} required lifecycle probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolvePlacement(location: string): string {
  return path.resolve(process.cwd(), location);
}

await required("root esbuild", async () => {
  const esbuild = await import(resolvePlacement("node_modules/esbuild/lib/main.js"));
  await esbuild.transform("const value: number = 1", { loader: "ts" });
});

for (const placement of [
  "node_modules/vite/node_modules/esbuild",
  "node_modules/drizzle-kit/node_modules/@esbuild-kit/esm-loader/node_modules/esbuild",
  "node_modules/drizzle-kit/node_modules/tsx/node_modules/esbuild",
]) {
  if (!fs.existsSync(placement)) continue;
  await required(placement, async () => {
    const esbuild = await import(resolvePlacement(path.join(placement, "lib/main.js")));
    await esbuild.transform("let value = 1");
  });
}

await required("sharp SVG to PNG", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')).png().toBuffer();
  if (!png?.subarray(1, 4).equals(Buffer.from("PNG"))) throw new Error("invalid PNG output");
});
await required("ssh2", async () => {
  const ssh2 = await import("ssh2");
  if (!ssh2.Client) throw new Error("Client export missing");
});
await required("msgpackr-extract", () => import("msgpackr-extract"));
await required("core-js", () => import("core-js"));
await required("es5-ext", () => import("es5-ext"));

if (process.platform === "darwin") {
  await required("fsevents", () => import("fsevents"));
} else {
  results.push({ name: "fsevents", status: "optional-skip", detail: `unsupported platform ${process.platform}` });
}

for (const optionalNative of ["bufferutil", "cpu-features"]) {
  try {
    await import(optionalNative);
    results.push({ name: optionalNative, status: "pass", detail: "optional accelerator available" });
  } catch {
    results.push({
      name: optionalNative,
      status: "optional-skip",
      detail: "optional accelerator unavailable; supported JavaScript/runtime fallback remains active",
    });
  }
}

console.log(JSON.stringify({ lifecyclePolicy: "global scripts disabled; required modules probed", results }, null, 2));