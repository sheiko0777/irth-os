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

  // Read the role from wherever Better Auth surfaces it for the active org.
  // Default to null (most-restrictive) when absent — never assume 'owner'.
  // Server-side procedures (adminProcedure/ownerProcedure) are the source of
  // truth; this only gates UI affordances.
  const user = session.user as { role?: string };
  const sess = session.session as { activeOrganizationRole?: string; role?: string } | undefined;
  const role = user?.role || sess?.activeOrganizationRole || sess?.role;

  return role ? (role as Role) : null;
}
