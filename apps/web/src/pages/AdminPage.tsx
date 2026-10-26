import { createResourceSchema } from '@bookspace/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';

type UserRow = { id: string; fullName: string; email: string; userType: string; isActive: boolean; roles: string[] };
type ResourceRow = { id: string; name: string; kind: string; status: string; location: string };
type AuditRow = { id: string; action: string; actorName: string; createdAt: string; targetType: string };

export function AdminPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const [tab, setTab] = useState<'resources' | 'users' | 'reports' | 'audit' | 'settings'>('resources');
  const [tempPassword, setTempPassword] = useState('');
  const resources = useQuery({ queryKey: ['admin-resources'], queryFn: () => api<{ data: ResourceRow[] }>('/api/v1/resources?status=all&pageSize=100') });
  const users = useQuery({ queryKey: ['admin-users'], enabled: tab === 'users', queryFn: () => api<{ data: UserRow[] }>('/api/v1/users') });
  const audit = useQuery({ queryKey: ['audit'], enabled: tab === 'audit', queryFn: () => api<{ data: AuditRow[] }>('/api/v1/admin/audit') });
  const settings = useQuery({
    queryKey: ['settings'],
    enabled: tab === 'settings',
    queryFn: () => api<{ data: { timezone: string; pendingExpiryHours: number } }>('/api/v1/admin/settings'),
  });
  const reports = useQuery({
    queryKey: ['reports'],
    enabled: tab === 'reports',
    queryFn: () => api<{ data: { id: string; resource: string; requester: string; status: string; startTime: string }[] }>('/api/v1/admin/reports/bookings?pageSize=50'),
  });
  const resourceForm = useForm({
    resolver: zodResolver(createResourceSchema),
    defaultValues: {
      kind: 'room' as const,
      name: '',
      description: '',
      location: '',
      capacity: 10,
      approvalRequired: false,
      minMinutes: 30,
      maxMinutes: 180,
      maxAdvanceDays: 30,
      bufferMinutes: 0,
      allowedUserTypes: [] as Array<'student' | 'lecturer' | 'staff'>,
    },
  });
  const createResource = useMutation({
    mutationFn: (values: unknown) => api('/api/v1/resources', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async () => {
      resourceForm.reset();
      await client.invalidateQueries({ queryKey: ['admin-resources'] });
    },
  });
  if (!auth.user?.roles.includes('admin')) return <p className="alert">Administrator access is required.</p>;
  return (
    <div className="grid">
      <h1>Administration</h1>
      <div className="inline" role="tablist">
        {(['resources', 'users', 'reports', 'audit', 'settings'] as const).map((item) => (
          <button key={item} className={tab === item ? 'button' : 'button secondary'} type="button" onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {tab === 'resources' && (
        <div className="grid">
          <form className="panel form" onSubmit={resourceForm.handleSubmit((values) => createResource.mutate(values))}>
            <h2>New resource</h2>
            <label>Name<input {...resourceForm.register('name')} /></label>
            <label>Location<input {...resourceForm.register('location')} /></label>
            <label>Kind
              <select {...resourceForm.register('kind')}>
                <option value="room">Room</option>
                <option value="equipment">Equipment</option>
              </select>
            </label>
            <label>Capacity<input type="number" {...resourceForm.register('capacity', { valueAsNumber: true })} /></label>
            <label>Minimum minutes<input type="number" {...resourceForm.register('minMinutes', { valueAsNumber: true })} /></label>
            <label>Maximum minutes<input type="number" {...resourceForm.register('maxMinutes', { valueAsNumber: true })} /></label>
            <label>Buffer minutes<input type="number" {...resourceForm.register('bufferMinutes', { valueAsNumber: true })} /></label>
            <label><input type="checkbox" {...resourceForm.register('approvalRequired')} /> Approval required</label>
            {createResource.error && <p className="alert">{errorText(createResource.error)}</p>}
            <button className="button" type="submit" disabled={createResource.isPending}>Create resource</button>
          </form>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th>Location</th></tr></thead>
              <tbody>
                {resources.data?.data.map((row) => (
                  <tr key={row.id}><td>{row.name}</td><td>{row.kind}</td><td>{row.status}</td><td>{row.location}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'users' && (
        <div className="grid">
          <UserCreate onCreated={(password) => setTempPassword(password)} />
          {tempPassword && <p className="alert" role="status">Temporary password, shown once: {tempPassword}</p>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Roles</th><th></th></tr></thead>
              <tbody>
                {users.data?.data.map((user) => (
                  <tr key={user.id}>
                    <td>{user.fullName}</td>
                    <td>{user.email}</td>
                    <td>{user.userType}</td>
                    <td>{user.roles.join(', ')}</td>
                    <td>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={async () => {
                          const result = await api<{ data: { temporaryPassword: string } }>(`/api/v1/users/${user.id}/reset-password`, { method: 'POST' });
                          setTempPassword(result.data.temporaryPassword);
                        }}
                      >
                        Reset password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'reports' && (
        <div className="grid">
          <a className="button" href="/api/v1/admin/reports/bookings.csv">Download CSV</a>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Resource</th><th>Requester</th><th>Status</th><th>Start</th></tr></thead>
              <tbody>
                {reports.data?.data.map((row) => (
                  <tr key={row.id}><td>{row.resource}</td><td>{row.requester}</td><td>{row.status}</td><td>{row.startTime}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'audit' && (
        <ul>
          {audit.data?.data.map((row) => (
            <li key={row.id}>{row.createdAt} · {row.actorName} · {row.action} · {row.targetType}</li>
          ))}
        </ul>
      )}
      {tab === 'settings' && settings.data && (
        <SettingsForm initial={settings.data.data} />
      )}
    </div>
  );
}

function UserCreate({ onCreated }: { onCreated: (password: string) => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ email: '', fullName: '', userType: 'student', role: 'member' });
  return (
    <form
      className="panel form"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await api<{ data: { temporaryPassword: string } }>('/api/v1/users', {
          method: 'POST',
          body: JSON.stringify({ ...form, roles: [form.role] }),
        });
        onCreated(result.data.temporaryPassword);
        await client.invalidateQueries({ queryKey: ['admin-users'] });
      }}
    >
      <h2>Provision account</h2>
      <label>Name<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
      <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
      <label>Type
        <select value={form.userType} onChange={(event) => setForm({ ...form, userType: event.target.value })}>
          <option value="student">Student</option>
          <option value="lecturer">Lecturer</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      <label>Role
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option value="member">Member</option>
          <option value="approver">Approver</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button className="button" type="submit">Create account</button>
    </form>
  );
}

function SettingsForm({ initial }: { initial: { timezone: string; pendingExpiryHours: number } }) {
  const [timezone, setTimezone] = useState(initial.timezone);
  const [hours, setHours] = useState(initial.pendingExpiryHours);
  const [message, setMessage] = useState('');
  return (
    <form
      className="panel form"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ timezone, pendingExpiryHours: hours }) });
          setMessage('Settings saved.');
        } catch (error) {
          setMessage(errorText(error));
        }
      }}
    >
      <label>Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
      <label>Pending expiry hours<input type="number" value={hours} onChange={(event) => setHours(Number(event.target.value))} /></label>
      <button className="button" type="submit">Save settings</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
