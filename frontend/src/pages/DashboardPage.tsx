import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useProject } from '../project';
import { RagDot, STATUS_LABELS } from '../components/Badges';
import { EmptyState, PageHeader, Spinner } from '../components/ui';
import { humanize, timeAgo } from '../utils';

const STATUS_COLORS: Record<string, string> = { BACKLOG: '#97A0AF', TO_DO: '#5E6C84', DOING: '#0052CC', CLOSED: '#36B37E' };
const RAG_COLORS: Record<string, string> = { GREEN: '#36B37E', AMBER: '#FFAB00', RED: '#DE350B' };

function BarList({ entries, colors, labels }: { entries: [string, number][]; colors: Record<string, string>; labels?: Record<string, string> }) {
  const max = Math.max(...entries.map(([, n]) => n), 1);
  if (!entries.length) return <p className="text-jira-muted">No data</p>;
  return (
    <div className="space-y-3">
      {entries.map(([k, n]) => (
        <div key={k}>
          <div className="flex justify-between mb-1">
            <span>{labels?.[k] ?? humanize(k)}</span>
            <span className="font-semibold">{n}</span>
          </div>
          <div className="h-2 rounded-full bg-jira-gray-hover overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: colors[k] ?? '#5E6C84' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { project } = useProject();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.getDashboard() });

  if (isLoading) return <Spinner />;
  if (!data) return <EmptyState title="Dashboard unavailable">The dashboard could not be loaded.</EmptyState>;

  const stats = [
    { label: 'Total issues', value: data.summary.total },
    { label: 'In progress', value: data.summary.inProgress },
    { label: 'Closed', value: data.summary.closed },
    { label: 'Completion', value: `${data.summary.completionRate}%` },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" breadcrumbs={project ? `${project.name} · plan progress` : undefined} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-jira-subtle">{s.label}</p>
            <p className="text-3xl font-semibold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <div className="card-header"><h2 className="card-title">Issues by status</h2></div>
          <div className="p-4">
            <BarList entries={Object.entries(data.byStatus)} colors={STATUS_COLORS} labels={STATUS_LABELS} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h2 className="card-title">RAG status</h2></div>
          <div className="p-4">
            <BarList entries={Object.entries(data.byRag)} colors={RAG_COLORS} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Blocked</h2>
            <span className="lozenge bg-[#FFEBE6] text-[#BF2600]">{data.blocked.length}</span>
          </div>
          {data.blocked.length === 0 ? <p className="p-4 text-jira-muted">Nothing is blocked.</p> : (
            <div className="divide-y divide-jira-border">
              {data.blocked.map((issue) => (
                <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
                  <span className="link shrink-0">{issue.key}</span>
                  <span className="truncate flex-1">{issue.summary}</span>
                  <span className="text-jira-subtle text-xs shrink-0">{issue.assignee?.name ?? 'Unassigned'}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">At risk or delayed</h2>
            <span className="lozenge bg-[#FFFAE6] text-[#974F0C]">{data.atRisk.length}</span>
          </div>
          {data.atRisk.length === 0 ? <p className="p-4 text-jira-muted">No issues are amber or red.</p> : (
            <div className="divide-y divide-jira-border">
              {data.atRisk.map((issue) => (
                <Link key={issue.id} to={`/browse/${issue.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-jira-gray">
                  <RagDot status={issue.ragStatus} />
                  <span className="link shrink-0">{issue.key}</span>
                  <span className="truncate flex-1">{issue.summary}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.recentEscalations.length > 0 && (
        <div className="card mt-6">
          <div className="card-header"><h2 className="card-title">Recent escalations</h2></div>
          <div className="divide-y divide-jira-border">
            {data.recentEscalations.map((e, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <span className="lozenge bg-jira-gray-hover text-[#42526E]">{humanize(e.action)}</span>
                <Link to={`/browse/${e.issue.key}`} className="link shrink-0">{e.issue.key}</Link>
                <span className="truncate flex-1">{e.issue.summary}</span>
                <span className="text-xs text-jira-subtle shrink-0">{e.user.name} · {timeAgo(e.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
