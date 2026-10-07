import { useQuery, skipToken, type UseQueryOptions, type QueryKey, type QueryFunction } from "@tanstack/react-query";
import { getQueryFn, protectedScope } from "@/lib/queryClient";
import { useAuth } from "./use-auth";

/** Adopted Contact reads keep their old family/id prefixes and explicit
 * request URL. Only cache identity receives the actor/permission generation. */
export function useCrmQuery<T = unknown, E = Error, D = T>(
  options: UseQueryOptions<T, E, D, QueryKey>,
) {
  const {user} = useAuth();
  const originalKey = options.queryKey;
  const fn = options.queryFn;
  const enabled = options.enabled;
  const queryFn: QueryFunction<T, QueryKey> = context => {
    const unscoped = {...context, queryKey: originalKey};
    if (typeof fn === "function") return fn(unscoped);
    return getQueryFn<T>({on401:"throw"})(unscoped);
  };
  return useQuery<T,E,D,QueryKey>({
    ...options,
    queryKey:[...originalKey, protectedScope(user)],
    queryFn:fn === skipToken ? skipToken : queryFn,
    enabled:typeof enabled === "function" ? query=>!!user && enabled(query) : !!user && enabled !== false,
    // Never bridge another actor, entity or filter through previous data.
    placeholderData:undefined,
  });
}
