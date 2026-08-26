import { headers } from 'next/headers';
import { ACTIVE_ORGANIZATION_COOKIE, parseActiveOrganizationId } from '@irth/db/activeOrganization';

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
    if (!cookie || !cookie.includes('better-auth.session_token')) return null;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    try {
        const res = await fetch(`${appUrl}/api/auth/get-session`, {
            headers: {
                cookie,
                'x-forwarded-host': headersList.get('x-forwarded-host') || headersList.get('host') || '',
            },
            cache: 'no-store',
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.session || !data?.user) return null;

        const activeOrganizationId = parseActiveOrganizationId(cookie);
        return {
            ...data,
            session: {
                ...data.session,
                ...(activeOrganizationId ? { activeOrganizationId } : {}),
            },
        } as VerifiedSession;
    } catch {
        return null;
    }
}
