import { getZonedParts, zonedTimeToUtc } from '@bookspace/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatWhen } from '../lib/format';

type Hour = { weekday: number; openTime: string; closeTime: string };
type Block = { id: string; startTime: string; endTime: string; reason: string };
type UserRow = { id: string; fullName: string; roles: string[]; isActive: boolean };
type ResourceDetails = {
  name: string;
  description: string;
  location: string;
  capacity: number;
  approvalRequired: boolean;
  minMinutes: number;
  maxMinutes: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
  assetTag: string | null;
  serialNo: string | null;
  parentResourceId: string | null;
  allowedUserTypes: string[];
  status: string;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function normalizeHours(hours: Hour[]) {
  return hours.map((hour) => ({ ...hour, openTime: hour.openTime.slice(0, 5), closeTime: hour.closeTime.slice(0, 5) }));
}

export function ResourceAdmin({
  resourceId,
  details,
  hours,
  blocks,
  approverIds,
  timeZone,
}: {
  resourceId: string;
  details: ResourceDetails;
  hours: Hour[];
  blocks: Block[];
  approverIds: string[];
  timeZone: string;
}) {
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState(details);
  const [draftHours, setDraftHours] = useState(() => normalizeHours(hours));
  const [block, setBlock] = useState({
    date: getZonedParts(new Date(), timeZone).dateKey,
    start: '12:00',
    end: '13:00',
    reason: '',
  });
  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<{ data: UserRow[] }>('/api/v1/users'),
  });
  const catalogue = useQuery({
    queryKey: ['admin-resources'],
    queryFn: () => api<{ data: { id: string; name: string }[] }>('/api/v1/resources?status=all&pageSize=100'),
  });
  const staff =
    users.data?.data.filter(
      (user) => user.isActive && (user.roles.includes('approver') || user.roles.includes('admin')),
    ) ?? [];
  const [selected, setSelected] = useState(approverIds);

  useEffect(() => {
    setDraft(details);
    setDraftHours(normalizeHours(hours));
    setSelected(approverIds);
  }, [details, hours, approverIds]);

  async function save(task: () => Promise<unknown>, success: string) {
    try {
      await task();
      setMessage(success);
      await client.invalidateQueries({ queryKey: ['resource', resourceId] });
      await client.invalidateQueries({ queryKey: ['availability', resourceId] });
      await client.invalidateQueries({ queryKey: ['admin-resources'] });
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
          void save(
            () =>
              api(`/api/v1/resources/${resourceId}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  ...draft,
                  assetTag: draft.assetTag || null,
                  serialNo: draft.serialNo || null,
                  parentResourceId: draft.parentResourceId || null,
                }),
              }),
            'Resource details saved.',
          );
        }}
      >
        <h3>Details and policy</h3>
        <label>
          Name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label>
          Description
          <textarea
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <label>
          Location
          <input
            value={draft.location}
            onChange={(event) => setDraft({ ...draft, location: event.target.value })}
          />
        </label>
        <label>
          Status
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="retired">Retired</option>
          </select>
        </label>
        <label>
          Capacity
          <input
            type="number"
            value={draft.capacity}
            onChange={(event) => setDraft({ ...draft, capacity: Number(event.target.value) })}
          />
        </label>
        <label>
          Min minutes
          <input
            type="number"
            value={draft.minMinutes}
            onChange={(event) => setDraft({ ...draft, minMinutes: Number(event.target.value) })}
          />
        </label>
        <label>
          Max minutes
          <input
            type="number"
            value={draft.maxMinutes}
            onChange={(event) => setDraft({ ...draft, maxMinutes: Number(event.target.value) })}
          />
        </label>
        <label>
          Max advance days
          <input
            type="number"
            value={draft.maxAdvanceDays}
            onChange={(event) => setDraft({ ...draft, maxAdvanceDays: Number(event.target.value) })}
          />
        </label>
        <label>
          Buffer minutes
          <input
            type="number"
            value={draft.bufferMinutes}
            onChange={(event) => setDraft({ ...draft, bufferMinutes: Number(event.target.value) })}
          />
        </label>
        <label>
          Asset tag
          <input
            value={draft.assetTag ?? ''}
            onChange={(event) => setDraft({ ...draft, assetTag: event.target.value })}
          />
        </label>
        <label>
          Serial number
          <input
            value={draft.serialNo ?? ''}
            onChange={(event) => setDraft({ ...draft, serialNo: event.target.value })}
          />
        </label>
        <label>
          Parent resource
          <select
            value={draft.parentResourceId ?? ''}
            onChange={(event) => setDraft({ ...draft, parentResourceId: event.target.value || null })}
          >
            <option value="">None</option>
            {catalogue.data?.data
              .filter((row) => row.id !== resourceId)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </label>
        <fieldset>
          <legend>Allowed user types</legend>
          {['student', 'lecturer', 'staff'].map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={draft.allowedUserTypes.includes(type)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    allowedUserTypes: event.target.checked
                      ? [...draft.allowedUserTypes, type]
                      : draft.allowedUserTypes.filter((item) => item !== type),
                  })
                }
              />
              {type}
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={draft.approvalRequired}
            onChange={(event) => setDraft({ ...draft, approvalRequired: event.target.checked })}
          />{' '}
          Approval required
        </label>
        <button className="button" type="submit">
          Save details
        </button>
      </form>
      <form
        className="grid"
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            () =>
              api(`/api/v1/resources/${resourceId}/hours`, {
                method: 'PUT',
                body: JSON.stringify({ hours: draftHours }),
              }),
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
                {DAYS.map((day, dayIndex) => (
                  <option key={day} value={dayIndex}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Opens
              <input
                type="time"
                value={hour.openTime}
                onChange={(event) => {
                  const next = [...draftHours];
                  next[index] = { ...hour, openTime: event.target.value };
                  setDraftHours(next);
                }}
              />
            </label>
            <label>
              Closes
              <input
                type="time"
                value={hour.closeTime}
                onChange={(event) => {
                  const next = [...draftHours];
                  next[index] = { ...hour, closeTime: event.target.value };
                  setDraftHours(next);
                }}
              />
            </label>
            <button
              className="button secondary"
              type="button"
              onClick={() => setDraftHours(draftHours.filter((_, item) => item !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="inline">
          <button
            className="button secondary"
            type="button"
            onClick={() => setDraftHours([...draftHours, { weekday: 1, openTime: '08:00', closeTime: '18:00' }])}
          >
            Add window
          </button>
          <button className="button" type="submit">
            Save hours
          </button>
        </div>
      </form>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const startTime = zonedTimeToUtc(block.date, block.start, timeZone).toISOString();
          const endTime = zonedTimeToUtc(block.date, block.end, timeZone).toISOString();
          void save(
            () =>
              api(`/api/v1/resources/${resourceId}/blocks`, {
                method: 'POST',
                body: JSON.stringify({ startTime, endTime, reason: block.reason }),
              }),
            'Closure saved.',
          );
        }}
      >
        <h3>Maintenance and closures</h3>
        <ul>
          {blocks.map((item) => (
            <li key={item.id}>
              {item.reason} · {formatWhen(item.startTime, timeZone)}
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  void save(
                    () => api(`/api/v1/resources/${resourceId}/blocks/${item.id}`, { method: 'DELETE' }),
                    'Closure removed.',
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <label>
          Date
          <input type="date" value={block.date} onChange={(event) => setBlock({ ...block, date: event.target.value })} />
        </label>
        <label>
          Start
          <input
            type="time"
            value={block.start}
            onChange={(event) => setBlock({ ...block, start: event.target.value })}
          />
        </label>
        <label>
          End
          <input type="time" value={block.end} onChange={(event) => setBlock({ ...block, end: event.target.value })} />
        </label>
        <label>
          Reason
          <input
            value={block.reason}
            onChange={(event) => setBlock({ ...block, reason: event.target.value })}
            required
            minLength={3}
          />
        </label>
        <button className="button" type="submit">
          Add closure
        </button>
      </form>
      <form
        className="grid"
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            () =>
              api(`/api/v1/resources/${resourceId}/approvers`, {
                method: 'PUT',
                body: JSON.stringify({ userIds: selected }),
              }),
            'Approvers saved.',
          );
        }}
      >
        <h3>Approvers</h3>
        {staff.length === 0 && <p>No approver or administrator accounts yet.</p>}
        {staff.map((user) => (
          <label key={user.id}>
            <input
              type="checkbox"
              checked={selected.includes(user.id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, user.id]
                    : selected.filter((id) => id !== user.id),
                )
              }
            />
            {user.fullName}
          </label>
        ))}
        <button className="button" type="submit">
          Save approvers
        </button>
      </form>
    </section>
  );
}
