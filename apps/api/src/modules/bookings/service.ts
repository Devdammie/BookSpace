import { createHash } from 'node:crypto';
import {
  canCancel,
  canDecide,
  canEditPending,
  canViewBooking,
  evaluatePolicy,
  findFreeSlots,
  getZonedParts,
  intervalOverlapsBlock,
  occupiedEnd,
  toTstzRange,
  transition,
  type BookingStatus,
} from '@bookspace/shared';
import { and, asc, desc, eq, lte, ne, or, sql } from 'drizzle-orm';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import {
  approvals,
  auditLog,
  bookingEvents,
  bookings,
  idempotencyKeys,
  notifications,
  resourceApprovers,
  resourceBlocks,
  resourceHours,
  resources,
  users,
} from '../../db/schema.js';
import { isSlotConflict, pgCode, ProblemError } from '../../http/errors.js';
import { getDepartmentSettings } from '../../settings.js';
import type { Actor, BookingDto } from '../../types.js';

function hashRequest(input: { resourceId: string; startTime: string; endTime: string; purpose: string }) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function dto(input: {
  id: string;
  resourceId: string;
  resourceName: string;
  userId: string;
  requesterName: string;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  purpose: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  message?: string;
}): BookingDto {
  return {
    id: input.id,
    resourceId: input.resourceId,
    resourceName: input.resourceName,
    userId: input.userId,
    requesterName: input.requesterName,
    startTime: input.startTime.toISOString(),
    endTime: input.endTime.toISOString(),
    status: input.status,
    purpose: input.purpose,
    version: input.version,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    message: input.message,
  };
}

async function suggest(db: Database, input: {
  resourceId: string;
  start: Date;
  end: Date;
  bufferMinutes: number;
  timeZone: string;
  hours: { weekday: number; openTime: string; closeTime: string }[];
}) {
  const dateKey = getZonedParts(input.start, input.timeZone).dateKey;
  const weekday = getZonedParts(input.start, input.timeZone).weekday;
  const windows = input.hours.filter((hour) => hour.weekday === weekday);
  const openTime = windows[0]?.openTime ?? '08:00:00';
  const closeTime = windows[0]?.closeTime ?? '18:00:00';
  const confirmed = await db
    .select({ startTime: bookings.startTime, endTime: bookings.endTime })
    .from(bookings)
    .where(and(eq(bookings.resourceId, input.resourceId), eq(bookings.status, 'CONFIRMED')));
  const blocks = await db
    .select({ startTime: resourceBlocks.startTime, endTime: resourceBlocks.endTime })
    .from(resourceBlocks)
    .where(eq(resourceBlocks.resourceId, input.resourceId));
  const busy = [
    ...confirmed.map((row) => ({ start: row.startTime, end: occupiedEnd(row.endTime, input.bufferMinutes) })),
    ...blocks.map((row) => ({ start: row.startTime, end: row.endTime })),
  ];
  const durationMinutes = Math.max(15, Math.round((input.end.getTime() - input.start.getTime()) / 60_000));
  return findFreeSlots({
    dateKey,
    timeZone: input.timeZone,
    openTime,
    closeTime,
    durationMinutes,
    stepMinutes: 30,
    busy,
    limit: 3,
  }).map((slot) => ({ startTime: slot.start.toISOString(), endTime: slot.end.toISOString() }));
}

