import { addDays, getZonedParts, zonedTimeToUtc } from '@bookspace/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createApp } from '../../src/app.js';
import { loadConfig, resetConfigForTests } from '../../src/config.js';
import { createDatabase, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { departments, resources } from '../../src/db/schema.js';
import { DEMO_USERS, seedDatabase } from '../../src/seed.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { userRoles, users } from '../../src/db/schema.js';

loadConfig();
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('tenant isolation', () => {
  let db: Database;
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>['app'];
  let otherSlug = 'other-lab';
  let otherResourceId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    resetConfigForTests();
    const config = loadConfig();
    const created = createDatabase(config.databaseUrl);
    db = created.db;
    pool = created.pool;
    await runMigrations(db);
    await seedDatabase(db);
    await db.execute(
      sql`truncate table bookings, approvals, booking_events, notifications, idempotency_keys, audit_log restart identity cascade`,
    );

    const [department] = await db
      .insert(departments)
      .values({ name: 'Other Lab', slug: otherSlug, timezone: 'America/Los_Angeles' })
      .onConflictDoUpdate({
        target: departments.slug,
        set: { name: 'Other Lab', isActive: true },
      })
      .returning();

    const [admin] = await db
      .insert(users)
      .values({
        departmentId: department.id,
        email: 'other.admin@bookspace.test',
        fullName: 'Other Admin',
        userType: 'staff',
        passwordHash: await hashPassword('OtherAdmin!234'),
        mustChangePassword: false,
      })
      .onConflictDoNothing()
      .returning();

    let adminId = admin?.id;
    if (!adminId) {
      const [existing] = await db.select().from(users).where(eq(users.email, 'other.admin@bookspace.test'));
      adminId = existing.id;
      await db.update(users).set({ departmentId: department.id, isActive: true }).where(eq(users.id, adminId));
      await db.delete(userRoles).where(eq(userRoles.userId, adminId));
    }
    await db.insert(userRoles).values([
      { userId: adminId, roleId: 'admin' },
      { userId: adminId, roleId: 'member' },
    ]);

    const [existingResource] = await db
      .select()
      .from(resources)
      .where(eq(resources.departmentId, department.id));
    if (existingResource) {
      otherResourceId = existingResource.id;
    } else {
      const [resource] = await db
        .insert(resources)
        .values({
          departmentId: department.id,
          kind: 'room',
          name: 'Other Seminar',
          location: 'Building Z',
          capacity: 8,
          approvalRequired: false,
          minMinutes: 30,
          maxMinutes: 120,
          maxAdvanceDays: 30,
          bufferMinutes: 0,
        })
        .returning();
      otherResourceId = resource.id;
    }
    app = createApp({ db, pool, config }).app;
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function login(email: string, password: string, departmentSlug: string) {
    const agent = request.agent(app);
    const response = await agent.post('/api/v1/auth/login').send({ email, password, departmentSlug });
    expect(response.status).toBe(200);
    return { agent, csrf: response.body.data.csrfToken as string };
  }

  function futureSlot(weekday: number, time: string) {
    const today = getZonedParts(new Date(), 'America/Los_Angeles').dateKey;
    for (let offset = 1; offset <= 21; offset += 1) {
      const dateKey = addDays(today, offset);
      const instant = zonedTimeToUtc(dateKey, time, 'America/Los_Angeles');
      if (getZonedParts(instant, 'America/Los_Angeles').weekday === weekday) return instant;
    }
    throw new Error('No matching weekday');
  }

  it('creates a department through self-serve signup', async () => {
    const slug = `signup-${Date.now()}`;
    const response = await request(app).post('/api/v1/departments').send({
      name: 'Signup Lab',
      slug,
      timezone: 'America/Los_Angeles',
      adminFullName: 'Signup Admin',
      adminEmail: `signup.${Date.now()}@bookspace.test`,
      adminPassword: 'SignupPass!234',
    });
    expect(response.status).toBe(201);
    expect(response.body.data.slug).toBe(slug);
  });

  it('hides another department resource from demo members', async () => {
    const student = await login(DEMO_USERS.student.email, DEMO_USERS.student.password, 'demo');
    const hidden = await student.agent.get(`/api/v1/resources/${otherResourceId}`);
    expect(hidden.status).toBe(404);
    const booking = await student.agent.post('/api/v1/bookings').set('x-csrf-token', student.csrf).send({
      resourceId: otherResourceId,
      startTime: futureSlot(2, '09:00:00').toISOString(),
      endTime: futureSlot(2, '10:00:00').toISOString(),
      purpose: 'Cross tenant attempt',
    });
    expect(booking.status).toBe(404);
  });

  it('keeps user lists inside the signed-in department', async () => {
    const demoAdmin = await login(DEMO_USERS.admin.email, DEMO_USERS.admin.password, 'demo');
    const otherAdmin = await login('other.admin@bookspace.test', 'OtherAdmin!234', otherSlug);
    const demoUsers = await demoAdmin.agent.get('/api/v1/users');
    const otherUsers = await otherAdmin.agent.get('/api/v1/users');
    expect(demoUsers.status).toBe(200);
    expect(otherUsers.status).toBe(200);
    expect(demoUsers.body.data.some((row: { email: string }) => row.email === 'other.admin@bookspace.test')).toBe(false);
    expect(otherUsers.body.data.some((row: { email: string }) => row.email === DEMO_USERS.admin.email)).toBe(false);
  });

  it('rejects login against the wrong department slug', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({
      email: DEMO_USERS.student.email,
      password: DEMO_USERS.student.password,
      departmentSlug: otherSlug,
    });
    expect(response.status).toBe(401);
  });

  it('protects the maintenance cron route with CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'test-cron-secret-value';
    resetConfigForTests();
    const config = loadConfig();
    const secured = createApp({ db, pool, config }).app;
    const denied = await request(secured).post('/api/v1/internal/maintenance');
    expect(denied.status).toBe(401);
    const allowed = await request(secured)
      .post('/api/v1/internal/maintenance')
      .set('authorization', 'Bearer test-cron-secret-value');
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.ok).toBe(true);
  });
});
