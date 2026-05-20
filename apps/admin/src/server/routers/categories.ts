import { router, protectedProcedure } from "../trpc";
import { categories } from "@irth/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { withAudit } from "@irth/db";

export const categoriesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const data = await ctx.db
      .select()
      .from(categories)
      .where(eq(categories.orgId, ctx.orgId))
      .orderBy(desc(categories.createdAt));

    return {
      data,
      error: null,
      meta: null,
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        parentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withAudit(
        ctx.db,
        async () => {
          const [category] = await ctx.db
            .insert(categories)
            .values({
              orgId: ctx.orgId,
              name: input.name,
              slug: input.slug,
              parentId: input.parentId,
            })
            .returning();
          return category;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: "CREATE_CATEGORY",
          tableName: "categories",
          changes: input,
        },
      );

      return { data: result, error: null, meta: null };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withAudit(
        ctx.db,
        async () => {
          const [deleted] = await ctx.db
            .delete(categories)
            .where(
              and(eq(categories.id, input.id), eq(categories.orgId, ctx.orgId)),
            )
            .returning();

          if (!deleted) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          return deleted;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: "DELETE_CATEGORY",
          tableName: "categories",
          changes: { id: input.id },
        },
      );

      return { data: result, error: null, meta: null };
    }),
});
