import type { NextFunction, Request, Response } from "express";
import { storage } from "../storage";
import { getInboxItem } from "../storage/inbox";
import { getInboxItemResolution } from "./inbox-item-resolution";

type DashboardUser = { role?: string; email?: string | null };

const NOT_FOUND = { message: "Not found", code: "CRM_OBJECT_NOT_FOUND" };

function isPrivileged(user: DashboardUser | undefined): boolean {
  return user?.role === "admin" || user?.role === "manager";
}

function canAccessOwner(user: DashboardUser | undefined, owner: string | null | undefined, exact: boolean): boolean {
  if (isPrivileged(user)) return true;
  if (user?.role !== "agent" || !user.email) return false;
  return exact ? owner === user.email : owner === null || owner === undefined || owner === user.email;
}

export function denyCrmObject(res: Response): false {
  res.status(404).json(NOT_FOUND);
  return false;
}

export async function authorizeContactAccess(
  req: Request,
  res: Response,
  contactId: number,
  options: { exactAssignment?: boolean } = {},
) {
  if (!Number.isInteger(contactId) || contactId <= 0) return denyCrmObject(res);
  const contact = await storage.getContact(contactId);
  if (!contact || !canAccessOwner(req.user as DashboardUser | undefined, contact.assignedTo, !!options.exactAssignment)) {
    return denyCrmObject(res);
  }
  return contact;
}

export async function authorizeDealAccess(
  req: Request,
  res: Response,
  dealId: number,
  options: { exactAssignment?: boolean } = {},
) {
  if (!Number.isInteger(dealId) || dealId <= 0) return denyCrmObject(res);
  const deal = await storage.getDeal(dealId);
  if (!deal || deal.archivedAt || !canAccessOwner(req.user as DashboardUser | undefined, deal.owner, !!options.exactAssignment)) {
    return denyCrmObject(res);
  }
  return deal;
}

/** Resolve server-derived Inbox metadata; never accept a body contactId as authority. */
export async function authorizeInboxItemAccess(
  req: Request,
  res: Response,
  sourceItemId: string,
  options: { exactAssignment?: boolean } = {},
) {
  const item = await getInboxItem(sourceItemId);
  const remembered = getInboxItemResolution(sourceItemId);
  const contactId = item?.contactId ?? remembered?.contactId;
  if (!contactId) return denyCrmObject(res);
  const contact = await authorizeContactAccess(req, res, contactId, options);
  if (!contact) return false;
  return {
    item,
    contact,
    channel: remembered?.channel ?? (item?.sourceItemType as "email" | "sms" | "ghl_chat" | "voicemail" | "site" | undefined),
    providerConversationId: remembered?.providerConversationId,
  };
}

/**
 * Covers every active `/api/contacts/:id` and `/api/deals/:id` detail path before
 * its handler runs. Route-specific helpers below remain necessary for indirect IDs
 * (notes, reviews, Inbox items), but this prevents drift across the large direct
 * Contact Detail inventory.
 */
export async function crmObjectAccessGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user as DashboardUser | undefined;
    if (user?.role !== "agent") return next();

    const contactMatch = req.path.match(/^\/api\/contacts\/(\d+)(?:\/|$)/);
    if (contactMatch) {
      if (!await authorizeContactAccess(req, res, Number(contactMatch[1]))) return;
    }

    const dealMatch = req.path.match(/^\/api\/deals\/(\d+)(?:\/|$)/);
    if (dealMatch) {
      if (!await authorizeDealAccess(req, res, Number(dealMatch[1]))) return;
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

export function agentOwnershipEmail(user: DashboardUser | undefined): string | undefined {
  return user?.role === "agent" && user.email ? user.email : undefined;
}

export function parseStrictPagination(
  raw: Record<string, unknown>,
  options: { defaultLimit: number; maxLimit: number; page?: boolean },
): { limit: number; offset: number; page?: number } | { error: "INVALID_PAGINATION" } {
  const parseInteger = (value: unknown, fallback: number, min: number, max: number): number | null => {
    if (value === undefined || value === "") return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= min && numeric <= max ? numeric : null;
  };

  const limit = parseInteger(raw.limit, options.defaultLimit, 1, options.maxLimit);
  if (limit === null) return { error: "INVALID_PAGINATION" };
  if (options.page) {
    const page = parseInteger(raw.page, 1, 1, Number.MAX_SAFE_INTEGER);
    return page === null ? { error: "INVALID_PAGINATION" } : { limit, offset: (page - 1) * limit, page };
  }
  const offset = parseInteger(raw.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  return offset === null ? { error: "INVALID_PAGINATION" } : { limit, offset };
}

export function invalidPagination(res: Response) {
  return res.status(400).json({ code: "INVALID_PAGINATION", message: "limit and offset/page must be positive whole-number values within the route limit" });
}