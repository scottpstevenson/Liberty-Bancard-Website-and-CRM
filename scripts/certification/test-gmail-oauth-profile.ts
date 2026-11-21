/** Real Gmail OAuth routes and session/database persistence, with Google transport stubbed. */
import assert from "node:assert/strict";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";

process.env.GOOGLE_CLIENT_ID = "synthetic-client";
process.env.GOOGLE_CLIENT_SECRET = "synthetic-secret";
const fixture = await stage3BHttpFixture(async app => {
  const { registerGmailOAuthRoutes } = await import("../../server/routes/gmail-oauth");
  registerGmailOAuthRoutes(app);
}, undefined, { backgroundProfile: "off" });

const { google } = await import("googleapis");
const { storage } = await import("../../server/storage");
const originalGmail = google.gmail;
const originalOAuth = google.oauth2;
const originalToken = google.auth.OAuth2.prototype.getToken;
let profileEmail: string | undefined = "Scott@libertybancard.com";
let tokenExchanges = 0;
(google.auth.OAuth2.prototype as any).getToken = async () => {
  tokenExchanges++;
  return { tokens: { refresh_token: "synthetic-refresh-token", access_token: "synthetic-access" } };
};
(google as any).oauth2 = () => { throw Error("Unsupported userinfo boundary was called"); };
(google as any).gmail = () => ({
  users: {
    getProfile: async ({ userId }: { userId: string }) => {
      assert.equal(userId, "me");
      return { data: { emailAddress: profileEmail } };
    },
    settings: {
      sendAs: {
        list: async () => ({
          data: { sendAs: [
            { sendAsEmail: "support@libertybancard.com", verificationStatus: "accepted" },
            { sendAsEmail: "pending@example.test", verificationStatus: "pending" },
          ] },
        }),
      },
    },
  },
});

try {
  const svc = await import("../../server/services/gmail-oauth");
  const authorization = await fixture.request("admin", "GET", "/api/admin/gmail-oauth/authorize");
  assert.equal(authorization.status, 200);
  assert.equal(authorization.headers.get("cache-control"), "no-store");
  const state = new URL(authorization.body.authUrl).searchParams.get("state");
  assert.match(state ?? "", /^[a-f0-9]{64}$/);
  const initiatingCookie = fixture.sessions.get("admin")!.cookie;
  assert.equal((await fixture.login("admin")).status, 200);
  const otherSessionCookie = fixture.sessions.get("admin")!.cookie;
  assert.notEqual(otherSessionCookie, initiatingCookie);

  const callback = (cookie: string, responseState?: string) => {
    const query = new URLSearchParams({ code: "synthetic-code" });
    if (responseState !== undefined) query.set("state", responseState);
    return fetch(fixture.base + "/api/admin/gmail-oauth/callback?" + query, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
  };
  assert.equal((await callback("", state!)).status, 401);
  for (const rejected of [
    await callback(otherSessionCookie, state!),
    await callback(initiatingCookie),
    await callback(initiatingCookie, "0".repeat(64)),
  ]) {
    assert.equal(rejected.status, 302);
    assert.ok(new URL(rejected.headers.get("location")!).searchParams.has("gmail_error"));
  }
  assert.equal(tokenExchanges, 0);

  const accepted = await callback(initiatingCookie, state!);
  assert.equal(accepted.status, 302);
  assert.equal(new URL(accepted.headers.get("location")!).searchParams.get("gmail_connected"), "scott@libertybancard.com");
  const saved = await storage.getSystemSetting("gmail_oauth_refresh_token");
  assert.ok(saved && saved !== "synthetic-refresh-token");
  const replay = await callback(initiatingCookie, state!);
  assert.ok(new URL(replay.headers.get("location")!).searchParams.has("gmail_error"));
  assert.equal(tokenExchanges, 1);

  assert.deepEqual((await svc.getGmailOAuthStatus()).aliases, ["support@libertybancard.com"]);
  assert.deepEqual(await svc.verifyGmailConnection(), { success: true, email: "scott@libertybancard.com" });
  profileEmail = undefined;
  assert.equal((await svc.exchangeCodeForTokens("another-synthetic-code")).success, false);
  assert.equal(await storage.getSystemSetting("gmail_oauth_refresh_token"), saved);
  assert.equal((await svc.verifyGmailConnection()).success, false);
  assert.equal(fixture.externalCalls(), 0);
  console.log("GMAIL_OAUTH_PROFILE_PASS: callback session binding, replay rejection, mailbox profile, encrypted persistence, verified aliases and prior-token preservation.");
} finally {
  google.gmail = originalGmail;
  google.oauth2 = originalOAuth;
  google.auth.OAuth2.prototype.getToken = originalToken;
  await fixture.close();
}
process.exit(0);
