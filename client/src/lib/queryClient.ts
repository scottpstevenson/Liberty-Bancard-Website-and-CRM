import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { prepareWorkCreation, acknowledgeWorkCreation } from "./work-create-intent";
import { clearProtectedToasts } from "@/hooks/use-toast";

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
    return {
      code: typeof body?.code === "string" ? body.code : body?.error,
      reason: typeof body?.message === "string" ? body.message : body?.reason,
    };
  } catch {
    return {};
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  additionalHeaders?: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = { ...additionalHeaders };
  if (data) headers["Content-Type"] = "application/json";

  const upperMethod = method.toUpperCase();
  const taskCreation = upperMethod==="POST" && url==="/api/tasks";
  if (taskCreation) data = prepareWorkCreation(queryClient.getQueryData<{id:string}>(["/api/auth/user"])?.id,data);
  if (upperMethod !== "GET" && upperMethod !== "HEAD" && upperMethod !== "OPTIONS") {
    const csrfToken = getCsrfToken();
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    // Optional cancellation is used for reads. Durable commands retain their
    // existing idempotency/version/retry authority and are never auto-aborted.
    signal: upperMethod === "GET" || upperMethod === "HEAD" ? signal : undefined,
  });

  await throwIfResNotOk(res);
  if (taskCreation) {
    // Consume a clone before releasing the retry UUID. A failed/truncated
    // response body remains an unresolved intent, not a new creation.
    const accepted = await res.clone().json();
    if (!Number.isSafeInteger(accepted.id) || accepted.id<=0) throw new Error("Creation receipt unavailable. Retry the same intent.");
    acknowledgeWorkCreation(data);
  }
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      signal,
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

import {actorIdentity,currentProtectedIdentity,advanceProtectedIdentity,currentProtectedGeneration,
  notifyProtectedIdentity,type ProtectedActor} from "./protected-actor";
export {actorIdentity,currentProtectedIdentity,protectedScope,protectedContextToken,subscribeProtectedIdentity} from "./protected-actor";
let protectedTransition:Promise<void>=Promise.resolve();
/** Explicit public families survive session changes; everything else fails
 * closed. Endpoint-family prefixes remain unchanged for existing invalidators. */
export function isProtectedQuery(key: readonly unknown[]) {
  const endpoint = typeof key[0] === "string" ? key[0] : "";
  return endpoint !== "/api/auth/user" && ![
    "/api/blog", "/api/public", "/api/locations", "/api/industries",
    "/api/testimonials", "/api/case-studies", "/api/faq", "/api/site",
  ].some(prefix => endpoint === prefix || endpoint.startsWith(prefix + "/"));
}
export async function transitionProtectedActor(actor: ProtectedActor | null) {
  const next = actorIdentity(actor);
  if (next === currentProtectedIdentity()) return protectedTransition;
  // Fence first; delayed reads must not be reused while cancellation settles.
  const generation=advanceProtectedIdentity(next);
  clearProtectedToasts();
  protectedTransition=queryClient.cancelQueries({ predicate: q => isProtectedQuery(q.queryKey) }).then(()=>{
    if(generation===currentProtectedGeneration())
      queryClient.removeQueries({ predicate: q => isProtectedQuery(q.queryKey) });
  });
  notifyProtectedIdentity();
  await protectedTransition;
}
