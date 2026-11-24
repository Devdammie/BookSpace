import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import type pg from 'pg';
import './types.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { ProblemError, pgCode } from './http/errors.js';
import { tokensMatch } from './modules/auth/passwords.js';
import { createAdminRouter } from './modules/admin/routes.js';
import { createApprovalRouter } from './modules/approvals/routes.js';
import { createAuthRouter } from './modules/auth/routes.js';
import { createBookingRouter } from './modules/bookings/routes.js';
import { createDashboardRouter } from './modules/dashboard/routes.js';
import { createDepartmentRouter } from './modules/departments/routes.js';
import { createNotificationRouter } from './modules/notifications/routes.js';
import { createResourceRouter } from './modules/resources/routes.js';
import { createUserRouter } from './modules/users/routes.js';

const PgStore = connectPgSimple(session);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApp(deps: { db: Database; pool: pg.Pool; config: AppConfig }) {
  const { db, pool, config } = deps;
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const logger = pino({ level: config.isTest ? 'silent' : 'info' });
  app.use(pinoHttp({ logger, redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] }));
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });
  app.get('/openapi.yaml', (_req, res) => {
    const openapi = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/openapi.yaml');
    if (!existsSync(openapi)) {
      res.status(404).json({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND', detail: 'OpenAPI document is missing.' });
      return;
    }
    res.type('text/yaml').sendFile(openapi);
  });
  app.get('/ready', async (_req, res) => {
    try {
      await pool.query('select 1');
      res.json({ data: { status: 'ready' } });
    } catch {
      res.status(503).json({ type: 'about:blank', title: 'Service Unavailable', status: 503, code: 'NOT_READY', detail: 'Database is not reachable.' });
    }
  });

  app.use(
    session({
      store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
      name: 'bookspace.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );

  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (_req, res) => {
      res.status(429).json(new ProblemError(429, 'RATE_LIMITED', 'Too many requests. Try again later.').toJSON());
    },
  });
  app.use('/api/v1/auth/login', loginLimit);

  app.use((req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.header('origin');
    if (origin && origin !== config.webOrigin) {
      next(new ProblemError(403, 'FORBIDDEN', 'Request origin is not allowed.'));
      return;
    }
    if (req.path === '/api/v1/auth/login' || req.path === '/api/v1/departments') {
      next();
      return;
    }
    if (!req.session.userId) {
      next();
      return;
    }
    const header = req.header('x-csrf-token') ?? '';
    if (!req.session.csrfToken || !tokensMatch(header, req.session.csrfToken)) {
      next(new ProblemError(403, 'CSRF', 'Missing or invalid CSRF token.'));
      return;
    }
    next();
  });

  app.use('/api/v1/departments', createDepartmentRouter(db, config));
  app.use('/api/v1/auth', createAuthRouter(db, config));
  app.use('/api/v1/users', createUserRouter(db, config));
  app.use('/api/v1/resources', createResourceRouter(db, config));
  const bookings = createBookingRouter(db, config);
  app.use('/api/v1/bookings', bookings.router);
  app.use('/api/v1/approvals', createApprovalRouter(db, config));
  app.use('/api/v1/notifications', createNotificationRouter(db));
  app.use('/api/v1/dashboard', createDashboardRouter(db, config));
  app.use('/api/v1/admin', createAdminRouter(db, config));
  app.use('/api', (_req, _res, next) => {
    next(new ProblemError(404, 'NOT_FOUND', 'That API route does not exist.'));
  });

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (config.serveWeb && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/health' || req.path === '/ready') {
        next();
        return;
      }
      res.sendFile(path.join(webDist, 'index.html'), (error) => {
        if (error) next();
      });
    });
  }

  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ProblemError) {
      res.status(error.status).json(error.toJSON(req.path));
      return;
    }
    if (pgCode(error) === '23P01') {
      res.status(409).json(new ProblemError(409, 'SLOT_CONFLICT', 'That time is already reserved.').toJSON(req.path));
      return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected failure';
    const missingSchema = /relation .* does not exist/i.test(message);
    const detail = config.isProduction
      ? 'Unexpected failure.'
      : missingSchema
        ? 'Database schema is missing. Run npm run db:migrate using the direct Neon URL.'
        : message;
    if (!config.isTest) logger.error({ err: error }, 'request failed');
    res.status(500).json(new ProblemError(500, 'INTERNAL', detail).toJSON(req.path));
  });

  return { app, logger };
}
