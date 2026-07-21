---
name: GHL fetch timeout — AbortController pattern
description: Every GHL API call must have a hard timeout or a stale TCP socket will block a BullMQ worker indefinitely.
---

## The problem

Node.js `fetch` has no built-in timeout. A stale keep-alive socket to GHL can hang for minutes, exhausting the BullMQ `lockDuration` and causing "could not renew lock" errors on every sync tick — even when GHL is otherwise healthy.

## The fix (in `server/services/ghl.ts`)

```ts
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), GHL_REQUEST_TIMEOUT_MS); // default 20 s
try {
  const response = await fetch(url, { ...options, headers, signal: controller.signal });
  clearTimeout(timeoutId);
  // ... handle response
} catch (err: unknown) {
  clearTimeout(timeoutId);  // Always clear to avoid leak
  const isAbort = err instanceof Error && err.name === "AbortError";
  const isRetryable = isAbort || errMsg.includes("ECONNRESET") || ...;
  // AbortError = our own timeout; treat as transient, retry with backoff
}
```

**Key rules:**
- Create a fresh `AbortController` per attempt (not shared across retries)
- Call `clearTimeout(timeoutId)` in BOTH the success path and the catch block
- Treat `AbortError` (`err.name === "AbortError"`) as retryable — it's our own timeout, not a permanent error
- `GHL_REQUEST_TIMEOUT_MS` env var controls the timeout (default 20000)

**How to apply:** Any service that makes outbound HTTP calls inside a BullMQ worker should use this pattern. 20 s is a safe default for GHL; increase only if specific endpoints are known to be slower.
