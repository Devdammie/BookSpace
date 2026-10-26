import { Router } from 'express';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { asyncRoute } from '../../http/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createBookingService } from '../bookings/service.js';
import { actorOf } from '../../middleware/auth.js';

export function createApprovalRouter(db: Database, config: AppConfig) {
  const router = Router();
  const service = createBookingService(db, config);
  router.get(
    '/',
    requireAuth(db),
    requireRole('approver', 'admin'),
    asyncRoute(async (req, res) => {
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 20);
      res.json(await service.list(actorOf(req), { page, pageSize, scope: 'queue' }));
    }),
  );
  return router;
}
