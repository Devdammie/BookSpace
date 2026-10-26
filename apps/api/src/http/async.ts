import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ProblemError } from './errors.js';

export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function parseOrThrow<T extends ZodType>(schema: T, data: unknown): T['_output'] {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ProblemError(400, 'VALIDATION_ERROR', 'Request validation failed', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
