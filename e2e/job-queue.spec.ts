import { test, expect } from "@playwright/test";

const BASE_URL = process.env.APP_URL || "http://localhost:5000";
const TEST_EMAIL = "playwright-test@libertybancard.internal";
const TEST_PASSWORD = "PlaywrightTest2024!";

async function loginViaBrowser(page: any) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(TEST_EMAIL);
  await page.getByLabel(/password/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

test.describe("Job Queue panel — Operator Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaBrowser(page);
    // Navigate directly to the queue-metrics view via URL param
    await page.goto(`${BASE_URL}/dashboard/operator?view=queue-metrics`);
    // Wait for the operator view container to confirm the view loaded
    await page.waitForSelector('[data-testid="operator-view-queue-metrics"]', { timeout: 15_000 });
  });

  // ─── Test 1: Queue summary cards render ──────────────────────────────────────
  test("queue summary cards are visible", async ({ page }) => {
    await expect(page.getByTestId("card-queue-active")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("card-queue-waiting")).toBeVisible();
    await expect(page.getByTestId("card-queue-failed")).toBeVisible();
  });

  // ─── Test 2: Queue list table renders at least one queue row ─────────────────
  test("queue list table renders with at least one queue", async ({ page }) => {
    // The refresh button confirms the Queue Health card is rendered
    await expect(page.getByTestId("btn-refresh-queues")).toBeVisible({ timeout: 10_000 });

    // Wait for at least one queue row to appear (rows have data-testid="row-queue-*")
    const firstRow = page.locator('[data-testid^="row-queue-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
  });

  // ─── Test 3: DLQ section renders — badge or empty state ──────────────────────
  test("dead-letter queue section shows badge or clean-state message", async ({ page }) => {
    // DLQ refresh button confirms the card rendered
    await expect(page.getByTestId("btn-refresh-dlq")).toBeVisible({ timeout: 10_000 });

    // Either the count badge OR the "no dead-letter jobs" message must be visible
    const badge = page.getByTestId("badge-dlq-count");
    const emptyMsg = page.getByTestId("no-dlq-message");

    const badgeVisible = await badge.isVisible().catch(() => false);
    const emptyVisible = await emptyMsg.isVisible().catch(() => false);

    expect(badgeVisible || emptyVisible).toBe(true);
  });

  // ─── Test 4: Pause button triggers API and shows toast ───────────────────────
  test("pause button calls API and shows success toast", async ({ page }) => {
    // Intercept the pause API call so we don't actually pause a real queue
    await page.route("**/api/operator/queue/*/pause", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    );

    // Wait for queue rows to load
    const pauseBtn = page.locator('[data-testid^="btn-pause-queue-"]').first();
    await pauseBtn.waitFor({ state: "visible", timeout: 10_000 });

    await pauseBtn.click({ force: true });

    // Expect a toast with "paused" text to appear
    await expect(
      page.locator('[role="region"][aria-live]').filter({ hasText: /paused/i })
        .or(page.locator('[data-sonner-toast]').filter({ hasText: /paused/i }))
        .or(page.locator('[data-state="open"]').filter({ hasText: /paused/i }))
    ).toBeVisible({ timeout: 8_000 });
  });

  // ─── Test 5: Resume button calls API and shows toast ─────────────────────────
  test("resume button calls API and shows success toast", async ({ page }) => {
    // Mock resume so we don't actually resume
    await page.route("**/api/operator/queue/*/resume", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    );

    // Also mock the queue-metrics to return a paused queue so we can test resume
    await page.route("**/api/operator/queue-metrics", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          usingMock: false,
          queues: [
            {
              name: "test-queue",
              waiting: 0,
              active: 0,
              completed: 5,
              failed: 0,
              delayed: 0,
              paused: true,
              repeatEveryMs: 60000,
              lastCompletedAt: null,
              lastFailedAt: null,
              avgDurationMs: null,
              throughputPerHour: null,
            },
          ],
        }),
      })
    );

    // Reload to pick up the mocked queue-metrics response
    await page.reload();
    await page.waitForSelector('[data-testid="operator-view-queue-metrics"]', { timeout: 10_000 });

    const resumeBtn = page.locator('[data-testid^="btn-resume-queue-"]').first();
    await resumeBtn.waitFor({ state: "visible", timeout: 10_000 });

    await resumeBtn.click({ force: true });

    await expect(
      page.locator('[role="region"][aria-live]').filter({ hasText: /resumed/i })
        .or(page.locator('[data-sonner-toast]').filter({ hasText: /resumed/i }))
        .or(page.locator('[data-state="open"]').filter({ hasText: /resumed/i }))
    ).toBeVisible({ timeout: 8_000 });
  });
});
