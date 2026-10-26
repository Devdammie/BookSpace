import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const links = [
  ['/', 'Dashboard'],
  ['/resources', 'Resources'],
  ['/bookings', 'My bookings'],
  ['/notifications', 'Notifications'],
] as const;

export function Layout() {
  const auth = useAuth();
  const user = auth.user!;
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ total: number }>('/api/v1/notifications?unread=true&pageSize=1'),
    refetchInterval: 30_000,
  });
  return (
    <div className="shell">
      <a className="skip" href="#content">Skip to content</a>
      <aside className="rail">
        <div className="brand">
          <strong>BookSpace</strong>
          <span>Rooms and equipment</span>
        </div>
        <nav aria-label="Primary">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
              {to === '/notifications' && unread.data ? ` (${unread.data.total})` : ''}
            </NavLink>
          ))}
          {(user.roles.includes('approver') || user.roles.includes('admin')) && <NavLink to="/approvals">Approvals</NavLink>}
          {user.roles.includes('admin') && <NavLink to="/admin">Admin</NavLink>}
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
