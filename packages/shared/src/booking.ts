export const BOOKING_STATUSES = [
  'PENDING_APPROVAL',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
  'EXPIRED',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_ACTIONS = ['approve', 'reject', 'cancel', 'expire', 'complete'] as const;
export type BookingAction = (typeof BOOKING_ACTIONS)[number];

const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingAction, BookingStatus>>> = {
  PENDING_APPROVAL: {
    approve: 'CONFIRMED',
    reject: 'REJECTED',
    cancel: 'CANCELLED',
    expire: 'EXPIRED',
  },
  CONFIRMED: {
    cancel: 'CANCELLED',
    complete: 'COMPLETED',
  },
  REJECTED: {},
  CANCELLED: {},
  COMPLETED: {},
  EXPIRED: {},
};

export function transition(from: BookingStatus, action: BookingAction): BookingStatus {
  const next = TRANSITIONS[from][action];
  if (!next) {
    throw new Error(`INVALID_TRANSITION:${from}:${action}`);
  }
  return next;
}

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Buffer sits after the requested end, so adjacent bookings keep a gap of N minutes, not 2N. */
export function occupiedEnd(end: Date, bufferMinutes: number): Date {
  return new Date(end.getTime() + bufferMinutes * 60_000);
}

export function toTstzRange(start: Date, end: Date): string {
  return `[${start.toISOString()},${end.toISOString()})`;
}

type ActorRef = { id: string; roles: readonly string[] };

export function canDecide(
  actor: ActorRef,
  bookingUserId: string,
  approverIds: readonly string[],
): { ok: true; override: boolean } | { ok: false; reason: string } {
  if (actor.id === bookingUserId) {
    return { ok: false, reason: 'You cannot decide your own request.' };
  }
  if (actor.roles.includes('admin')) {
    return { ok: true, override: !approverIds.includes(actor.id) };
  }
  if (actor.roles.includes('approver') && approverIds.includes(actor.id)) {
    return { ok: true, override: false };
  }
  return { ok: false, reason: 'You are not allowed to decide this request.' };
}

export function canCancel(actor: ActorRef, bookingUserId: string, status: BookingStatus): boolean {
  if (status !== 'PENDING_APPROVAL' && status !== 'CONFIRMED') return false;
  if (actor.roles.includes('admin')) return true;
  return actor.id === bookingUserId;
}

export function canEditPending(actor: ActorRef, bookingUserId: string, status: BookingStatus): boolean {
  if (status !== 'PENDING_APPROVAL') return false;
  return actor.id === bookingUserId || actor.roles.includes('admin');
}

export function canViewBooking(actor: ActorRef, bookingUserId: string, approverIds: readonly string[]): boolean {
  if (actor.roles.includes('admin')) return true;
  if (actor.id === bookingUserId) return true;
  return actor.roles.includes('approver') && approverIds.includes(actor.id);
}

export function isStaff(roles: readonly string[]): boolean {
  return roles.includes('approver') || roles.includes('admin');
}
