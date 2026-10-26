import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config.js';
import { createDatabase, type Database } from './client.js';

export function migrationsFolder() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
}

export async function runMigrations(db: Database) {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  const config = loadConfig();
  if (!config.directUrl) {
    console.error('Set DATABASE_URL_UNPOOLED or DATABASE_URL before migrating.');
    process.exit(1);
  }
  if (config.directUrl.includes('-pooler')) {
    console.error('Migrations must use the direct Neon host, not the pooled "-pooler" host.');
    process.exit(1);
  }
  const { pool, db } = createDatabase(config.directUrl);
  runMigrations(db)
    .then(async () => {
      console.log('Migrations applied.');
      await pool.end();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
