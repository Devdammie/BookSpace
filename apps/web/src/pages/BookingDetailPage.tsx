import { getZonedParts, zonedTimeToUtc } from '@bookspace/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatWhen } from '../lib/format';

type Booking = {
  data: {
    id: string;
    resourceName: string;
    purpose: string;
    status: string;
    version: number;
    startTime: string;
    endTime: string;
    requesterName: string;
  };
};

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const auth = useAuth();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const booking = useQuery({ queryKey: ['booking', id], queryFn: () => api<Booking>(`/api/v1/bookings/${id}`) });
  const events = useQuery({
    queryKey: ['booking-events', id],
    queryFn: () => api<{ data: { id: string; eventType: string; actorName: string; createdAt: string; toStatus: string | null }[] }>(`/api/v1/bookings/${id}/events`),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: async () => {
      setConfirming(false);
      await client.invalidateQueries({ queryKey: ['booking', id] });
    },
  });
  if (booking.isLoading) return <p role="status">Loading booking…</p>;
  if (booking.error || !booking.data) return <p className="alert">{errorText(booking.error)}</p>;
  const data = booking.data.data;
  const zone = auth.user!.timezone;
  return (
    <div className="grid">
      <h1>{data.resourceName}</h1>
      <p><StatusBadge status={data.status} /> · {data.purpose}</p>
      <p>{formatWhen(data.startTime, zone)} to {formatWhen(data.endTime, zone)}</p>
      <p>Requested by {data.requesterName}</p>
      {(data.status === 'PENDING_APPROVAL' || data.status === 'CONFIRMED') && (
        <div className="panel grid">
          <h2>Cancel</h2>
          {data.status === 'CONFIRMED' && <p>Cancelling a confirmed booking frees the slot for someone else.</p>}
          <label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          {!confirming && <button className="button danger" type="button" onClick={() => setConfirming(true)}>Cancel booking</button>}
          {confirming && (
            <div className="inline">
              <button className="button danger" type="button" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Confirm cancellation</button>
              <button className="button secondary" type="button" onClick={() => setConfirming(false)}>Keep booking</button>
            </div>
          )}
          {cancel.error && <p className="alert" role="alert">{errorText(cancel.error)}</p>}
        </div>
      )}
      {data.status === 'PENDING_APPROVAL' && <ScheduleForm key={data.version} bookingId={data.id} version={data.version} startTime={data.startTime} endTime={data.endTime} purpose={data.purpose} timeZone={zone} mode="edit" />}
      {data.status === 'CONFIRMED' && auth.user?.roles.includes('admin') && (
        <ScheduleForm key={data.version} bookingId={data.id} version={data.version} startTime={data.startTime} endTime={data.endTime} purpose={data.purpose} timeZone={zone} mode="reschedule" />
      )}
      <section>
        <h2>History</h2>
        <ol>
          {events.data?.data.map((event) => (
            <li key={event.id}>{event.eventType} by {event.actorName} · {formatWhen(event.createdAt, zone)} {event.toStatus ? `→ ${event.toStatus}` : ''}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ScheduleForm({
  bookingId,
  version,
  startTime,
  endTime,
  purpose,
  timeZone,
  mode,
}: {
  bookingId: string;
  version: number;
  startTime: string;
  endTime: string;
  purpose: string;
  timeZone: string;
  mode: 'edit' | 'reschedule';
}) {
  const client = useQueryClient();
  const start = getZonedParts(new Date(startTime), timeZone);
  const end = getZonedParts(new Date(endTime), timeZone);
  const [form, setForm] = useState({ date: start.dateKey, start: start.timeKey.slice(0, 5), end: end.timeKey.slice(0, 5), purpose });
  const [message, setMessage] = useState('');
  const title = mode === 'edit' ? 'Edit pending request' : 'Reschedule confirmed booking';
  return (
    <form
      className="panel form"
      onSubmit={async (event) => {
        event.preventDefault();
        const body = {
          startTime: zonedTimeToUtc(form.date, form.start, timeZone).toISOString(),
          endTime: zonedTimeToUtc(form.date, form.end, timeZone).toISOString(),
          version,
          ...(mode === 'edit' ? { purpose: form.purpose } : {}),
        };
        try {
          await api(mode === 'edit' ? `/api/v1/bookings/${bookingId}` : `/api/v1/bookings/${bookingId}/reschedule`, {
            method: mode === 'edit' ? 'PATCH' : 'POST',
            body: JSON.stringify(body),
          });
          setMessage('Saved.');
          await client.invalidateQueries({ queryKey: ['booking', bookingId] });
          await client.invalidateQueries({ queryKey: ['booking-events', bookingId] });
        } catch (error) {
          setMessage(errorText(error));
        }
      }}
    >
      <h2>{title}</h2>
      <label>Date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
      <label>Start<input type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label>
      <label>End<input type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></label>
      {mode === 'edit' && <label>Purpose<textarea value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} /></label>}
      <button className="button" type="submit">Save</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
