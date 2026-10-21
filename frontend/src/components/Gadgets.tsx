import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type BreakdownField, type Gadget, type GadgetData, type GadgetType } from '../api';
import { PriorityIcon, StatusBadge, TypeBadge, STATUS_LABELS, typeLabel } from './Badges';
import { errorMessage, Spinner } from './ui';
import { humanize } from '../utils';

export const GADGET_TYPES: { type: GadgetType; label: string; hint: string }[] = [
  { type: 'FILTER_RESULTS', label: 'Issue list', hint: 'The issues a filter finds, newest first unless the filter sorts them.' },
  { type: 'FILTER_COUNT', label: 'Issue count', hint: 'One big number: how many issues a filter finds.' },
  { type: 'BREAKDOWN', label: 'Breakdown', hint: 'A filter’s issues counted by status, priority, type or assignee.' },
];

export const BREAKDOWN_LABELS: Record<BreakdownField, string> = {
  status: 'Status', priority: 'Priority', type: 'Issue type', assignee: 'Assignee',
};

const COLORS: Record<string, string> = {
  BACKLOG: '#97A0AF', TO_DO: '#5E6C84', DOING: '#0052CC', CLOSED: '#36B37E',
  HIGHEST: '#DE350B', HIGH: '#FF5630', MEDIUM: '#FFAB00', LOW: '#2684FF', LOWEST: '#4C9AFF',
};

function groupLabel(field: BreakdownField, key: string, label: string) {
  if (field === 'status') return STATUS_LABELS[key] ?? humanize(key);
  if (field === 'priority') return humanize(key);
  if (field === 'type') return typeLabel(key);
  return label;
}

/** Wraps a filter-backed gadget's data in its loading, error and "filter deleted" states. */
export function GadgetBody({ dashboardId, gadget }: { dashboardId: string; gadget: Gadget }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['gadget-data', dashboardId, gadget.id, gadget.filterId, gadget.type, gadget.config],
    queryFn: () => api.getGadgetData(dashboardId, gadget.id),
    retry: false,
  });

  if (isLoading) return <Spinner />;
  if (error) return <p className="p-4 text-[#BF2600]">{errorMessage(error)}</p>;
  if (!data) return null;
  if ('filterMissing' in data) {
    return <p className="p-4 text-jira-muted">This gadget’s filter was deleted. Edit the gadget to pick another filter.</p>;
  }
  return <GadgetView data={data} />;
}

function GadgetView({ data }: { data: Exclude<GadgetData, { filterMissing: true }> }) {
  const searchLink = `/search?filter=${data.filterId}`;

  if (data.type === 'FILTER_COUNT') {
    return (
      <Link to={searchLink} className="block p-6 text-center hover:bg-jira-gray" title={`Open “${data.filterName}” in search`}>
        <p className="text-5xl font-semibold text-jira-navy">{data.total}</p>
        <p className="text-jira-subtle mt-1">{data.total === 1 ? 'issue' : 'issues'}</p>
      </Link>
    );
  }

  if (data.type === 'BREAKDOWN') {
    const max = Math.max(...data.groups.map((g) => g.count), 1);
    if (!data.groups.length) return <p className="p-4 text-jira-muted">No issues match this filter.</p>;
    return (
      <div className="p-4 space-y-3">
        {data.groups.map((g) => (
          <div key={g.key || 'none'}>
            <div className="flex justify-between mb-1">
              <span>{groupLabel(data.groupBy, g.key, g.label)}</span>
              <span className="font-semibold">{g.count}</span>
            </div>
            <div className="h-2 rounded-full bg-jira-gray-hover overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(g.count / max) * 100}%`, background: COLORS[g.key] ?? '#0052CC' }} />
            </div>
          </div>
        ))}
        <p className="text-xs text-jira-muted pt-1">
          {data.total} {data.total === 1 ? 'issue' : 'issues'} · <Link to={searchLink} className="link">Open in search</Link>
        </p>
      </div>
    );
  }

  if (!data.issues.length) return <p className="p-4 text-jira-muted">No issues match this filter.</p>;
  return (
    <>
      <div className="divide-y divide-jira-border">
        {data.issues.map((issue) => (
          <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
            <TypeBadge type={issue.type} />
            <span className={`link shrink-0 ${issue.status === 'CLOSED' ? 'line-through' : ''}`}>{issue.key}</span>
            <span className="truncate flex-1">{issue.summary}</span>
            <PriorityIcon priority={issue.priority} />
            <span className="hidden sm:block shrink-0"><StatusBadge status={issue.status} name={issue.workflowStatus?.name} /></span>
          </Link>
        ))}
      </div>
      {data.total > data.issues.length && (
        <div className="px-4 py-2.5 border-t border-jira-border text-xs text-jira-muted">
          Showing {data.issues.length} of {data.total} · <Link to={searchLink} className="link">See all in search</Link>
        </div>
      )}
    </>
  );
}
