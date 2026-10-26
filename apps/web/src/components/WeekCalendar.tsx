import { addDays, getZonedParts, rangesOverlap, zonedTimeToUtc } from '@bookspace/shared';
import { Fragment } from 'react';

type Item = { id: string; startTime: string; endTime: string; status: string; label: string };

export function WeekCalendar({
  anchor,
  timeZone,
  items,
  onSelect,
}: {
  anchor: string;
  timeZone: string;
  items: Item[];
  onSelect?: (dateKey: string, hour: number) => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(anchor, index));
  const hours = Array.from({ length: 10 }, (_, index) => index + 8);
  return (
    <div className="week-scroll">
      <div className="week" role="grid" aria-label="Availability week">
        <div />
        {days.map((day) => (
          <div key={day}>{day.slice(5)}</div>
        ))}
        {hours.map((hour) => (
          <Fragment key={hour}>
            <div>{`${hour}:00`}</div>
            {days.map((day) => {
              const start = zonedTimeToUtc(day, `${String(hour).padStart(2, '0')}:00:00`, timeZone);
              const end = new Date(start.getTime() + 60 * 60 * 1000);
              const hits = items.filter((item) => rangesOverlap(start, end, new Date(item.startTime), new Date(item.endTime)));
              const kind = hits.some((hit) => hit.status === 'blocked')
                ? 'blocked'
                : hits.some((hit) => hit.status === 'CONFIRMED')
                  ? 'confirmed'
                  : hits.some((hit) => hit.status === 'PENDING_APPROVAL')
                    ? 'pending'
                    : '';
              const text = hits.map((hit) => hit.label).join(', ');
              return (
                <div key={`${day}-${hour}`} className={kind ? `slot-${kind}` : undefined}>
                  <button type="button" onClick={() => onSelect?.(day, hour)} aria-label={`${day} ${hour}:00 ${text || 'free'}`}>
                    {text || 'Free'}
                  </button>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className="muted">Times use {timeZone}. Patterned cells are closures. Shaded cells are bookings. Each cell also says Free, Confirmed, Pending, or Blocked.</p>
      <span className="sr-only">{getZonedParts(new Date(), timeZone).dateKey}</span>
    </div>
  );
}
