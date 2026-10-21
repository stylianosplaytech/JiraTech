import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BreakdownField, type CustomDashboard, type Gadget, type GadgetType } from '../api';
import { BREAKDOWN_LABELS, GADGET_TYPES, GadgetBody } from '../components/Gadgets';
import { EmptyState, errorMessage, Modal, PageHeader, Spinner, useDialogs, useToast } from '../components/ui';
import { PlusIcon, TrashIcon } from '../components/Icons';

interface GadgetForm {
  /** Set when editing an existing gadget. */
  id?: string;
  type: GadgetType;
  filterId: string;
  title: string;
  maxRows: number;
  groupBy: BreakdownField;
  chart: 'bars' | 'donut';
  days: 7 | 14 | 30 | 90;
  bucket: 'day' | 'week';
  wide: boolean;
}

function GadgetModal({ dashboardId, form, onChange, onClose }: {
  dashboardId: string;
  form: GadgetForm;
  onChange: (f: GadgetForm) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: filters } = useQuery({ queryKey: ['filters'], queryFn: api.getFilters });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });

  const save = useMutation({
    mutationFn: () => {
      const config = form.type === 'FILTER_RESULTS' ? { maxRows: form.maxRows }
        : form.type === 'BREAKDOWN' ? { groupBy: form.groupBy, chart: form.chart }
        : form.type === 'TREND' ? { days: form.days, bucket: form.bucket } : {};
      const title = form.title.trim() || undefined;
      return form.id
        ? api.updateGadget(dashboardId, form.id, { title, filterId: form.filterId, config, wide: form.wide })
        : api.addGadget(dashboardId, { type: form.type, filterId: form.filterId, title, config, wide: form.wide });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const hint = GADGET_TYPES.find((t) => t.type === form.type)?.hint;
  const mine = filters?.filter((f) => f.ownerId === me?.id) ?? [];
  const others = filters?.filter((f) => f.ownerId !== me?.id) ?? [];

  return (
    <Modal
      title={form.id ? 'Edit gadget' : 'Add gadget'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!form.filterId || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : form.id ? 'Save' : 'Add gadget'}
          </button>
        </>
      )}
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (form.filterId) save.mutate(); }}>
        {!form.id && (
          <div>
            <label className="field-label" htmlFor="gadget-type">Show</label>
            <select id="gadget-type" className="input" value={form.type} onChange={(e) => onChange({ ...form, type: e.target.value as GadgetType, wide: e.target.value === 'FILTER_RESULTS' })}>
              {GADGET_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
            {hint && <p className="text-xs text-jira-muted mt-1">{hint}</p>}
          </div>
        )}
        <div>
          <label className="field-label" htmlFor="gadget-filter">Saved filter</label>
          {filters && filters.length === 0 ? (
            <p className="text-jira-muted">
              You have no saved filters yet. <Link to="/search" className="link">Run a search</Link> and choose “Save as”, then come back.
            </p>
          ) : (
            <select
              id="gadget-filter"
              className="input"
              value={form.filterId}
              onChange={(e) => onChange({ ...form, filterId: e.target.value })}
            >
              <option value="">Choose a filter…</option>
              {mine.length > 0 && <optgroup label="My filters">{mine.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Shared with me">{others.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.owner.name})</option>)}</optgroup>}
            </select>
          )}
        </div>
        <div>
          <label className="field-label" htmlFor="gadget-title">Title</label>
          <input id="gadget-title" className="input" maxLength={120} value={form.title} onChange={(e) => onChange({ ...form, title: e.target.value })} placeholder="Defaults to the filter’s name" />
        </div>
        {form.type === 'FILTER_RESULTS' && (
          <div>
            <label className="field-label" htmlFor="gadget-rows">Issues to show</label>
            <select id="gadget-rows" className="input" value={form.maxRows} onChange={(e) => onChange({ ...form, maxRows: Number(e.target.value) })}>
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
        {form.type === 'BREAKDOWN' && (
          <>
            <div>
              <label className="field-label" htmlFor="gadget-group">Count by</label>
              <select id="gadget-group" className="input" value={form.groupBy} onChange={(e) => onChange({ ...form, groupBy: e.target.value as BreakdownField })}>
                {(Object.keys(BREAKDOWN_LABELS) as BreakdownField[]).map((f) => <option key={f} value={f}>{BREAKDOWN_LABELS[f]}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="gadget-chart">Chart</label>
              <select id="gadget-chart" className="input" value={form.chart} onChange={(e) => onChange({ ...form, chart: e.target.value as 'bars' | 'donut' })}>
                <option value="bars">Bars</option>
                <option value="donut">Donut</option>
              </select>
            </div>
          </>
        )}
        {form.type === 'TREND' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="gadget-days">Period</label>
              <select id="gadget-days" className="input" value={form.days} onChange={(e) => onChange({ ...form, days: Number(e.target.value) as GadgetForm['days'] })}>
                {[7, 14, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="gadget-bucket">Count per</label>
              <select id="gadget-bucket" className="input" value={form.bucket} onChange={(e) => onChange({ ...form, bucket: e.target.value as 'day' | 'week' })}>
                <option value="day">Day</option>
                <option value="week">Week</option>
              </select>
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.wide} onChange={(e) => onChange({ ...form, wide: e.target.checked })} />
          Full width
        </label>
        <p className="text-xs text-jira-muted">
          The filter runs as whoever is viewing, so “currentUser()” means them, and they only see issues from projects they can browse.
        </p>
      </form>
    </Modal>
  );
}

export default function CustomDashboardPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, prompt } = useDialogs();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: dashboard, isLoading, error } = useQuery({ queryKey: ['dashboard', id], queryFn: () => api.getCustomDashboard(id), retry: false });
  const [gadgetForm, setGadgetForm] = useState<GadgetForm | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', id] });
    queryClient.invalidateQueries({ queryKey: ['dashboards'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const update = useMutation({
    mutationFn: (data: { name?: string; description?: string; shared?: boolean }) => api.updateDashboard(id, data),
    onSuccess: (d, vars) => {
      refresh();
      if (vars.shared !== undefined) toast(d.shared ? 'Dashboard shared with everyone' : 'Dashboard is now private');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteDashboard(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboards'] }); navigate('/dashboards'); },
    onError,
  });
  const copy = useMutation({
    mutationFn: () => api.duplicateDashboard(id),
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ['dashboards'] }); toast('Saved a copy to your dashboards'); navigate(`/dashboards/${d.id}`); },
    onError,
  });
  const removeGadget = useMutation({
    mutationFn: (gadgetId: string) => api.removeGadget(id, gadgetId),
    onSuccess: refresh,
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.reorderGadgets(id, ids),
    onSuccess: (d: CustomDashboard) => { queryClient.setQueryData(['dashboard', id], d); },
    onError,
  });

  if (isLoading) return <Spinner />;
  if (error || !dashboard) {
    return (
      <EmptyState title="Dashboard not found" action={<Link to="/dashboards" className="btn btn-default">All dashboards</Link>}>
        It may have been deleted or made private by its owner.
      </EmptyState>
    );
  }

  const isOwner = dashboard.ownerId === me?.id;
  const move = (index: number, by: -1 | 1) => {
    const ids = dashboard.gadgets.map((g) => g.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    reorder.mutate(ids);
  };
  const editGadget = (g: Gadget) => setGadgetForm({
    id: g.id, type: g.type, filterId: g.filterId ?? '', title: g.title,
    maxRows: g.config.maxRows ?? 10, groupBy: g.config.groupBy ?? 'status', chart: g.config.chart ?? 'bars',
    days: g.config.days ?? 30, bucket: g.config.bucket ?? 'day', wide: g.wide,
  });

  return (
    <div>
      <PageHeader
        breadcrumbs={<Link to="/dashboards" className="link">Dashboards</Link>}
        title={<>{dashboard.name}{dashboard.shared && <span className="ml-3 lozenge bg-jira-blue-light text-jira-blue align-middle">Shared</span>}</>}
        actions={isOwner ? (
          <>
            <button type="button" className="btn btn-primary" onClick={() => setGadgetForm({ type: 'FILTER_RESULTS', filterId: '', title: '', maxRows: 10, groupBy: 'status', chart: 'bars', days: 30, bucket: 'day', wide: true })}>
              <PlusIcon size={14} /> Add gadget
            </button>
            <button type="button" className="btn btn-default" onClick={() => update.mutate({ shared: !dashboard.shared })}>
              {dashboard.shared ? 'Make private' : 'Share'}
            </button>
            <button
              type="button"
              className="btn btn-default"
              onClick={async () => {
                const name = await prompt({ title: 'Rename dashboard', label: 'Name', initial: dashboard.name, confirmLabel: 'Rename' });
                if (name) update.mutate({ name });
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn btn-default"
              onClick={async () => {
                if (await confirm({ title: `Delete “${dashboard.name}”?`, message: 'The dashboard is removed for you and anyone it is shared with. Your saved filters are kept.', confirmLabel: 'Delete', danger: true })) remove.mutate();
              }}
            >
              <TrashIcon size={14} /> Delete
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={copy.isPending} onClick={() => copy.mutate()}>Save a copy</button>
        )}
      >
        {dashboard.description && <p className="text-jira-subtle mt-1">{dashboard.description}</p>}
        {!isOwner && <p className="text-xs text-jira-muted mt-1">Shared by {dashboard.owner.name}. Save a copy to make your own changes.</p>}
      </PageHeader>

      {dashboard.gadgets.length === 0 ? (
        <div className="card">
          <EmptyState
            title="This dashboard is empty"
            action={isOwner && (
              <button type="button" className="btn btn-default" onClick={() => setGadgetForm({ type: 'FILTER_RESULTS', filterId: '', title: '', maxRows: 10, groupBy: 'status', chart: 'bars', days: 30, bucket: 'day', wide: true })}>Add a gadget</button>
            )}
          >
            {isOwner ? 'Add gadgets that show the results of your saved filters.' : 'Its owner hasn’t added any gadgets yet.'}
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {dashboard.gadgets.map((g, i) => (
            <div key={g.id} className={`card ${g.wide ? 'md:col-span-2' : ''}`}>
              <div className="card-header">
                <h2 className="card-title truncate">{g.title}</h2>
                {isOwner && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" className="btn btn-subtle btn-sm" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Move ${g.title} earlier`} title="Move earlier">↑</button>
                    <button type="button" className="btn btn-subtle btn-sm" disabled={i === dashboard.gadgets.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Move ${g.title} later`} title="Move later">↓</button>
                    <button type="button" className="btn btn-subtle btn-sm" onClick={() => editGadget(g)}>Edit</button>
                    <button
                      type="button"
                      className="btn btn-subtle btn-sm btn-icon"
                      aria-label={`Remove ${g.title}`}
                      onClick={async () => {
                        if (await confirm({ title: `Remove “${g.title}”?`, message: 'The saved filter itself is kept.', confirmLabel: 'Remove', danger: true })) removeGadget.mutate(g.id);
                      }}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                )}
              </div>
              <GadgetBody dashboardId={dashboard.id} gadget={g} />
            </div>
          ))}
        </div>
      )}

      {gadgetForm && (
        <GadgetModal dashboardId={dashboard.id} form={gadgetForm} onChange={setGadgetForm} onClose={() => setGadgetForm(null)} />
      )}
    </div>
  );
}
