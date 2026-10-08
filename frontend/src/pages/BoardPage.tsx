import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useProject } from '../project';
import { PriorityIcon, RagDot, STATUS_LABELS, TypeBadge } from '../components/Badges';
import { SearchIcon } from '../components/Icons';
import Avatar from '../components/Avatar';
import { PageHeader, Spinner } from '../components/ui';

export default function BoardPage() {
  const { project } = useProject();
  const [filter, setFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data, isLoading } = useQuery({ queryKey: ['board'], queryFn: () => api.getBoard() });

  const q = filter.trim().toLowerCase();
  const visible = (issues: NonNullable<typeof data>['columns'][number]['issues']) =>
    issues.filter((i) =>
      (!q || i.summary.toLowerCase().includes(q) || i.key.toLowerCase().includes(q))
      && (!onlyMine || i.assignee?.id === me?.id));

  return (
    <div>
      <PageHeader
        breadcrumbs={project && (
          <>
            <Link to="/projects" className="hover:underline">Projects</Link> / <Link to={`/projects/${project.key}`} className="hover:underline">{project.name}</Link>
          </>
        )}
        title={`${project?.key ?? ''} board`}
        actions={<Link to="/search" className="btn btn-default">View all issues</Link>}
      >
        <div className="flex items-center gap-3 mt-4">
          <div className="relative w-56">
            <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jira-muted pointer-events-none" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search this board" className="input h-8 pl-8" />
          </div>
          {me && (
            <button
              type="button"
              onClick={() => setOnlyMine(!onlyMine)}
              className={`btn btn-sm ${onlyMine ? 'bg-jira-blue-light text-jira-blue' : 'btn-subtle'}`}
              aria-pressed={onlyMine}
            >
              <Avatar name={me.name} size="xs" /> Only my issues
            </button>
          )}
        </div>
      </PageHeader>

      {isLoading ? <Spinner /> : (
        <div className="grid grid-cols-4 gap-2 items-start">
          {data?.columns.map((col) => {
            const issues = visible(col.issues);
            return (
              <div key={col.status} className="bg-jira-gray rounded-[3px] min-h-[300px]">
                <div className="px-3 pt-3 pb-2 text-xs font-semibold uppercase text-jira-subtle">
                  {STATUS_LABELS[col.status] ?? col.status} <span className="ml-1 font-normal">{issues.length}</span>
                </div>
                <div className="px-2 pb-2 space-y-1.5">
                  {issues.map((issue) => (
                    <Link
                      key={issue.id}
                      to={`/browse/${issue.key}`}
                      className="block bg-white rounded-[3px] shadow-card p-3 hover:bg-[#FAFBFC] transition-colors"
                    >
                      <p className="leading-snug text-jira-navy mb-2 line-clamp-3">{issue.summary}</p>
                      {issue.components && issue.components.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {issue.components.slice(0, 3).map((c) => (
                            <span key={c.component.id} className="lozenge bg-jira-gray-hover text-jira-subtle normal-case font-semibold">{c.component.name}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <TypeBadge type={issue.type} />
                        <span className={`text-xs font-medium text-jira-subtle ${issue.status === 'CLOSED' ? 'line-through' : ''}`}>{issue.key}</span>
                        {issue.blocked && <span className="lozenge bg-[#FFEBE6] text-[#BF2600]">Blocked</span>}
                        <span className="ml-auto flex items-center gap-1.5">
                          <RagDot status={issue.ragStatus === 'GREEN' ? undefined : issue.ragStatus} />
                          <PriorityIcon priority={issue.priority} />
                          {issue.assignee
                            ? <Avatar name={issue.assignee.name} size="xs" />
                            : <span className="w-5 h-5 rounded-full border border-dashed border-jira-muted" title="Unassigned" />}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {issues.length === 0 && <p className="text-xs text-jira-muted text-center py-6">No issues</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
