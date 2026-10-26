import assert from 'node:assert/strict';
import test from 'node:test';
import { canRunRestore, classifyDatabaseUrl } from './restore-target.mjs';

test('rejects a pooled Neon URL for restore', () => {
  const url = 'postgresql://user:pass@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require';
  assert.equal(classifyDatabaseUrl(url), 'pooled');
  assert.equal(canRunRestore(url, 'yes'), false);
});

test('allows a direct URL only when the operator confirms', () => {
  const url = 'postgresql://user:pass@ep-example.region.aws.neon.tech/neondb?sslmode=require';
  assert.equal(classifyDatabaseUrl(url), 'direct');
  assert.equal(canRunRestore(url, 'no'), false);
  assert.equal(canRunRestore(url, 'yes'), true);
});
