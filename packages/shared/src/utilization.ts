import { addDays, getZonedParts, normalizeTime, zonedTimeToUtc, type HoursWindow } from './time.js';

export type UtilizationResource = {
  id: string;
  hours: HoursWindow[];
};

export type UtilizationBooking = {
  resourceId: string;
  start: Date;
  end: Date;
};

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / 60_000);
}

function clip(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): { start: Date; end: Date } | null {
  const clippedStart = new Date(Math.max(start.getTime(), rangeStart.getTime()));
  const clippedEnd = new Date(Math.min(end.getTime(), rangeEnd.getTime()));
  if (clippedEnd <= clippedStart) return null;
  return { start: clippedStart, end: clippedEnd };
}

export function utilization(input: {
  rangeStart: Date;
  rangeEnd: Date;
  timeZone: string;
  resources: UtilizationResource[];
  bookings: UtilizationBooking[];
}): { bookedMinutes: number; availableMinutes: number; ratio: number } {
  if (input.rangeEnd <= input.rangeStart) {
    return { bookedMinutes: 0, availableMinutes: 0, ratio: 0 };
  }
  const startKey = getZonedParts(input.rangeStart, input.timeZone).dateKey;
  const endKey = getZonedParts(new Date(input.rangeEnd.getTime() - 1), input.timeZone).dateKey;
  let available = 0;
  let booked = 0;
  let guard = 0;
  for (let key = startKey; key <= endKey; key = addDays(key, 1)) {
    if (++guard > 400) break;
    const dayStart = zonedTimeToUtc(key, '00:00:00', input.timeZone);
    const dayEnd = zonedTimeToUtc(addDays(key, 1), '00:00:00', input.timeZone);
    const weekday = getZonedParts(dayStart, input.timeZone).weekday;
    for (const resource of input.resources) {
      const windows =
        resource.hours.length === 0
          ? [{ start: dayStart, end: dayEnd }]
          : resource.hours
              .filter((window) => window.weekday === weekday)
              .map((window) => ({
                start: zonedTimeToUtc(key, normalizeTime(window.openTime), input.timeZone),
                end: zonedTimeToUtc(key, normalizeTime(window.closeTime), input.timeZone),
              }));
      for (const window of windows) {
        const open = clip(window.start, window.end, input.rangeStart, input.rangeEnd);
        if (!open) continue;
        available += minutesBetween(open.start, open.end);
        for (const booking of input.bookings) {
          if (booking.resourceId !== resource.id) continue;
          const overlap = clip(booking.start, booking.end, open.start, open.end);
          if (overlap) booked += minutesBetween(overlap.start, overlap.end);
        }
      }
    }
  }
  const ratio = available === 0 ? 0 : Math.round((booked / available) * 1000) / 1000;
  return { bookedMinutes: booked, availableMinutes: available, ratio };
}
