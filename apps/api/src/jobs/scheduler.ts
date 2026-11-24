import cron from 'node-cron';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { createBookingService } from '../modules/bookings/service.js';

const MAX_BATCHES_PER_TICK = 10;

export type SchedulerHandle = {
  stop: () => Promise<void>;
};

export function startScheduler(db: Database, config: AppConfig, log: { error: (error: unknown) => void }) {
  const service = createBookingService(db, config);
  let running = false;
  let stopped = false;
  let activeRun: Promise<void> | null = null;

  async function drainMaintenance() {
    if (running || stopped) return;
    running = true;
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_TICK && !stopped; batch += 1) {
        const processed = await service.runMaintenance();
        if (processed === 0) break;
      }
    } catch (error) {
      log.error(error);
    } finally {
      running = false;
    }
  }

  function runMaintenance() {
    if (running || stopped) return;
    activeRun = drainMaintenance().finally(() => {
      activeRun = null;
    });
  }

  const task = cron.schedule('* * * * *', () => {
    runMaintenance();
  });

  runMaintenance();

  return {
    async stop() {
      stopped = true;
      await task.stop();
      await activeRun;
    },
  } satisfies SchedulerHandle;
}
