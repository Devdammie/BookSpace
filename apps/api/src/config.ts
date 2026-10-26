import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AppConfig = {
  databaseUrl: string;
  directUrl: string;
  sessionSecret: string;
  port: number;
  webOrigin: string;
  nodeEnv: string;
  timezone: string;
  isProduction: boolean;
  isTest: boolean;
  serveWeb: boolean;
};

function loadEnvFile() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    process.loadEnvFile(candidate);
    return;
  }
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  loadEnvFile();
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const directUrl = process.env.DATABASE_URL_UNPOOLED || databaseUrl;
  const sessionSecret = process.env.SESSION_SECRET ?? '';
  if (isProduction) {
    if (sessionSecret.length < 16) {
      throw new Error('SESSION_SECRET must be at least 16 characters in production.');
    }
    if (!databaseUrl.includes('sslmode=require')) {
      throw new Error('DATABASE_URL must include sslmode=require in production.');
    }
  }
  cached = {
    databaseUrl,
    directUrl,
    sessionSecret: sessionSecret || 'dev-only-secret-change-me',
    port: Number(process.env.PORT ?? 4000),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    nodeEnv,
    timezone: process.env.DEPARTMENT_TIMEZONE ?? 'America/Los_Angeles',
    isProduction,
    isTest: nodeEnv === 'test',
    serveWeb: process.env.SERVE_WEB === 'true' || isProduction,
  };
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}
