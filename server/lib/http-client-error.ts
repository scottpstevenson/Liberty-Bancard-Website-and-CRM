import type { Duplex } from "node:stream";

/**
 * Explicit handling for HTTP protocol errors raised before a request reaches
 * Express (malformed or truncated requests, peers closing mid-request).
 *
 * Without a listener Node writes a 400 only when the socket is still writable
 * and otherwise destroys it with an unlogged `Parse Error`. Handling it here
 * makes the outcome deterministic: a closed 400 when the peer can still read,
 * a clean destroy otherwise, and one bounded summary line instead of one log
 * line per bad connection.
 */
const BAD_REQUEST_RESPONSE =
  "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

const LOG_INTERVAL_MS = 60_000;
let suppressed = 0;
let lastLoggedAt = 0;

export function handleHttpClientError(
  err: NodeJS.ErrnoException,
  socket: Duplex,
  now: () => number = Date.now,
): void {
  if (!socket.destroyed && socket.writable && err.code !== "ECONNRESET") {
    socket.end(BAD_REQUEST_RESPONSE);
  } else {
    socket.destroy();
  }

  if (err.code === "ECONNRESET") return; // routine peer reset, not a protocol error
  const at = now();
  if (at - lastLoggedAt >= LOG_INTERVAL_MS) {
    const extra = suppressed > 0 ? ` (+${suppressed} similar in the last minute)` : "";
    console.warn(`[HTTP] Rejected malformed client request: ${err.code ?? err.message}${extra}`);
    lastLoggedAt = at;
    suppressed = 0;
  } else {
    suppressed += 1;
  }
}

/**
 * Node closes an idle keep-alive connection after 5s by default, which is shorter than the idle timeout of the
 * proxy in front of this server. The proxy then reuses a connection the server has just closed, and the request
 * fails as a reset upstream (a 5xx) or arrives as a truncated request (HPE_INVALID_EOF_STATE). The server must keep
 * idle connections open longer than the proxy does, and headersTimeout must exceed keepAliveTimeout.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;
export const HEADERS_TIMEOUT_MS = 66_000;

export function configureHttpServerTimeouts(server: { keepAliveTimeout: number; headersTimeout: number }): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}
