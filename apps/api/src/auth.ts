import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set in production");
}

export const auth = betterAuth({
    secret: secret ?? "dev-only-insecure-secret-change-me",
    baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787",
    database: {
        provider: "postgresql",
        url: process.env.DATABASE_URL!,
    },
    plugins: [
        organization({
            allowUserToCreateOrganization: false
        })
    ]
});

