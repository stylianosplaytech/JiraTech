import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { TypeBadge, PriorityIcon, RagDot } from '../components/Badges';

const COLUMN_LABELS: Record<string, string> = {
  BACKLOG: 'Backlog',
  TO_DO: 'To Do',
  DOING: 'Doing',
  CLOSED: 'Closed',
};

export default function BoardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['board'], queryFn: () => api.getBoard() });

  if (isLoading) return <div className="text-gray-500">Loading board...</div>;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">SPORTS Board</h1>
      <div className="grid grid-cols-4 gap-4">
        {data?.columns.map((col) => (
          <div key={col.status} className="bg-white rounded-lg border border-jira-border">
            <div className="px-4 py-3 border-b border-jira-border font-medium text-sm flex justify-between">
              <span>{COLUMN_LABELS[col.status] ?? col.status}</span>
              <span className="text-gray-400">{col.issues.length}</span>
            </div>
            <div className="p-2 space-y-2 min-h-[200px]">
              {col.issues.map((issue) => (
                <Link
                  key={issue.id}
                  to={`/issues/${issue.id}`}
                  className="block bg-jira-gray hover:bg-gray-200 rounded p-3 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <TypeBadge type={issue.type} />
                    <PriorityIcon priority={issue.priority} />
                    <RagDot status={issue.ragStatus} />
                    {issue.blocked && (
                      <span className="text-red-500 text-xs font-bold" title="Blocked">⛔</span>
                    )}
                  </div>
                  <p className="text-sm font-medium leading-snug">{issue.summary}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-500">{issue.key}</span>
                    {issue.assignee && (
                      <span className="text-xs bg-jira-blue text-white rounded-full px-2 py-0.5">
                        {issue.assignee.name.split(' ').map((n) => n[0]).join('')}
                      </span>
                    )}
                  </div>
                  {issue.components && issue.components.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {issue.components.map((c) => (
                        <span key={c.component.id} className="text-xs text-gray-500">
                          {c.component.name}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
