import { createAuthClient } from "better-auth/react";
import { resolveAppBaseUrl } from "./appUrl";

export const authClient = createAuthClient({
  baseURL: resolveAppBaseUrl(),
});

export const { signIn, signOut, signUp, useSession } = authClient;
