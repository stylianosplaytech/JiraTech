import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BreakdownField, type CustomDashboard, type Gadget, type GadgetSpan, type GadgetType, type SingleField } from '../api';
import { BREAKDOWN_LABELS, GADGET_TYPES, GadgetBody, SINGLE_FIELD_KEYS } from '../components/Gadgets';
import { TYPE_THUMB, ThumbChoice } from '../components/GadgetThumbs';
import { EmptyState, errorMessage, Modal, PageHeader, Spinner, useDialogs, useToast } from '../components/ui';
import { PlusIcon, TrashIcon } from '../components/Icons';
import { PdfBanner, PdfBlock, PdfExport } from '../reports/PdfExport';

interface GadgetForm {
  /** Set when editing an existing gadget. */
  id?: string;
  type: GadgetType;
  filterId: string;
  title: string;
  maxRows: number;
  groupBy: BreakdownField;
  stackBy: BreakdownField;
  chart: 'bars' | 'donut' | 'pie' | 'line';
  days: 7 | 14 | 30 | 90;
  bucket: 'day' | 'week';
  span: GadgetSpan;
}

/** Starting settings when the kind of gadget changes. */
function defaultsFor(type: GadgetType): Partial<GadgetForm> {
  return { type, days: type === 'DUE_DATES' || type === 'PERIOD_COMPARISON' ? 7 : 30, span: (type === 'FILTER_RESULTS' || type === 'STALE' || type === 'DUE_DATES' || type === 'RECENTLY_UPDATED' || type === 'RECENTLY_RESOLVED' || type === 'UNASSIGNED') ? 3 : 1, chart: type === 'CREATED_VS_RESOLVED' || type === 'BACKLOG_TREND' ? 'line' : 'bars' };
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
      const config = form.type === 'FILTER_RESULTS' || form.type === 'STALE' || form.type === 'RECENTLY_UPDATED' || form.type === 'RECENTLY_RESOLVED' || form.type === 'UNASSIGNED' ? { maxRows: form.maxRows }
        : form.type === 'DUE_DATES' ? { maxRows: form.maxRows, days: form.days }
        : form.type === 'STACKED' ? { groupBy: form.groupBy, stackBy: form.stackBy }
        : form.type === 'RESOLUTION_TIME' || form.type === 'PERIOD_COMPARISON' ? { days: form.days }
        : form.type === 'BREAKDOWN' ? { groupBy: form.groupBy, chart: form.chart }
        : form.type === 'TREND' || form.type === 'CREATED_VS_RESOLVED' || form.type === 'BACKLOG_TREND' ? { days: form.days, bucket: form.bucket, chart: form.chart } : {};
      const title = form.title.trim() || undefined;
      return form.id
        ? api.updateGadget(dashboardId, form.id, { title, filterId: form.filterId, config, span: form.span })
        : api.addGadget(dashboardId, { type: form.type, filterId: form.filterId, title, config, span: form.span });
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
      width="max-w-xl"
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
            <span className="field-label">What should it show?</span>
            <ThumbChoice
              label="Kind of gadget"
              columns={3}
              value={form.type}
              onChange={(type) => onChange({
                ...form,
                ...defaultsFor(type),
                // A stacked breakdown can't count by label, component or fix version.
                ...(type === 'STACKED' && !SINGLE_FIELD_KEYS.includes(form.groupBy as SingleField) ? { groupBy: 'status' as const, stackBy: 'priority' as const } : {}),
              })}
              options={GADGET_TYPES.map((t) => ({ value: t.type, label: t.label, thumb: TYPE_THUMB[t.type], hint: t.hint }))}
            />
            {hint && <p className="text-xs text-jira-muted mt-1.5">{hint}</p>}
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
        {(form.type === 'FILTER_RESULTS' || form.type === 'STALE' || form.type === 'DUE_DATES' || form.type === 'RECENTLY_UPDATED' || form.type === 'RECENTLY_RESOLVED' || form.type === 'UNASSIGNED') && (
          <div>
            <label className="field-label" htmlFor="gadget-rows">Issues to show</label>
            <select id="gadget-rows" className="input" value={form.maxRows} onChange={(e) => onChange({ ...form, maxRows: Number(e.target.value) })}>
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
        {form.type === 'STACKED' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="gadget-group">Count by</label>
              <select id="gadget-group" className="input" value={form.groupBy}
                onChange={(e) => { const groupBy = e.target.value as BreakdownField; onChange({ ...form, groupBy, stackBy: form.stackBy === groupBy ? (groupBy === 'status' ? 'priority' : 'status') : form.stackBy }); }}>
                {SINGLE_FIELD_KEYS.map((f) => <option key={f} value={f}>{BREAKDOWN_LABELS[f]}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="gadget-stack">Split each bar by</label>
              <select id="gadget-stack" className="input" value={form.stackBy} onChange={(e) => onChange({ ...form, stackBy: e.target.value as BreakdownField })}>
                {SINGLE_FIELD_KEYS.filter((f) => f !== form.groupBy).map((f) => <option key={f} value={f}>{BREAKDOWN_LABELS[f]}</option>)}
              </select>
            </div>
          </div>
        )}
        {form.type === 'DUE_DATES' && (
          <div>
            <label className="field-label" htmlFor="gadget-ahead">Show issues due within</label>
            <select id="gadget-ahead" className="input" value={form.days} onChange={(e) => onChange({ ...form, days: Number(e.target.value) as GadgetForm['days'] })}>
              {[7, 14, 30, 90].map((n) => <option key={n} value={n}>The next {n} days</option>)}
            </select>
          </div>
        )}
        {(form.type === 'RESOLUTION_TIME' || form.type === 'PERIOD_COMPARISON') && (
          <div>
            <label className="field-label" htmlFor="gadget-days">{form.type === 'PERIOD_COMPARISON' ? 'Compare the last' : 'Issues resolved in'}</label>
            <select id="gadget-days" className="input" value={form.days} onChange={(e) => onChange({ ...form, days: Number(e.target.value) as GadgetForm['days'] })}>
              {[7, 14, 30, 90].map((n) => <option key={n} value={n}>{form.type === 'PERIOD_COMPARISON' ? `${n} days with the ${n} before` : `The last ${n} days`}</option>)}
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
              <span className="field-label">Chart</span>
              <ThumbChoice
                label="Chart style"
                value={form.chart}
                onChange={(chart) => onChange({ ...form, chart })}
                options={[
                  { value: 'bars', label: 'Bars', thumb: 'bars' },
                  { value: 'donut', label: 'Donut', thumb: 'donut' },
                  { value: 'pie', label: 'Pie', thumb: 'pie' },
                ]}
              />
            </div>
          </>
        )}
        {(form.type === 'TREND' || form.type === 'CREATED_VS_RESOLVED' || form.type === 'BACKLOG_TREND') && (
          <>
          <div>
            <span className="field-label">Chart</span>
            <ThumbChoice
              label="Chart style"
              columns={3}
              value={form.chart}
              onChange={(chart) => onChange({ ...form, chart })}
              options={form.type === 'TREND' || form.type === 'BACKLOG_TREND'
                ? [{ value: 'bars', label: 'Bars', thumb: 'created' }, { value: 'line', label: 'Line', thumb: 'created-line' }]
                : [{ value: 'line', label: 'Lines', thumb: 'cvr' }, { value: 'bars', label: 'Bars', thumb: 'cvr-bars' }]}
            />
          </div>
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
          </>
        )}
        <div>
          <span className="field-label">Width</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Gadget width">
            {([[1, '1/3'], [2, '2/3'], [3, 'Full width']] as [GadgetSpan, string][]).map(([n, label]) => (
              <label key={n} className={`flex-1 cursor-pointer rounded border px-3 py-2 text-center ${form.span === n ? 'border-jira-blue bg-jira-blue-light text-jira-blue font-medium' : 'border-jira-border hover:bg-jira-gray'}`}>
                <input type="radio" name="gadget-span" className="sr-only" checked={form.span === n} onChange={() => onChange({ ...form, span: n })} />
                <span className="flex gap-0.5 h-2 mb-1.5" aria-hidden="true">
                  {[1, 2, 3].map((i) => <span key={i} className={`flex-1 rounded-sm ${i <= n ? 'bg-current opacity-70' : 'bg-jira-gray-hover'}`} />)}
                </span>
                {label}
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-jira-muted">
          The filter runs as whoever is viewing, so “currentUser()” means them, and they only see issues from projects they can browse.
        </p>
      </form>
    </Modal>
  );
}

const COL_SPAN: Record<GadgetSpan, string> = { 1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3' };
const PDF_COL_SPAN: Record<GadgetSpan, string> = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' };

/** Groups gadgets into rows of three columns, the way the dashboard grid flows them. */
function pdfRows(gadgets: Gadget[]): Gadget[][] {
  const rows: Gadget[][] = [];
  let used = 3;
  for (const g of gadgets) {
    if (used + g.span > 3) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(g);
    used += g.span;
  }
  return rows;
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
    maxRows: g.config.maxRows ?? 10, groupBy: g.config.groupBy ?? 'status', stackBy: g.config.stackBy ?? 'priority', chart: g.config.chart ?? (g.type === 'CREATED_VS_RESOLVED' || g.type === 'BACKLOG_TREND' ? 'line' : 'bars'),
    days: g.config.days ?? 30, bucket: g.config.bucket ?? 'day', span: g.span,
  });

  return (
    <div>
      <PageHeader
        breadcrumbs={<Link to="/dashboards" className="link">Dashboards</Link>}
        title={<>{dashboard.name}{dashboard.shared && <span className="ml-3 lozenge bg-jira-blue-light text-jira-blue align-middle">Shared</span>}</>}
        actions={(
          <>
            <PdfExport
              title={dashboard.name}
              disabled={dashboard.gadgets.length === 0}
              filename={`${dashboard.name.replace(/[^w-]+/g, '-').replace(/^-+|-+$/g, '') || 'dashboard'}.pdf`}
              footer={`Conductor · ${dashboard.name} · ${dashboard.owner.name}`}
            >
              <div data-pdf-section="">
                <PdfBanner title={dashboard.name} subtitle={dashboard.description || `Dashboard by ${dashboard.owner.name}`} />
                <div className="h-3" />
                {pdfRows(dashboard.gadgets).map((row) => (
                  <PdfBlock key={row[0].id} className="grid grid-cols-3 gap-4 items-start">
                    {row.map((g) => (
                      <div key={g.id} className={`card ${PDF_COL_SPAN[g.span]}`}>
                        <div className="card-header"><h2 className="card-title">{g.title}</h2></div>
                        <GadgetBody dashboardId={dashboard.id} gadget={g} />
                      </div>
                    ))}
                  </PdfBlock>
                ))}
              </div>
            </PdfExport>
            {isOwner ? (
          <>
            <button type="button" className="btn btn-primary" onClick={() => setGadgetForm({ type: 'FILTER_RESULTS', filterId: '', title: '', maxRows: 10, groupBy: 'status', stackBy: 'priority', chart: 'bars', days: 30, bucket: 'day', span: 3 })}>
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
          <button type="button" className="btn btn-default" disabled={copy.isPending} onClick={() => copy.mutate()}>Save a copy</button>
        )}
          </>
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
              <button type="button" className="btn btn-default" onClick={() => setGadgetForm({ type: 'FILTER_RESULTS', filterId: '', title: '', maxRows: 10, groupBy: 'status', stackBy: 'priority', chart: 'bars', days: 30, bucket: 'day', span: 3 })}>Add a gadget</button>
            )}
          >
            {isOwner ? 'Add gadgets that show the results of your saved filters.' : 'Its owner hasn’t added any gadgets yet.'}
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {dashboard.gadgets.map((g, i) => (
            <div key={g.id} className={`card ${COL_SPAN[g.span]}`}>
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
