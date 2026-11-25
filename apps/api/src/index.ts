import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('Set DATABASE_URL to the Neon pooled connection string. See .env.example.');
  process.exit(1);
}
if (config.isProduction && !config.databaseUrl.includes('sslmode=require')) {
  console.error('DATABASE_URL must include sslmode=require.');
  process.exit(1);
}

const { pool, db } = createDatabase(config.databaseUrl);
pool.on('error', (error) => {
  console.error('Postgres pool error', error);
});
const { app, logger } = createApp({ db, pool, config });

// Vercel Fluid/Express loads this module and uses the default export.
// Long-lived listen + in-process cron are for local/Render only.
export default app;

if (!config.isVercel) {
  const scheduler = config.enableInProcessScheduler
    ? startScheduler(db, config, {
        error: (error) => logger.error({ err: error }, 'maintenance job failed'),
      })
    : null;

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, serveWeb: config.serveWeb }, 'BookSpace API listening');
  });

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (scheduler) await scheduler.stop();
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown();
    });
  }
}
