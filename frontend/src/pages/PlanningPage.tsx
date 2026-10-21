import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { StatusBadge, TypeBadge } from '../components/Badges';
import { CalendarIcon } from '../components/Icons';
import { EmptyState, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';
import { humanize } from '../utils';

const PI_STATUS: Record<string, string> = {
  PLANNING: 'bg-jira-gray-hover text-[#42526E]',
  ACTIVE: 'bg-jira-blue-light text-[#0747A6]',
  COMPLETED: 'bg-[#E3FCEF] text-[#006644]',
};

export default function PlanningPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedPi, setSelectedPi] = useState('');

  const { data: pis, isLoading } = useQuery({ queryKey: ['pis'], queryFn: api.getPis });

  const runSchedule = useMutation({
    mutationFn: (piId: string) => api.runSchedule(piId),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      toast(`Scheduled ${r.scheduled?.length ?? 0} issues`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
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

  if (isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Program increment planning"
        actions={pi && (
          <button type="button" onClick={() => runSchedule.mutate(pi.id)} disabled={runSchedule.isPending} className="btn btn-primary">
            {runSchedule.isPending ? 'Scheduling…' : 'Run scheduler'}
          </button>
        )}
      />

      {!pis?.length ? (
        <EmptyState title="No program increments yet">This project doesn't have any PIs to plan.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {pis.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPi(p.id)}
                className={`text-left card p-4 transition-shadow ${p.id === pi?.id ? 'border-jira-blue ring-2 ring-jira-blue/30' : 'hover:shadow-card'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  <span className={`lozenge ${PI_STATUS[p.status] ?? PI_STATUS.PLANNING}`}>{humanize(p.status)}</span>
                </div>
                <p className="flex items-center gap-1.5 text-jira-subtle">
                  <CalendarIcon size={14} />
                  {new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()}
                </p>
                <p className="text-jira-subtle mt-1">{p._count?.issues ?? 0} issues · {p.sprints.length} sprints</p>
              </button>
            ))}
          </div>

          {pi && (
            <>
              {pi.sprints.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-base font-semibold mb-3">Sprints in {pi.name}</h2>
                  <div className="flex flex-wrap gap-2">
                    {pi.sprints.map((s) => (
                      <span key={s.id} className="lozenge bg-jira-gray-hover text-jira-navy normal-case font-semibold text-xs px-2 py-1">{s.name}</span>
                    ))}
                  </div>
                </section>
              )}

              {runSchedule.data && (
                <section className="card mb-8">
                  <div className="card-header"><h2 className="card-title">Schedule results</h2></div>
                  <div className="p-4">
                    <div className="grid grid-cols-3 gap-4 mb-3">
                      <div><p className="text-jira-subtle">Scheduled</p><p className="text-2xl font-semibold">{runSchedule.data.scheduled?.length ?? 0}</p></div>
                      <div><p className="text-jira-subtle">Unscheduled</p><p className="text-2xl font-semibold text-[#DE350B]">{runSchedule.data.unscheduled?.length ?? 0}</p></div>
                      <div><p className="text-jira-subtle">Constraint violations</p><p className="text-2xl font-semibold text-[#974F0C]">{runSchedule.data.violatedConstraints?.length ?? 0}</p></div>
                    </div>
                    {runSchedule.data.violatedConstraints?.length > 0 && (
                      <ul className="list-disc pl-5 text-[#974F0C] space-y-1">
                        {runSchedule.data.violatedConstraints.map((v: string, i: number) => <li key={i}>{v}</li>)}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              <section>
                <h2 className="text-base font-semibold mb-3">Issues in {pi.name} <span className="text-jira-subtle font-normal">({piIssues?.length ?? 0})</span></h2>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr><th className="w-12">Type</th><th>Key</th><th>Summary</th><th>Status</th><th>Estimate</th><th>Scheduled</th></tr>
                    </thead>
                    <tbody>
                      {piIssues?.map((issue) => (
                        <tr key={issue.id}>
                          <td><TypeBadge type={issue.type} /></td>
                          <td className="whitespace-nowrap"><Link to={`/browse/${issue.key}`} className="link">{issue.key}</Link></td>
                          <td className="max-w-md"><Link to={`/browse/${issue.key}`} className="hover:underline line-clamp-1">{issue.summary}</Link></td>
                          <td><StatusBadge status={issue.status} name={issue.workflowStatus?.name} /></td>
                          <td>{issue.estimate ? `${issue.estimate}h` : '—'}</td>
                          <td className="text-jira-subtle whitespace-nowrap">
                            {issue.scheduledStart
                              ? `${new Date(issue.scheduledStart).toLocaleDateString()} – ${issue.scheduledEnd ? new Date(issue.scheduledEnd).toLocaleDateString() : '?'}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {piIssues?.length === 0 && <EmptyState title="No issues in this PI" />}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
