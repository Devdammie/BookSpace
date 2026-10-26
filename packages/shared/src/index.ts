export * from './time.js';
export * from './booking.js';
export * from './policy.js';
export * from './utilization.js';
export * from './schemas.js';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'SLOT_CONFLICT',
  'INVALID_TRANSITION',
  'RESOURCE_BLOCKED',
  'RESOURCE_UNAVAILABLE',
  'OUTSIDE_HOURS',
  'STALE_VERSION',
  'DURATION_INVALID',
  'IN_THE_PAST',
  'TOO_FAR_AHEAD',
  'USER_TYPE_NOT_ALLOWED',
  'NO_APPROVER',
  'PASSWORD_CHANGE_REQUIRED',
  'RATE_LIMITED',
  'CSRF',
  'IDEMPOTENCY_CONFLICT',
  'INTERNAL',
] as const;
