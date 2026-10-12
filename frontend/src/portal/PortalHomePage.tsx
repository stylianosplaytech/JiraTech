import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { timeAgo } from '../utils';
import { StatusBadge } from '../components/Badges';
import { ChevronRightIcon, MessageIcon } from '../components/Icons';
import { EmptyState, Spinner, errorMessage } from '../components/ui';

export default function PortalHomePage() {
  const { data: desks, isLoading, error } = useQuery({ queryKey: ['portal-desks'], queryFn: api.getPortalDesks });
  const { data: open } = useQuery({ queryKey: ['portal-requests', 'open', ''], queryFn: () => api.getMyRequests('open') });

  return (
    <div>
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold text-jira-navy">How can we help?</h1>
        <p className="text-jira-subtle mt-2">Choose a service desk to raise a request, or follow up on one you've already raised.</p>
      </div>

      {isLoading ? <Spinner /> : error ? <EmptyState title="Couldn't load the help center">{errorMessage(error)}</EmptyState> : (
        <>
          {desks?.length === 0 && (
            <EmptyState title="No service desks yet">You don't have access to any service desk. Ask your contact for an invitation.</EmptyState>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {desks?.map((d) => (
              <Link key={d.id} to={`/portal/${d.key}`} className="card p-5 flex items-start gap-4 hover:shadow-popover transition-shadow bg-white">
                <span className="flex items-center justify-center w-10 h-10 rounded-[3px] bg-jira-blue-light text-jira-blue shrink-0"><MessageIcon size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-jira-navy">{d.name}</span>
                  {d.description && <span className="block text-sm text-jira-subtle mt-1 line-clamp-2">{d.description}</span>}
                </span>
                <ChevronRightIcon size={16} className="text-jira-muted self-center" />
              </Link>
            ))}
          </div>
        </>
      )}

      {!!open?.length && (
        <section className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Your open requests</h2>
            <Link to="/portal/requests" className="link text-sm">View all</Link>
          </div>
          <div className="card bg-white divide-y divide-jira-border">
            {open.slice(0, 5).map((r) => (
              <Link key={r.key} to={`/portal/requests/${r.key}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-jira-gray">
                <span className="text-xs text-jira-muted font-mono">{r.key}</span>
                <span className="flex-1 min-w-[12rem] truncate font-medium">{r.summary}</span>
                <StatusBadge status={r.status.category} name={r.status.name} />
                <span className="text-xs text-jira-muted w-28 text-right">{timeAgo(r.updatedAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
