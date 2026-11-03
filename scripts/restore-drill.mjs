import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canRunRestore, classifyDatabaseUrl } from './restore-target.mjs';

const url = process.env.DATABASE_URL_UNPOOLED || '';
const kind = classifyDatabaseUrl(url);
if (!canRunRestore(url, process.env.CONFIRM_RESTORE_DRILL)) {
  console.log(`Restore drill not executed (${kind}).`);
  console.log('Neon procedure: in the Neon console, create a branch from an earlier timestamp, point a read-only client at it, and compare booking and resource counts with production.');
  console.log('To run pg_dump against the direct URL: CONFIRM_RESTORE_DRILL=yes DATABASE_URL_UNPOOLED=... node scripts/restore-drill.mjs');
  process.exit(0);
}

const candidates = [
  'pg_dump',
  'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
  'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
];
const pgDump = candidates.find((command) => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0);
if (!pgDump) {
  console.error('pg_dump is not installed. Use the Neon branch procedure above.');
  process.exit(2);
}
const bin = path.dirname(pgDump);
const psql = path.join(bin, process.platform === 'win32' ? 'psql.exe' : 'psql');
const pgRestore = path.join(bin, process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore');

const directory = mkdtempSync(path.join(tmpdir(), 'bookspace-restore-'));
const file = path.join(directory, 'bookspace.dump');
const dumped = spawnSync(pgDump, ['--format=custom', '--file', file, url], { encoding: 'utf8' });
if (dumped.status !== 0) {
  console.error(dumped.stderr || dumped.stdout);
  process.exit(1);
}

const source = new URL(url);
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const restoreName = 'bookspace_restore';
spawnSync(psql, [adminUrl.toString(), '-c', `DROP DATABASE IF EXISTS ${restoreName}`], { encoding: 'utf8' });
const created = spawnSync(psql, [adminUrl.toString(), '-c', `CREATE DATABASE ${restoreName}`], { encoding: 'utf8' });
if (created.status !== 0) {
  console.error(created.stderr || created.stdout);
  process.exit(1);
}
const restoreUrl = new URL(url);
restoreUrl.pathname = `/${restoreName}`;
const restored = spawnSync(pgRestore, ['--no-owner', '--dbname', restoreUrl.toString(), file], { encoding: 'utf8' });
if (restored.status !== 0) {
  console.error(restored.stderr || restored.stdout);
  process.exit(1);
}

function count(databaseUrl, table) {
  const result = spawnSync(psql, [databaseUrl, '-tAc', `SELECT count(*) FROM ${table}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `count failed for ${table}`);
  return result.stdout.trim();
}
for (const table of ['resources', 'bookings', 'users']) {
  const left = count(url, table);
  const right = count(restoreUrl.toString(), table);
  if (left !== right) {
    console.error(`${table} count mismatch: source ${left}, restore ${right}`);
    process.exit(1);
  }
  console.log(`${table}: ${left} rows restored`);
}
spawnSync(psql, [adminUrl.toString(), '-c', `DROP DATABASE ${restoreName}`], { encoding: 'utf8' });
console.log(`Restore drill passed. Dump kept at ${file}.`);
void source;
