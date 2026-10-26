import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { createUserSchema, setRolesSchema, updateMeSchema, updateUserSchema } from '@bookspace/shared';
import type { Database } from '../../db/client.js';
import { auditLog, userRoles, users } from '../../db/schema.js';
import { asyncRoute, parseOrThrow } from '../../http/async.js';
import { pgCode, ProblemError } from '../../http/errors.js';
import { actorOf, requireAuth, requireRole } from '../../middleware/auth.js';
import { getDepartmentSettings } from '../../settings.js';
import type { AppConfig } from '../../config.js';
import { publicUser } from '../auth/routes.js';
import { hashPassword, temporaryPassword } from '../auth/passwords.js';

async function activeAdminCount(db: Database) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleId, 'admin'), eq(users.isActive, true)));
  return new Set(rows.map((row) => row.id)).size;
}

export function createUserRouter(db: Database, config: AppConfig) {
  const router = Router();
  const auth = requireAuth(db);
  const openAuth = requireAuth(db, { allowPasswordChange: true });
  const admin = [auth, requireRole('admin')] as const;

  router.get(
    '/me',
    openAuth,
    asyncRoute(async (req, res) => {
      const department = await getDepartmentSettings(db, config.timezone);
      res.json({ data: { ...publicUser(actorOf(req)), timezone: department.timezone } });
    }),
  );

  router.patch(
    '/me',
    auth,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(updateMeSchema, req.body);
      const actor = actorOf(req);
      await db.update(users).set({ fullName: body.fullName, updatedAt: new Date() }).where(eq(users.id, actor.id));
      res.json({ data: { ...publicUser(actor), fullName: body.fullName } });
    }),
  );

  router.get(
    '/',
    ...admin,
    asyncRoute(async (_req, res) => {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          userType: users.userType,
          isActive: users.isActive,
          mustChangePassword: users.mustChangePassword,
          roleId: userRoles.roleId,
        })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .orderBy(asc(users.fullName));
      const grouped = new Map<string, {
        id: string;
        email: string;
        fullName: string;
        userType: string;
        isActive: boolean;
        mustChangePassword: boolean;
        roles: string[];
      }>();
      for (const row of rows) {
        const current = grouped.get(row.id) ?? { ...row, roles: [] as string[] };
        if (row.roleId) current.roles.push(row.roleId);
        grouped.set(row.id, current);
      }
      res.json({ data: [...grouped.values()] });
    }),
  );

  router.post(
    '/',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(createUserSchema, req.body);
      const password = body.temporaryPassword ?? temporaryPassword();
      try {
        const created = await db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({
              email: body.email,
              fullName: body.fullName,
              userType: body.userType,
              passwordHash: await hashPassword(password),
              mustChangePassword: true,
            })
            .returning({
              id: users.id,
              email: users.email,
              fullName: users.fullName,
              userType: users.userType,
              mustChangePassword: users.mustChangePassword,
            });
          await tx.insert(userRoles).values(body.roles.map((roleId) => ({ userId: user.id, roleId })));
          await tx.insert(auditLog).values({
            actorId: actorOf(req).id,
            action: 'user.created',
            targetType: 'user',
            targetId: user.id,
            details: { roles: body.roles },
          });
          return user;
        });
        res.status(201).json({ data: { ...created, roles: body.roles, temporaryPassword: password } });
      } catch (error) {
        if (pgCode(error) === '23505') {
          throw new ProblemError(409, 'VALIDATION_ERROR', 'An account with that email already exists.');
        }
        throw error;
      }
    }),
  );

  router.patch(
    '/:id',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(updateUserSchema, req.body);
      const userId = String(req.params.id);
      if (body.isActive === false && userId === actorOf(req).id) {
        throw new ProblemError(409, 'INVALID_TRANSITION', 'You cannot deactivate your own account.');
      }
      if (body.isActive === false) {
        const [role] = await db
          .select({ roleId: userRoles.roleId })
          .from(userRoles)
          .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, 'admin')));
        if (role && (await activeAdminCount(db)) <= 1) {
          throw new ProblemError(409, 'INVALID_TRANSITION', 'The last active administrator cannot be deactivated.');
        }
      }
      const [updated] = await db
        .update(users)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({ id: users.id, email: users.email, fullName: users.fullName, userType: users.userType, isActive: users.isActive });
      if (!updated) throw new ProblemError(404, 'NOT_FOUND', 'User not found.');
      await db.insert(auditLog).values({
        actorId: actorOf(req).id,
        action: 'user.updated',
        targetType: 'user',
        targetId: userId,
        details: body,
      });
      res.json({ data: updated });
    }),
  );

  router.post(
    '/:id/reset-password',
    ...admin,
    asyncRoute(async (req, res) => {
      const userId = String(req.params.id);
      const password = temporaryPassword();
      const [updated] = await db
        .update(users)
        .set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!updated) throw new ProblemError(404, 'NOT_FOUND', 'User not found.');
      await db.insert(auditLog).values({
        actorId: actorOf(req).id,
        action: 'user.password_reset',
        targetType: 'user',
        targetId: userId,
        details: {},
      });
      res.json({ data: { id: userId, temporaryPassword: password } });
    }),
  );

  router.put(
    '/:id/roles',
    ...admin,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(setRolesSchema, req.body);
      const userId = String(req.params.id);
      const [user] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, userId));
      if (!user) throw new ProblemError(404, 'NOT_FOUND', 'User not found.');
      const hadAdmin = Boolean(
        (await db.select().from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, 'admin'))))[0],
      );
      if (hadAdmin && user.isActive && !body.roles.includes('admin') && (await activeAdminCount(db)) <= 1) {
        throw new ProblemError(409, 'INVALID_TRANSITION', 'The last active administrator role cannot be removed.');
      }
      await db.transaction(async (tx) => {
        await tx.delete(userRoles).where(eq(userRoles.userId, userId));
        await tx.insert(userRoles).values(body.roles.map((roleId) => ({ userId, roleId })));
        await tx.insert(auditLog).values({
          actorId: actorOf(req).id,
          action: 'user.roles_changed',
          targetType: 'user',
          targetId: userId,
          details: { roles: body.roles },
        });
      });
      res.json({ data: { id: userId, roles: body.roles } });
    }),
  );

  return router;
}
