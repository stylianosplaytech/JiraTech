import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { TypeBadge, StatusBadge } from '../components/Badges';

export default function PlanningPage() {
  const queryClient = useQueryClient();
  const [selectedPi, setSelectedPi] = useState('');

  const { data: pis, isLoading } = useQuery({
    queryKey: ['pis'],
    queryFn: api.getPis,
  });

  const runSchedule = useMutation({
    mutationFn: (piId: string) => api.runSchedule(piId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issues'] }),
  });

  const pi = pis?.find((p) => p.id === selectedPi) ?? pis?.[0];

  useEffect(() => {
    if (pis?.length && !selectedPi) setSelectedPi(pis[0].id);
  }, [pis, selectedPi]);

  const { data: piIssues } = useQuery({
    queryKey: ['issues', { piId: pi?.id }],
    queryFn: () => api.getIssues({ piId: pi!.id }),
    enabled: !!pi?.id,
  });

  if (isLoading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">PI Planning</h1>
        {pi && (
          <button
            onClick={() => runSchedule.mutate(pi.id)}
            disabled={runSchedule.isPending}
            className="bg-jira-blue text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {runSchedule.isPending ? 'Scheduling...' : 'Run Scheduler'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {pis?.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedPi(p.id)}
            className={`text-left bg-white rounded-lg border p-4 transition-colors ${
              p.id === pi?.id ? 'border-jira-blue ring-2 ring-jira-blue/20' : 'border-jira-border hover:border-gray-300'
            }`}
          >
            <h3 className="font-semibold">{p.name}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {new Date(p.startDate).toLocaleDateString()} — {new Date(p.endDate).toLocaleDateString()}
            </p>
            <p className="text-sm text-gray-500">{p.status} · {p._count?.issues ?? 0} issues · {p.sprints.length} sprints</p>
          </button>
        ))}
      </div>

      {pi && (
        <>
          <div className="bg-white rounded-lg border border-jira-border p-4">
            <h2 className="font-medium mb-3">Sprints — {pi.name}</h2>
            <div className="grid grid-cols-4 gap-3">
              {pi.sprints.map((s) => (
                <div key={s.id} className="bg-jira-gray rounded p-3 text-sm">
                  <p className="font-medium">{s.name}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-jira-border overflow-hidden">
            <h2 className="font-medium px-4 py-3 border-b border-jira-border">
              PI Issues ({piIssues?.length ?? 0})
            </h2>
            <table className="w-full text-sm">
              <thead className="bg-jira-gray">
                <tr>
                  <th className="text-left px-4 py-2">Key</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Summary</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Estimate</th>
                  <th className="text-left px-4 py-2">Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {piIssues?.map((issue) => (
                  <tr key={issue.id} className="border-t border-jira-border hover:bg-jira-gray/50">
                    <td className="px-4 py-2">
                      <Link to={`/issues/${issue.id}`} className="text-jira-blue hover:underline">
                        {issue.key}
                      </Link>
                    </td>
                    <td className="px-4 py-2"><TypeBadge type={issue.type} /></td>
                    <td className="px-4 py-2 max-w-xs truncate">{issue.summary}</td>
                    <td className="px-4 py-2"><StatusBadge status={issue.status} /></td>
                    <td className="px-4 py-2">{issue.estimate ? `${issue.estimate}h` : '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">
                      {issue.scheduledStart
                        ? `${new Date(issue.scheduledStart).toLocaleDateString()} — ${issue.scheduledEnd ? new Date(issue.scheduledEnd).toLocaleDateString() : '?'}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {runSchedule.data && (
            <div className="bg-white rounded-lg border border-jira-border p-4">
              <h2 className="font-medium mb-3">Schedule Results</h2>
              <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                <div>
                  <span className="text-gray-500">Scheduled:</span>{' '}
                  <span className="font-medium">{runSchedule.data.scheduled?.length ?? 0}</span>
                </div>
                <div>
                  <span className="text-gray-500">Unscheduled:</span>{' '}
                  <span className="font-medium text-red-600">{runSchedule.data.unscheduled?.length ?? 0}</span>
                </div>
                <div>
                  <span className="text-gray-500">Violations:</span>{' '}
                  <span className="font-medium text-amber-600">{runSchedule.data.violatedConstraints?.length ?? 0}</span>
                </div>
              </div>
              {runSchedule.data.violatedConstraints?.length > 0 && (
                <ul className="text-sm text-amber-700 space-y-1">
                  {runSchedule.data.violatedConstraints.map((v: string, i: number) => (
                    <li key={i}>• {v}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
