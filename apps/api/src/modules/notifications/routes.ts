import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { listQuerySchema } from '@bookspace/shared';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { notifications } from '../../db/schema.js';
import { asyncRoute, parseOrThrow } from '../../http/async.js';
import { ProblemError } from '../../http/errors.js';
import { actorOf, requireAuth } from '../../middleware/auth.js';

const querySchema = listQuerySchema.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export function createNotificationRouter(db: Database) {
  const router = Router();
  const auth = requireAuth(db);

  router.get(
    '/',
    auth,
    asyncRoute(async (req, res) => {
      const query = parseOrThrow(querySchema, req.query);
      const actor = actorOf(req);
      const filters = [
        eq(notifications.departmentId, actor.departmentId),
        eq(notifications.userId, actor.id),
      ];
      if (query.unread) filters.push(isNull(notifications.readAt));
      const where = and(...filters);
      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(notifications).where(where);
      const rows = await db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      res.json({
        data: rows.map((row) => ({
          id: row.id,
          type: row.type,
          payload: row.payload,
          createdAt: row.createdAt.toISOString(),
          readAt: row.readAt?.toISOString() ?? null,
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      });
    }),
  );

  router.post(
    '/read-all',
    auth,
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.departmentId, actor.departmentId),
            eq(notifications.userId, actor.id),
            isNull(notifications.readAt),
          ),
        );
      res.json({ data: { ok: true } });
    }),
  );

  router.post(
    '/:id/read',
    auth,
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const [updated] = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, String(req.params.id)),
            eq(notifications.departmentId, actor.departmentId),
            eq(notifications.userId, actor.id),
          ),
        )
        .returning({ id: notifications.id });
      if (!updated) throw new ProblemError(404, 'NOT_FOUND', 'Notification not found.');
      res.json({ data: { id: updated.id } });
    }),
  );

  return router;
}
