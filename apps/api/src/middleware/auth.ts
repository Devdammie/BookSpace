import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type { Database } from '../db/client.js';
import { userRoles, users } from '../db/schema.js';
import { ProblemError } from '../http/errors.js';
import type { Actor } from '../types.js';

const ROLE_SET = new Set(['member', 'approver', 'admin']);

export async function loadActor(db: Database, userId: string): Promise<Actor | null> {
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
    .where(eq(users.id, userId));
  if (rows.length === 0) return null;
  const first = rows[0];
  const roles = rows
    .map((row) => row.roleId)
    .filter((role): role is Actor['roles'][number] => role !== null && ROLE_SET.has(role));
  return {
    id: first.id,
    email: first.email,
    fullName: first.fullName,
    userType: first.userType,
    isActive: first.isActive,
    mustChangePassword: first.mustChangePassword,
    roles,
  };
}

export function requireAuth(db: Database, options?: { allowPasswordChange?: boolean }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        next(new ProblemError(401, 'UNAUTHENTICATED', 'Sign in required.'));
        return;
      }
      const actor = await loadActor(db, userId);
      if (!actor || !actor.isActive) {
        req.session.destroy(() => undefined);
        next(new ProblemError(401, 'UNAUTHENTICATED', 'Sign in required.'));
        return;
      }
      if (actor.mustChangePassword && !options?.allowPasswordChange) {
        next(new ProblemError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change the temporary password before continuing.'));
        return;
      }
      req.actor = actor;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...roles: Actor['roles'][number][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actor = req.actor;
    if (!actor || !roles.some((role) => actor.roles.includes(role))) {
      next(new ProblemError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
      return;
    }
    next();
  };
}

export function actorOf(req: Request): Actor {
  if (!req.actor) throw new ProblemError(401, 'UNAUTHENTICATED', 'Sign in required.');
  return req.actor;
}
