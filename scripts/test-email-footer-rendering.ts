#!/usr/bin/env tsx
import assert from "node:assert/strict";
import {
  injectCanSpamTextFooter,
  renderEmailHtmlForPurpose,
  renderEmailPartsForPurpose,
} from "../server/services/can-spam-footer";

const config = {
  ok: true as const,
  mailingAddress: "123 Compliance Way, Miami, FL 33101",
  unsubscribeUrl: "https://example.test/unsubscribe?t=signed-token",
};
const html = "<html><body><h1>Hello</h1><p>Offer details.</p></body></html>";
let loaderCalls = 0;
const loader = async () => { loaderCalls++; return config; };
const commercial = await renderEmailPartsForPurpose({
  html, purpose: "marketing_outreach", contactId: 123, complianceLoader: loader,
});
const renderedHtml = commercial.html;
const renderedText = commercial.text;
assert.equal(loaderCalls, 1, "commercial HTML and text must share one config load");
assert.match(renderedHtml, /123 Compliance Way/);
assert.match(renderedHtml, /https:\/\/example\.test\/unsubscribe\?t=signed-token/);
assert.match(renderedText, /123 Compliance Way/);
assert.match(renderedText, /https:\/\/example\.test\/unsubscribe\?t=signed-token/);
assert.equal(injectCanSpamTextFooter(renderedText, config), renderedText, "text footer must de-duplicate");

const transactionalBody = "<p>Receipt confirmed.</p>";
const forbiddenLoader = async (): Promise<never> => {
  loaderCalls++;
  throw new Error("transactional path loaded compliance");
};
loaderCalls = 0;
const ghlGmailStyle = await renderEmailHtmlForPurpose({
  html: transactionalBody, purpose: "transactional_response", complianceLoader: forbiddenLoader,
});
assert.equal(ghlGmailStyle, transactionalBody, "transactional GHL/Gmail HTML remains byte-identical");
const smtpStyle = await renderEmailPartsForPurpose({
  html: transactionalBody, purpose: "transactional_response", complianceLoader: forbiddenLoader,
});
assert.equal(smtpStyle.html, transactionalBody, "transactional SMTP HTML remains byte-identical");
assert.equal(smtpStyle.text, "Receipt confirmed.", "transactional SMTP text derives safely");
assert.equal(loaderCalls, 0, "transactional renderers must never load compliance config");

await assert.rejects(
  () => renderEmailPartsForPurpose({
    html,
    purpose: "marketing_outreach",
    contactId: 123,
    complianceLoader: async () => ({ ok: false, error: "COMPLIANCE_CONFIGURATION_UNAVAILABLE" }),
  }),
  /COMPLIANCE_CONFIGURATION_UNAVAILABLE/,
);
console.log("✓ commercial HTML/text footer rendering and transactional preservation");