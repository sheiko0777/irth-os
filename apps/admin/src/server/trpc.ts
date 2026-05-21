import { initTRPC, TRPCError } from "@trpc/server";
import { db } from "@irth/db";
import { verifySession } from "@/lib/auth";

export const createContext = async () => {
  // Re-verify session per CVE-2025-29927
  const session = await verifySession();

  if (!session || !session.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // In a real scenario, this would come from the session context
  // after user is authenticated to a specific org.
  const orgId = session.user.orgId || "00000000-0000-0000-0000-000000000000";
  const userId = session.user.id;

  return {
    db,
    session,
    orgId,
    userId,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // Ensure orgId is present
  if (!ctx.orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No organization scope available.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      // Enforce non-null types for protected routes
      session: ctx.session,
      orgId: ctx.orgId,
      userId: ctx.userId,
    },
  });
});
