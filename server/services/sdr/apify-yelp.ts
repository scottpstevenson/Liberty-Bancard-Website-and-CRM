/** Yelp Search API returns one dataset item per page; ads/error pages are not leads. */
export const YELP_SEARCH_ACTOR = "johnvc/yelp-search-api";
export function apifyActorPath(actor: string): string {
  return encodeURIComponent(actor.replace("/", "~"));
}
export function yelpSearchInput(searchTerm: string, location: string, limit: number) {
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.min(500, Math.floor(limit))) : 0;
  return { boundedLimit, input: { search_term: searchTerm, location, max_pages: Math.ceil(boundedLimit / 10) } };
}
export function yelpOrganicResults(items: Record<string, any>[]): Record<string, any>[] {
  return items.filter(page => !page.error)
    .flatMap(page => Array.isArray(page.organic_results) ? page.organic_results : [])
    .filter(row => row && typeof row === "object" && typeof row.title === "string" && row.title.trim());
}
