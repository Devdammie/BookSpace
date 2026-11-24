import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { addDays, getZonedParts, zonedTimeToUtc } from '@bookspace/shared';
import { loadConfig } from './config.js';
import { createDatabase, type Database } from './db/client.js';
import {
  bookings,
  departments,
  resourceApprovers,
  resourceBlocks,
  resourceHours,
  resources,
  roles,
  userRoles,
  users,
} from './db/schema.js';
import { hashPassword } from './modules/auth/passwords.js';
import { createBookingService } from './modules/bookings/service.js';

export const DEMO_USERS = {
  admin: { email: 'ada.admin@bookspace.test', password: 'AdminPass!234', fullName: 'Ada Admin', userType: 'staff' as const, roles: ['admin', 'member'] as const },
  approver: { email: 'owen.officer@bookspace.test', password: 'ApproverPass!234', fullName: 'Owen Officer', userType: 'staff' as const, roles: ['approver', 'member'] as const },
  lecturer: { email: 'leah.lecturer@bookspace.test', password: 'LecturerPass!234', fullName: 'Leah Lecturer', userType: 'lecturer' as const, roles: ['member'] as const },
  student: { email: 'sam.student@bookspace.test', password: 'StudentPass!234', fullName: 'Sam Student', userType: 'student' as const, roles: ['member'] as const },
};

function nextWeekday(timeZone: string, weekday: number, time: string) {
  const today = getZonedParts(new Date(), timeZone).dateKey;
  for (let offset = 1; offset <= 21; offset += 1) {
    const dateKey = addDays(today, offset);
    const instant = zonedTimeToUtc(dateKey, time, timeZone);
    if (getZonedParts(instant, timeZone).weekday === weekday && instant.getTime() > Date.now()) return instant;
  }
  throw new Error(`No upcoming weekday ${weekday}`);
}

