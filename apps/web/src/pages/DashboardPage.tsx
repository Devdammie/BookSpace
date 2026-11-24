import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatWhen } from '../lib/format';
import { orgPath } from '../lib/paths';

type Dashboard = {
  data: {
    pending: number;
    upcoming: { id: string; startTime: string; endTime: string; status: string; purpose: string }[];
    recent: { id: string; resourceName: string; startTime: string; status: string; purpose: string }[];
  };
};

export function DashboardPage() {
  const auth = useAuth();
  const { slug = auth.user?.departmentSlug ?? '' } = useParams();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/v1/dashboard') });
  const admin = useQuery({
    queryKey: ['admin-dashboard'],
    enabled: auth.user?.roles.includes('admin') ?? false,
    queryFn: () => api<{ data: { pending: number; resources: number; users: number; utilization: { ratio: number } } }>('/api/v1/admin/dashboard'),
  });
  if (query.isLoading) return <p className="status-line" role="status">Loading your dashboard…</p>;
  if (query.error) return <p className="alert" role="alert">{errorText(query.error)}</p>;
  const data = query.data!.data;
  return (
    <div className="grid">
      <div className="topbar">
        <div>
          <h1>Hello, {auth.user?.fullName.split(' ')[0]}</h1>
          <p className="muted">Times are shown in {auth.user?.timezone}.</p>
        </div>
        <Link className="button" to={orgPath(slug, '/resources')}>Find a resource</Link>
      </div>
      <div className="metrics">
        <div className="card metric"><b>{data.pending}</b><span>Pending requests</span></div>
        <div className="card metric"><b>{data.upcoming.length}</b><span>Upcoming confirmed</span></div>
        {admin.data && (
          <>
            <div className="card metric"><b>{admin.data.data.resources}</b><span>Active resources</span></div>
            <div className="card metric"><b>{Math.round(admin.data.data.utilization.ratio * 100)}%</b><span>Next 7 days booked</span></div>
          </>
        )}
      </div>
      <section className="panel">
        <h2>Upcoming</h2>
        {data.upcoming.length === 0 && <p>No confirmed bookings yet.</p>}
        <ul>
          {data.upcoming.map((item) => (
            <li key={item.id}>
              <Link to={orgPath(slug, `/bookings/${item.id}`)}>{item.purpose}</Link> · {formatWhen(item.startTime, auth.user!.timezone)} · <StatusBadge status={item.status} />
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Recent</h2>
        {data.recent.length === 0 && <p>You have not made a request yet.</p>}
        <ul>
          {data.recent.map((item) => (
            <li key={item.id}>
              <Link to={orgPath(slug, `/bookings/${item.id}`)}>{item.resourceName}</Link> · {item.purpose} · <StatusBadge status={item.status} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
