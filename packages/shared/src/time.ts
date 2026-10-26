const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type ZonedParts = {
  weekday: number;
  year: number;
  month: number;
  day: number;
  dateKey: string;
  timeKey: string;
};

export function normalizeTime(value: string): string {
  const [hour = '00', minute = '00', second = '00'] = value.split(':');
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const weekday = WEEKDAYS.indexOf(parts.weekday as (typeof WEEKDAYS)[number]);
  return {
    weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timeKey: `${hour}:${parts.minute}:${parts.second}`,
  };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Number(parts.timeKey.slice(0, 2)),
    Number(parts.timeKey.slice(3, 5)),
    Number(parts.timeKey.slice(6, 8)),
  );
  return asUtc - date.getTime();
}

/** Convert a department-local civil time to a UTC instant. */
export function zonedTimeToUtc(dateKey: string, timeKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute, second] = normalizeTime(timeKey).split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = zoneOffsetMs(new Date(utcGuess), timeZone);
  const first = new Date(utcGuess - firstOffset);
  const secondOffset = zoneOffsetMs(first, timeZone);
  return secondOffset === firstOffset ? first : new Date(utcGuess - secondOffset);
}

export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export type HoursWindow = {
  weekday: number;
  openTime: string;
  closeTime: string;
};

export function withinOpeningHours(
  start: Date,
  end: Date,
  timeZone: string,
  hours: HoursWindow[],
): { ok: true } | { ok: false; reason: string } {
  if (hours.length === 0) return { ok: true };
  const startParts = getZonedParts(start, timeZone);
  const endParts = getZonedParts(end, timeZone);
  let endDateKey = endParts.dateKey;
  let endTime = endParts.timeKey;
  if (endTime === '00:00:00' && endDateKey !== startParts.dateKey) {
    endDateKey = addDays(endDateKey, -1);
    endTime = '24:00:00';
  }
  if (startParts.dateKey !== endDateKey) {
    return { ok: false, reason: 'Bookings must start and end on the same local day.' };
  }
  const windows = hours.filter((window) => window.weekday === startParts.weekday);
  if (windows.length === 0) {
    return { ok: false, reason: 'The resource is closed on that day.' };
  }
  const fits = windows.some((window) => {
    const open = normalizeTime(window.openTime);
    const close = normalizeTime(window.closeTime);
    return startParts.timeKey >= open && endTime <= close;
  });
  if (!fits) return { ok: false, reason: 'The booking is outside opening hours.' };
  return { ok: true };
}