export async function seedDatabase(db: Database) {
  const config = loadConfig();
  if (config.isProduction && process.env.ALLOW_DEMO_SEED !== 'yes') {
    throw new Error('Refusing to load demo accounts in production. Set ALLOW_DEMO_SEED=yes to override.');
  }

  await db
    .insert(roles)
    .values([
      { id: 'member', description: 'Can request and manage their own bookings.' },
      { id: 'approver', description: 'Can approve bookings for assigned resources.' },
      { id: 'admin', description: 'Can administer the department.' },
    ])
    .onConflictDoNothing();

  const [department] = await db
    .insert(departments)
    .values({
      name: 'Demo Department',
      slug: 'demo',
      timezone: config.timezone,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: departments.slug,
      set: { timezone: config.timezone, isActive: true },
    })
    .returning();

  const ids = new Map<string, string>();
  for (const person of Object.values(DEMO_USERS)) {
    const passwordHash = await hashPassword(person.password);
    const [existing] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.departmentId, department.id),
          sql`lower(${users.email}) = ${person.email}`,
        ),
      );
    let userId = existing?.id;
    if (!userId) {
      const [created] = await db
        .insert(users)
        .values({
          departmentId: department.id,
          email: person.email,
          fullName: person.fullName,
          userType: person.userType,
          passwordHash,
          mustChangePassword: false,
        })
        .returning({ id: users.id });
      userId = created.id;
    } else {
      await db
        .update(users)
        .set({ passwordHash, fullName: person.fullName, userType: person.userType, isActive: true, mustChangePassword: false, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await db.delete(userRoles).where(eq(userRoles.userId, userId));
    }
    await db.insert(userRoles).values(person.roles.map((roleId) => ({ userId: userId!, roleId })));
    ids.set(person.email, userId!);
  }

  const catalogue = [
    {
      name: 'Computer Lab A',
      kind: 'room' as const,
      location: 'Building A, Level 2',
      capacity: 30,
      approvalRequired: true,
      minMinutes: 60,
      maxMinutes: 180,
      bufferMinutes: 15,
      description: 'Teaching lab with 30 workstations.',
      allowedUserTypes: [] as string[],
    },
    {
      name: 'Seminar Room B',
      kind: 'room' as const,
      location: 'Building A, Level 1',
      capacity: 12,
      approvalRequired: false,
      minMinutes: 30,
      maxMinutes: 120,
      bufferMinutes: 0,
      description: 'Small seminar room with a display.',
      allowedUserTypes: [] as string[],
    },
    {
      name: 'Oscilloscope 1',
      kind: 'equipment' as const,
      location: 'Electronics bench',
      capacity: 1,
      approvalRequired: true,
      minMinutes: 30,
      maxMinutes: 240,
      bufferMinutes: 0,
      description: 'Benchtop oscilloscope.',
      assetTag: 'EQ-1001',
      serialNo: 'OSC-1001',
      allowedUserTypes: ['lecturer', 'staff'],
    },
    {
      name: 'Projector 4',
      kind: 'equipment' as const,
      location: 'Media cupboard',
      capacity: 1,
      approvalRequired: false,
      minMinutes: 30,
      maxMinutes: 240,
      bufferMinutes: 10,
      description: 'Portable projector.',
      assetTag: 'EQ-2004',
      serialNo: 'PRJ-4',
      allowedUserTypes: [] as string[],
    },
  ];

  const resourceIds = new Map<string, string>();
  for (const item of catalogue) {
    const [existing] = await db
      .select()
      .from(resources)
      .where(and(eq(resources.departmentId, department.id), eq(resources.name, item.name)));
    if (existing) {
      resourceIds.set(item.name, existing.id);
      continue;
    }
    const [created] = await db
      .insert(resources)
      .values({ ...item, departmentId: department.id, maxAdvanceDays: 30, parentResourceId: null })
      .returning({ id: resources.id });
    resourceIds.set(item.name, created.id);
  }

  const labId = resourceIds.get('Computer Lab A')!;
  const seminarId = resourceIds.get('Seminar Room B')!;
  const scopeId = resourceIds.get('Oscilloscope 1')!;
  await db
    .update(resources)
    .set({ parentResourceId: labId })
    .where(and(eq(resources.id, scopeId), eq(resources.departmentId, department.id)));

  for (const resourceId of [labId, seminarId, scopeId, resourceIds.get('Projector 4')!]) {
    const existingHours = await db.select().from(resourceHours).where(eq(resourceHours.resourceId, resourceId));
    if (existingHours.length > 0) continue;
    await db.insert(resourceHours).values(
      [1, 2, 3, 4, 5].map((weekday) => ({
        resourceId,
        weekday,
        openTime: '08:00:00',
        closeTime: '18:00:00',
      })),
    );
  }

  const approverId = ids.get(DEMO_USERS.approver.email)!;
  for (const resourceId of [labId, scopeId]) {
    const existing = await db
      .select()
      .from(resourceApprovers)
      .where(eq(resourceApprovers.resourceId, resourceId));
    if (existing.length > 0) continue;
    await db.insert(resourceApprovers).values({ resourceId, userId: approverId });
  }

  const existingBlocks = await db.select().from(resourceBlocks).where(eq(resourceBlocks.resourceId, seminarId));
  if (existingBlocks.length === 0) {
    const start = nextWeekday(config.timezone, 5, '12:00:00');
    await db.insert(resourceBlocks).values({
      resourceId: seminarId,
      startTime: start,
      endTime: new Date(start.getTime() + 60 * 60 * 1000),
      reason: 'Cleaning',
    });
  }

  const service = createBookingService(db, config);
  const studentId = ids.get(DEMO_USERS.student.email)!;
  const [student] = await db.select().from(users).where(eq(users.id, studentId));
  const actor = {
    id: student.id,
    departmentId: department.id,
    departmentSlug: 'demo',
    email: student.email,
    fullName: student.fullName,
    userType: student.userType,
    roles: ['member'] as Array<'member'>,
    mustChangePassword: false,
    isActive: true,
  };
  const existingBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.departmentId, department.id))
    .limit(1);
  if (existingBookings.length === 0) {
    const seminarStart = nextWeekday(config.timezone, 3, '09:00:00');
    await service.create(actor, {
      resourceId: seminarId,
      startTime: seminarStart.toISOString(),
      endTime: new Date(seminarStart.getTime() + 90 * 60 * 1000).toISOString(),
      purpose: 'Project standup',
    });
    const labStart = nextWeekday(config.timezone, 2, '10:00:00');
    await service.create(actor, {
      resourceId: labId,
      startTime: labStart.toISOString(),
      endTime: new Date(labStart.getTime() + 120 * 60 * 1000).toISOString(),
      purpose: 'Software engineering practical',
    });
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error('Set DATABASE_URL before seeding.');
    process.exit(1);
  }
  const { pool, db } = createDatabase(config.databaseUrl);
  seedDatabase(db)
    .then(async () => {
      console.log('Demo data ready.');
      console.log('Admin   ', DEMO_USERS.admin.email, DEMO_USERS.admin.password);
      console.log('Approver', DEMO_USERS.approver.email, DEMO_USERS.approver.password);
      console.log('Lecturer', DEMO_USERS.lecturer.email, DEMO_USERS.lecturer.password);
      console.log('Student ', DEMO_USERS.student.email, DEMO_USERS.student.password);
      await pool.end();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
