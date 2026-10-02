export type GhlInboundCursor = { startAfter: string; startAfterId: string } | null;

/** nextPage is a page counter in GHL responses, not necessarily a URL. */
export function parseGhlInboundCursor(meta: any, location: string, pageSize: number): GhlInboundCursor {
  const nextValue = meta.nextPageUrl || (typeof meta.nextPage === "string" ? meta.nextPage : null);
  if (nextValue) {
    if (typeof nextValue !== "string") throw new Error("GHL_INBOUND_PAGINATION_INVALID");
    let nextUrl: URL;
    try {
      nextUrl = new URL(nextValue, "https://services.leadconnectorhq.com/contacts/");
    } catch {
      throw new Error("GHL_INBOUND_PAGINATION_INVALID");
    }
    if (nextUrl.hostname !== "services.leadconnectorhq.com" || nextUrl.protocol !== "https:" ||
        !/^\/contacts\/?$/.test(nextUrl.pathname) || nextUrl.username || nextUrl.password ||
        (nextUrl.port && nextUrl.port !== "443")) {
      throw new Error("GHL_INBOUND_PAGINATION_HOST_INVALID");
    }
    if (nextUrl.searchParams.get("locationId") !== location ||
        nextUrl.searchParams.get("limit") !== String(pageSize)) {
      throw new Error("GHL_INBOUND_PAGINATION_SCOPE_INVALID");
    }
    const startAfter = nextUrl.searchParams.get("startAfter");
    const startAfterId = nextUrl.searchParams.get("startAfterId");
    if (!startAfter || !startAfterId || startAfter.length > 200 || startAfterId.length > 200) {
      throw new Error("GHL_INBOUND_PAGINATION_CURSOR_MISSING");
    }
    return { startAfter, startAfterId };
  }
  if (meta.nextPage != null && typeof meta.nextPage !== "string" &&
      !(typeof meta.nextPage === "number" && Number.isSafeInteger(meta.nextPage) && meta.nextPage >= 0)) {
    throw new Error("GHL_INBOUND_PAGINATION_INVALID");
  }
  if (meta.startAfter != null || meta.startAfterId != null) {
    // The timestamp cursor may be an epoch-millisecond number.
    const startAfter = typeof meta.startAfter === "number" &&
      Number.isSafeInteger(meta.startAfter) && meta.startAfter >= 0
      ? String(meta.startAfter) : meta.startAfter;
    const startAfterId = meta.startAfterId;
    // GHL may return null cursors at the end of the list.
    if (!startAfter && !startAfterId) return null;
    if (typeof startAfter !== "string" || !startAfter || startAfter.length > 200 ||
        typeof startAfterId !== "string" || !startAfterId || startAfterId.length > 200) {
      throw new Error("GHL_INBOUND_PAGINATION_CURSOR_INVALID");
    }
    return { startAfter, startAfterId };
  }
  if (meta.nextPageToken) throw new Error("GHL_INBOUND_PAGINATION_CURSOR_UNSUPPORTED");
  // The caller checks totals/full pages before accepting end-of-list.
  return null;
}