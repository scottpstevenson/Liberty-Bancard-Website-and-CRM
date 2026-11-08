import { useEffect, useState } from "react";

/**
 * Why previews lose the logo: delivered email references the logo by an absolute URL (APP_URL + /logo-blue.png), which
 * mail clients fetch fine. The dashboard preview runs that markup in an iframe with `sandbox=""`, so the frame has an
 * opaque origin, and the app serves its images with `Cross-Origin-Resource-Policy: same-origin` and an `img-src 'self'`
 * policy. The browser therefore refuses the image inside the preview even though the production URL is valid.
 *
 * The fix is display-only: fetch the same-origin copy once and substitute it as a `data:` URL in the PREVIEW string.
 * The sandbox stays empty (no scripts, no same-origin), the logo URL in the sent email is untouched, and nothing
 * external is requested: only the image's own path is read from this origin.
 */
const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi;
const MAX_IMAGES = 4;
const MAX_BYTES = 400_000;
const cache = new Map<string, Promise<string | null>>();

function sameOriginImagePath(src: string): string | null {
  try {
    const url = new URL(src, window.location.origin);
    if (!/^\/[^?#]*\.(png|jpe?g|gif|webp|svg)$/i.test(url.pathname)) return null;
    if (url.pathname.startsWith("/api/")) return null;
    return url.pathname;
  } catch { return null; }
}

function loadAsDataUrl(path: string): Promise<string | null> {
  let existing = cache.get(path);
  if (!existing) {
    existing = fetch(path, { credentials: "omit" })
      .then(async (res) => {
        if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
        const blob = await res.blob();
        if (blob.size > MAX_BYTES) return null;
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      })
      .catch(() => null);
    cache.set(path, existing);
  }
  return existing;
}

/** Returns the preview markup with same-origin-served images inlined once they load. Never alters the input string. */
export function useInlinedPreviewHtml(html: string): string {
  const [inlined, setInlined] = useState<{ source: string; html: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const matches = [...html.matchAll(IMG_SRC)].slice(0, MAX_IMAGES);
    const targets = [...new Set(matches.map((m) => m[3]))];
    if (targets.length === 0) return;
    (async () => {
      const replacements = new Map<string, string>();
      for (const src of targets) {
        const path = sameOriginImagePath(src);
        const dataUrl = path ? await loadAsDataUrl(path) : null;
        if (dataUrl) replacements.set(src, dataUrl);
      }
      if (cancelled || replacements.size === 0) return;
      setInlined({ source: html, html: html.replace(IMG_SRC, (whole, head, quote, src) => (replacements.has(src) ? `${head}${quote}${replacements.get(src)}${quote}` : whole)) });
    })();
    return () => { cancelled = true; };
  }, [html]);
  return inlined && inlined.source === html ? inlined.html : html;
}
