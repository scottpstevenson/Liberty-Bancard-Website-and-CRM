import assert from "node:assert/strict";
import postcss from "postcss";
import { ssrHtmlShell } from "../server/ssrShared";

// The SEO fallback survives as a head stylesheet after React mounts. Every
// fallback rule must remain lower priority than the application's utilities.
const html = ssrHtmlShell({
  title: "Style isolation",
  description: "CSS regression fixture",
  canonical: "/",
  body: "<section class=\"ssr-section\">Fallback content</section>",
});
const css = html.match(/<style data-ssr-fallback-styles>([\s\S]*?)<\/style>/)?.[1];
assert.ok(css, "The shared SSR shell must identify its fallback stylesheet");
const tree = postcss.parse(css);
const order = tree.nodes.find(node =>
  node.type === "atrule" && node.name === "layer" && !node.nodes);
assert.equal(order?.type === "atrule" ? order.params : undefined,
  "ssr-fallback, theme, base, components, utilities");
let checked = 0;
tree.walkRules(rule => {
  let parent = rule.parent;
  while (parent && !(parent.type === "atrule" &&
    parent.name === "layer" && parent.params === "ssr-fallback")) {
    parent = parent.parent;
  }
  assert.ok(parent, `Fallback selector escapes its layer: ${rule.selector}`);
  checked++;
});
assert.ok(checked > 100, "Verify the complete fallback, not an empty placeholder");
assert.ok(html.includes("Fallback content"), "Keep the no-JavaScript content");
console.log(`SSR style isolation passed: ${checked} rules below application layers`);
