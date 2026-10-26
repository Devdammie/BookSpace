import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
});

export const userTypeEnum = pgEnum('user_type', ['student', 'lecturer', 'staff']);
export const resourceKindEnum = pgEnum('resource_kind', ['room', 'equipment']);
export const resourceStatusEnum = pgEnum('resource_status', ['active', 'maintenance', 'retired']);
export const bookingStatusEnum = pgEnum('booking_status', [
  'PENDING_APPROVAL',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
  'EXPIRED',
]);
export const approvalDecisionEnum = pgEnum('approval_decision', ['approved', 'rejected']);

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    userType: userTypeEnum('user_type').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: resourceKindEnum('kind').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    location: text('location').notNull(),
    capacity: integer('capacity').notNull(),
    status: resourceStatusEnum('status').notNull().default('active'),
    approvalRequired: boolean('approval_required').notNull().default(false),
    minMinutes: integer('min_minutes').notNull(),
    maxMinutes: integer('max_minutes').notNull(),
    maxAdvanceDays: integer('max_advance_days').notNull(),
    bufferMinutes: integer('buffer_minutes').notNull().default(0),
    assetTag: text('asset_tag'),
    serialNo: text('serial_no'),
    parentResourceId: uuid('parent_resource_id').references((): AnyPgColumn => resources.id, {
      onDelete: 'set null',
    }),
    allowedUserTypes: text('allowed_user_types').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('resources_capacity_positive', sql`${table.capacity} > 0`),
    check('resources_duration_positive', sql`${table.minMinutes} > 0 AND ${table.maxMinutes} >= ${table.minMinutes}`),
    check('resources_advance_nonnegative', sql`${table.maxAdvanceDays} >= 0`),
    check('resources_buffer_nonnegative', sql`${table.bufferMinutes} >= 0`),
  ],
);

export const resourceHours = pgTable(
  'resource_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id),
    weekday: smallint('weekday').notNull(),
    openTime: time('open_time').notNull(),
    closeTime: time('close_time').notNull(),
  },
  (table) => [
    index('resource_hours_resource_idx').on(table.resourceId),
    check('resource_hours_weekday', sql`${table.weekday} BETWEEN 0 AND 6`),
    check('resource_hours_order', sql`${table.closeTime} > ${table.openTime}`),
  ],
);

export const resourceBlocks = pgTable(
  'resource_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id),
    startTime: timestamp('start_time', { withTimezone: true, mode: 'date' }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true, mode: 'date' }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('resource_blocks_resource_idx').on(table.resourceId, table.startTime),
    check('resource_blocks_order', sql`${table.endTime} > ${table.startTime}`),
  ],
);

export const resourceApprovers = pgTable(
  'resource_approvers',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.resourceId, table.userId] }),
    index('resource_approvers_user_idx').on(table.userId),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id),
    startTime: timestamp('start_time', { withTimezone: true, mode: 'date' }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true, mode: 'date' }).notNull(),
    blockedRange: tstzrange('blocked_range').notNull(),
    status: bookingStatusEnum('status').notNull(),
    purpose: text('purpose').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('bookings_resource_start_idx').on(table.resourceId, table.startTime),
    index('bookings_user_start_idx').on(table.userId, table.startTime),
    index('bookings_pending_idx')
      .on(table.resourceId)
      .where(sql`${table.status} = 'PENDING_APPROVAL'`),
    check('bookings_time_order', sql`${table.endTime} > ${table.startTime}`),
    check('bookings_version_positive', sql`${table.version} > 0`),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    approverId: uuid('approver_id')
      .notNull()
      .references(() => users.id),
    decision: approvalDecisionEnum('decision').notNull(),
    reason: text('reason').notNull().default(''),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('approvals_booking_idx').on(table.bookingId)],
);

export const bookingEvents = pgTable(
  'booking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    actorId: uuid('actor_id').references(() => users.id),
    eventType: text('event_type').notNull(),
    fromStatus: bookingStatusEnum('from_status'),
    toStatus: bookingStatusEnum('to_status'),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('booking_events_booking_idx').on(table.bookingId, table.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('audit_log_created_idx').on(table.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('notifications_user_read_idx').on(table.userId, table.readAt)],
);

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  responseBody: jsonb('response_body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export const sessions = pgTable('session', {
  sid: varchar('sid').primaryKey(),
  sess: jsonb('sess').notNull(),
  expire: timestamp('expire', { mode: 'date', precision: 6 }).notNull(),
});
