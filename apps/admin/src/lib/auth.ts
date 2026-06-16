// Re-verify session per Next.js CVE-2025-29927.
// Server Components must actively fetch and verify the session against the auth
// provider (not just read the cookie) so revoked/expired sessions are rejected.
import { headers } from 'next/headers';

export type SessionUser = {
    id: string;
    email?: string;
    name?: string;
    role?: string;
};

export type VerifiedSession = {
    user: SessionUser;
    session: {
        id: string;
        activeOrganizationId?: string;
    };
};

export async function verifySession(): Promise<VerifiedSession | null> {
    const headersList = await headers();
    const cookie = headersList.get('cookie');

    if (!cookie || !cookie.includes('better-auth.session_token')) {
        return null;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    try {
        // Validate against Better Auth's get-session endpoint, forwarding the
        // cookie and x-forwarded-host (CVE-2025-29927 host-resolution mitigation).
        const res = await fetch(`${appUrl}/api/auth/get-session`, {
            headers: {
                cookie,
                'x-forwarded-host':
                    headersList.get('x-forwarded-host') || headersList.get('host') || '',
            },
            cache: 'no-store',
        });

        if (!res.ok) return null;

        const data = await res.json();
        if (!data || !data.session || !data.user) return null;

        return data as VerifiedSession;
    } catch {
        return null;
    }
}
