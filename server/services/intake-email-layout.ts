const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Escaped, code-owned Liberty correspondence layout. One signature/logo owner. */
export function brandedIntakeEmail(greeting: string, body: string, signature: string, booking = true): string {
  return `<div style="background:#f3f6fa;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#17243b"><div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #dce3ed"><div style="background:#0b1d50;color:white;padding:24px;border-bottom:4px solid #bf1530;font-weight:bold;font-size:22px">Liberty Bancard</div><div style="padding:28px;line-height:1.6"><p>${esc(greeting)}</p>${body.split(/\n\s*\n/).map(p=>`<p>${esc(p).replace(/\n/g,"<br>")}</p>`).join("")}${booking ? '<p style="margin:28px 0"><a href="https://libertybancard.com/book" style="display:inline-block;background:#0b1d50;color:#fff;padding:14px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Schedule a call</a></p>' : ""}${signature}</div></div></div>`;
}
