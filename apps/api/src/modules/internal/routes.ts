import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { asyncRoute } from '../../http/async.js';
import { ProblemError } from '../../http/errors.js';
import { createBookingService } from '../bookings/service.js';

function bearerMatches(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice('Bearer '.length);
  const left = Buffer.from(token);
  const right = Buffer.from(secret);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createInternalRouter(db: Database, config: AppConfig) {
  const router = Router();
  const service = createBookingService(db, config);

  router.post(
    '/maintenance',
    asyncRoute(async (req, res) => {
      if (!config.cronSecret) {
        throw new ProblemError(503, 'INTERNAL', 'CRON_SECRET is not configured.');
      }
      if (!bearerMatches(req.header('authorization'), config.cronSecret)) {
        throw new ProblemError(401, 'UNAUTHENTICATED', 'Invalid cron credentials.');
      }

      let processed = 0;
      for (let batch = 0; batch < 10; batch += 1) {
        const count = await service.runMaintenance();
        processed += count;
        if (count === 0) break;
      }
      res.json({ data: { ok: true, processed } });
    }),
  );

  return router;
}
