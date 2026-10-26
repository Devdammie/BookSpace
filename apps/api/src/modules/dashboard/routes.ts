import { and, eq, gte, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { bookings } from '../db/schema.js';
import { asyncRoute } from '../http/async.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { createBookingService } from '../modules/bookings/service.js';

export function createDashboardRouter(db: Database, config: AppConfig) {
  const router = Router();
  const service = createBookingService(db, config);
  router.get(
    '/',
    requireAuth(db),
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const mine = await service.list(actor, { page: 1, pageSize: 8, scope: 'mine' });
      const upcoming = await db
        .select({ id: bookings.id, startTime: bookings.startTime, endTime: bookings.endTime, status: bookings.status, purpose: bookings.purpose })
        .from(bookings)
        .where(and(eq(bookings.userId, actor.id), eq(bookings.status, 'CONFIRMED'), gte(bookings.startTime, new Date())))
        .orderBy(bookings.startTime)
        .limit(5);
      const [pending] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(eq(bookings.userId, actor.id), eq(bookings.status, 'PENDING_APPROVAL')));
      res.json({
        data: {
          upcoming: upcoming.map((row) => ({ ...row, startTime: row.startTime.toISOString(), endTime: row.endTime.toISOString() })),
          pending: pending?.count ?? 0,
          recent: mine.data,
        },
      });
    }),
  );
  return router;
}
