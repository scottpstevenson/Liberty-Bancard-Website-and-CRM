# Release Security Verification

Use this checklist after the deterministic release gate passes and before a production release is signed off. It is intentionally an operator process: CI can test a build but cannot safely deploy it or inspect a staging/production browser session.

## 1. Establish the tested release identity

Set the exact commit SHA before validation and use the same value in the deployment environment:

```bash
export RELEASE_SHA="$(git rev-parse HEAD)"
bash scripts/run-pre-deploy.sh
```

The release gate runs TypeScript checking, a clean production build, the CSP/CORS/JSON-LD suite, and the redacting artifact scan. A production deployment must set this same `RELEASE_SHA`.

## 2. Test staging with the enforcing production CSP

Run the staging process with `NODE_ENV=production`. In a browser, verify the following paths render without CSP console violations:

- SSR and SEO HTML: `/`, `/learn`, `/learn/interchange-fee`, a location page, an alternatives page, and a switch-from page.
- Crawler-blog HTML, widget preview, unsubscribe, SPA fallback, and a 404.
- The configured Google Analytics and Meta Pixel loaders, when those IDs are configured.
- GHL chat: open the widget, send a non-production test interaction, and verify its normal UI/network behavior.

Record the browser console CSP output and the GHL network hostnames in the release evidence. The current GHL wildcard source entries stay in place until report-only browser evidence proves every runtime host can be narrowed. If a required host is not supported by the reviewed policy, stop the release; do not restore production `unsafe-inline` or broaden the policy without review.

## 3. Verify release identity after deployment

Compare the public health endpoint to the tested SHA:

```bash
RELEASE_SHA="$RELEASE_SHA" RELEASE_URL="https://your-production-domain" \
  npx tsx scripts/verify-release-identity.ts
```

The command succeeds only when `/api/health` returns the exact tested SHA. Treat a missing or mismatched SHA as a failed production sign-off.