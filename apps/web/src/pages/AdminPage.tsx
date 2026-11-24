import { createResourceSchema, updateUserSchema } from '@bookspace/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { orgPath } from '../lib/paths';

type UserRow = {
  id: string;
  fullName: string;
  email: string;
  userType: string;
  isActive: boolean;
  roles: string[];
  mustChangePassword: boolean;
};
type ResourceRow = {
  id: string;
  name: string;
  kind: string;
  status: string;
  location: string;
  description: string;
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
};
type AuditRow = {
  id: string;
  action: string;
  actorName: string;
  createdAt: string;
  targetType: string;
  targetId: string;
  details: unknown;
};
type ReportRow = {
  id: string;
  resource: string;
  requester: string;
  status: string;
  startTime: string;
  endTime: string;
  purpose: string;
};

export function AdminPage() {
  const auth = useAuth();
  const { slug = auth.user?.departmentSlug ?? '' } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useState<'resources' | 'users' | 'reports' | 'audit' | 'settings'>('resources');
  const [tempPassword, setTempPassword] = useState('');
  const [reportFilters, setReportFilters] = useState({
    status: '',
    resourceId: '',
    from: '',
    to: '',
    page: 1,
  });
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const resources = useQuery({
    queryKey: ['admin-resources'],
    queryFn: () => api<{ data: ResourceRow[] }>('/api/v1/resources?status=all&pageSize=100'),
  });
  const users = useQuery({
    queryKey: ['admin-users'],
    enabled: tab === 'users' || tab === 'resources',
    queryFn: () => api<{ data: UserRow[] }>('/api/v1/users'),
  });
  const audit = useQuery({
    queryKey: ['audit', reportFilters.page],
    enabled: tab === 'audit',
    queryFn: () =>
      api<{ data: AuditRow[]; total: number; page: number }>(
        `/api/v1/admin/audit?page=${reportFilters.page}&pageSize=20`,
      ),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    enabled: tab === 'settings',
    queryFn: () => api<{ data: { timezone: string; pendingExpiryHours: number } }>('/api/v1/admin/settings'),
  });
  const reportQuery = useMemo(() => {
    const params = new URLSearchParams({ page: String(reportFilters.page), pageSize: '50' });
    if (reportFilters.status) params.set('status', reportFilters.status);
    if (reportFilters.resourceId) params.set('resourceId', reportFilters.resourceId);
    if (reportFilters.from) params.set('from', new Date(reportFilters.from).toISOString());
    if (reportFilters.to) params.set('to', new Date(reportFilters.to).toISOString());
    return params.toString();
  }, [reportFilters]);
  const reports = useQuery({
    queryKey: ['reports', reportQuery],
    enabled: tab === 'reports',
    queryFn: () => api<{ data: ReportRow[] }>(`/api/v1/admin/reports/bookings?${reportQuery}`),
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
      assetTag: null as string | null,
      serialNo: null as string | null,
      parentResourceId: null as string | null,
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
          <button
            key={item}
            className={tab === item ? 'button' : 'button secondary'}
            type="button"
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {tab === 'resources' && (
        <div className="grid">
          <form
            className="panel form"
            onSubmit={resourceForm.handleSubmit((values) =>
              createResource.mutate({
                ...values,
                assetTag: values.assetTag || null,
                serialNo: values.serialNo || null,
                parentResourceId: values.parentResourceId || null,
              }),
            )}
          >
            <h2>New resource</h2>
            <label>
              Name
              <input {...resourceForm.register('name')} />
            </label>
            <label>
              Description
              <textarea {...resourceForm.register('description')} />
            </label>
            <label>
              Location
              <input {...resourceForm.register('location')} />
            </label>
            <label>
              Kind
              <select {...resourceForm.register('kind')}>
                <option value="room">Room</option>
                <option value="equipment">Equipment</option>
              </select>
            </label>
            <label>
              Capacity
              <input type="number" {...resourceForm.register('capacity', { valueAsNumber: true })} />
            </label>
            <label>
              Minimum minutes
              <input type="number" {...resourceForm.register('minMinutes', { valueAsNumber: true })} />
            </label>
            <label>
              Maximum minutes
              <input type="number" {...resourceForm.register('maxMinutes', { valueAsNumber: true })} />
            </label>
            <label>
              Max advance days
              <input type="number" {...resourceForm.register('maxAdvanceDays', { valueAsNumber: true })} />
            </label>
            <label>
              Buffer minutes
              <input type="number" {...resourceForm.register('bufferMinutes', { valueAsNumber: true })} />
            </label>
            <label>
              Asset tag
              <input {...resourceForm.register('assetTag')} />
            </label>
            <label>
              Serial number
              <input {...resourceForm.register('serialNo')} />
            </label>
            <label>
              Parent resource
              <select {...resourceForm.register('parentResourceId')}>
                <option value="">None</option>
                {resources.data?.data.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Allowed user types</legend>
              {(['student', 'lecturer', 'staff'] as const).map((type) => (
                <label key={type}>
                  <input type="checkbox" value={type} {...resourceForm.register('allowedUserTypes')} />
                  {type}
                </label>
              ))}
            </fieldset>
            <label>
              <input type="checkbox" {...resourceForm.register('approvalRequired')} /> Approval required
            </label>
            {createResource.error && <p className="alert">{errorText(createResource.error)}</p>}
            <button className="button" type="submit" disabled={createResource.isPending}>
              Create resource
            </button>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {resources.data?.data.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.kind}</td>
                    <td>{row.status}</td>
                    <td>{row.location}</td>
                    <td>
                      <Link className="button secondary" to={orgPath(slug, `/resources/${row.id}`)}>
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'users' && (
        <div className="grid">
          <UserCreate onCreated={(password) => setTempPassword(password)} />
          {tempPassword && (
            <p className="alert" role="status">
              Temporary password, shown once: {tempPassword}
            </p>
          )}
          {editingUser && (
            <UserEdit
              user={editingUser}
              onClose={() => setEditingUser(null)}
              onSaved={() => {
                setEditingUser(null);
                void client.invalidateQueries({ queryKey: ['admin-users'] });
              }}
            />
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Type</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.data?.data.map((user) => (
                  <tr key={user.id}>
                    <td>{user.fullName}</td>
                    <td>{user.email}</td>
                    <td>{user.userType}</td>
                    <td>{user.roles.join(', ')}</td>
                    <td>{user.isActive ? 'Active' : 'Inactive'}</td>
                    <td className="inline">
                      <button className="button secondary" type="button" onClick={() => setEditingUser(user)}>
                        Edit
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`Reset password for ${user.fullName}?`)) return;
                          const result = await api<{ data: { temporaryPassword: string } }>(
                            `/api/v1/users/${user.id}/reset-password`,
                            { method: 'POST' },
                          );
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
          <form
            className="filters"
            onSubmit={(event) => {
              event.preventDefault();
              setReportFilters((current) => ({ ...current, page: 1 }));
            }}
          >
            <label>
              Status
              <select
                value={reportFilters.status}
                onChange={(event) => setReportFilters({ ...reportFilters, status: event.target.value, page: 1 })}
              >
                <option value="">All</option>
                {['PENDING_APPROVAL', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED'].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Resource
              <select
                value={reportFilters.resourceId}
                onChange={(event) => setReportFilters({ ...reportFilters, resourceId: event.target.value, page: 1 })}
              >
                <option value="">All</option>
                {resources.data?.data.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input
                type="datetime-local"
                value={reportFilters.from}
                onChange={(event) => setReportFilters({ ...reportFilters, from: event.target.value, page: 1 })}
              />
            </label>
            <label>
              To
              <input
                type="datetime-local"
                value={reportFilters.to}
                onChange={(event) => setReportFilters({ ...reportFilters, to: event.target.value, page: 1 })}
              />
            </label>
          </form>
          <a className="button" href={`/api/v1/admin/reports/bookings.csv?${reportQuery}`}>
            Download CSV
          </a>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Requester</th>
                  <th>Status</th>
                  <th>Start</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {reports.data?.data.map((row) => (
                  <tr key={row.id}>
                    <td>{row.resource}</td>
                    <td>{row.requester}</td>
                    <td>{row.status}</td>
                    <td>{row.startTime}</td>
                    <td>{row.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'audit' && (
        <div className="grid">
          <ul>
            {audit.data?.data.map((row) => (
              <li key={row.id}>
                {row.createdAt} · {row.actorName} · {row.action} · {row.targetType}/{row.targetId}
              </li>
            ))}
          </ul>
          <div className="inline">
            <button
              className="button secondary"
              type="button"
              disabled={reportFilters.page <= 1}
              onClick={() => setReportFilters((current) => ({ ...current, page: current.page - 1 }))}
            >
              Previous
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setReportFilters((current) => ({ ...current, page: current.page + 1 }))}
            >
              Next
            </button>
          </div>
        </div>
      )}
      {tab === 'settings' && settings.data && <SettingsForm initial={settings.data.data} />}
    </div>
  );
}

function UserCreate({ onCreated }: { onCreated: (password: string) => void }) {
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    userType: 'student',
    roles: ['member'] as string[],
  });
  return (
    <form
      className="panel form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        try {
          const result = await api<{ data: { temporaryPassword: string } }>('/api/v1/users', {
            method: 'POST',
            body: JSON.stringify(form),
          });
          onCreated(result.data.temporaryPassword);
          setForm({ email: '', fullName: '', userType: 'student', roles: ['member'] });
          await client.invalidateQueries({ queryKey: ['admin-users'] });
        } catch (err) {
          setError(errorText(err));
        }
      }}
    >
      <h2>Provision account</h2>
      <label>
        Name
        <input
          value={form.fullName}
          onChange={(event) => setForm({ ...form, fullName: event.target.value })}
          required
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          required
        />
      </label>
      <label>
        Type
        <select value={form.userType} onChange={(event) => setForm({ ...form, userType: event.target.value })}>
          <option value="student">Student</option>
          <option value="lecturer">Lecturer</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      <fieldset>
        <legend>Roles</legend>
        {['member', 'approver', 'admin'].map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={form.roles.includes(role)}
              onChange={(event) =>
                setForm({
                  ...form,
                  roles: event.target.checked
                    ? [...form.roles, role]
                    : form.roles.filter((item) => item !== role),
                })
              }
            />
            {role}
          </label>
        ))}
      </fieldset>
      {error && <p className="alert">{error}</p>}
      <button className="button" type="submit">
        Create account
      </button>
    </form>
  );
}

function UserEdit({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [userType, setUserType] = useState(user.userType);
  const [isActive, setIsActive] = useState(user.isActive);
  const [roles, setRoles] = useState(user.roles);
  const [error, setError] = useState('');
  return (
    <form
      className="panel form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        try {
          const body = updateUserSchema.parse({ fullName, userType, isActive });
          await api(`/api/v1/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) });
          await api(`/api/v1/users/${user.id}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) });
          onSaved();
        } catch (err) {
          setError(errorText(err));
        }
      }}
    >
      <h2>Edit {user.email}</h2>
      <label>
        Name
        <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
      </label>
      <label>
        Type
        <select value={userType} onChange={(event) => setUserType(event.target.value)}>
          <option value="student">Student</option>
          <option value="lecturer">Lecturer</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active
      </label>
      <fieldset>
        <legend>Roles</legend>
        {['member', 'approver', 'admin'].map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(event) =>
                setRoles(
                  event.target.checked ? [...roles, role] : roles.filter((item) => item !== role),
                )
              }
            />
            {role}
          </label>
        ))}
      </fieldset>
      {error && <p className="alert">{error}</p>}
      <div className="inline">
        <button className="button" type="submit">
          Save
        </button>
        <button className="button secondary" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
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
        await api('/api/v1/admin/settings', {
          method: 'PATCH',
          body: JSON.stringify({ timezone, pendingExpiryHours: hours }),
        });
        setMessage('Settings saved.');
      }}
    >
      <h2>Department settings</h2>
      <label>
        Timezone
        <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
      </label>
      <label>
        Pending expiry hours
        <input type="number" value={hours} onChange={(event) => setHours(Number(event.target.value))} />
      </label>
      {message && <p role="status">{message}</p>}
      <button className="button" type="submit">
        Save settings
      </button>
    </form>
  );
}
