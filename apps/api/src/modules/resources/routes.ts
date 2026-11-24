import { and, asc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import {
  approversSchema,
  blockSchema,
  canViewBooking,
  hoursSchema,
  isStaff,
  listQuerySchema,
  occupiedEnd,
  toTstzRange,
  createResourceSchema,
  updateResourceSchema,
} from '@bookspace/shared';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import {
  auditLog,
  bookings,
  resourceApprovers,
  resourceBlocks,
  resourceHours,
  resources,
  userRoles,
  users,
} from '../../db/schema.js';
import { asyncRoute, parseOrThrow } from '../../http/async.js';
import { ProblemError } from '../../http/errors.js';
import { actorOf, requireAuth, requireRole } from '../../middleware/auth.js';
import { getDepartmentSettings } from '../../settings.js';
import type { AppConfig } from '../../config.js';

const listResourcesSchema = listQuerySchema.extend({
  kind: z.enum(['room', 'equipment']).optional(),
  location: z.string().max(200).optional(),
  q: z.string().max(100).optional(),
  capacityMin: z.coerce.number().int().positive().optional(),
  availableFrom: z.string().datetime().optional(),
  availableTo: z.string().datetime().optional(),
  status: z.enum(['active', 'maintenance', 'retired', 'all']).optional(),
});

function cleanTerm(value: string) {
  return `%${value.replace(/[%_]/g, '')}%`;
}

function windowsConflict(hours: { weekday: number; openTime: string; closeTime: string }[]) {
  for (let i = 0; i < hours.length; i += 1) {
    for (let j = i + 1; j < hours.length; j += 1) {
      const a = hours[i];
      const b = hours[j];
      if (a.weekday === b.weekday && a.openTime < b.closeTime && a.closeTime > b.openTime) return true;
    }
  }
  return false;
}

export function createResourceRouter(db: Database, _config: AppConfig) {
  const router = Router();
  const auth = requireAuth(db);
  const admin = [auth, requireRole('admin')] as const;

  router.get(
    '/',
    auth,
    asyncRoute(async (req, res) => {
      const query = parseOrThrow(listResourcesSchema, req.query);
      const actor = actorOf(req);
      const filters = [eq(resources.departmentId, actor.departmentId)];
      if (query.kind) filters.push(eq(resources.kind, query.kind));
      if (query.location) filters.push(eq(resources.location, query.location));
      if (query.capacityMin) filters.push(gte(resources.capacity, query.capacityMin));
      if (query.q) {
        const term = cleanTerm(query.q);
        filters.push(or(ilike(resources.name, term), ilike(resources.location, term))!);
      }
      if (!actor.roles.includes('admin')) {
        filters.push(eq(resources.status, 'active'));
      } else if (!query.status || query.status === 'active') {
        filters.push(eq(resources.status, 'active'));
      } else if (query.status !== 'all') {
        filters.push(eq(resources.status, query.status));
      }
      if (query.availableFrom && query.availableTo) {
        const from = new Date(query.availableFrom);
        const to = new Date(query.availableTo);
        filters.push(sql`not exists (
          select 1 from bookings
          where bookings.resource_id = ${resources.id}
            and bookings.department_id = ${actor.departmentId}
            and bookings.status = 'CONFIRMED'
            and bookings.blocked_range && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')
        )`);
        filters.push(sql`not exists (
          select 1 from resource_blocks
          where resource_blocks.resource_id = ${resources.id}
            and resource_blocks.start_time < ${to}
            and resource_blocks.end_time > ${from}
        )`);
      }
      const where = filters.length ? and(...filters) : undefined;
      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(resources).where(where);
      const rows = await db
        .select()
        .from(resources)
        .where(where)
        .orderBy(asc(resources.name))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const locations = await db
        .selectDistinct({ location: resources.location })
        .from(resources)
        .where(and(eq(resources.departmentId, actor.departmentId), eq(resources.status, 'active')))
        .orderBy(asc(resources.location));
      res.json({
        data: rows,
        page: query.page,
        pageSize: query.pageSize,
        total,
        facets: { locations: locations.map((row) => row.location) },
      });
    }),
  );

  router.post(
    '/',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(createResourceSchema, req.body);
      const actor = actorOf(req);
      if (body.maxMinutes < body.minMinutes) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'Maximum duration must be at least the minimum.');
      }
      if (body.parentResourceId) {
        const [parent] = await db
          .select({ id: resources.id })
          .from(resources)
          .where(and(eq(resources.id, body.parentResourceId), eq(resources.departmentId, actor.departmentId)));
        if (!parent) throw new ProblemError(400, 'VALIDATION_ERROR', 'Parent resource must belong to this department.');
      }
      const [created] = await db
        .insert(resources)
        .values({ ...body, departmentId: actor.departmentId })
        .returning();
      await db.insert(auditLog).values({
        departmentId: actor.departmentId,
        actorId: actor.id,
        action: 'resource.created',
        targetType: 'resource',
        targetId: created.id,
        details: { name: created.name },
      });
      res.status(201).json({ data: created });
    }),
  );

  router.get(
    '/:id/availability',
    auth,
    asyncRoute(async (req, res) => {
      const query = parseOrThrow(
        z.object({ from: z.string().datetime(), to: z.string().datetime() }),
        req.query,
      );
      const actor = actorOf(req);
      const [resource] = await db
        .select()
        .from(resources)
        .where(and(eq(resources.id, String(req.params.id)), eq(resources.departmentId, actor.departmentId)));
      if (!resource || (resource.status === 'retired' && !actor.roles.includes('admin'))) {
        throw new ProblemError(404, 'NOT_FOUND', 'Resource not found.');
      }
      const from = new Date(query.from);
      const to = new Date(query.to);
      const hours = await db.select().from(resourceHours).where(eq(resourceHours.resourceId, resource.id));
      const blocks = await db
        .select()
        .from(resourceBlocks)
        .where(
          and(
            eq(resourceBlocks.resourceId, resource.id),
            sql`${resourceBlocks.startTime} < ${to}`,
            sql`${resourceBlocks.endTime} > ${from}`,
          ),
        );
      const rows = await db
        .select({ booking: bookings, requesterName: users.fullName })
        .from(bookings)
        .innerJoin(users, eq(users.id, bookings.userId))
        .where(
          and(
            eq(bookings.resourceId, resource.id),
            eq(bookings.departmentId, actor.departmentId),
            sql`${bookings.status} in ('CONFIRMED', 'PENDING_APPROVAL')`,
            sql`${bookings.startTime} < ${to}`,
            sql`${bookings.endTime} > ${from}`,
          ),
        );
      const approverRows = await db
        .select({ userId: resourceApprovers.userId })
        .from(resourceApprovers)
        .where(eq(resourceApprovers.resourceId, resource.id));
      const approverIds = approverRows.map((row) => row.userId);
      const department = await getDepartmentSettings(db, actor.departmentId);
      res.json({
        data: {
          resourceId: resource.id,
          timezone: department.timezone,
          hours,
          blocks: blocks.map((block) => ({
            id: block.id,
            startTime: block.startTime.toISOString(),
            endTime: block.endTime.toISOString(),
            reason: block.reason,
          })),
          bookings: rows.map((row) => {
            const visible = canViewBooking(actor, row.booking.userId, approverIds);
            return {
              id: row.booking.id,
              startTime: row.booking.startTime.toISOString(),
              endTime: row.booking.endTime.toISOString(),
              status: row.booking.status,
              mine: row.booking.userId === actor.id,
              purpose: visible ? row.booking.purpose : undefined,
              requesterName: visible && isStaff(actor.roles) ? row.requesterName : undefined,
            };
          }),
        },
      });
    }),
  );

  router.get(
    '/:id',
    auth,
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const [resource] = await db
        .select()
        .from(resources)
        .where(and(eq(resources.id, String(req.params.id)), eq(resources.departmentId, actor.departmentId)));
      if (!resource || (resource.status === 'retired' && !actor.roles.includes('admin'))) {
        throw new ProblemError(404, 'NOT_FOUND', 'Resource not found.');
      }
      const hours = await db.select().from(resourceHours).where(eq(resourceHours.resourceId, resource.id)).orderBy(asc(resourceHours.weekday), asc(resourceHours.openTime));
      const blocks = await db.select().from(resourceBlocks).where(eq(resourceBlocks.resourceId, resource.id)).orderBy(asc(resourceBlocks.startTime));
      const approverRows = isStaff(actor.roles)
        ? await db.select({ userId: resourceApprovers.userId }).from(resourceApprovers).where(eq(resourceApprovers.resourceId, resource.id))
        : [];
      res.json({
        data: {
          ...resource,
          hours: hours.map((hour) => ({
            id: hour.id,
            weekday: hour.weekday,
            openTime: hour.openTime,
            closeTime: hour.closeTime,
          })),
          blocks: blocks.map((block) => ({
            id: block.id,
            startTime: block.startTime.toISOString(),
            endTime: block.endTime.toISOString(),
            reason: block.reason,
          })),
          approverIds: approverRows.map((row) => row.userId),
        },
      });
    }),
  );

  router.patch(
    '/:id',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(updateResourceSchema, req.body);
      const actor = actorOf(req);
      if (body.parentResourceId === String(req.params.id)) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'A resource cannot be its own parent.');
      }
      if (body.parentResourceId) {
        const [parent] = await db
          .select({ id: resources.id })
          .from(resources)
          .where(and(eq(resources.id, body.parentResourceId), eq(resources.departmentId, actor.departmentId)));
        if (!parent) throw new ProblemError(400, 'VALIDATION_ERROR', 'Parent resource must belong to this department.');
      }
      const [updated] = await db
        .update(resources)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(resources.id, String(req.params.id)), eq(resources.departmentId, actor.departmentId)))
        .returning();
      if (!updated) throw new ProblemError(404, 'NOT_FOUND', 'Resource not found.');
      await db.insert(auditLog).values({
        departmentId: actor.departmentId,
        actorId: actor.id,
        action: body.status && body.status !== 'active' ? 'resource.deactivated' : 'resource.updated',
        targetType: 'resource',
        targetId: updated.id,
        details: body,
      });
      res.json({ data: updated });
    }),
  );

  router.put(
    '/:id/hours',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(hoursSchema, req.body);
      if (body.hours.some((hour) => hour.closeTime <= hour.openTime)) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'Closing time must be after opening time.');
      }
      if (windowsConflict(body.hours)) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'Opening hours on the same day cannot overlap.');
      }
      const resourceId = String(req.params.id);
      const actor = actorOf(req);
      const [resource] = await db
        .select({ id: resources.id })
        .from(resources)
        .where(and(eq(resources.id, resourceId), eq(resources.departmentId, actor.departmentId)));
      if (!resource) throw new ProblemError(404, 'NOT_FOUND', 'Resource not found.');
      await db.transaction(async (tx) => {
        await tx.delete(resourceHours).where(eq(resourceHours.resourceId, resourceId));
        if (body.hours.length > 0) {
          await tx.insert(resourceHours).values(body.hours.map((hour) => ({ ...hour, resourceId })));
        }
      });
      await db.insert(auditLog).values({
        departmentId: actor.departmentId,
        actorId: actor.id,
        action: 'resource.hours_updated',
        targetType: 'resource',
        targetId: resourceId,
        details: { count: body.hours.length },
      });
      res.json({ data: body.hours });
    }),
  );

  router.post(
    '/:id/blocks',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(blockSchema, req.body);
      const start = new Date(body.startTime);
      const end = new Date(body.endTime);
      if (!(end > start)) throw new ProblemError(400, 'VALIDATION_ERROR', 'Block end must be after the start.');
      const resourceId = String(req.params.id);
      const actor = actorOf(req);
      const created = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from resources where id = ${resourceId} and department_id = ${actor.departmentId} for update`,
        );
        const [resource] = await tx
          .select()
          .from(resources)
          .where(and(eq(resources.id, resourceId), eq(resources.departmentId, actor.departmentId)));
        if (!resource) throw new ProblemError(404, 'NOT_FOUND', 'Resource not found.');
        const conflicts = await tx
          .select({ id: bookings.id, startTime: bookings.startTime, endTime: bookings.endTime })
          .from(bookings)
          .where(
            and(
              eq(bookings.resourceId, resourceId),
              eq(bookings.departmentId, actor.departmentId),
              eq(bookings.status, 'CONFIRMED'),
              sql`${bookings.blockedRange} && ${toTstzRange(start, occupiedEnd(end, 0))}::tstzrange`,
            ),
          );
        if (conflicts.length > 0) {
          throw new ProblemError(409, 'RESOURCE_BLOCKED', 'Cancel or move the confirmed bookings that overlap this closure.', {
            bookings: conflicts.map((booking) => ({
              id: booking.id,
              startTime: booking.startTime.toISOString(),
              endTime: booking.endTime.toISOString(),
            })),
          });
        }
        const [block] = await tx
          .insert(resourceBlocks)
          .values({ resourceId, startTime: start, endTime: end, reason: body.reason })
          .returning();
        return block;
      });
      await db.insert(auditLog).values({
        departmentId: actor.departmentId,
        actorId: actor.id,
        action: 'resource.block_created',
        targetType: 'resource',
        targetId: resourceId,
        details: { blockId: created.id, reason: body.reason },
      });
      res.status(201).json({ data: created });
    }),
  );

  router.delete(
    '/:id/blocks/:blockId',
    ...admin,
    asyncRoute(async (req, res) => {
      const actor = actorOf(req);
      const resourceId = String(req.params.id);
      const [resource] = await db
        .select({ id: resources.id })
        .from(resources)
        .where(and(eq(resources.id, resourceId), eq(resources.departmentId, actor.departmentId)));
      if (!resource) throw new ProblemError(404, 'NOT_FOUND', 'Resource not found.');
      const [removed] = await db
        .delete(resourceBlocks)
        .where(and(eq(resourceBlocks.id, String(req.params.blockId)), eq(resourceBlocks.resourceId, resourceId)))
        .returning();
      if (!removed) throw new ProblemError(404, 'NOT_FOUND', 'Block not found.');
      await db.insert(auditLog).values({
        departmentId: actor.departmentId,
        actorId: actor.id,
        action: 'resource.block_deleted',
        targetType: 'resource',
        targetId: String(req.params.id),
        details: { blockId: removed.id },
      });
      res.json({ data: { id: removed.id } });
    }),
  );

  router.put(
    '/:id/approvers',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(approversSchema, req.body);
      const resourceId = String(req.params.id);
      const actor = actorOf(req);
      const [resource] = await db
        .select({ id: resources.id })
        .from(resources)
        .where(and(eq(resources.id, resourceId), eq(resources.departmentId, actor.departmentId)));
      if (!resource) throw new ProblemError(404, 'NOT_FOUND', 'Resource not found.');
      if (body.userIds.length > 0) {
        const rows = await db
          .select({ id: users.id, roleId: userRoles.roleId, isActive: users.isActive })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .where(and(inArray(users.id, body.userIds), eq(users.departmentId, actor.departmentId)));
        const eligible = new Set(
          rows.filter((row) => row.isActive && (row.roleId === 'approver' || row.roleId === 'admin')).map((row) => row.id),
        );
        if (body.userIds.some((id) => !eligible.has(id))) {
          throw new ProblemError(400, 'VALIDATION_ERROR', 'Every approver must be an active approver or administrator.');
        }
      }
      await db.transaction(async (tx) => {
        await tx.delete(resourceApprovers).where(eq(resourceApprovers.resourceId, resourceId));
        if (body.userIds.length > 0) {
          await tx.insert(resourceApprovers).values(body.userIds.map((userId) => ({ resourceId, userId })));
        }
      });
      await db.insert(auditLog).values({
        departmentId: actor.departmentId,
        actorId: actor.id,
        action: 'resource.approvers_updated',
        targetType: 'resource',
        targetId: resourceId,
        details: { userIds: body.userIds },
      });
      res.json({ data: { userIds: body.userIds } });
    }),
  );

  return router;
}
