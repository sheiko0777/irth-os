import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth-server';

/**
 * The Better Auth catch-all. Its absence is what made login impossible: the
 * client called /api/auth/sign-in/email and verifySession() called
 * /api/auth/get-session, and both 404'd. No test caught it because a missing
 * route is not a compile error — tsc, the suite and `next build` all passed
 * against an app that could not authenticate anyone.
 */
export const { GET, POST } = toNextJsHandler(auth);
