import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AppConfig = {
  databaseUrl: string;
  directUrl: string;
  sessionSecret: string;
  cronSecret: string;
  port: number;
  webOrigin: string;
  allowedOrigins: string[];
  nodeEnv: string;
  timezone: string;
  isProduction: boolean;
  isTest: boolean;
  isVercel: boolean;
  serveWeb: boolean;
  enableInProcessScheduler: boolean;
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

function httpsOrigin(hostOrUrl: string | undefined): string | null {
  if (!hostOrUrl) return null;
  if (hostOrUrl.startsWith('http://') || hostOrUrl.startsWith('https://')) {
    return hostOrUrl.replace(/\/$/, '');
  }
  return `https://${hostOrUrl.replace(/\/$/, '')}`;
}

function collectAllowedOrigins(webOrigin: string): string[] {
  const origins = new Set<string>([webOrigin]);
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const) {
    const origin = httpsOrigin(process.env[key]);
    if (origin) origins.add(origin);
  }
  const extra = process.env.WEB_ORIGINS?.split(',') ?? [];
  for (const item of extra) {
    const trimmed = item.trim().replace(/\/$/, '');
    if (trimmed) origins.add(trimmed);
  }
  return [...origins];
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  loadEnvFile();
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const isVercel = process.env.VERCEL === '1';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const directUrl = process.env.DATABASE_URL_UNPOOLED || databaseUrl;
  const sessionSecret = process.env.SESSION_SECRET ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (isProduction) {
    if (sessionSecret.length < 16) {
      throw new Error('SESSION_SECRET must be at least 16 characters in production.');
    }
    if (!databaseUrl.includes('sslmode=require')) {
      throw new Error('DATABASE_URL must include sslmode=require in production.');
    }
  }

  const webOrigin =
    process.env.WEB_ORIGIN?.replace(/\/$/, '') ||
    httpsOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    httpsOrigin(process.env.VERCEL_URL) ||
    'http://localhost:5173';

  const enableInProcessScheduler =
    process.env.ENABLE_IN_PROCESS_SCHEDULER === 'true'
      ? true
      : process.env.ENABLE_IN_PROCESS_SCHEDULER === 'false'
        ? false
        : !isVercel;

  cached = {
    databaseUrl,
    directUrl,
    sessionSecret: sessionSecret || 'dev-only-secret-change-me',
    cronSecret,
    port: Number(process.env.PORT ?? 4000),
    webOrigin,
    allowedOrigins: collectAllowedOrigins(webOrigin),
    nodeEnv,
    timezone: process.env.DEPARTMENT_TIMEZONE ?? 'America/Los_Angeles',
    isProduction,
    isTest: nodeEnv === 'test',
    isVercel,
    // Explicit only: set SERVE_WEB=true for single-process hosts (e.g. Render).
    // Vercel serves the Vite app as a separate service.
    serveWeb: process.env.SERVE_WEB === 'true',
    enableInProcessScheduler,
  };
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}

export function isAllowedOrigin(origin: string | undefined, config: AppConfig): boolean {
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  // Preview deployments under the same Vercel project share *.vercel.app hosts.
  if (config.isVercel && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  return false;
}
