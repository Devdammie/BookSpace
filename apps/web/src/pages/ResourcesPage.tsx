import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../lib/api';

type Resource = {
  id: string;
  name: string;
  kind: string;
  location: string;
  capacity: number;
  approvalRequired: boolean;
  status: string;
};

export function ResourcesPage() {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const query = useQuery({
    queryKey: ['resources', kind, q, location],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: '50' });
      if (kind) params.set('kind', kind);
      if (q) params.set('q', q);
      if (location) params.set('location', location);
      return api<{ data: Resource[]; facets: { locations: string[] } }>(`/api/v1/resources?${params}`);
    },
  });
  return (
    <div className="grid">
      <h1>Resource catalogue</h1>
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <label>Search<input value={q} onChange={(event) => setQ(event.target.value)} /></label>
        <label>
          Type
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">All</option>
            <option value="room">Rooms</option>
            <option value="equipment">Equipment</option>
          </select>
        </label>
        <label>
          Location
          <select value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="">All</option>
            {query.data?.facets.locations.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </form>
      {query.isLoading && <p role="status">Loading resources…</p>}
      {query.error && <p className="alert" role="alert">{errorText(query.error)}</p>}
      {query.data?.data.length === 0 && <p>No resources match those filters.</p>}
      <div className="grid cards">
        {query.data?.data.map((resource) => (
          <article className="card" key={resource.id}>
            <h2>{resource.name}</h2>
            <p>{resource.kind} · {resource.location}</p>
            <p>Capacity {resource.capacity}. {resource.approvalRequired ? 'Approval required.' : 'Confirms immediately.'}</p>
            <Link className="button" to={`/resources/${resource.id}`}>View availability</Link>
          </article>
        ))}
      </div>
    </div>
  );
}
