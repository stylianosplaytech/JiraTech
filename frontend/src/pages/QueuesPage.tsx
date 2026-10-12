import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useProject } from '../project';
import { timeAgo } from '../utils';
import { PriorityIcon, StatusBadge } from '../components/Badges';
import SlaBadge from '../components/SlaBadge';
import Avatar from '../components/Avatar';
import { AlertIcon, PlusIcon } from '../components/Icons';
import { EmptyState, PageHeader, Spinner, errorMessage } from '../components/ui';

const PAGE = 50;

export default function QueuesPage() {
  const { project, projects, setProjectKey } = useProject();
  const [params, setParams] = useSearchParams();
  const [startAt, setStartAt] = useState(0);
  const isDesk = project?.type === 'SERVICE_DESK';
  const key = project?.key ?? '';

  const { data: queues, isLoading, error } = useQuery({
    queryKey: ['queues', key],
    queryFn: () => api.getQueues(key),
    enabled: isDesk,
    refetchInterval: 60_000,
  });
  const queueId = params.get('queue') ?? queues?.[0]?.id;
  const queue = queues?.find((q) => q.id === queueId);
  useEffect(() => setStartAt(0), [queueId, key]);

  const { data: page, isFetching } = useQuery({
    queryKey: ['queue-issues', key, queueId, startAt],
    queryFn: () => api.getQueueIssues(key, queueId!, startAt),
    enabled: isDesk && !!queue && !queue.error,
    // SLA clocks tick: keep the list fresh.
    refetchInterval: 60_000,
  });

  if (!isDesk) {
    const desks = projects.filter((p) => p.type === 'SERVICE_DESK');
    return (
      <EmptyState
        title="Queues are for service desk projects"
        action={desks.length ? (
          <div className="flex flex-wrap justify-center gap-2">
            {desks.map((d) => (
              <button key={d.id} type="button" className="btn btn-default" onClick={() => setProjectKey(d.key)}>Open {d.name}</button>
            ))}
          </div>
        ) : <Link to="/projects?create=1" className="btn btn-default">Create a service desk</Link>}
      >
        {project ? `${project.name} is a software project.` : 'Pick a service desk project.'} Switch to a service desk to work its requests.
      </EmptyState>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={<><Link to="/projects" className="hover:underline">Projects</Link> / <Link to={`/projects/${key}`} className="hover:underline">{project.name}</Link></>}
        title="Queues"
        actions={(
          <>
            <Link to={`/portal/${key}`} className="btn btn-default"><PlusIcon size={14} /> Raise a request</Link>
            {project.myRole === 'ADMIN' && <Link to={`/projects/${key}#service-desk`} className="btn btn-default">Service desk settings</Link>}
          </>
        )}
      />

      {isLoading ? <Spinner /> : error ? <EmptyState title="Couldn't load the queues">{errorMessage(error)}</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
          <nav aria-label="Queues" className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1 pb-1">
            {queues?.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setParams({ queue: q.id })}
                aria-current={q.id === queueId ? 'page' : undefined}
                className={`flex items-center justify-between gap-3 shrink-0 rounded-[3px] px-3 py-2 text-left text-sm ${
                  q.id === queueId ? 'bg-jira-blue-light text-jira-blue font-semibold' : 'text-jira-navy hover:bg-jira-gray'}`}
              >
                <span className="truncate">{q.name}</span>
                {q.error
                  ? <span className="text-[#DE350B]" title={q.error}><AlertIcon size={14} /></span>
                  : <span className="text-xs text-jira-subtle tabular-nums">{q.count}</span>}
              </button>
            ))}
            {queues?.length === 0 && <p className="text-jira-muted px-3">No queues yet.</p>}
          </nav>

          <section className="min-w-0">
            {queue && (
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <h2 className="text-base font-semibold">{queue.name}</h2>
                <Link to={`/search?jql=${encodeURIComponent(`project = ${key} AND ${queue.jql}`)}`} className="text-xs link font-mono truncate max-w-full" title="Open in search">
                  {queue.jql}
                </Link>
              </div>
            )}
            {queue?.error && (
              <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2 mb-3">
                This queue's JQL no longer works: {queue.error}. A project administrator can fix it in the service desk settings.
              </div>
            )}
            {!page && !queue?.error && queue && <Spinner />}
            {page && page.issues.length === 0 && <EmptyState title="Nothing in this queue">Requests that match it will show up here.</EmptyState>}
            {page && page.issues.length > 0 && (
              <>
                <div className={`overflow-x-auto ${isFetching ? 'opacity-70' : ''}`}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Summary</th>
                        <th>Status</th>
                        <th title="Time to first response">First response</th>
                        <th title="Time to resolution">Resolution</th>
                        <th>Reporter</th>
                        <th>Assignee</th>
                        <th>Organization</th>
                        <th>Request type</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.issues.map((r) => (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <PriorityIcon priority={r.priority} />
                              <Link to={`/browse/${r.key}`} className="link">{r.key}</Link>
                            </span>
                          </td>
                          <td className="min-w-[220px]"><Link to={`/browse/${r.key}`} className="hover:underline">{r.summary}</Link></td>
                          <td><StatusBadge status={r.status} name={r.workflowStatus?.name} /></td>
                          <td><SlaBadge clock={r.sla.firstResponse} /></td>
                          <td><SlaBadge clock={r.sla.resolution} /></td>
                          <td className="whitespace-nowrap">{r.reporter ? <span className="flex items-center gap-2"><Avatar name={r.reporter.name} size="xs" />{r.reporter.name}</span> : '—'}</td>
                          <td className="whitespace-nowrap">{r.assignee ? <span className="flex items-center gap-2"><Avatar name={r.assignee.name} size="xs" />{r.assignee.name}</span> : <span className="text-jira-muted">Unassigned</span>}</td>
                          <td className="text-jira-subtle whitespace-nowrap">{r.organization?.name ?? '—'}</td>
                          <td className="text-jira-subtle whitespace-nowrap">{r.requestType?.name ?? '—'}</td>
                          <td className="text-jira-subtle whitespace-nowrap" title={new Date(r.createdAt).toLocaleString()}>{timeAgo(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {page.total > PAGE && (
                  <div className="flex items-center justify-end gap-2 mt-3 text-sm text-jira-subtle">
                    {startAt + 1}–{Math.min(startAt + PAGE, page.total)} of {page.total}
                    <button type="button" className="btn btn-default btn-sm" disabled={startAt === 0} onClick={() => setStartAt(Math.max(0, startAt - PAGE))}>Previous</button>
                    <button type="button" className="btn btn-default btn-sm" disabled={startAt + PAGE >= page.total} onClick={() => setStartAt(startAt + PAGE)}>Next</button>
                  </div>
                )}
                <p className="field-help">Without an ORDER BY, the request closest to breaching its SLA comes first. SLA clocks run around the clock and pause while waiting for the customer.</p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
