import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatWhen } from '../lib/format';

type Note = { id: string; type: string; payload: { resourceName?: string; reason?: string }; createdAt: string; readAt: string | null };

export function NotificationsPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ data: Note[] }>('/api/v1/notifications?pageSize=50') });
  const read = useMutation({
    mutationFn: (id: string) => api(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  return (
    <div className="grid">
      <div className="topbar">
        <h1>Notifications</h1>
        <button className="button secondary" type="button" onClick={() => api('/api/v1/notifications/read-all', { method: 'POST' }).then(() => client.invalidateQueries({ queryKey: ['notifications'] }))}>
          Mark all read
        </button>
      </div>
      {query.isLoading && <p role="status">Loading notifications…</p>}
      {query.error && <p className="alert">{errorText(query.error)}</p>}
      {query.data?.data.length === 0 && <p>You have no notifications.</p>}
      <ul className="grid">
        {query.data?.data.map((note) => (
          <li className="card" key={note.id}>
            <strong>{note.type.replaceAll('_', ' ')}</strong>
            <span>{note.payload.resourceName}</span>
            <span className="muted">{formatWhen(note.createdAt, auth.user!.timezone)} · {note.readAt ? 'Read' : 'Unread'}</span>
            {!note.readAt && <button className="button secondary" type="button" onClick={() => read.mutate(note.id)}>Mark read</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
