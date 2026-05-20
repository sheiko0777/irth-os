import { headers } from 'next/headers';

interface User {
    id: string;
    orgId: string;
}

interface SessionData {
    session: unknown;
    user: User;
}

export async function verifySession() {
    const headersList = await headers();

    const cookie = headersList.get('cookie');

    if (!cookie || !cookie.includes('better-auth.session_token')) {
        return null;
    }

    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
        const res = await fetch(`${apiUrl}/api/auth/get-session`, {
            headers: { cookie }
        });

        if (!res.ok) throw new Error('Invalid session');

        const data = await res.json() as SessionData;
        return data.user ? { user: data.user } : null;
    } catch (e) {
        return null;
    }
}
