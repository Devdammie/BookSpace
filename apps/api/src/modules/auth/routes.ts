import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { changePasswordSchema, loginSchema } from '@bookspace/shared';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { departments, users } from '../../db/schema.js';
import { asyncRoute, parseOrThrow } from '../../http/async.js';
import { ProblemError } from '../../http/errors.js';
import { actorOf, loadActor, requireAuth } from '../../middleware/auth.js';
import { hashPassword, newCsrfToken, verifyPassword } from './passwords.js';

const failures = new Map<string, { count: number; lockedUntil: number }>();

function assertNotLocked(key: string, enabled: boolean) {
  if (!enabled) return;
  const entry = failures.get(key);
  if (entry && entry.lockedUntil > Date.now()) {
    throw new ProblemError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again later.');
  }
}

function recordFailure(key: string, enabled: boolean) {
  if (!enabled) return;
  const entry = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
  failures.set(key, entry);
}

function saveSession(session: Express.Request['session']) {
  return new Promise<void>((resolve, reject) => {
    session.save((error) => (error ? reject(error) : resolve()));
  });
}

export function createAuthRouter(db: Database, config: AppConfig) {
  const router = Router();
  const openAuth = requireAuth(db, { allowPasswordChange: true });

  router.post(
    '/login',
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(loginSchema, req.body);
      const lockKey = `${body.departmentSlug}:${body.email}`;
      assertNotLocked(lockKey, !config.isTest);
      const [department] = await db
        .select()
        .from(departments)
        .where(and(eq(departments.slug, body.departmentSlug), eq(departments.isActive, true)));
      const [user] = department
        ? await db
            .select()
            .from(users)
            .where(and(sql`lower(${users.email}) = ${body.email}`, eq(users.departmentId, department.id)))
        : [];
      const valid = user
        ? await verifyPassword(body.password, user.passwordHash)
        : await verifyPassword(
            body.password,
            '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          );
      if (!department || !user || !user.isActive || !valid) {
        recordFailure(lockKey, !config.isTest);
        throw new ProblemError(401, 'UNAUTHENTICATED', 'Invalid email or password for that department.');
      }
      failures.delete(lockKey);
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => (error ? reject(error) : resolve()));
      });
      req.session.userId = user.id;
      req.session.departmentId = department.id;
      req.session.csrfToken = newCsrfToken();
      await saveSession(req.session);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const actor = await loadActor(db, user.id);
      res.json({
        data: {
          user: {
            ...publicUser(actor!),
            timezone: department.timezone,
            departmentSlug: department.slug,
            departmentName: department.name,
          },
          csrfToken: req.session.csrfToken,
        },
      });
    }),
  );

  router.post(
    '/logout',
    openAuth,
    asyncRoute(async (req, res) => {
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      res.json({ data: { ok: true } });
    }),
  );

  router.get(
    '/csrf',
    openAuth,
    asyncRoute(async (req, res) => {
      if (!req.session.csrfToken) {
        req.session.csrfToken = newCsrfToken();
        await saveSession(req.session);
      }
      res.json({ data: { csrfToken: req.session.csrfToken } });
    }),
  );

  router.post(
    '/change-password',
    openAuth,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(changePasswordSchema, req.body);
      const actor = actorOf(req);
      const [user] = await db.select().from(users).where(eq(users.id, actor.id));
      if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'The current password is incorrect.');
      }
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, updatedAt: new Date() })
        .where(eq(users.id, actor.id));
      res.json({ data: { ok: true } });
    }),
  );

  return router;
}

export function publicUser(actor: NonNullable<Express.Request['actor']>) {
  return {
    id: actor.id,
    email: actor.email,
    fullName: actor.fullName,
    userType: actor.userType,
    roles: actor.roles,
    mustChangePassword: actor.mustChangePassword,
    departmentId: actor.departmentId,
    departmentSlug: actor.departmentSlug,
  };
}
