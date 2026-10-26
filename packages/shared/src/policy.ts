import { rangesOverlap, occupiedEnd } from './booking.js';
import { withinOpeningHours, type HoursWindow, zonedTimeToUtc, normalizeTime } from './time.js';

export type PolicyIssue = { status: number; code: string; detail: string };

export type PolicyResource = {
  status: string;
  minMinutes: number;
  maxMinutes: number;
  maxAdvanceDays: number;
  allowedUserTypes: readonly string[];
};

export function evaluatePolicy(input: {
  start: Date;
  end: Date;
  now: Date;
  timeZone: string;
  userType: string;
  resource: PolicyResource;
  hours: HoursWindow[];
}): PolicyIssue | null {
  if (input.resource.status !== 'active') {
    return { status: 409, code: 'RESOURCE_UNAVAILABLE', detail: 'This resource is not available for booking.' };
  }
  if (!(input.end > input.start)) {
    return { status: 400, code: 'VALIDATION_ERROR', detail: 'End time must be after the start time.' };
  }
  if (input.start <= input.now) {
    return { status: 400, code: 'IN_THE_PAST', detail: 'The booking must start in the future.' };
  }
  const minutes = (input.end.getTime() - input.start.getTime()) / 60_000;
  if (minutes < input.resource.minMinutes || minutes > input.resource.maxMinutes) {
    return {
      status: 400,
      code: 'DURATION_INVALID',
      detail: `Bookings must be between ${input.resource.minMinutes} and ${input.resource.maxMinutes} minutes.`,
    };
  }
  const latest = input.now.getTime() + input.resource.maxAdvanceDays * 86_400_000;
  if (input.start.getTime() > latest) {
    return {
      status: 400,
      code: 'TOO_FAR_AHEAD',
      detail: `Bookings can only be made ${input.resource.maxAdvanceDays} days ahead.`,
    };
  }
  if (
    input.resource.allowedUserTypes.length > 0 &&
    !input.resource.allowedUserTypes.includes(input.userType)
  ) {
    return { status: 403, code: 'USER_TYPE_NOT_ALLOWED', detail: 'Your account type cannot book this resource.' };
  }
  const hours = withinOpeningHours(input.start, input.end, input.timeZone, input.hours);
  if (!hours.ok) return { status: 400, code: 'OUTSIDE_HOURS', detail: hours.reason };
  return null;
}

export function intervalOverlapsBlock(
  start: Date,
  end: Date,
  bufferMinutes: number,
  blocks: { start: Date; end: Date }[],
): boolean {
  const occupied = occupiedEnd(end, bufferMinutes);
  return blocks.some((block) => rangesOverlap(start, occupied, block.start, block.end));
}

export function findFreeSlots(input: {
  dateKey: string;
  timeZone: string;
  openTime: string;
  closeTime: string;
  durationMinutes: number;
  stepMinutes: number;
  busy: { start: Date; end: Date }[];
  limit?: number;
}): { start: Date; end: Date }[] {
  const open = zonedTimeToUtc(input.dateKey, normalizeTime(input.openTime), input.timeZone);
  const close = zonedTimeToUtc(input.dateKey, normalizeTime(input.closeTime), input.timeZone);
  const results: { start: Date; end: Date }[] = [];
  const limit = input.limit ?? 3;
  for (
    let cursor = open.getTime();
    cursor + input.durationMinutes * 60_000 <= close.getTime();
    cursor += input.stepMinutes * 60_000
  ) {
    const start = new Date(cursor);
    const end = new Date(cursor + input.durationMinutes * 60_000);
    const hit = input.busy.some((busy) => rangesOverlap(start, end, busy.start, busy.end));
    if (!hit) results.push({ start, end });
    if (results.length >= limit) break;
  }
  return results;
}
