import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

function buildAuth() {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret && process.env.NODE_ENV === "production") {
        throw new Error("BETTER_AUTH_SECRET must be set in production");
    }
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error("DATABASE_URL is not set");
    }
    return betterAuth({
        secret: secret ?? "dev-only-insecure-secret-change-me",
        baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787",
        database: {
            provider: "postgresql",
            url,
        },
        plugins: [
            organization({
                allowUserToCreateOrganization: false
            })
        ]
    });
}

type Auth = ReturnType<typeof buildAuth>;

let cached: Auth | undefined;

function resolveAuth(): Auth {
    if (!cached) {
        cached = buildAuth();
    }
    return cached;
}

// Same lazy-proxy reasoning as apps/api/src/db.ts: Better Auth opens its own
// postgres connection from DATABASE_URL, so building it eagerly at import time
// carries the identical Cloudflare Workers cold-start risk (env not wired up
// yet during isolate startup). Deferred to first property access, which only
// ever happens from inside a request handler (auth.handler(...) in index.ts,
// auth.api.getSession(...) in authContext.ts).
export const auth: Auth = new Proxy({} as Auth, {
    get(_target, prop) {
        const real = resolveAuth();
        const value = Reflect.get(real, prop, real);
        return typeof value === 'function' ? value.bind(real) : value;
    },
});

