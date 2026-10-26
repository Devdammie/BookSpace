import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { changePasswordSchema, loginSchema } from '@bookspace/shared';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { asyncRoute, parseOrThrow } from '../../http/async.js';
import { ProblemError } from '../../http/errors.js';
import { actorOf, loadActor, requireAuth } from '../../middleware/auth.js';
import { getDepartmentSettings } from '../../settings.js';
import { hashPassword, newCsrfToken, verifyPassword } from './passwords.js';

const failures = new Map<string, { count: number; lockedUntil: number }>();

function assertNotLocked(email: string, enabled: boolean) {
  if (!enabled) return;
  const entry = failures.get(email);
  if (entry && entry.lockedUntil > Date.now()) {
    throw new ProblemError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again later.');
  }
}

function recordFailure(email: string, enabled: boolean) {
  if (!enabled) return;
  const entry = failures.get(email) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
  failures.set(email, entry);
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
      assertNotLocked(body.email, !config.isTest);
      const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${body.email}`);
      const valid = user ? await verifyPassword(body.password, user.passwordHash) : await verifyPassword(body.password, '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      if (!user || !user.isActive || !valid) {
        recordFailure(body.email, !config.isTest);
        throw new ProblemError(401, 'UNAUTHENTICATED', 'Invalid email or password.');
      }
      failures.delete(body.email);
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => (error ? reject(error) : resolve()));
      });
      req.session.userId = user.id;
      req.session.csrfToken = newCsrfToken();
      await saveSession(req.session);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const actor = await loadActor(db, user.id);
      const department = await getDepartmentSettings(db, config.timezone);
      res.json({
        data: {
          user: { ...publicUser(actor!), timezone: department.timezone },
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
  };
}