export function createBookingService(db: Database, config: AppConfig) {
  async function resourceContext(resourceId: string) {
    const [resource] = await db.select().from(resources).where(eq(resources.id, resourceId));
    if (!resource) throw new ProblemError(404, 'NOT_FOUND', 'Resource not found.');
    const hours = await db.select().from(resourceHours).where(eq(resourceHours.resourceId, resourceId));
    const blocks = await db.select().from(resourceBlocks).where(eq(resourceBlocks.resourceId, resourceId));
    const approverRows = await db
      .select({ userId: resourceApprovers.userId })
      .from(resourceApprovers)
      .where(eq(resourceApprovers.resourceId, resourceId));
    return {
      resource,
      hours: hours.map((hour) => ({ weekday: hour.weekday, openTime: hour.openTime, closeTime: hour.closeTime })),
      blocks,
      approverIds: approverRows.map((row) => row.userId),
    };
  }

  function assertPolicy(
    actor: Actor,
    context: Awaited<ReturnType<typeof resourceContext>>,
    start: Date,
    end: Date,
    timeZone: string,
  ) {
    const issue = evaluatePolicy({
      start,
      end,
      now: new Date(),
      timeZone,
      userType: actor.userType,
      resource: context.resource,
      hours: context.hours,
    });
    if (issue) throw new ProblemError(issue.status, issue.code, issue.detail);
    if (intervalOverlapsBlock(start, end, context.resource.bufferMinutes, context.blocks.map((block) => ({
      start: block.startTime,
      end: block.endTime,
    })))) {
      throw new ProblemError(409, 'RESOURCE_BLOCKED', 'The resource is blocked for maintenance or closure during that time.');
    }
  }

  async function withSuggestions(error: unknown, context: {
    resourceId: string;
    start: Date;
    end: Date;
    bufferMinutes: number;
    timeZone: string;
    hours: { weekday: number; openTime: string; closeTime: string }[];
  }): Promise<never> {
    if (error instanceof ProblemError && error.code === 'SLOT_CONFLICT') {
      const suggestions = await suggest(db, context);
      throw new ProblemError(409, 'SLOT_CONFLICT', error.detail, { suggestions });
    }
    if (isSlotConflict(error)) {
      const suggestions = await suggest(db, context);
      throw new ProblemError(409, 'SLOT_CONFLICT', 'That time was just reserved.', { suggestions });
    }
    throw error;
  }

  return {
    async create(
      actor: Actor,
      input: { resourceId: string; startTime: string; endTime: string; purpose: string },
      idempotencyKey?: string,
    ) {
      const start = new Date(input.startTime);
      const end = new Date(input.endTime);
      const canonical = {
        resourceId: input.resourceId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: input.purpose,
      };
      const requestHash = hashRequest(canonical);
      if (idempotencyKey) {
        const [existing] = await db
          .select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.userId, actor.id), eq(idempotencyKeys.key, idempotencyKey)));
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ProblemError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
          }
          return existing.responseBody as { data: BookingDto };
        }
      }

      const context = await resourceContext(input.resourceId);
      const department = await getDepartmentSettings(db, config.timezone);
      assertPolicy(actor, context, start, end, department.timezone);
      if (context.resource.approvalRequired && context.approverIds.length === 0) {
        throw new ProblemError(409, 'NO_APPROVER', 'This resource requires approval, but no approver is assigned yet.');
      }
      const range = toTstzRange(start, occupiedEnd(end, context.resource.bufferMinutes));
      const slotContext = {
        resourceId: context.resource.id,
        start,
        end,
        bufferMinutes: context.resource.bufferMinutes,
        timeZone: department.timezone,
        hours: context.hours,
      };

      try {
        return await db.transaction(async (tx) => {
          if (idempotencyKey) {
            await tx.insert(idempotencyKeys).values({
              userId: actor.id,
              key: idempotencyKey,
              requestHash,
              responseBody: { pending: true },
            });
          }
          if (!context.resource.approvalRequired) {
            await tx.execute(sql`select id from resources where id = ${context.resource.id} for update`);
          }
          const [created] = await tx
            .insert(bookings)
            .values({
              userId: actor.id,
              resourceId: context.resource.id,
              startTime: start,
              endTime: end,
              blockedRange: range,
              status: context.resource.approvalRequired ? 'PENDING_APPROVAL' : 'CONFIRMED',
              purpose: input.purpose,
            })
            .returning();
          const message = context.resource.approvalRequired
            ? 'Booking request submitted.'
            : 'Booking confirmed.';
          const body = {
            data: dto({
              ...created,
              resourceName: context.resource.name,
              requesterName: actor.fullName,
              message,
            }),
          };
          await tx.insert(bookingEvents).values({
            bookingId: created.id,
            actorId: actor.id,
            eventType: context.resource.approvalRequired ? 'submitted' : 'confirmed',
            fromStatus: null,
            toStatus: created.status,
            details: { purpose: input.purpose },
          });
          await tx.insert(auditLog).values({
            actorId: actor.id,
            action: context.resource.approvalRequired ? 'booking.submitted' : 'booking.confirmed',
            targetType: 'booking',
            targetId: created.id,
            details: { resourceId: context.resource.id },
          });
          if (context.resource.approvalRequired) {
            if (context.approverIds.length > 0) {
              await tx.insert(notifications).values(
                context.approverIds.map((userId) => ({
                  userId,
                  type: 'BOOKING_SUBMITTED',
                  payload: { bookingId: created.id, resourceName: context.resource.name, purpose: input.purpose },
                })),
              );
            }
          } else {
            await tx.insert(notifications).values({
              userId: actor.id,
              type: 'BOOKING_CONFIRMED',
              payload: { bookingId: created.id, resourceName: context.resource.name },
            });
          }
          if (idempotencyKey) {
            await tx
              .update(idempotencyKeys)
              .set({ responseBody: body })
              .where(and(eq(idempotencyKeys.userId, actor.id), eq(idempotencyKeys.key, idempotencyKey)));
          }
          return body;
        });
      } catch (error) {
        if (idempotencyKey && pgCode(error) === '23505') {
          const [existing] = await db
            .select()
            .from(idempotencyKeys)
            .where(and(eq(idempotencyKeys.userId, actor.id), eq(idempotencyKeys.key, idempotencyKey)));
          if (existing?.requestHash === requestHash && existing.responseBody && !(existing.responseBody as { pending?: boolean }).pending) {
            return existing.responseBody as { data: BookingDto };
          }
          throw new ProblemError(409, 'IDEMPOTENCY_CONFLICT', 'This request is already in progress. Retry in a moment.');
        }
        return withSuggestions(error, slotContext);
      }
    },

    async updatePending(
      actor: Actor,
      bookingId: string,
      input: { startTime: string; endTime: string; purpose: string; version: number },
    ) {
      const current = await this.get(actor, bookingId);
      if (!canEditPending(actor, current.userId, current.status)) {
        throw new ProblemError(409, 'INVALID_TRANSITION', 'Only a pending request can be edited.');
      }
      if (current.version !== input.version) throw new ProblemError(409, 'STALE_VERSION', 'This booking was updated. Reload and try again.');
      const start = new Date(input.startTime);
      const end = new Date(input.endTime);
      const context = await resourceContext(current.resourceId);
      const department = await getDepartmentSettings(db, config.timezone);
      assertPolicy(actor, context, start, end, department.timezone);
      const range = toTstzRange(start, occupiedEnd(end, context.resource.bufferMinutes));
      const [updated] = await db
        .update(bookings)
        .set({ startTime: start, endTime: end, purpose: input.purpose, blockedRange: range, version: input.version + 1, updatedAt: new Date() })
        .where(and(eq(bookings.id, bookingId), eq(bookings.version, input.version), eq(bookings.status, 'PENDING_APPROVAL')))
        .returning();
      if (!updated) throw new ProblemError(409, 'STALE_VERSION', 'This booking was updated. Reload and try again.');
      await db.insert(bookingEvents).values({
        bookingId,
        actorId: actor.id,
        eventType: 'edited',
        fromStatus: 'PENDING_APPROVAL',
        toStatus: 'PENDING_APPROVAL',
        details: { purpose: input.purpose },
      });
      await db.insert(auditLog).values({
        actorId: actor.id,
        action: 'booking.edited',
        targetType: 'booking',
        targetId: bookingId,
        details: {},
      });
      return { data: dto({ ...updated, resourceName: context.resource.name, requesterName: current.requesterName, message: 'Request updated.' }) };
    },

    async cancel(actor: Actor, bookingId: string, reason?: string) {
      const current = await this.get(actor, bookingId);
      if (!canCancel(actor, current.userId, current.status)) {
        throw new ProblemError(409, 'INVALID_TRANSITION', 'This booking cannot be cancelled.');
      }
      if (current.status === 'CONFIRMED' && !reason?.trim()) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'A reason is required to cancel a confirmed booking.');
      }
      let next: BookingStatus;
      try {
        next = transition(current.status, 'cancel');
      } catch {
        throw new ProblemError(409, 'INVALID_TRANSITION', 'This booking cannot be cancelled.');
      }
      const [updated] = await db
        .update(bookings)
        .set({ status: next, version: current.version + 1, updatedAt: new Date() })
        .where(and(eq(bookings.id, bookingId), eq(bookings.version, current.version), eq(bookings.status, current.status)))
        .returning();
      if (!updated) throw new ProblemError(409, 'STALE_VERSION', 'This booking was updated. Reload and try again.');
      await db.insert(bookingEvents).values({
        bookingId,
        actorId: actor.id,
        eventType: 'cancelled',
        fromStatus: current.status,
        toStatus: next,
        details: { reason: reason ?? '' },
      });
      await db.insert(auditLog).values({
        actorId: actor.id,
        action: 'booking.cancelled',
        targetType: 'booking',
        targetId: bookingId,
        details: { reason: reason ?? '' },
      });
      const recipients = new Set<string>([current.userId]);
      const context = await resourceContext(current.resourceId);
      for (const approverId of context.approverIds) recipients.add(approverId);
      await db.insert(notifications).values(
        [...recipients].map((userId) => ({
          userId,
          type: 'BOOKING_CANCELLED',
          payload: { bookingId, resourceName: current.resourceName, reason: reason ?? '' },
        })),
      );
      return { data: dto({ ...updated, resourceName: current.resourceName, requesterName: current.requesterName, message: 'Booking cancelled.' }) };
    },

    async approve(actor: Actor, bookingId: string, version: number) {
      return decide(actor, bookingId, version, 'approve');
    },

    async reject(actor: Actor, bookingId: string, version: number, reason: string) {
      return decide(actor, bookingId, version, 'reject', reason);
    },

    async reschedule(actor: Actor, bookingId: string, input: { startTime: string; endTime: string; version: number }) {
      if (!actor.roles.includes('admin')) throw new ProblemError(403, 'FORBIDDEN', 'Only an administrator can reschedule a confirmed booking.');
      const current = await this.get(actor, bookingId);
      if (current.status !== 'CONFIRMED') throw new ProblemError(409, 'INVALID_TRANSITION', 'Only a confirmed booking can be rescheduled in place.');
      if (current.version !== input.version) throw new ProblemError(409, 'STALE_VERSION', 'This booking was updated. Reload and try again.');
      const start = new Date(input.startTime);
      const end = new Date(input.endTime);
      const context = await resourceContext(current.resourceId);
      const department = await getDepartmentSettings(db, config.timezone);
      const [requester] = await db.select().from(users).where(eq(users.id, current.userId));
      if (!requester) throw new ProblemError(404, 'NOT_FOUND', 'Requester not found.');
      assertPolicy({ ...actor, id: requester.id, userType: requester.userType }, context, start, end, department.timezone);
      const range = toTstzRange(start, occupiedEnd(end, context.resource.bufferMinutes));
      const slotContext = {
        resourceId: context.resource.id,
        start,
        end,
        bufferMinutes: context.resource.bufferMinutes,
        timeZone: department.timezone,
        hours: context.hours,
      };
      try {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`select id from resources where id = ${context.resource.id} for update`);
          const [locked] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
          if (!locked || locked.version !== input.version || locked.status !== 'CONFIRMED') {
            throw new ProblemError(409, 'STALE_VERSION', 'This booking was updated. Reload and try again.');
          }
          const [updated] = await tx
            .update(bookings)
            .set({ startTime: start, endTime: end, blockedRange: range, version: locked.version + 1, updatedAt: new Date() })
            .where(eq(bookings.id, bookingId))
            .returning();
          await tx.insert(bookingEvents).values({
            bookingId,
            actorId: actor.id,
            eventType: 'rescheduled',
            fromStatus: 'CONFIRMED',
            toStatus: 'CONFIRMED',
            details: {},
          });
          await tx.insert(auditLog).values({
            actorId: actor.id,
            action: 'booking.rescheduled',
            targetType: 'booking',
            targetId: bookingId,
            details: { override: true },
          });
          await tx.insert(notifications).values({
            userId: current.userId,
            type: 'BOOKING_CHANGED',
            payload: { bookingId, resourceName: context.resource.name },
          });
          return { data: dto({ ...updated, resourceName: context.resource.name, requesterName: current.requesterName, message: 'Booking rescheduled.' }) };
        });
      } catch (error) {
        return withSuggestions(error, slotContext);
      }
    },

    async get(actor: Actor, bookingId: string): Promise<BookingDto> {
      const [row] = await db
        .select({
          booking: bookings,
          resourceName: resources.name,
          requesterName: users.fullName,
        })
        .from(bookings)
        .innerJoin(resources, eq(resources.id, bookings.resourceId))
        .innerJoin(users, eq(users.id, bookings.userId))
        .where(eq(bookings.id, bookingId));
      if (!row) throw new ProblemError(404, 'NOT_FOUND', 'Booking not found.');
      const approverRows = await db
        .select({ userId: resourceApprovers.userId })
        .from(resourceApprovers)
        .where(eq(resourceApprovers.resourceId, row.booking.resourceId));
      const approverIds = approverRows.map((item) => item.userId);
      if (!canViewBooking(actor, row.booking.userId, approverIds)) {
        throw new ProblemError(404, 'NOT_FOUND', 'Booking not found.');
      }
      return dto({ ...row.booking, resourceName: row.resourceName, requesterName: row.requesterName });
    },

    async list(
      actor: Actor,
      query: { page: number; pageSize: number; status?: BookingStatus; resourceId?: string; scope?: string },
    ) {
      const filters = [];
      if (query.status) filters.push(eq(bookings.status, query.status));
      if (query.resourceId) filters.push(eq(bookings.resourceId, query.resourceId));
      if (query.scope === 'all') {
        if (!actor.roles.includes('admin')) throw new ProblemError(403, 'FORBIDDEN', 'Only an administrator can list every booking.');
      } else if (query.scope === 'queue') {
        const assigned = await db
          .select({ resourceId: resourceApprovers.resourceId })
          .from(resourceApprovers)
          .where(eq(resourceApprovers.userId, actor.id));
        const ids = assigned.map((row) => row.resourceId);
        if (actor.roles.includes('admin')) {
          filters.push(eq(bookings.status, 'PENDING_APPROVAL'));
        } else if (ids.length === 0) {
          return { data: [], page: query.page, pageSize: query.pageSize, total: 0 };
        } else {
          filters.push(sql`${bookings.resourceId} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
          filters.push(eq(bookings.status, 'PENDING_APPROVAL'));
        }
      } else {
        filters.push(eq(bookings.userId, actor.id));
      }
      const where = filters.length ? and(...filters) : undefined;
      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(bookings).where(where);
      const rows = await db
        .select({ booking: bookings, resourceName: resources.name, requesterName: users.fullName })
        .from(bookings)
        .innerJoin(resources, eq(resources.id, bookings.resourceId))
        .innerJoin(users, eq(users.id, bookings.userId))
        .where(where)
        .orderBy(desc(bookings.startTime))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      return {
        data: rows.map((row) => dto({ ...row.booking, resourceName: row.resourceName, requesterName: row.requesterName })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },

    async events(actor: Actor, bookingId: string) {
      await this.get(actor, bookingId);
      const rows = await db
        .select({
          id: bookingEvents.id,
          eventType: bookingEvents.eventType,
          fromStatus: bookingEvents.fromStatus,
          toStatus: bookingEvents.toStatus,
          details: bookingEvents.details,
          createdAt: bookingEvents.createdAt,
          actorName: users.fullName,
        })
        .from(bookingEvents)
        .leftJoin(users, eq(users.id, bookingEvents.actorId))
        .where(eq(bookingEvents.bookingId, bookingId))
        .orderBy(asc(bookingEvents.createdAt));
      return {
        data: rows.map((row) => ({
          ...row,
          actorName: row.actorName ?? 'System',
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },

    async runMaintenance() {
      const department = await getDepartmentSettings(db, config.timezone);
      const now = new Date();
      await db.transaction(async (tx) => {
        const pending = await tx
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.status, 'PENDING_APPROVAL'),
              or(
                lte(bookings.startTime, now),
                sql`${bookings.createdAt} < now() - (${department.pendingExpiryHours} * interval '1 hour')`,
              ),
            ),
          )
          .limit(50)
          .for('update', { skipLocked: true });
        for (const booking of pending) {
          const [resource] = await tx.select({ name: resources.name }).from(resources).where(eq(resources.id, booking.resourceId));
          await tx
            .update(bookings)
            .set({ status: 'EXPIRED', version: booking.version + 1, updatedAt: now })
            .where(eq(bookings.id, booking.id));
          await tx.insert(bookingEvents).values({
            bookingId: booking.id,
            actorId: null,
            eventType: 'expired',
            fromStatus: 'PENDING_APPROVAL',
            toStatus: 'EXPIRED',
            details: {},
          });
          await tx.insert(notifications).values({
            userId: booking.userId,
            type: 'BOOKING_EXPIRED',
            payload: { bookingId: booking.id, resourceName: resource?.name ?? 'Resource' },
          });
        }
        const finished = await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.status, 'CONFIRMED'), lte(bookings.endTime, now)))
          .limit(50)
          .for('update', { skipLocked: true });
        for (const booking of finished) {
          const [resource] = await tx.select({ name: resources.name }).from(resources).where(eq(resources.id, booking.resourceId));
          await tx
            .update(bookings)
            .set({ status: 'COMPLETED', version: booking.version + 1, updatedAt: now })
            .where(eq(bookings.id, booking.id));
          await tx.insert(bookingEvents).values({
            bookingId: booking.id,
            actorId: null,
            eventType: 'completed',
            fromStatus: 'CONFIRMED',
            toStatus: 'COMPLETED',
            details: {},
          });
          await tx.insert(notifications).values({
            userId: booking.userId,
            type: 'BOOKING_COMPLETED',
            payload: { bookingId: booking.id, resourceName: resource?.name ?? 'Resource' },
          });
        }
      });
    },
  };

  async function decide(
    actor: Actor,
    bookingId: string,
    version: number,
    action: 'approve' | 'reject',
    reason = '',
  ) {
    const [row] = await db
      .select({ booking: bookings, resourceName: resources.name, requesterName: users.fullName })
      .from(bookings)
      .innerJoin(resources, eq(resources.id, bookings.resourceId))
      .innerJoin(users, eq(users.id, bookings.userId))
      .where(eq(bookings.id, bookingId));
    if (!row) throw new ProblemError(404, 'NOT_FOUND', 'Booking not found.');
    const context = await resourceContext(row.booking.resourceId);
    if (!canViewBooking(actor, row.booking.userId, context.approverIds)) {
      throw new ProblemError(404, 'NOT_FOUND', 'Booking not found.');
    }
    const permission = canDecide(actor, row.booking.userId, context.approverIds);
    if (!permission.ok) throw new ProblemError(403, 'FORBIDDEN', permission.reason);
    if (row.booking.version !== version) throw new ProblemError(409, 'STALE_VERSION', 'This booking was updated. Reload and try again.');
    let next: BookingStatus;
    try {
      next = transition(row.booking.status, action);
    } catch {
      throw new ProblemError(409, 'INVALID_TRANSITION', 'This request can no longer be decided.');
    }
    const department = await getDepartmentSettings(db, config.timezone);
    if (action === 'approve') {
      const [requester] = await db.select().from(users).where(eq(users.id, row.booking.userId));
      if (!requester) throw new ProblemError(404, 'NOT_FOUND', 'Requester not found.');
      assertPolicy(
        { ...actor, id: requester.id, userType: requester.userType },
        context,
        row.booking.startTime,
        row.booking.endTime,
        department.timezone,
      );
    }
    const range = toTstzRange(row.booking.startTime, occupiedEnd(row.booking.endTime, context.resource.bufferMinutes));
    const slotContext = {
      resourceId: context.resource.id,
      start: row.booking.startTime,
      end: row.booking.endTime,
      bufferMinutes: context.resource.bufferMinutes,
      timeZone: department.timezone,
      hours: context.hours,
    };
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select id from resources where id = ${context.resource.id} for update`);
        const [locked] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
        if (!locked || locked.version !== version || locked.status !== 'PENDING_APPROVAL') {
          throw new ProblemError(409, 'STALE_VERSION', 'This booking was updated. Reload and try again.');
        }
        if (action === 'approve') {
          const liveBlocks = await tx.select().from(resourceBlocks).where(eq(resourceBlocks.resourceId, context.resource.id));
          if (
            intervalOverlapsBlock(
              locked.startTime,
              locked.endTime,
              context.resource.bufferMinutes,
              liveBlocks.map((block) => ({ start: block.startTime, end: block.endTime })),
            )
          ) {
            throw new ProblemError(409, 'RESOURCE_BLOCKED', 'The resource is blocked during that time.');
          }
        }
        const [updated] = await tx
          .update(bookings)
          .set({
            status: next,
            blockedRange: range,
            version: locked.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, bookingId))
          .returning();
        await tx.insert(approvals).values({
          bookingId,
          approverId: actor.id,
          decision: action === 'approve' ? 'approved' : 'rejected',
          reason,
        });
        await tx.insert(bookingEvents).values({
          bookingId,
          actorId: actor.id,
          eventType: action === 'approve' ? 'approved' : 'rejected',
          fromStatus: 'PENDING_APPROVAL',
          toStatus: next,
          details: { reason, override: permission.override },
        });
        await tx.insert(auditLog).values({
          actorId: actor.id,
          action: permission.override ? 'booking.admin_override' : `booking.${action}d`,
          targetType: 'booking',
          targetId: bookingId,
          details: { reason, override: permission.override },
        });
        await tx.insert(notifications).values({
          userId: locked.userId,
          type: action === 'approve' ? 'BOOKING_CONFIRMED' : 'BOOKING_REJECTED',
          payload: { bookingId, resourceName: context.resource.name, reason },
        });
        if (action === 'approve') {
          const competitors = await tx
            .select()
            .from(bookings)
            .where(
              and(
                eq(bookings.resourceId, context.resource.id),
                eq(bookings.status, 'PENDING_APPROVAL'),
                ne(bookings.id, bookingId),
                sql`${bookings.blockedRange} && ${range}::tstzrange`,
              ),
            )
            .orderBy(asc(bookings.id))
            .for('update');
          for (const other of competitors) {
            await tx
              .update(bookings)
              .set({ status: 'REJECTED', version: other.version + 1, updatedAt: new Date() })
              .where(eq(bookings.id, other.id));
            await tx.insert(approvals).values({
              bookingId: other.id,
              approverId: actor.id,
              decision: 'rejected',
              reason: 'The time slot was given to another request.',
            });
            await tx.insert(bookingEvents).values({
              bookingId: other.id,
              actorId: actor.id,
              eventType: 'rejected',
              fromStatus: 'PENDING_APPROVAL',
              toStatus: 'REJECTED',
              details: { reason: 'SLOT_TAKEN' },
            });
            await tx.insert(notifications).values({
              userId: other.userId,
              type: 'SLOT_TAKEN',
              payload: { bookingId: other.id, resourceName: context.resource.name },
            });
          }
        }
        return {
          data: dto({
            ...updated,
            resourceName: row.resourceName,
            requesterName: row.requesterName,
            message: action === 'approve' ? 'Booking confirmed.' : 'Request rejected.',
          }),
        };
      });
    } catch (error) {
      return withSuggestions(error, slotContext);
    }
  }
}
