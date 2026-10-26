import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatWhen } from '../lib/format';

type Row = { id: string; resourceName: string; startTime: string; endTime: string; status: string; purpose: string };

export function BookingsPage() {
  const auth = useAuth();
  const [status, setStatus] = useState('');
  const query = useQuery({
    queryKey: ['bookings', status],
    queryFn: () => api<{ data: Row[] }>(`/api/v1/bookings?scope=mine&pageSize=50${status ? `&status=${status}` : ''}`),
  });
  return (
    <div className="grid">
      <h1>My bookings</h1>
      <label>
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All</option>
          {['PENDING_APPROVAL', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED'].map((item) => (
            <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>
          ))}
        </select>
      </label>
      {query.isLoading && <p role="status">Loading bookings…</p>}
      {query.error && <p className="alert">{errorText(query.error)}</p>}
      {query.data?.data.length === 0 && <p>No bookings in this view.</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Resource</th><th>When</th><th>Status</th><th>Purpose</th></tr></thead>
          <tbody>
            {query.data?.data.map((row) => (
              <tr key={row.id}>
                <td><Link to={`/bookings/${row.id}`}>{row.resourceName}</Link></td>
                <td>{formatWhen(row.startTime, auth.user!.timezone)}</td>
                <td><StatusBadge status={row.status} /></td>
                <td>{row.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
