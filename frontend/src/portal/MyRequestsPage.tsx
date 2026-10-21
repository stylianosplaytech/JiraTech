import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { timeAgo } from '../utils';
import { StatusBadge } from '../components/Badges';
import { SearchIcon } from '../components/Icons';
import { EmptyState, Spinner, errorMessage } from '../components/ui';

const FILTERS = [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']] as const;

export default function MyRequestsPage() {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');
  const term = q.trim();
  const { data: requests, isLoading, error } = useQuery({
    queryKey: ['portal-requests', status, term],
    queryFn: () => api.getMyRequests(status, term || undefined),
  });

  return (
    <div>
      <h1 className="page-title mb-4">Requests</h1>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1" role="group" aria-label="Status">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
              className={`btn btn-sm ${status === value ? 'bg-jira-blue-light text-jira-blue' : 'btn-default'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64 sm:ml-auto">
          <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jira-muted pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requests" className="input h-8 pl-8" aria-label="Search requests" />
        </div>
      </div>

      {isLoading ? <Spinner /> : error ? <EmptyState title="Couldn't load your requests">{errorMessage(error)}</EmptyState> : !requests?.length ? (
        <EmptyState title={term ? 'No requests match your search' : status === 'open' ? 'You have no open requests' : 'No requests here'} action={<Link to="/portal" className="btn btn-primary">Raise a request</Link>}>
          Requests you raise, that others add you to, or that colleagues share with your organization appear here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto card bg-white">
          <table className="data-table">
            <thead>
              <tr><th>Reference</th><th>Summary</th><th>Status</th><th>Portal</th><th>Requester</th><th>Shared with</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.key}>
                  <td className="whitespace-nowrap"><Link to={`/portal/requests/${r.key}`} className="link">{r.key}</Link></td>
                  <td className="min-w-[220px]">
                    <Link to={`/portal/requests/${r.key}`} className="font-medium hover:underline">{r.summary}</Link>
                    {r.requestType && <span className="block text-xs text-jira-muted">{r.requestType.name}</span>}
                  </td>
                  <td><StatusBadge status={r.status.category} name={r.status.name} /></td>
                  <td className="text-jira-subtle whitespace-nowrap">{r.portal?.name ?? '—'}</td>
                  <td className="whitespace-nowrap">{r.reporter?.name ?? '—'}</td>
                  <td className="text-jira-subtle whitespace-nowrap">{r.organization?.name ?? '—'}</td>
                  <td className="text-jira-subtle whitespace-nowrap" title={new Date(r.updatedAt).toLocaleString()}>{timeAgo(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
