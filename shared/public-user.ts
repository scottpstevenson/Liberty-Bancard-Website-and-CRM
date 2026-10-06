/** Explicit public principal DTO. Never spread a stored authentication row:
 * current/future credentials and recovery bearers are not public profile data. */
export function publicUser(user: {
  id: string; email?: string | null; firstName?: string | null; lastName?: string | null;
  profileImageUrl?: string | null; role?: string | null; authProvider?: string | null;
  emailVerified?: unknown; agentId?: string | null; totpEnabled?: boolean | null;
  permissions?: unknown; tourCompletedAt?: unknown; createdAt?: unknown; updatedAt?: unknown;
  accountState?: string; accountVersion?: number;
}) {
  return {
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    profileImageUrl: user.profileImageUrl, role: user.role, authProvider: user.authProvider,
    emailVerified: user.emailVerified, agentId: user.agentId, totpEnabled: user.totpEnabled,
    permissions: user.permissions, tourCompletedAt: user.tourCompletedAt,
    createdAt: user.createdAt, updatedAt: user.updatedAt,
    accountState: user.accountState, accountVersion: user.accountVersion,
  };
}
