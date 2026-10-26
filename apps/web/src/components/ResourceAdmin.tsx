import { getZonedParts, zonedTimeToUtc } from '@bookspace/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatWhen } from '../lib/format';

type Hour = { weekday: number; openTime: string; closeTime: string };
type Block = { id: string; startTime: string; endTime: string; reason: string };
type UserRow = { id: string; fullName: string; roles: string[]; isActive: boolean };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ResourceAdmin({
  resourceId,
  status,
  hours,
  blocks,
  approverIds,
  timeZone,
}: {
  resourceId: string;
  status: string;
  hours: Hour[];
  blocks: Block[];
  approverIds: string[];
  timeZone: string;
}) {
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const [nextStatus, setNextStatus] = useState(status);
  const [draftHours, setDraftHours] = useState(
    hours.map((hour) => ({ ...hour, openTime: hour.openTime.slice(0, 5), closeTime: hour.closeTime.slice(0, 5) })),
  );
  const [block, setBlock] = useState({ date: getZonedParts(new Date(), timeZone).dateKey, start: '12:00', end: '13:00', reason: '' });
  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<{ data: UserRow[] }>('/api/v1/users'),
  });
  const staff = users.data?.data.filter((user) => user.isActive && (user.roles.includes('approver') || user.roles.includes('admin'))) ?? [];
  const [selected, setSelected] = useState(approverIds);

  async function save(task: () => Promise<unknown>, success: string) {
    try {
      await task();
      setMessage(success);
      await client.invalidateQueries({ queryKey: ['resource', resourceId] });
      await client.invalidateQueries({ queryKey: ['availability', resourceId] });
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <section className="panel grid">
      <h2>Manage this resource</h2>
      {message && <p role="status">{message}</p>}
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(() => api(`/api/v1/resources/${resourceId}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }), 'Status saved.');
        }}
      >
        <label>
          Status
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="retired">Retired</option>
          </select>
        </label>
        <button className="button secondary" type="submit">Save status</button>
      </form>
      <form
        className="grid"
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            () => api(`/api/v1/resources/${resourceId}/hours`, { method: 'PUT', body: JSON.stringify({ hours: draftHours }) }),
            'Opening hours saved.',
          );
        }}
      >
        <h3>Opening hours</h3>
        {draftHours.map((hour, index) => (
          <div className="inline" key={`${hour.weekday}-${index}`}>
            <label>
              Day
              <select
                value={hour.weekday}
                onChange={(event) => {
                  const next = [...draftHours];
                  next[index] = { ...hour, weekday: Number(event.target.value) };
                  setDraftHours(next);
                }}
              >
                {DAYS.map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}
              </select>
            </label>
            <label>Opens<input type="time" value={hour.openTime} onChange={(event) => {
              const next = [...draftHours];
              next[index] = { ...hour, openTime: event.target.value };
              setDraftHours(next);
            }} /></label>
            <label>Closes<input type="time" value={hour.closeTime} onChange={(event) => {
              const next = [...draftHours];
              next[index] = { ...hour, closeTime: event.target.value };
              setDraftHours(next);
            }} /></label>
            <button className="button secondary" type="button" onClick={() => setDraftHours(draftHours.filter((_, item) => item !== index))}>Remove</button>
          </div>
        ))}
        <div className="inline">
          <button className="button secondary" type="button" onClick={() => setDraftHours([...draftHours, { weekday: 1, openTime: '08:00', closeTime: '18:00' }])}>Add window</button>
          <button className="button" type="submit">Save hours</button>
        </div>
      </form>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const startTime = zonedTimeToUtc(block.date, block.start, timeZone).toISOString();
          const endTime = zonedTimeToUtc(block.date, block.end, timeZone).toISOString();
          void save(
            () => api(`/api/v1/resources/${resourceId}/blocks`, { method: 'POST', body: JSON.stringify({ startTime, endTime, reason: block.reason }) }),
            'Closure saved.',
          );
        }}
      >
        <h3>Maintenance and closures</h3>
        <ul>
          {blocks.map((item) => (
            <li key={item.id}>
              {item.reason} · {formatWhen(item.startTime, timeZone)}
              <button className="button secondary" type="button" onClick={() => void save(() => api(`/api/v1/resources/${resourceId}/blocks/${item.id}`, { method: 'DELETE' }), 'Closure removed.')}>Remove</button>
            </li>
          ))}
        </ul>
        <label>Date<input type="date" value={block.date} onChange={(event) => setBlock({ ...block, date: event.target.value })} /></label>
        <label>Start<input type="time" value={block.start} onChange={(event) => setBlock({ ...block, start: event.target.value })} /></label>
        <label>End<input type="time" value={block.end} onChange={(event) => setBlock({ ...block, end: event.target.value })} /></label>
        <label>Reason<input value={block.reason} onChange={(event) => setBlock({ ...block, reason: event.target.value })} required minLength={3} /></label>
        <button className="button" type="submit">Add closure</button>
      </form>
      <form
        className="grid"
        onSubmit={(event) => {
          event.preventDefault();
          void save(() => api(`/api/v1/resources/${resourceId}/approvers`, { method: 'PUT', body: JSON.stringify({ userIds: selected }) }), 'Approvers saved.');
        }}
      >
        <h3>Approvers</h3>
        {staff.length === 0 && <p>No approver or administrator accounts yet.</p>}
        {staff.map((user) => (
          <label key={user.id}>
            <input
              type="checkbox"
              checked={selected.includes(user.id)}
              onChange={(event) => setSelected(event.target.checked ? [...selected, user.id] : selected.filter((id) => id !== user.id))}
            />
            {user.fullName}
          </label>
        ))}
        <button className="button" type="submit">Save approvers</button>
      </form>
    </section>
  );
}
