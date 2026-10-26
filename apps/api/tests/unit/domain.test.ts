import { describe, expect, it } from 'vitest';
import {
  canDecide,
  evaluatePolicy,
  findFreeSlots,
  occupiedEnd,
  rangesOverlap,
  transition,
  utilization,
  zonedTimeToUtc,
} from '@bookspace/shared';

const hours = [{ weekday: 1, openTime: '08:00', closeTime: '18:00' }];
const resource = {
  status: 'active',
  minMinutes: 30,
  maxMinutes: 180,
  maxAdvanceDays: 30,
  allowedUserTypes: [] as string[],
};

describe('overlap and buffer', () => {
  it('treats back-to-back slots as free', () => {
    const a = new Date('2026-11-02T09:00:00Z');
    const b = new Date('2026-11-02T10:00:00Z');
    const c = new Date('2026-11-02T11:00:00Z');
    expect(rangesOverlap(a, b, b, c)).toBe(false);
  });

  it('flags the four documented conflict shapes', () => {
    const t = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 2, hour, minute));
    expect(rangesOverlap(t(9), t(11), t(10), t(12))).toBe(true);
    expect(rangesOverlap(t(9), t(12), t(9, 30), t(10, 30))).toBe(true);
    expect(rangesOverlap(t(10), t(11), t(9), t(12))).toBe(true);
  });

  it('applies the buffer on the end side only', () => {
    const start = new Date('2026-11-02T09:00:00Z');
    const end = new Date('2026-11-02T10:00:00Z');
    const occupied = occupiedEnd(end, 15);
    expect(rangesOverlap(start, occupied, new Date('2026-11-02T10:00:00Z'), new Date('2026-11-02T11:00:00Z'))).toBe(true);
    expect(rangesOverlap(start, occupied, new Date('2026-11-02T10:15:00Z'), new Date('2026-11-02T11:15:00Z'))).toBe(false);
  });
});

describe('state machine', () => {
  it('confirms a pending request', () => {
    expect(transition('PENDING_APPROVAL', 'approve')).toBe('CONFIRMED');
  });

  it('rejects decisions on terminal states', () => {
    expect(() => transition('REJECTED', 'approve')).toThrow(/INVALID_TRANSITION/);
    expect(() => transition('CANCELLED', 'approve')).toThrow(/INVALID_TRANSITION/);
    expect(() => transition('CONFIRMED', 'approve')).toThrow(/INVALID_TRANSITION/);
  });

  it('expires and completes', () => {
    expect(transition('PENDING_APPROVAL', 'expire')).toBe('EXPIRED');
    expect(transition('CONFIRMED', 'complete')).toBe('COMPLETED');
    expect(transition('CONFIRMED', 'cancel')).toBe('CANCELLED');
  });
});

describe('permissions', () => {
  const approver = { id: 'a', roles: ['approver', 'member'] };
  const admin = { id: 'admin', roles: ['admin'] };

  it('blocks self approval', () => {
    expect(canDecide(approver, 'a', ['a']).ok).toBe(false);
    expect(canDecide(admin, 'admin', []).ok).toBe(false);
  });

  it('allows an assigned approver and an admin override', () => {
    expect(canDecide(approver, 'student', ['a'])).toEqual({ ok: true, override: false });
    expect(canDecide(approver, 'student', ['other']).ok).toBe(false);
    expect(canDecide(admin, 'student', [])).toEqual({ ok: true, override: true });
  });
});

describe('policy and time', () => {
  it('converts a post-DST local time in Los Angeles', () => {
    expect(zonedTimeToUtc('2026-03-09', '10:00:00', 'America/Los_Angeles').toISOString()).toBe('2026-03-09T17:00:00.000Z');
  });

  it('converts a post-fallback local time in Los Angeles', () => {
    expect(zonedTimeToUtc('2026-11-02', '10:00:00', 'America/Los_Angeles').toISOString()).toBe('2026-11-02T18:00:00.000Z');
  });

  it('rejects a user type the resource does not allow', () => {
    const start = zonedTimeToUtc('2026-11-02', '10:00:00', 'America/Los_Angeles');
    const end = zonedTimeToUtc('2026-11-02', '11:00:00', 'America/Los_Angeles');
    const issue = evaluatePolicy({
      start,
      end,
      now: new Date('2026-11-01T00:00:00Z'),
      timeZone: 'America/Los_Angeles',
      userType: 'student',
      resource: { ...resource, allowedUserTypes: ['lecturer', 'staff'] },
      hours,
    });
    expect(issue?.code).toBe('USER_TYPE_NOT_ALLOWED');
  });

  it('rejects a booking outside opening hours', () => {
    const start = zonedTimeToUtc('2026-11-02', '19:00:00', 'America/Los_Angeles');
    const end = zonedTimeToUtc('2026-11-02', '20:00:00', 'America/Los_Angeles');
    const issue = evaluatePolicy({
      start,
      end,
      now: new Date('2026-11-01T00:00:00Z'),
      timeZone: 'America/Los_Angeles',
      userType: 'student',
      resource,
      hours,
    });
    expect(issue?.code).toBe('OUTSIDE_HOURS');
  });

  it('suggests free slots around a busy block', () => {
    const busy = {
      start: zonedTimeToUtc('2026-11-02', '10:00:00', 'America/Los_Angeles'),
      end: zonedTimeToUtc('2026-11-02', '12:00:00', 'America/Los_Angeles'),
    };
    const slots = findFreeSlots({
      dateKey: '2026-11-02',
      timeZone: 'America/Los_Angeles',
      openTime: '08:00',
      closeTime: '13:00',
      durationMinutes: 60,
      stepMinutes: 60,
      busy: [busy],
      limit: 3,
    });
    expect(slots.map((slot) => slot.start.toISOString())).toEqual([
      '2026-11-02T16:00:00.000Z',
      '2026-11-02T17:00:00.000Z',
      '2026-11-02T20:00:00.000Z',
    ]);
  });
});

describe('utilization', () => {
  it('divides booked minutes by opening minutes', () => {
    const start = zonedTimeToUtc('2026-11-02', '00:00:00', 'America/Los_Angeles');
    const end = zonedTimeToUtc('2026-11-03', '00:00:00', 'America/Los_Angeles');
    const result = utilization({
      rangeStart: start,
      rangeEnd: end,
      timeZone: 'America/Los_Angeles',
      resources: [{ id: 'lab', hours: [{ weekday: 1, openTime: '08:00', closeTime: '10:00' }] }],
      bookings: [{
        resourceId: 'lab',
        start: zonedTimeToUtc('2026-11-02', '09:00:00', 'America/Los_Angeles'),
        end: zonedTimeToUtc('2026-11-02', '10:00:00', 'America/Los_Angeles'),
      }],
    });
    expect(result.availableMinutes).toBe(120);
    expect(result.bookedMinutes).toBe(60);
    expect(result.ratio).toBe(0.5);
  });
});
