/**
 * Ownership rule shared by the campaign and sequence routes and the content workspace overview, so readers and writers
 * of the same objects cannot disagree. Admins reach everything; a manager reaches only objects they created (matched by
 * account email or id); every other role reaches none. Pure.
 */
export interface OwnershipActor { role?: unknown; email?: unknown; id?: unknown }

export function canMutateOwnedCampaignObject(user: OwnershipActor | undefined | null, createdBy: string | null | undefined): boolean {
  if (user?.role === "admin") return true;
  if (user?.role !== "manager" || !createdBy) return false;
  const email = typeof user.email === "string" ? user.email : null;
  const id = user.id == null ? null : String(user.id);
  return (email !== null && createdBy === email) || (id !== null && createdBy === id);
}
