import type { Role } from '@irth/db';

// Trusted request identity established by authContext. Typing these makes
// c.get/c.set on the Hono context safe.
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    orgId: string;
    role: Role;
    // Set by authContext alongside userId — needed by /invite/accept's
    // email-match check (packages/db/src/invites.ts's acceptOrgInvite).
    userEmail: string | undefined;
  }
}
