import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { orgPath } from '../lib/paths';

export function Layout() {
  const auth = useAuth();
  const { slug = auth.user?.departmentSlug ?? '' } = useParams();
  const user = auth.user!;
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ total: number }>('/api/v1/notifications?unread=true&pageSize=1'),
    refetchInterval: 30_000,
  });
  const links = [
    [orgPath(slug), 'Dashboard'],
    [orgPath(slug, '/resources'), 'Resources'],
    [orgPath(slug, '/bookings'), 'My bookings'],
    [orgPath(slug, '/notifications'), 'Notifications'],
  ] as const;

  return (
    <div className="shell">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <aside className="rail">
        <div className="brand">
          <strong>BookSpace</strong>
          <span>{user.departmentSlug}</span>
        </div>
        <nav aria-label="Primary">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === orgPath(slug)}>
              {label}
              {to === orgPath(slug, '/notifications') && unread.data ? ` (${unread.data.total})` : ''}
            </NavLink>
          ))}
          {(user.roles.includes('approver') || user.roles.includes('admin')) && (
            <NavLink to={orgPath(slug, '/approvals')}>Approvals</NavLink>
          )}
          {user.roles.includes('admin') && <NavLink to={orgPath(slug, '/admin')}>Admin</NavLink>}
        </nav>
        <div className="muted">
          <div>{user.fullName}</div>
          <div>{user.userType}</div>
          <button
            className="text-button secondary"
            type="button"
            onClick={async () => {
              await api('/api/v1/auth/logout', { method: 'POST' });
              await auth.refresh();
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="content">
        <Outlet />
      </main>
    </div>
  );
}
