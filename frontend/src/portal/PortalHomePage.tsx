import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, isCustomer } from '../api';
import { timeAgo } from '../utils';
import { StatusBadge } from '../components/Badges';
import { ChevronRightIcon } from '../components/Icons';
import { EmptyState, Spinner, errorMessage } from '../components/ui';
import { PortalLogo } from './Branding';

export default function PortalHomePage() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: desks, isLoading, error } = useQuery({ queryKey: ['portal-desks'], queryFn: api.getPortalDesks });
  const { data: open } = useQuery({ queryKey: ['portal-requests', 'open', ''], queryFn: () => api.getMyRequests('open') });

  // A customer with one help center lands straight in it, with its own look.
  if (isCustomer(me) && desks?.length === 1) return <Navigate to={`/portal/${desks[0].key}`} replace />;

  return (
    <div>
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold text-jira-navy">How can we help?</h1>
        <p className="text-jira-subtle mt-2">Choose a help center to raise a request, or follow up on one you've already raised.</p>
      </div>

      {isLoading ? <Spinner /> : error ? <EmptyState title="Couldn't load the help center">{errorMessage(error)}</EmptyState> : (
        <>
          {desks?.length === 0 && (
            <EmptyState title="No help centers yet">You don't have access to any service desk. Ask your contact for an invitation.</EmptyState>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {desks?.map((d) => (
              <Link
                key={d.id}
                to={`/portal/${d.key}`}
                className="card p-5 flex items-start gap-4 hover:shadow-popover transition-shadow bg-white border-t-[3px]"
                style={d.branding.color ? { borderTopColor: d.branding.color } : undefined}
              >
                <PortalLogo branding={d.branding} name={d.name} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-jira-navy">{d.name}</span>
                  {(d.branding.welcome ?? d.description) && (
                    <span className="block text-sm text-jira-subtle mt-1 line-clamp-2">{d.branding.welcome ?? d.description}</span>
                  )}
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
            <h2 className="text-base font-semibold">Open requests</h2>
            <Link to="/portal/requests" className="link text-sm">View all</Link>
          </div>
          <RequestList requests={open.slice(0, 5)} />
        </section>
      )}
    </div>
  );
}

/** A compact list of requests, used on the help center pages. */
export function RequestList({ requests }: { requests: Awaited<ReturnType<typeof api.getMyRequests>> }) {
  return (
    <div className="card bg-white divide-y divide-jira-border">
      {requests.map((r) => (
        <Link key={r.key} to={`/portal/requests/${r.key}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-jira-gray">
          <span className="text-xs text-jira-muted font-mono">{r.key}</span>
          <span className="flex-1 min-w-[12rem] truncate font-medium">{r.summary}</span>
          {r.organization && <span className="text-xs text-jira-muted" title="Shared with your organization">{r.organization.name}</span>}
          <StatusBadge status={r.status.category} name={r.status.name} />
          <span className="text-xs text-jira-muted w-28 text-right">{timeAgo(r.updatedAt)}</span>
        </Link>
      ))}
    </div>
  );
}
