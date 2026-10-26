import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export function poolConfig(connectionString: string): pg.PoolConfig {
  const needsSsl = /sslmode=require/i.test(connectionString) || connectionString.includes('neon.tech');
  return {
    connectionString,
    max: 10,
    ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
  };
}

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool(poolConfig(connectionString));
  const db = drizzle(pool, { schema });
  return { pool, db };
}
