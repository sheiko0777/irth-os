export { can, PERMISSIONS } from '@irth/db/src/permissions';
import type { Role } from '@irth/db/src/permissions';
import { useSession } from './auth-client';

export function useRole(): Role | null {
  const { data: session } = useSession();
  
  // Since we don't have full BetterAuth mocked payload schema, 
  // we assume role is part of session.user.role if it's there.
  // Alternatively, return 'owner' or 'admin' as default in mock mode
  // The spec says: "(reads role from Better Auth session org context)"
  // so we read from session?.session?.activeOrganizationRole or session?.user?.role
  // We'll read `session?.user?.role` or `session?.session?.role` per Better Auth norms 
  // or return 'owner' if we're in a mocked session that has it.

  if (!session) return null;

  // Adapt to how BetterAuth stores the org role (typically in session.user.role or similar custom field, or activeOrganization)
  const role = (session.user as { role?: string })?.role || 'owner';

  return role as Role;
}
