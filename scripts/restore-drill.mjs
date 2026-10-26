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

const dump = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
if (dump.status !== 0) {
  console.error('pg_dump is not installed. Use the Neon branch procedure above.');
  process.exit(2);
}

const directory = mkdtempSync(path.join(tmpdir(), 'bookspace-restore-'));
const file = path.join(directory, 'bookspace.dump');
const dumped = spawnSync('pg_dump', ['--format=custom', '--file', file, url], { encoding: 'utf8' });
if (dumped.status !== 0) {
  console.error(dumped.stderr);
  process.exit(1);
}
console.log(`Dump written to ${file}. Restore it with pg_restore only into an empty database you created for the drill.`);
