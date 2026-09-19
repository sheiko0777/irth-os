import { router, adminProcedure } from '../trpc';
import { auditLog, user, orgMembers, session, paginationOffset } from '@irth/db';
import { paginationInputSchema } from '../pagination';
import { eq, and, desc, sql, inArray, gte, lte, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { parseUserAgent } from '@/lib/device';
import { getActionMeta, getTableLabelAr } from '@/lib/auditLabels';

export const auditRouter = router({
  /**
   * List paginated audit logs with multi-field filtering and client device enrichment.
   * STRICTLY READ-ONLY.
   */
  list: adminProcedure
    .input(
      z.object({
        ...paginationInputSchema(25, 100),
        tableName: z.string().optional(),
        action: z.string().optional(),
        userId: z.string().optional(),
        search: z.string().trim().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await ctx.withOrg(async (tx) => {
        const { page, pageSize, tableName, action, userId, search, dateFrom, dateTo } = input;
        const offset = paginationOffset(page, pageSize);

        // Build filter conditions
        const conditions = [eq(auditLog.orgId, ctx.orgId)];

        if (tableName && tableName !== 'all') {
          conditions.push(eq(auditLog.tableName, tableName));
        }

        if (action && action !== 'all') {
          conditions.push(eq(auditLog.action, action));
        }

        if (userId && userId !== 'all') {
          conditions.push(eq(auditLog.userId, userId));
        }

        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          if (!isNaN(fromDate.getTime())) {
            conditions.push(gte(auditLog.createdAt, fromDate));
          }
        }

        if (dateTo) {
          const toDate = new Date(dateTo);
          if (!isNaN(toDate.getTime())) {
            // End of the day
            toDate.setHours(23, 59, 59, 999);
            conditions.push(lte(auditLog.createdAt, toDate));
          }
        }

        if (search) {
          const searchPattern = `%${search}%`;
          conditions.push(
            or(
              ilike(auditLog.action, searchPattern),
              ilike(auditLog.tableName, searchPattern),
              sql`cast(${auditLog.recordId} as text) ilike ${searchPattern}`,
              sql`cast(${auditLog.changes} as text) ilike ${searchPattern}`
            )!
          );
        }

        const whereClause = and(...conditions);

        // 1. Fetch total count and paginated rows
        const [totalResult, rows] = await Promise.all([
          tx
            .select({ count: sql<number>`count(*)::int` })
            .from(auditLog)
            .where(whereClause),
          tx
            .select({
              id: auditLog.id,
              orgId: auditLog.orgId,
              userId: auditLog.userId,
              action: auditLog.action,
              tableName: auditLog.tableName,
              recordId: auditLog.recordId,
              changes: auditLog.changes,
              createdAt: auditLog.createdAt,
              userName: user.name,
              userEmail: user.email,
              userImage: user.image,
              userRole: orgMembers.role,
            })
            .from(auditLog)
            .leftJoin(user, eq(auditLog.userId, user.id))
            .leftJoin(
              orgMembers,
              and(eq(orgMembers.userId, auditLog.userId), eq(orgMembers.orgId, ctx.orgId))
            )
            .where(whereClause)
            .orderBy(desc(auditLog.createdAt))
            .limit(pageSize)
            .offset(offset),
        ]);

        const total = totalResult[0]?.count ?? 0;

        // 2. Enrich rows with client/session metadata
        const userIds = Array.from(
          new Set(rows.map((r) => r.userId).filter((id): id is string => Boolean(id)))
        );

        let sessionsByUser = new Map<string, { ipAddress: string | null; userAgent: string | null }>();
        if (userIds.length > 0) {
          const activeSessions = await tx
            .select({
              userId: session.userId,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
            })
            .from(session)
            .where(inArray(session.userId, userIds))
            .orderBy(desc(session.createdAt));

          for (const s of activeSessions) {
            if (!sessionsByUser.has(s.userId)) {
              sessionsByUser.set(s.userId, {
                ipAddress: s.ipAddress,
                userAgent: s.userAgent,
              });
            }
          }
        }

        const items = rows.map((row) => {
          const userSession = row.userId ? sessionsByUser.get(row.userId) : null;
          const changesObj = (row.changes as Record<string, unknown> | null) || {};

          // Check if changes carries direct client info or fallback to session
          const rawUa =
            (changesObj._userAgent as string) ||
            userSession?.userAgent ||
            null;
          const ipAddress =
            (changesObj._ip as string) ||
            userSession?.ipAddress ||
            null;

          const parsedDevice = parseUserAgent(rawUa);
          const actionMeta = getActionMeta(row.action);
          const tableLabelAr = getTableLabelAr(row.tableName);

          return {
            id: row.id,
            action: row.action,
            actionLabelAr: actionMeta.labelAr,
            actionCategory: actionMeta.category,
            actionBadgeClass: actionMeta.badgeClass,
            tableName: row.tableName,
            tableLabelAr,
            recordId: row.recordId,
            changes: changesObj,
            createdAt: row.createdAt,
            actor: {
              id: row.userId,
              name: row.userName || (row.userId ? 'مستخدم مسجل' : 'النظام الآلي'),
              email: row.userEmail || null,
              image: row.userImage || null,
              role: row.userRole || (row.userId ? 'عضو' : 'نظام'),
            },
            client: {
              ipAddress,
              rawUa,
              deviceType: parsedDevice.deviceType,
              browser: parsedDevice.browser,
              os: parsedDevice.os,
              deviceLabelAr: parsedDevice.labelAr,
            },
          };
        });

        return {
          items,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize) || 1,
          },
        };
      });
    }),

  /**
   * Aggregated KPI statistics for the audit dashboard.
   * STRICTLY READ-ONLY.
   */
  stats: adminProcedure.query(async ({ ctx }) => {
    return await ctx.withOrg(async (tx) => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [totalCountResult, todayCountResult, uniqueUsersResult, latestRowResult] = await Promise.all([
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLog)
          .where(eq(auditLog.orgId, ctx.orgId)),
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.orgId, ctx.orgId),
              gte(auditLog.createdAt, todayStart)
            )
          ),
        tx
          .select({ count: sql<number>`count(distinct ${auditLog.userId})::int` })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.orgId, ctx.orgId),
              sql`${auditLog.userId} is not null`
            )
          ),
        tx
          .select({ createdAt: auditLog.createdAt, action: auditLog.action })
          .from(auditLog)
          .where(eq(auditLog.orgId, ctx.orgId))
          .orderBy(desc(auditLog.createdAt))
          .limit(1),
      ]);

      return {
        totalEvents: totalCountResult[0]?.count ?? 0,
        todayEvents: todayCountResult[0]?.count ?? 0,
        activeOperatorsCount: uniqueUsersResult[0]?.count ?? 0,
        latestEvent: latestRowResult[0] ?? null,
      };
    });
  }),

  /**
   * Get single audit record details for deep changeset inspection.
   * STRICTLY READ-ONLY.
   */
  getById: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return await ctx.withOrg(async (tx) => {
        const [row] = await tx
          .select({
            id: auditLog.id,
            orgId: auditLog.orgId,
            userId: auditLog.userId,
            action: auditLog.action,
            tableName: auditLog.tableName,
            recordId: auditLog.recordId,
            changes: auditLog.changes,
            createdAt: auditLog.createdAt,
            userName: user.name,
            userEmail: user.email,
            userImage: user.image,
            userRole: orgMembers.role,
          })
          .from(auditLog)
          .leftJoin(user, eq(auditLog.userId, user.id))
          .leftJoin(
            orgMembers,
            and(eq(orgMembers.userId, auditLog.userId), eq(orgMembers.orgId, ctx.orgId))
          )
          .where(and(eq(auditLog.id, input.id), eq(auditLog.orgId, ctx.orgId)))
          .limit(1);

        if (!row) {
          return null;
        }

        const changesObj = (row.changes as Record<string, unknown> | null) || {};
        const actionMeta = getActionMeta(row.action);

        let userSession = null;
        if (row.userId) {
          const sessions = await tx
            .select({
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
            })
            .from(session)
            .where(eq(session.userId, row.userId))
            .orderBy(desc(session.createdAt))
            .limit(1);
          userSession = sessions[0] || null;
        }

        const rawUa = (changesObj._userAgent as string) || userSession?.userAgent || null;
        const ipAddress = (changesObj._ip as string) || userSession?.ipAddress || null;
        const parsedDevice = parseUserAgent(rawUa);

        return {
          ...row,
          actionLabelAr: actionMeta.labelAr,
          actionCategory: actionMeta.category,
          tableLabelAr: getTableLabelAr(row.tableName),
          client: {
            ipAddress,
            rawUa,
            deviceLabelAr: parsedDevice.labelAr,
            browser: parsedDevice.browser,
            os: parsedDevice.os,
            deviceType: parsedDevice.deviceType,
          },
        };
      });
    }),
});
