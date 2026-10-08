---
name: Private auto-auth UI verification
description: Verify isolated authenticated UI fixtures without exposing their session-injecting proxy.
---

Keep any fixture proxy that injects an authenticated admin session bound to loopback. Use a one-off private process and an app-preview screenshot with its explicit port.

**Why:** Workflow port detection expects a externally reachable bind. A healthy loopback fixture can therefore report a port-start failure; changing it to bind publicly would expose the proxy's automatic fixture-admin authority.

**How to apply:** Confirm the fixture is serving locally, screenshot its explicit loopback port, and stop it afterward. Do not weaken the bind merely to satisfy workflow readiness; external preview needs separate authentication.

Check generated port mappings as well as the socket bind before treating a fixture as private.

**Why:** A loopback-only certification server was automatically registered with an external port mapping. Binding to loopback alone is not proof that Replit's proxy cannot reach it.

**How to apply:** Prefer real synthetic sessions over auto-auth injection. Stop temporary servers and remove their generated mappings through the validated configuration replacement before handoff; never ship an auto-auth fixture or its proxy mapping.

Keep authentication, roles, and operational control data real in visual fixtures. A presentation-only welcome-tour flag may be overridden only inside the private fixture; do not change stored user preferences to obtain a screenshot.

**Why:** A fresh capture browser can open the welcome tour over a working authenticated page. Dismissing it through persistent account changes would modify unrelated user state.

**How to apply:** Limit any tour suppression to the fixture response, retain its read-only mutation block, and stop the fixture after verification.

When using Chromium's debugging protocol, select the dedicated `type=page`
target explicitly; do not assume the first listed target is the application.

**Why:** The bundled Chromium exposed an extension background page first even
in headless mode. Attaching to it produced blank text and hanging screenshot
commands while the actual app and its authentication were working.

**How to apply:** Start a dedicated profile with extensions disabled, select
the intended page by type and URL, and bound every debugging command with a
timeout. Keep the browser and its debugging port private to the fixture.

Native mobile routing and a phone-sized desktop viewport are different checks.

**Why:** The existing phone shell redirected the report route into its own home
work queue. Using its supported “Switch to desktop view” action verified the
responsive report without changing routing, but did not certify native queues.

**How to apply:** Name the mode in browser receipts; never label a responsive
desktop-view proof as native mobile workflow certification. Stop Chromium's
dedicated process group before deleting its profile, since utility children can
continue writing after the main process exits.

Chromium's capture browser rejects port 6000 as an unsafe port.

**Why:** A healthy authenticated isolated preview on that port failed capture
before any HTTP request. Its verified private backend port rendered normally.

**How to apply:** For a capture, use the existing isolated backend loopback
port from its readiness receipt after verifying the isolation/origin fields.
Do not mistake the browser's port refusal for an application failure, weaken
authentication, or expose an automatic-session proxy to work around it.