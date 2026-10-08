import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RagDot } from '../components/Badges';

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.getDashboard(),
  });

  if (isLoading) return <div className="text-gray-500">Loading dashboard...</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Plan Progress Dashboard</h1>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Issues', value: data.summary.total },
          { label: 'In Progress', value: data.summary.inProgress },
          { label: 'Closed', value: data.summary.closed },
          { label: 'Completion', value: `${data.summary.completionRate}%` },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg border border-jira-border p-4">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="text-2xl font-bold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-jira-border p-4">
          <h2 className="font-medium mb-3">By Status</h2>
          <div className="space-y-2">
            {Object.entries(data.byStatus).map(([status, count]) => (
              <div key={status} className="flex justify-between text-sm">
                <span>{status.replace(/_/g, ' ')}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-jira-border p-4">
          <h2 className="font-medium mb-3">RAG Status</h2>
          <div className="space-y-2">
            {Object.entries(data.byRag).map(([rag, count]) => (
              <div key={rag} className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2">
                  <RagDot status={rag} /> {rag}
                </span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.blocked.length > 0 && (
        <div className="bg-white rounded-lg border border-red-200 p-4">
          <h2 className="font-medium text-red-700 mb-3">Blocked ({data.blocked.length})</h2>
          <div className="space-y-2">
            {data.blocked.map((issue) => (
              <Link
                key={issue.id}
                to={`/issues/${issue.id}`}
                className="flex justify-between text-sm hover:bg-red-50 p-2 rounded"
              >
                <span><span className="text-jira-blue">{issue.key}</span> — {issue.summary}</span>
                <span className="text-gray-500">{issue.assignee?.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {data.atRisk.length > 0 && (
        <div className="bg-white rounded-lg border border-amber-200 p-4">
          <h2 className="font-medium text-amber-700 mb-3">At Risk / Delayed ({data.atRisk.length})</h2>
          <div className="space-y-2">
            {data.atRisk.map((issue) => (
              <Link
                key={issue.id}
                to={`/issues/${issue.id}`}
                className="flex justify-between items-center text-sm hover:bg-amber-50 p-2 rounded"
              >
                <span><span className="text-jira-blue">{issue.key}</span> — {issue.summary}</span>
                <RagDot status={issue.ragStatus} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {data.recentEscalations.length > 0 && (
        <div className="bg-white rounded-lg border border-jira-border p-4">
          <h2 className="font-medium mb-3">Recent Escalations</h2>
          <div className="space-y-2">
            {data.recentEscalations.map((e, i) => (
              <div key={i} className="text-sm flex justify-between">
                <span>
                  <span className="font-medium">{e.action}</span> on{' '}
                  <span className="text-jira-blue">{e.issue.key}</span> — {e.issue.summary}
                </span>
                <span className="text-gray-500">{e.user.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
