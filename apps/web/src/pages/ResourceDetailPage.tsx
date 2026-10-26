import { createBookingSchema, getZonedParts, zonedTimeToUtc } from '@bookspace/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ResourceAdmin } from '../components/ResourceAdmin';
import { WeekCalendar } from '../components/WeekCalendar';
import { ApiError, api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays } from '@bookspace/shared';

const formSchema = z.object({
  date: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  purpose: z.string().min(3),
});

type ResourceDetail = {
  data: {
    id: string;
    name: string;
    description: string;
    kind: string;
    location: string;
    capacity: number;
    approvalRequired: boolean;
    minMinutes: number;
    maxMinutes: number;
    bufferMinutes: number;
    status: string;
    hours: { weekday: number; openTime: string; closeTime: string }[];
    blocks: { id: string; startTime: string; endTime: string; reason: string }[];
    approverIds: string[];
  };
};

export function ResourceDetailPage() {
  const { id = '' } = useParams();
  const auth = useAuth();
  const client = useQueryClient();
  const timeZone = auth.user?.timezone ?? 'UTC';
  const today = getZonedParts(new Date(), timeZone).dateKey;
  const [anchor, setAnchor] = useState(today);
  const idempotency = useRef(crypto.randomUUID());
  const resource = useQuery({
    queryKey: ['resource', id],
    queryFn: () => api<ResourceDetail>(`/api/v1/resources/${id}`),
  });
  const weekEnd = addDays(anchor, 7);
  const availability = useQuery({
    queryKey: ['availability', id, anchor],
    queryFn: () =>
      api<{
        data: {
          bookings: { id: string; startTime: string; endTime: string; status: string; purpose?: string }[];
          blocks: { id: string; startTime: string; endTime: string; reason: string }[];
        };
      }>(`/api/v1/resources/${id}/availability?from=${zonedTimeToUtc(anchor, '00:00:00', timeZone).toISOString()}&to=${zonedTimeToUtc(weekEnd, '00:00:00', timeZone).toISOString()}`),
  });
  const form = useForm({ resolver: zodResolver(formSchema), defaultValues: { date: today, start: '10:00', end: '11:00', purpose: '' } });
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ startTime: string; endTime: string }[]>([]);
  const items = useMemo(() => {
    const bookings = availability.data?.data.bookings.map((item) => ({
      id: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
      status: item.status,
      label: item.status === 'CONFIRMED' ? 'Confirmed' : 'Pending',
    })) ?? [];
    const blocks = availability.data?.data.blocks.map((item) => ({
      id: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
      status: 'blocked',
      label: `Blocked: ${item.reason}`,
    })) ?? [];
    return [...bookings, ...blocks];
  }, [availability.data]);
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const startTime = zonedTimeToUtc(values.date, values.start, timeZone).toISOString();
      const endTime = zonedTimeToUtc(values.date, values.end, timeZone).toISOString();
      const parsed = createBookingSchema.safeParse({ resourceId: id, startTime, endTime, purpose: values.purpose });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the booking times.');
      return api(`/api/v1/bookings`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotency.current },
        body: JSON.stringify(parsed.data),
      });
    },
    onSuccess: async () => {
      setMessage('Request saved.');
      setSuggestions([]);
      idempotency.current = crypto.randomUUID();
      await client.invalidateQueries({ queryKey: ['availability', id] });
    },
    onError: (error) => {
      setMessage(errorText(error));
      setSuggestions(error instanceof ApiError ? error.suggestions ?? [] : []);
    },
  });
  if (resource.isLoading) return <p role="status">Loading resource…</p>;
  if (resource.error || !resource.data) return <p className="alert">{errorText(resource.error)}</p>;
  const data = resource.data.data;
  return (
    <div className="grid">
      <div>
        <h1>{data.name}</h1>
        <p>{data.description}</p>
        <p className="muted">{data.kind} · {data.location} · capacity {data.capacity} · {data.minMinutes}–{data.maxMinutes} min · buffer {data.bufferMinutes} min · {data.approvalRequired ? 'Approval required' : 'Confirms immediately'}</p>
      </div>
      <div className="inline">
        <button className="button secondary" type="button" onClick={() => setAnchor(addDays(anchor, -7))}>Previous week</button>
        <button className="button secondary" type="button" onClick={() => setAnchor(addDays(anchor, 7))}>Next week</button>
      </div>
      <WeekCalendar
        anchor={anchor}
        timeZone={timeZone}
        items={items}
        onSelect={(date, hour) => {
          form.setValue('date', date);
          form.setValue('start', `${String(hour).padStart(2, '0')}:00`);
          form.setValue('end', `${String(hour + 1).padStart(2, '0')}:00`);
        }}
      />
      <form className="panel form" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <h2>Request this resource</h2>
        <label>Date<input type="date" {...form.register('date')} /></label>
        <label>Start<input type="time" {...form.register('start')} /></label>
        <label>End<input type="time" {...form.register('end')} /></label>
        <label>Purpose<textarea {...form.register('purpose')} /></label>
        {message && <p className="alert" role="alert">{message}</p>}
        {suggestions.length > 0 && (
          <div>
            <p>Nearby free slots:</p>
            {suggestions.map((slot) => (
              <button
                className="button secondary"
                type="button"
                key={slot.startTime}
                onClick={() => {
                  const parts = getZonedParts(new Date(slot.startTime), timeZone);
                  const end = getZonedParts(new Date(slot.endTime), timeZone);
                  form.setValue('date', parts.dateKey);
                  form.setValue('start', parts.timeKey.slice(0, 5));
                  form.setValue('end', end.timeKey.slice(0, 5));
                }}
              >
                Use {slot.startTime.slice(0, 16).replace('T', ' ')}
              </button>
            ))}
          </div>
        )}
        <button className="button" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Submitting…' : 'Submit request'}</button>
      </form>
      {auth.user?.roles.includes('admin') && (
        <ResourceAdmin
          key={data.id}
          resourceId={data.id}
          status={data.status}
          hours={data.hours}
          blocks={data.blocks ?? []}
          approverIds={data.approverIds ?? []}
          timeZone={timeZone}
        />
      )}
      {data.hours.length > 0 && (
        <section>
          <h2>Opening hours</h2>
          <ul>
            {data.hours.map((hour) => (
              <li key={`${hour.weekday}-${hour.openTime}`}>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][hour.weekday]} {hour.openTime.slice(0, 5)}–{hour.closeTime.slice(0, 5)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
