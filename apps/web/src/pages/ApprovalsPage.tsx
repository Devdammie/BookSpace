import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatWhen } from '../lib/format';

type Row = {
  id: string;
  resourceName: string;
  requesterName: string;
  purpose: string;
  startTime: string;
  endTime: string;
  status: string;
  version: number;
};

export function ApprovalsPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const query = useQuery({ queryKey: ['approvals'], queryFn: () => api<{ data: Row[] }>('/api/v1/approvals?pageSize=100') });
  const decide = useMutation({
    mutationFn: (input: { id: string; version: number; action: 'approve' | 'reject'; reason?: string }) =>
      api(`/api/v1/bookings/${input.id}/${input.action}`, {
        method: 'POST',
        body: JSON.stringify(input.action === 'approve' ? { version: input.version } : { version: input.version, reason: input.reason }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  if (!auth.user?.roles.includes('approver') && !auth.user?.roles.includes('admin')) {
    return <p className="alert">Your account cannot decide requests.</p>;
  }
  return (
    <div className="grid">
      <h1>Approval queue</h1>
      {query.isLoading && <p role="status">Loading requests…</p>}
      {query.error && <p className="alert">{errorText(query.error)}</p>}
      {query.data?.data.length === 0 && <p>No requests are waiting.</p>}
      {decide.error && <p className="alert" role="alert">{errorText(decide.error)}</p>}
      <div className="grid">
        {query.data?.data.map((row) => (
          <article className="card" key={row.id}>
            <h2>{row.resourceName}</h2>
            <p>{row.requesterName} · {row.purpose}</p>
            <p>{formatWhen(row.startTime, auth.user!.timezone)} to {formatWhen(row.endTime, auth.user!.timezone)}</p>
            <StatusBadge status={row.status} />
            <label>
              Rejection reason
              <input value={reasons[row.id] ?? ''} onChange={(event) => setReasons({ ...reasons, [row.id]: event.target.value })} />
            </label>
            <div className="inline">
              <button className="button" type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, version: row.version, action: 'approve' })}>Approve</button>
              <button className="button danger" type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, version: row.version, action: 'reject', reason: reasons[row.id] })}>Reject</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
