import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { isValidTimeZone, listQuerySchema, settingsSchema, utilization } from '@bookspace/shared';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { auditLog, bookings, resourceHours, resources, users } from '../../db/schema.js';
import { asyncRoute, parseOrThrow } from '../../http/async.js';
import { ProblemError } from '../../http/errors.js';
import { requireAuth, requireRole, actorOf } from '../../middleware/auth.js';
import { getDepartmentSettings, saveDepartmentSettings } from '../../settings.js';
import { createBookingService } from '../bookings/service.js';

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createAdminRouter(db: Database, config: AppConfig) {
  const router = Router();
  const auth = requireAuth(db);
  const admin = [auth, requireRole('admin')] as const;
  const staff = [auth, requireRole('admin', 'approver')] as const;
  const bookingsService = createBookingService(db, config);

  router.get(
    '/dashboard',
    ...admin,
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const counts = await db
        .select({ status: bookings.status, count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(eq(bookings.departmentId, actor.departmentId))
        .groupBy(bookings.status);
      const [resourceCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(resources)
        .where(eq(resources.departmentId, actor.departmentId));
      const [userCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.departmentId, actor.departmentId));
      const department = await getDepartmentSettings(db, actor.departmentId);
      const rangeStart = new Date();
      const rangeEnd = new Date(Date.now() + 7 * 86_400_000);
      const resourceRows = await db
        .select()
        .from(resources)
        .where(and(eq(resources.departmentId, actor.departmentId), eq(resources.status, 'active')));
      const hourRows = await db
        .select({
          resourceId: resourceHours.resourceId,
          weekday: resourceHours.weekday,
          openTime: resourceHours.openTime,
          closeTime: resourceHours.closeTime,
        })
        .from(resourceHours)
        .innerJoin(resources, eq(resources.id, resourceHours.resourceId))
        .where(eq(resources.departmentId, actor.departmentId));
      const bookingRows = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.departmentId, actor.departmentId),
            eq(bookings.status, 'CONFIRMED'),
            lte(bookings.startTime, rangeEnd),
            gte(bookings.endTime, rangeStart),
          ),
        );
      const usage = utilization({
        rangeStart,
        rangeEnd,
        timeZone: department.timezone,
        resources: resourceRows.map((resource) => ({
          id: resource.id,
          hours: hourRows
            .filter((hour) => hour.resourceId === resource.id)
            .map((hour) => ({ weekday: hour.weekday, openTime: hour.openTime, closeTime: hour.closeTime })),
        })),
        bookings: bookingRows.map((booking) => ({
          resourceId: booking.resourceId,
          start: booking.startTime,
          end: booking.endTime,
        })),
      });
      const queue = await bookingsService.list(actor, { page: 1, pageSize: 5, scope: 'queue' });
      res.json({
        data: {
          counts,
          resources: resourceCount?.count ?? 0,
          users: userCount?.count ?? 0,
          pending: queue.total,
          utilization: usage,
          timezone: department.timezone,
        },
      });
    }),
  );

  const reportSchema = listQuerySchema.extend({
    status: z.enum(['PENDING_APPROVAL', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED']).optional(),
    resourceId: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  });

  async function reportRows(departmentId: string, query: z.infer<typeof reportSchema>) {
    const filters = [eq(bookings.departmentId, departmentId)];
    if (query.status) filters.push(eq(bookings.status, query.status));
    if (query.resourceId) filters.push(eq(bookings.resourceId, query.resourceId));
    if (query.from) filters.push(gte(bookings.startTime, new Date(query.from)));
    if (query.to) filters.push(lte(bookings.startTime, new Date(query.to)));
    const where = filters.length ? and(...filters) : undefined;
    return db
      .select({
        id: bookings.id,
        resource: resources.name,
        requester: users.fullName,
        email: users.email,
        startTime: bookings.startTime,
        endTime: bookings.endTime,
        status: bookings.status,
        purpose: bookings.purpose,
      })
      .from(bookings)
      .innerJoin(
        resources,
        and(eq(resources.id, bookings.resourceId), eq(resources.departmentId, departmentId)),
      )
      .innerJoin(users, and(eq(users.id, bookings.userId), eq(users.departmentId, departmentId)))
      .where(where)
      .orderBy(desc(bookings.startTime))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
  }

  router.get(
    '/reports/bookings',
    ...staff,
    asyncRoute(async (req, res) => {
      const query = parseOrThrow(reportSchema, req.query);
      const rows = await reportRows(actorOf(req).departmentId, query);
      res.json({
        data: rows.map((row) => ({
          ...row,
          startTime: row.startTime.toISOString(),
          endTime: row.endTime.toISOString(),
        })),
      });
    }),
  );

  router.get(
    '/reports/bookings.csv',
    ...staff,
    asyncRoute(async (req, res) => {
      const query = parseOrThrow(reportSchema, { ...req.query, pageSize: req.query.pageSize ?? '1000' });
      const rows = await reportRows(actorOf(req).departmentId, query);
      const header = ['id', 'resource', 'requester', 'email', 'startTime', 'endTime', 'status', 'purpose'];
      const lines = [
        header.join(','),
        ...rows.map((row) =>
          [row.id, row.resource, row.requester, row.email, row.startTime.toISOString(), row.endTime.toISOString(), row.status, row.purpose]
            .map(csvCell)
            .join(','),
        ),
      ];
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="bookings.csv"');
      res.send(lines.join('\n'));
    }),
  );

  router.get(
    '/audit',
    ...admin,
    asyncRoute(async (req, res) => {
      const query = parseOrThrow(listQuerySchema, req.query);
      const actor = actorOf(req);
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(eq(auditLog.departmentId, actor.departmentId));
      const rows = await db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          details: auditLog.details,
          createdAt: auditLog.createdAt,
          actorName: users.fullName,
        })
        .from(auditLog)
        .leftJoin(
          users,
          and(eq(users.id, auditLog.actorId), eq(users.departmentId, actor.departmentId)),
        )
        .where(eq(auditLog.departmentId, actor.departmentId))
        .orderBy(desc(auditLog.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      res.json({
        data: rows.map((row) => ({ ...row, actorName: row.actorName ?? 'System', createdAt: row.createdAt.toISOString() })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      });
    }),
  );

  router.get(
    '/settings',
    ...admin,
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      res.json({ data: await getDepartmentSettings(db, actor.departmentId) });
    }),
  );

  router.patch(
    '/settings',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(settingsSchema, req.body);
      if (!isValidTimeZone(body.timezone)) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'Unknown timezone.');
      }
      const actor = actorOf(req);
      await saveDepartmentSettings(db, actor.departmentId, body);
      await db.insert(auditLog).values({
        departmentId: actor.departmentId,
        actorId: actor.id,
        action: 'settings.updated',
        targetType: 'settings',
        targetId: 'department',
        details: body,
      });
      res.json({ data: body });
    }),
  );

  return router;
}
