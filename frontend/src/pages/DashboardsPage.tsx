import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DashboardSummary } from '../api';
import { EmptyState, errorMessage, Modal, PageHeader, Spinner, useToast } from '../components/ui';
import { PlusIcon } from '../components/Icons';
import { timeAgo } from '../utils';

function DashboardCard({ d, mine }: { d: DashboardSummary; mine: boolean }) {
  const gadgets = d._count?.gadgets ?? 0;
  return (
    <Link to={`/dashboards/${d.id}`} className="card p-4 block hover:bg-jira-gray">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-jira-navy truncate">{d.name}</h3>
        {mine && d.shared && <span className="lozenge bg-jira-blue-light text-jira-blue shrink-0">Shared</span>}
      </div>
      {d.description && <p className="text-jira-subtle mt-1 line-clamp-2">{d.description}</p>}
      <p className="text-xs text-jira-muted mt-3">
        {gadgets} {gadgets === 1 ? 'gadget' : 'gadgets'} · {mine ? 'updated' : `by ${d.owner.name},`} {timeAgo(d.updatedAt)}
      </p>
    </Link>
  );
}

export default function DashboardsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: dashboards, isLoading } = useQuery({ queryKey: ['dashboards'], queryFn: api.getDashboards });
  const [form, setForm] = useState<{ name: string; description: string; shared: boolean } | null>(null);

  const create = useMutation({
    mutationFn: () => api.createDashboard({ name: form!.name.trim(), description: form!.description.trim() || undefined, shared: form!.shared }),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      navigate(`/dashboards/${d.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const mine = dashboards?.filter((d) => d.ownerId === me?.id) ?? [];
  const shared = dashboards?.filter((d) => d.ownerId !== me?.id) ?? [];

  return (
    <div>
      <PageHeader
        title="Dashboards"
        actions={<button type="button" className="btn btn-primary" onClick={() => setForm({ name: '', description: '', shared: false })}><PlusIcon size={14} /> Create dashboard</button>}
      />

      <h2 className="section-title mb-2">Built in</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link to="/dashboards/overview" className="card p-4 block hover:bg-jira-gray">
          <h3 className="font-semibold text-jira-navy">Project overview</h3>
          <p className="text-jira-subtle mt-1">Plan progress, RAG status, blocked and at-risk issues for the current project.</p>
        </Link>
      </div>

      {isLoading ? <Spinner /> : (
        <>
          <h2 className="section-title mb-2">My dashboards</h2>
          {mine.length === 0 ? (
            <div className="card mb-8">
              <EmptyState
                title="You haven’t made a dashboard yet"
                action={<button type="button" className="btn btn-default" onClick={() => setForm({ name: '', description: '', shared: false })}>Create your first dashboard</button>}
              >
                Build one from your saved filters: lists of issues, counts and breakdowns. Save a filter on the Issues page first if you don’t have one.
              </EmptyState>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {mine.map((d) => <DashboardCard key={d.id} d={d} mine />)}
            </div>
          )}

          {shared.length > 0 && (
            <>
              <h2 className="section-title mb-2">Shared with you</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {shared.map((d) => <DashboardCard key={d.id} d={d} mine={false} />)}
              </div>
            </>
          )}
        </>
      )}

      {form && (
        <Modal
          title="Create dashboard"
          onClose={() => setForm(null)}
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setForm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…' : 'Create'}
              </button>
            </>
          )}
        >
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) create.mutate(); }}>
            <div>
              <label className="field-label" htmlFor="dash-name">Name</label>
              <input id="dash-name" autoFocus className="input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. My team’s week" />
            </div>
            <div>
              <label className="field-label" htmlFor="dash-desc">Description (optional)</label>
              <input id="dash-desc" className="input" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.shared} onChange={(e) => setForm({ ...form, shared: e.target.checked })} />
              Share with everyone (they can view it, and save their own copy)
            </label>
            <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
          </form>
        </Modal>
      )}
    </div>
  );
}
