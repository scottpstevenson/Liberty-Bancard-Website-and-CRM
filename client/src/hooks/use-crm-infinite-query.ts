import { useInfiniteQuery, type InfiniteData, type QueryKey, type UseInfiniteQueryOptions } from "@tanstack/react-query";
import { protectedScope } from "@/lib/queryClient";
import { useAuth } from "./use-auth";

/** Same actor-bound cache contract as useCrmQuery for signed continuation pages. */
export function useCrmInfiniteQuery<T,E=Error,D=InfiniteData<T>,K extends QueryKey=QueryKey,P=unknown>(
  options:UseInfiniteQueryOptions<T,E,D,T,QueryKey,P>,
) {
  const {user}=useAuth();
  const {queryKey,queryFn,enabled}=options;
  return useInfiniteQuery<T,E,D,QueryKey,P>({
    ...options,queryKey:[...queryKey,protectedScope(user)],
    queryFn:typeof queryFn==="function"?context=>queryFn({...context,queryKey}):queryFn,
    enabled:typeof enabled==="function"?query=>!!user && enabled(query):!!user && enabled!==false,
    placeholderData:undefined,
  });
}
