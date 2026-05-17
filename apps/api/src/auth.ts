import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
    database: {
        provider: "postgresql",
        url: process.env.DATABASE_URL!, // We'll configure this later
    },
    plugins: [
        organization({
            allowUserToCreateOrganization: false
        })
    ]
});
