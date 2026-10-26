import { Router } from 'express';
import {
  approveBookingSchema,
  cancelBookingSchema,
  createBookingSchema,
  listQuerySchema,
  rejectBookingSchema,
  rescheduleBookingSchema,
  updateBookingSchema,
  type BookingStatus,
} from '@bookspace/shared';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { asyncRoute, parseOrThrow } from '../../http/async.js';
import { actorOf, requireAuth } from '../../middleware/auth.js';
import { createBookingService } from './service.js';

const listSchema = listQuerySchema.extend({
  status: z.enum(['PENDING_APPROVAL', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED']).optional(),
  resourceId: z.string().uuid().optional(),
  scope: z.enum(['mine', 'queue', 'all']).optional(),
});

export function createBookingRouter(db: Database, config: AppConfig) {
  const router = Router();
  const service = createBookingService(db, config);
  const auth = requireAuth(db);

  router.post(
    '/',
    auth,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(createBookingSchema, req.body);
      const key = req.header('idempotency-key') ?? undefined;
      const result = await service.create(actorOf(req), body, key);
      res.status(201).json(result);
    }),
  );

  router.get(
    '/',
    auth,
    asyncRoute(async (req, res) => {
      const query = parseOrThrow(listSchema, req.query);
      res.json(await service.list(actorOf(req), { ...query, status: query.status as BookingStatus | undefined }));
    }),
  );

  router.get(
    '/:id/events',
    auth,
    asyncRoute(async (req, res) => {
      res.json(await service.events(actorOf(req), String(req.params.id)));
    }),
  );

  router.get(
    '/:id',
    auth,
    asyncRoute(async (req, res) => {
      res.json({ data: await service.get(actorOf(req), String(req.params.id)) });
    }),
  );

  router.patch(
    '/:id',
    auth,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(updateBookingSchema, req.body);
      res.json(await service.updatePending(actorOf(req), String(req.params.id), body));
    }),
  );

  router.post(
    '/:id/cancel',
    auth,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(cancelBookingSchema, req.body ?? {});
      res.json(await service.cancel(actorOf(req), String(req.params.id), body.reason));
    }),
  );

  router.post(
    '/:id/approve',
    auth,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(approveBookingSchema, req.body);
      res.json(await service.approve(actorOf(req), String(req.params.id), body.version));
    }),
  );

  router.post(
    '/:id/reject',
    auth,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(rejectBookingSchema, req.body);
      res.json(await service.reject(actorOf(req), String(req.params.id), body.version, body.reason));
    }),
  );

  router.post(
    '/:id/reschedule',
    auth,
    asyncRoute(async (req, res) => {
      const body = parseOrThrow(rescheduleBookingSchema, req.body);
      res.json(await service.reschedule(actorOf(req), String(req.params.id), body));
    }),
  );

  return { router, service };
}
