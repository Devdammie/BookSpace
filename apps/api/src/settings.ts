import { eq } from 'drizzle-orm';
import type { Database } from './db/client.js';
import { departments } from './db/schema.js';
import { ProblemError } from './http/errors.js';
import type { Tenant } from './types.js';

export async function getDepartmentById(db: Database, departmentId: string): Promise<Tenant> {
  const [row] = await db.select().from(departments).where(eq(departments.id, departmentId));
  if (!row || !row.isActive) throw new ProblemError(404, 'NOT_FOUND', 'Department not found.');
  return toTenant(row);
}

export async function getDepartmentBySlug(db: Database, slug: string): Promise<Tenant> {
  const [row] = await db.select().from(departments).where(eq(departments.slug, slug.toLowerCase()));
  if (!row || !row.isActive) throw new ProblemError(404, 'NOT_FOUND', 'Department not found.');
  return toTenant(row);
}

export async function getDepartmentSettings(db: Database, departmentId: string) {
  const department = await getDepartmentById(db, departmentId);
  return {
    timezone: department.timezone,
    pendingExpiryHours: department.pendingExpiryHours,
  };
}

export async function saveDepartmentSettings(
  db: Database,
  departmentId: string,
  value: { timezone: string; pendingExpiryHours: number },
) {
  const [updated] = await db
    .update(departments)
    .set({
      timezone: value.timezone,
      pendingExpiryHours: value.pendingExpiryHours,
    })
    .where(eq(departments.id, departmentId))
    .returning();
  if (!updated) throw new ProblemError(404, 'NOT_FOUND', 'Department not found.');
  return toTenant(updated);
}

function toTenant(row: typeof departments.$inferSelect): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    pendingExpiryHours: row.pendingExpiryHours,
    isActive: row.isActive,
  };
}
