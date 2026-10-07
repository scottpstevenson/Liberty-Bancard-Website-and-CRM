import assert from "node:assert/strict";
import { createServer } from "vite";
import { tsImport } from "tsx/esm/api";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Frontend-only fixture: no login bypass, application server, DB or providers.
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/index.css";
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastClose } from "/src/components/ui/toast.tsx";
const h = React.createElement;
function Fixture() {
  const [open, setOpen] = React.useState(false);
  return h("div", {className:"crm-theme"},
    h("header", {style:{position:"fixed",top:0,left:0,width:"100%",height:56,display:"flex",alignItems:"center",paddingLeft:12,zIndex:50,background:"white"}},
      h("button", {id:"navigation", onClick:()=>document.body.dataset.navigation="clicked"}, "Open navigation")),
    h("main", {style:{paddingTop:70}}, "Mobile header regression fixture"),
    h("button", {id:"notify", onClick:()=>setOpen(true)}, "Show notification"),
    h(ToastProvider, {},
      h(Toast, {open, onOpenChange:setOpen, duration:60000, className:"crm-theme crm-portal"},
        h(ToastTitle, {}, "Test notification"), h(ToastClose, {"aria-label":"Dismiss notification"})),
      h(ToastViewport, {id:"viewport", className:"crm-theme crm-portal"})));
}
createRoot(document.getElementById("root")).render(h(Fixture));
`;
const server = await createServer({
  configFile: false,
  root: path.resolve("client"),
  resolve: { alias: {
    "@": path.resolve("client/src"),
    "@shared": path.resolve("shared"),
    "@assets": path.resolve("attached_assets"),
  } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-dev-runtime"] },
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
  plugins: [react(), tailwindcss(), {
    name: "toast-layout-regression-fixture",
    configureServer(server) {
      server.middlewares.use("/toast-layout-fixture", async (_req, res, next) => {
        try {
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml("/toast-layout-fixture",
          '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/@id/virtual:toast-layout-fixture"></script>'));
        } catch (error) { next(error); }
      });
    },
    resolveId(id) { if (id === "virtual:toast-layout-fixture") return "\0toast-layout-fixture"; },
    load(id) { if (id === "\0toast-layout-fixture") return source; },
  }],
});
await server.listen();
let browser;
try {
  const { privateStage3Browser } = await tsImport("./fixtures/private-stage3-browser.ts", {
    parentURL: import.meta.url,
  });
  browser = await privateStage3Browser("http://127.0.0.1:5199", "", fetch,
    ".local/test-results/toast-viewport", {realInput:true});
  for (const width of [375, 390, 430, 1440]) {
    await browser.call("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 1, mobile: width < 640,
    });
    await browser.navigate("/toast-layout-fixture");
    try { await browser.waitFor(/Open navigation/); }
    catch (error) {
      console.error("Fixture exceptions:", browser.exceptions);
      console.error("Failed fixture requests:", browser.requests.filter(r=>r.failed || r.status>=400));
      throw error;
    }
    const empty = await browser.evaluate(`(() => {
      const v=document.querySelector("#viewport"), n=document.querySelector("#navigation");
      const s=getComputedStyle(v),r=n.getBoundingClientRect();
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {background:s.backgroundColor,pointerEvents:s.pointerEvents,height:v.getBoundingClientRect().height,
        headerHit:hit===n, hit:hit?.outerHTML.slice(0,500),overlay:document.querySelector("vite-error-overlay")?.shadowRoot?.textContent.slice(-4000),buttonRect:{x:r.x,y:r.y,width:r.width,height:r.height}};
    })()`);
    assert.equal(empty.background, "rgba(0, 0, 0, 0)");
    assert.equal(empty.pointerEvents, "none");
    assert.equal(empty.height, 0);
    assert.equal(empty.headerHit, true, JSON.stringify(empty));
    await browser.click("#navigation");
    assert.equal(await browser.evaluate("document.body.dataset.navigation"), "clicked");
    await browser.click("#notify");
    await browser.waitFor(/Test notification/);
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-state="open"]')).pointerEvents`), "auto");
    await browser.click('[aria-label="Dismiss notification"]');
    for (let i=0; i<30; i++) {
      if (await browser.evaluate("document.querySelector('#viewport').children.length === 0")) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(await browser.evaluate("document.querySelector('#viewport [data-state=\"open\"]') === null"), true);
    assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('#viewport')).backgroundColor"), "rgba(0, 0, 0, 0)");
    await browser.screenshot(`header-${width}`);
    console.log(`PASS ${width}px: empty overlay transparent, header tappable, notification dismissible`);
  }
  assert.deepEqual(browser.exceptions, []);
  if (process.argv.includes("--serve")) {
    console.log("Fixture ready for screenshot on port 5199");
    await new Promise(resolve => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
  }
} finally {
  await browser?.close();
  await server.close();
}
