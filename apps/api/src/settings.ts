import type { Database } from './db/client.js';
import { settings } from './db/schema.js';

export async function getDepartmentSettings(db: Database, fallbackTimezone: string) {
  const rows = await db.select().from(settings);
  const timezoneRow = rows.find((row) => row.key === 'timezone');
  const expiryRow = rows.find((row) => row.key === 'pending_expiry_hours');
  const timezone = typeof timezoneRow?.value === 'string' ? timezoneRow.value : fallbackTimezone;
  const pendingExpiryHours = typeof expiryRow?.value === 'number' ? expiryRow.value : 48;
  return { timezone, pendingExpiryHours };
}

export async function saveDepartmentSettings(
  db: Database,
  value: { timezone: string; pendingExpiryHours: number },
) {
  const pairs: { key: string; value: string | number }[] = [
    { key: 'timezone', value: value.timezone },
    { key: 'pending_expiry_hours', value: value.pendingExpiryHours },
  ];
  for (const pair of pairs) {
    await db
      .insert(settings)
      .values(pair)
      .onConflictDoUpdate({ target: settings.key, set: { value: pair.value } });
  }
}
