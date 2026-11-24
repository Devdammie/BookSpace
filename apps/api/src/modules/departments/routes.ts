import { createDepartmentSchema, isValidTimeZone } from '@bookspace/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { auditLog, departments, userRoles, users } from '../../db/schema.js';
import { asyncRoute, parseOrThrow } from '../../http/async.js';
import { pgCode, ProblemError } from '../../http/errors.js';
import { hashPassword } from '../auth/passwords.js';

export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'demo',
  'health',
  'login',
  'o',
  'ready',
  'signup',
  'static',
  'www',
]);

export function createDepartmentRouter(db: Database, config: AppConfig) {
  const router = Router();
  const signupLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (_req, res) => {
      res.status(429).json(new ProblemError(429, 'RATE_LIMITED', 'Too many signup attempts. Try again later.').toJSON());
    },
  });

  router.get(
    '/:slug',
    asyncRoute(async (req, res) => {
      const slug = String(req.params.slug).toLowerCase();
      const [row] = await db
        .select({
          name: departments.name,
          slug: departments.slug,
          timezone: departments.timezone,
        })
        .from(departments)
        .where(eq(departments.slug, slug));
      if (!row) throw new ProblemError(404, 'NOT_FOUND', 'Department not found.');
      res.json({ data: row });
    }),
  );

  router.post(
    '/',
    signupLimit,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(createDepartmentSchema, req.body);
      if (RESERVED_SLUGS.has(body.slug)) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'That department URL is reserved. Choose another slug.');
      }
      if (!isValidTimeZone(body.timezone)) {
        throw new ProblemError(400, 'VALIDATION_ERROR', 'Unknown timezone.');
      }
      try {
        const created = await db.transaction(async (tx) => {
          const [department] = await tx
            .insert(departments)
            .values({
              name: body.name,
              slug: body.slug,
              timezone: body.timezone,
            })
            .returning();
          const [admin] = await tx
            .insert(users)
            .values({
              departmentId: department.id,
              email: body.adminEmail,
              fullName: body.adminFullName,
              userType: 'staff',
              passwordHash: await hashPassword(body.adminPassword),
              mustChangePassword: false,
            })
            .returning({
              id: users.id,
              email: users.email,
              fullName: users.fullName,
            });
          await tx.insert(userRoles).values([
            { userId: admin.id, roleId: 'admin' },
            { userId: admin.id, roleId: 'member' },
          ]);
          await tx.insert(auditLog).values({
            departmentId: department.id,
            actorId: admin.id,
            action: 'department.created',
            targetType: 'department',
            targetId: department.id,
            details: { slug: department.slug },
          });
          return { department, admin };
        });
        res.status(201).json({
          data: {
            id: created.department.id,
            name: created.department.name,
            slug: created.department.slug,
            timezone: created.department.timezone,
            admin: created.admin,
          },
        });
      } catch (error) {
        if (pgCode(error) === '23505') {
          const message = error instanceof Error ? error.message : '';
          if (message.includes('users_email') || message.includes('email')) {
            throw new ProblemError(409, 'VALIDATION_ERROR', 'An account with that email already exists.');
          }
          throw new ProblemError(409, 'VALIDATION_ERROR', 'That department slug is already taken.');
        }
        throw error;
      }
    }),
  );

  return router;
}
