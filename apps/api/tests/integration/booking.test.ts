import { addDays, getZonedParts, zonedTimeToUtc } from '@bookspace/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig, resetConfigForTests } from '../../src/config.js';
import { createDatabase, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { bookings, resources } from '../../src/db/schema.js';
import { DEMO_USERS, seedDatabase } from '../../src/seed.js';
import type pg from 'pg';

loadConfig();
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('booking flow against Postgres', () => {
  let db: Database;
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>['app'];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    resetConfigForTests();
    const config = loadConfig();
    const created = createDatabase(config.databaseUrl);
    db = created.db;
    pool = created.pool;
    await runMigrations(db);
    await seedDatabase(db);
    await db.execute(sql`truncate table bookings, approvals, booking_events, notifications, idempotency_keys, audit_log restart identity cascade`);
    app = createApp({ db, pool, config }).app;
  });

  afterAll(async () => {
    await pool?.end();
  });

  function futureSlot(weekday: number, time: string) {
    const today = getZonedParts(new Date(), 'America/Los_Angeles').dateKey;
    for (let offset = 1; offset <= 21; offset += 1) {
      const dateKey = addDays(today, offset);
      const instant = zonedTimeToUtc(dateKey, time, 'America/Los_Angeles');
      if (getZonedParts(instant, 'America/Los_Angeles').weekday === weekday) return instant;
    }
    throw new Error('No matching weekday');
  }

  async function login(email: string, password: string) {
    const agent = request.agent(app);
    const response = await agent.post('/api/v1/auth/login').send({ email, password, departmentSlug: 'demo' });
    expect(response.status).toBe(200);
    return { agent, csrf: response.body.data.csrfToken as string };
  }

  it('AC1 hides protected routes from anonymous callers', async () => {
    const response = await request(app).get('/api/v1/bookings');
    expect(response.status).toBe(401);
  });

  it('AC2 and AC4 confirm one request and reject the competing one', async () => {
    const student = await login(DEMO_USERS.student.email, DEMO_USERS.student.password);
    const lecturer = await login(DEMO_USERS.lecturer.email, DEMO_USERS.lecturer.password);
    const approver = await login(DEMO_USERS.approver.email, DEMO_USERS.approver.password);
    const [projector] = await db.select().from(resources).where(eq(resources.name, 'Projector 4'));
    const start = futureSlot(4, '14:00:00');
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const first = await student.agent
      .post('/api/v1/bookings')
      .set('x-csrf-token', student.csrf)
      .send({ resourceId: projector.id, startTime: start.toISOString(), endTime: end.toISOString(), purpose: 'Demo one' });
    const second = await lecturer.agent
      .post('/api/v1/bookings')
      .set('x-csrf-token', lecturer.csrf)
      .send({ resourceId: projector.id, startTime: start.toISOString(), endTime: end.toISOString(), purpose: 'Demo two' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SLOT_CONFLICT');

    const [lab] = await db.select().from(resources).where(eq(resources.name, 'Computer Lab A'));
    const labStart = futureSlot(4, '16:00:00');
    const labEnd = new Date(labStart.getTime() + 60 * 60 * 1000);
    const pendingA = await student.agent.post('/api/v1/bookings').set('x-csrf-token', student.csrf).send({
      resourceId: lab.id, startTime: labStart.toISOString(), endTime: labEnd.toISOString(), purpose: 'Lab practical',
    });
    const pendingB = await lecturer.agent.post('/api/v1/bookings').set('x-csrf-token', lecturer.csrf).send({
      resourceId: lab.id, startTime: labStart.toISOString(), endTime: labEnd.toISOString(), purpose: 'Lab revision',
    });
    expect(pendingA.body.data.status).toBe('PENDING_APPROVAL');
    expect(pendingB.body.data.status).toBe('PENDING_APPROVAL');
    const approved = await approver.agent
      .post(`/api/v1/bookings/${pendingA.body.data.id}/approve`)
      .set('x-csrf-token', approver.csrf)
      .send({ version: pendingA.body.data.version });
    expect(approved.status).toBe(200);
    const loser = await approver.agent
      .post(`/api/v1/bookings/${pendingB.body.data.id}/approve`)
      .set('x-csrf-token', approver.csrf)
      .send({ version: pendingB.body.data.version });
    expect([404, 409]).toContain(loser.status);
    const rows = await db.select().from(bookings).where(eq(bookings.resourceId, lab.id));
    expect(rows.filter((row) => row.status === 'CONFIRMED')).toHaveLength(1);
  });

  it('AC5 refuses to approve a cancelled request', async () => {
    const student = await login(DEMO_USERS.student.email, DEMO_USERS.student.password);
    const approver = await login(DEMO_USERS.approver.email, DEMO_USERS.approver.password);
    const [lab] = await db.select().from(resources).where(eq(resources.name, 'Computer Lab A'));
    const start = futureSlot(5, '11:00:00');
    const created = await student.agent.post('/api/v1/bookings').set('x-csrf-token', student.csrf).send({
      resourceId: lab.id,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      purpose: 'Will cancel',
    });
    await student.agent.post(`/api/v1/bookings/${created.body.data.id}/cancel`).set('x-csrf-token', student.csrf).send({ reason: 'No longer needed' });
    const decision = await approver.agent
      .post(`/api/v1/bookings/${created.body.data.id}/approve`)
      .set('x-csrf-token', approver.csrf)
      .send({ version: created.body.data.version });
    expect(decision.status).toBe(409);
  });

  it('AC3 lets only one of two concurrent confirms succeed', async () => {
    const student = await login(DEMO_USERS.student.email, DEMO_USERS.student.password);
    const lecturer = await login(DEMO_USERS.lecturer.email, DEMO_USERS.lecturer.password);
    const [room] = await db.select().from(resources).where(eq(resources.name, 'Seminar Room B'));
    const start = futureSlot(1, '15:00:00');
    const body = {
      resourceId: room.id,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
      purpose: 'Concurrent hold',
    };
    const [left, right] = await Promise.all([
      student.agent.post('/api/v1/bookings').set('x-csrf-token', student.csrf).send(body),
      lecturer.agent.post('/api/v1/bookings').set('x-csrf-token', lecturer.csrf).send({ ...body, purpose: 'Concurrent other' }),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([201, 409]);
    const confirmed = await db.select().from(bookings).where(eq(bookings.resourceId, room.id));
    expect(confirmed.filter((row) => row.status === 'CONFIRMED' && row.startTime.getTime() === start.getTime())).toHaveLength(1);
  });

  it('refuses self-approval and hides another user booking', async () => {
    const student = await login(DEMO_USERS.student.email, DEMO_USERS.student.password);
    const lecturer = await login(DEMO_USERS.lecturer.email, DEMO_USERS.lecturer.password);
    const [lab] = await db.select().from(resources).where(eq(resources.name, 'Computer Lab A'));
    const start = futureSlot(2, '11:00:00');
    const created = await student.agent.post('/api/v1/bookings').set('x-csrf-token', student.csrf).send({
      resourceId: lab.id,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      purpose: 'Own request',
    });
    expect(created.status).toBe(201);
    const self = await student.agent
      .post(`/api/v1/bookings/${created.body.data.id}/approve`)
      .set('x-csrf-token', student.csrf)
      .send({ version: created.body.data.version });
    expect(self.status).toBe(403);
    const hidden = await lecturer.agent.get(`/api/v1/bookings/${created.body.data.id}`);
    expect(hidden.status).toBe(404);
  });

  it('AC6 blocks a reservation that overlaps a maintenance closure', async () => {
    const admin = await login(DEMO_USERS.admin.email, DEMO_USERS.admin.password);
    const student = await login(DEMO_USERS.student.email, DEMO_USERS.student.password);
    const [room] = await db.select().from(resources).where(eq(resources.name, 'Seminar Room B'));
    const start = futureSlot(3, '16:00:00');
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const block = await admin.agent.post(`/api/v1/resources/${room.id}/blocks`).set('x-csrf-token', admin.csrf).send({
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      reason: 'Maintenance window',
    });
    expect(block.status).toBe(201);
    const booking = await student.agent.post('/api/v1/bookings').set('x-csrf-token', student.csrf).send({
      resourceId: room.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      purpose: 'Should be blocked',
    });
    expect(booking.status).toBe(409);
    expect(booking.body.code).toBe('RESOURCE_BLOCKED');
  });
});
