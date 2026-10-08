import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { TypeBadge, StatusBadge, PriorityIcon, RagDot } from '../components/Badges';

export default function IssuesPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const params: Record<string, string> = {};
  if (search) params.search = search;
  if (typeFilter) params.type = typeFilter;

  const { data: issues, isLoading } = useQuery({
    queryKey: ['issues', params],
    queryFn: () => api.getIssues(params),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Issues</h1>
        <Link
          to="/issues/new"
          className="bg-jira-blue text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
        >
          Create Issue
        </Link>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search issues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-jira-border rounded px-3 py-2 text-sm flex-1 max-w-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border border-jira-border rounded px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          <option value="FEATURE_EPIC">Feature Epic</option>
          <option value="STORY">Story</option>
          <option value="DEFECT">Defect</option>
          <option value="TASK">Task</option>
          <option value="RELEASE_EPIC">Release Epic</option>
          <option value="RELEASE_CANDIDATE">Release Candidate</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-lg border border-jira-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-jira-gray border-b border-jira-border">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Key</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Summary</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Priority</th>
                <th className="text-left px-4 py-2 font-medium">Assignee</th>
                <th className="text-left px-4 py-2 font-medium">RAG</th>
              </tr>
            </thead>
            <tbody>
              {issues?.map((issue) => (
                <tr key={issue.id} className="border-b border-jira-border hover:bg-jira-gray/50">
                  <td className="px-4 py-2">
                    <Link to={`/issues/${issue.id}`} className="text-jira-blue hover:underline">
                      {issue.key}
                    </Link>
                  </td>
                  <td className="px-4 py-2"><TypeBadge type={issue.type} /></td>
                  <td className="px-4 py-2 max-w-md truncate">{issue.summary}</td>
                  <td className="px-4 py-2"><StatusBadge status={issue.status} /></td>
                  <td className="px-4 py-2"><PriorityIcon priority={issue.priority} /></td>
                  <td className="px-4 py-2 text-gray-600">{issue.assignee?.name ?? '—'}</td>
                  <td className="px-4 py-2"><RagDot status={issue.ragStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
