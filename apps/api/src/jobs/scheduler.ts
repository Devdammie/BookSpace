import cron from 'node-cron';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { createBookingService } from '../modules/bookings/service.js';

export function startScheduler(db: Database, config: AppConfig, log: { error: (error: unknown) => void }) {
  const service = createBookingService(db, config);
  return cron.schedule('* * * * *', () => {
    service.runMaintenance().catch((error: unknown) => log.error(error));
  });
}
