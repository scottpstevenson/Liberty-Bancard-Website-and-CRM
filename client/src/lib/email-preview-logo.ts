/**
 * Preview-only helper. The email preview runs in a fully sandboxed frame (opaque origin), and the site serves
 * `/logo-blue.png` with `Cross-Origin-Resource-Policy: same-origin`, so the browser refuses to load the logo into
 * that frame. Inlining the same image as a data URI for display keeps the sandbox closed. Only the displayed copy is
 * changed; the saved revision, its fingerprint and the email that is sent are untouched.
 */
const LOGO_SRC = /(<img\b[^>]*\bsrc=")[^"]*logo-blue\.png(")/gi;

export function inlineEmailLogo(html: string, logoDataUri: string | undefined): string {
  if (!logoDataUri) return html;
  return html.replace(LOGO_SRC, (_match, before: string, after: string) => `${before}${logoDataUri}${after}`);
}

export async function loadEmailLogoDataUri(): Promise<string> {
  const response = await fetch("/logo-blue.png", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Logo request failed (${response.status})`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Logo could not be read"));
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Logo could not be read")));
    reader.readAsDataURL(blob);
  });
}
