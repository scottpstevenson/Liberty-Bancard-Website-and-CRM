import { QueryClient, QueryFunction } from "@tanstack/react-query";

export function getCsrfToken(): string | null {
  const match = document.cookie.match(
    new RegExp("(?:^|;\\s*)csrf_token=([^;]*)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * apiRequest() throws `Error(\`${status}: ${text}\`)` on a non-OK response,
 * where `text` is the raw response body — usually a JSON error object like
 * `{"error":"typed_confirmation_required","reason":"..."}`. Callers that
 * need to branch on the server's structured error code (not just show the
 * message) should catch the thrown error and pass its `.message` through
 * this helper rather than re-deriving JSON parsing inline. Returns an empty
 * object (no `code`/`reason`) for non-JSON bodies (e.g. an HTML error page)
 * instead of throwing.
 */
export function parseApiRequestError(message: string): { code?: string; reason?: string } {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return {};
  try {
    const body = JSON.parse(message.slice(jsonStart));
    return { code: body?.error, reason: body?.reason };
  } catch {
    return {};
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  additionalHeaders?: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = { ...additionalHeaders };
  if (data) headers["Content-Type"] = "application/json";

  const upperMethod = method.toUpperCase();
  const publicInboundPaths = [
    "/api/public/estimate",
    "/api/public/support",
    "/api/public/get-started",
    "/api/public/integration-request",
    "/api/public/callback",
    "/api/equipment-order",
    "/api/public/testimonial-submit",
    "/api/newsletter/subscribe",
  ];
  if (upperMethod === "POST" && publicInboundPaths.includes(url) && !headers["Idempotency-Key"]) {
    headers["Idempotency-Key"] = crypto.randomUUID();
  }
  if (upperMethod !== "GET" && upperMethod !== "HEAD" && upperMethod !== "OPTIONS") {
    const csrfToken = getCsrfToken();
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
