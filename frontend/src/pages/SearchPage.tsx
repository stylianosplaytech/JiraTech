import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Issue, type SavedFilter } from '../api';
import { useProject } from '../project';
import { jqlValue, humanize } from '../utils';
import { TypeBadge, StatusBadge, PriorityIcon } from '../components/Badges';
import Avatar from '../components/Avatar';

const PAGE_SIZE = 50;
const TYPES = ['EPIC', 'FEATURE_EPIC', 'STORY', 'TASK', 'DEFECT', 'SUB_TASK', 'RELEASE_EPIC', 'RELEASE_CANDIDATE'];
const STATUSES = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];
const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];

const COLUMNS: { label: string; sort?: string; className?: string }[] = [
  { label: 'T', sort: 'type', className: 'w-8' },
  { label: 'Key', sort: 'key' },
  { label: 'Summary', sort: 'summary', className: 'min-w-[280px]' },
  { label: 'Assignee', sort: 'assignee' },
  { label: 'Reporter' },
  { label: 'P', sort: 'priority', className: 'w-8' },
  { label: 'Status', sort: 'status' },
  { label: 'Resolution' },
  { label: 'Created', sort: 'created' },
  { label: 'Updated', sort: 'updated' },
];

interface Basic {
  project: string; // '' = all projects
  types: string[];
  statuses: string[];
  priorities: string[];
  assignee: '' | 'me' | 'unassigned';
  text: string;
}

function basicToJql(b: Basic): string {
  const clauses: string[] = [];
  if (b.project) clauses.push(`project = ${b.project}`);
  if (b.types.length) clauses.push(`type IN (${b.types.join(', ')})`);
  if (b.statuses.length) clauses.push(`status IN (${b.statuses.join(', ')})`);
  if (b.priorities.length) clauses.push(`priority IN (${b.priorities.join(', ')})`);
  if (b.assignee === 'me') clauses.push('assignee = currentUser()');
  if (b.assignee === 'unassigned') clauses.push('assignee IS EMPTY');
  if (b.text.trim()) clauses.push(`text ~ ${jqlValue(b.text.trim())}`);
  return `${clauses.join(' AND ')}${clauses.length ? ' ' : ''}ORDER BY created DESC`;
}

/** Replace (or add) the ORDER BY clause. Clicking the active column flips its direction. */
function withSort(jql: string, field: string): string {
  const match = /\s*ORDER\s+BY\s+(.*)$/i.exec(jql);
  const base = match ? jql.slice(0, match.index) : jql;
  const current = match?.[1].split(',')[0].trim().split(/\s+/);
  const sameField = current && current[0].toLowerCase() === field;
  const dir = sameField ? (current?.[1]?.toUpperCase() === 'ASC' ? 'DESC' : 'ASC') : (['created', 'updated', 'priority'].includes(field) ? 'DESC' : 'ASC');
  return `${base.trim()}${base.trim() ? ' ' : ''}ORDER BY ${field} ${dir}`;
}

function currentSort(jql: string): { field: string; dir: string } | null {
  const m = /ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i.exec(jql);
  return m ? { field: m[1].toLowerCase(), dir: (m[2] ?? 'ASC').toUpperCase() } : null;
}

function MultiSelect({ label, options, value, onChange }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`border rounded px-3 py-1.5 text-sm bg-white ${value.length ? 'border-jira-blue text-jira-blue' : 'border-jira-border'}`}
      >
        {label}{value.length ? `: ${value.length === 1 ? humanize(value[0]) : value.length}` : ''} ▾
      </button>
      {open && (
        <div tabIndex={-1} className="absolute left-0 top-full mt-1 bg-white border border-jira-border rounded shadow-lg z-20 py-1 min-w-[180px]">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 px-3 py-1 text-sm hover:bg-jira-gray cursor-pointer">
              <input
                type="checkbox"
                checked={value.includes(o)}
                onChange={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}
              />
              {humanize(o)}
            </label>
          ))}
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full text-left px-3 py-1 text-xs text-jira-blue border-t border-jira-border mt-1">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function toCsv(issues: Issue[]): string {
  const rows = [['Key', 'Type', 'Summary', 'Status', 'Priority', 'Assignee', 'Reporter', 'Created', 'Updated']];
  for (const i of issues) {
    rows.push([i.key, i.type, i.summary, i.status, i.priority, i.assignee?.name ?? '', i.reporter?.name ?? '', i.createdAt ?? '', i.updatedAt ?? '']);
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { projectKey, projects } = useProject();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: filters } = useQuery({ queryKey: ['filters'], queryFn: api.getFilters });

  const urlJql = params.get('jql');
  const filterId = params.get('filter');
  const page = Math.max(parseInt(params.get('page') ?? '0', 10) || 0, 0);
  const activeFilter = filters?.find((f) => f.id === filterId);

  const defaultJql = projectKey ? `project = ${projectKey} ORDER BY created DESC` : 'ORDER BY created DESC';
  const jql = urlJql ?? activeFilter?.jql ?? defaultJql;

  const [mode, setMode] = useState<'basic' | 'jql'>(urlJql && !urlJql.startsWith('project = ') ? 'jql' : 'basic');
  const [draft, setDraft] = useState(jql);
  const [basic, setBasic] = useState<Basic>({
    project: projectKey ?? '', types: [], statuses: [], priorities: [], assignee: '', text: '',
  });

  useEffect(() => setDraft(jql), [jql]);

  const run = (nextJql: string, extra: Record<string, string> = {}) => {
    const next: Record<string, string> = { jql: nextJql, ...extra };
    if (filterId && !extra.filter) next.filter = filterId;
    setParams(next);
  };

  const updateBasic = (patch: Partial<Basic>) => {
    const next = { ...basic, ...patch };
    setBasic(next);
    run(basicToJql(next));
  };

  const { data, error, isFetching } = useQuery({
    queryKey: ['search', jql, page],
    queryFn: () => api.search(jql, page * PAGE_SIZE, PAGE_SIZE),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const saveNew = useMutation({
    mutationFn: (name: string) => api.createFilter({ name, jql }),
    onSuccess: (f) => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      setParams({ filter: f.id });
    },
  });
  const saveChanges = useMutation({
    mutationFn: (f: SavedFilter) => api.updateFilter(f.id, { jql }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['filters'] }),
  });
  const toggleShare = useMutation({
    mutationFn: (f: SavedFilter) => api.updateFilter(f.id, { shared: !f.shared }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['filters'] }),
  });
  const removeFilter = useMutation({
    mutationFn: (id: string) => api.deleteFilter(id),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      if (id === filterId) setParams({});
    },
  });

  const myFilters = filters?.filter((f) => f.ownerId === me?.id) ?? [];
  const sharedFilters = filters?.filter((f) => f.ownerId !== me?.id) ?? [];
  const sort = currentSort(jql);
  const total = data?.total ?? 0;
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);
  const dirty = activeFilter && activeFilter.jql !== jql;

  const builtIns = useMemo(() => {
    const p = projectKey ? `project = ${projectKey} AND ` : '';
    return [
      { name: 'My open issues', jql: `${p}assignee = currentUser() AND status != CLOSED ORDER BY priority DESC` },
      { name: 'Reported by me', jql: `${p}reporter = currentUser() ORDER BY created DESC` },
      { name: 'All issues', jql: `${p.replace(/ AND $/, '')} ORDER BY created DESC`.trim() },
      { name: 'Open issues', jql: `${p}status != CLOSED ORDER BY priority DESC` },
      { name: 'Done issues', jql: `${p}status = CLOSED ORDER BY updated DESC` },
      { name: 'Updated recently', jql: `${p}updated >= -7d ORDER BY updated DESC` },
    ];
  }, [projectKey]);

  const exportCsv = () => {
    if (!data) return;
    const blob = new Blob([toCsv(data.issues)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${activeFilter?.name ?? 'issues'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0 space-y-5 text-sm">
        <div>
          <h3 className="text-[11px] font-semibold uppercase text-gray-500 mb-1">Filters</h3>
          {builtIns.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => setParams({ jql: f.jql })}
              className={`block w-full text-left px-2 py-1 rounded hover:bg-white ${!filterId && jql === f.jql ? 'bg-white font-medium' : ''}`}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase text-gray-500 mb-1">My saved filters</h3>
          {myFilters.length === 0 && <p className="px-2 text-gray-400 text-xs">Run a search, then “Save as”.</p>}
          {myFilters.map((f) => (
            <div key={f.id} className={`group flex items-center rounded hover:bg-white ${f.id === filterId ? 'bg-white font-medium' : ''}`}>
              <button type="button" onClick={() => setParams({ filter: f.id })} className="flex-1 text-left px-2 py-1 truncate" title={f.jql}>
                {f.name}{f.shared && <span className="ml-1 text-[10px] text-gray-500">(shared)</span>}
              </button>
              <button
                type="button"
                onClick={() => { if (confirm(`Delete filter “${f.name}”?`)) removeFilter.mutate(f.id); }}
                className="opacity-0 group-hover:opacity-100 px-2 text-gray-400 hover:text-red-600"
                title="Delete filter"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {sharedFilters.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase text-gray-500 mb-1">Shared with everyone</h3>
            {sharedFilters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setParams({ filter: f.id })}
                className={`block w-full text-left px-2 py-1 rounded hover:bg-white truncate ${f.id === filterId ? 'bg-white font-medium' : ''}`}
                title={`${f.jql} — by ${f.owner.name}`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold truncate">
            {activeFilter ? activeFilter.name : 'Search'}
            {dirty && <span className="ml-2 text-sm font-normal text-amber-600">(edited)</span>}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {activeFilter && activeFilter.ownerId === me?.id && (
              <>
                {dirty && (
                  <button type="button" onClick={() => saveChanges.mutate(activeFilter)} className="px-3 py-1.5 bg-jira-blue text-white rounded text-sm">
                    Save changes
                  </button>
                )}
                <button type="button" onClick={() => toggleShare.mutate(activeFilter)} className="px-3 py-1.5 bg-white border border-jira-border rounded text-sm">
                  {activeFilter.shared ? 'Stop sharing' : 'Share'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                const name = prompt('Name this filter', activeFilter ? `${activeFilter.name} (copy)` : '');
                if (name?.trim()) saveNew.mutate(name.trim());
              }}
              className="px-3 py-1.5 bg-white border border-jira-border rounded text-sm"
            >
              Save as
            </button>
            <button type="button" onClick={exportCsv} disabled={!data?.issues.length} className="px-3 py-1.5 bg-white border border-jira-border rounded text-sm disabled:opacity-50">
              Export CSV
            </button>
          </div>
        </div>

        <div className="bg-white border border-jira-border rounded-lg p-3 space-y-2">
          {mode === 'basic' ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={basic.project}
                onChange={(e) => updateBasic({ project: e.target.value })}
                className={`border rounded px-3 py-1.5 text-sm bg-white ${basic.project ? 'border-jira-blue text-jira-blue' : 'border-jira-border'}`}
              >
                <option value="">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.key}>{p.name} ({p.key})</option>)}
              </select>
              <MultiSelect label="Type" options={TYPES} value={basic.types} onChange={(types) => updateBasic({ types })} />
              <MultiSelect label="Status" options={STATUSES} value={basic.statuses} onChange={(statuses) => updateBasic({ statuses })} />
              <MultiSelect label="Priority" options={PRIORITIES} value={basic.priorities} onChange={(priorities) => updateBasic({ priorities })} />
              <select
                value={basic.assignee}
                onChange={(e) => updateBasic({ assignee: e.target.value as Basic['assignee'] })}
                className={`border rounded px-3 py-1.5 text-sm bg-white ${basic.assignee ? 'border-jira-blue text-jira-blue' : 'border-jira-border'}`}
              >
                <option value="">Any assignee</option>
                <option value="me">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </select>
              <form onSubmit={(e) => { e.preventDefault(); run(basicToJql(basic)); }} className="flex-1 min-w-[200px]">
                <input
                  value={basic.text}
                  onChange={(e) => setBasic({ ...basic, text: e.target.value })}
                  placeholder="Contains text (Enter)"
                  className="w-full border border-jira-border rounded px-3 py-1.5 text-sm"
                />
              </form>
              <button type="button" onClick={() => { setDraft(jql); setMode('jql'); }} className="text-sm text-jira-blue hover:underline">
                Switch to JQL
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); run(draft.trim()); }} className="space-y-2">
              <div className="flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(draft.trim()); }
                  }}
                  rows={2}
                  spellCheck={false}
                  className="flex-1 border border-jira-border rounded px-3 py-2 text-sm font-mono"
                  placeholder='project = SPORTS AND status != CLOSED ORDER BY priority DESC'
                />
                <button type="submit" className="px-4 bg-jira-blue text-white rounded text-sm">Search</button>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  Fields: project, key, type, status, priority, resolution, assignee, reporter, watcher, labels, component,
                  fixVersion, sprint, parent, summary, description, comment, text, created, updated · Operators: = != ~ !~ &gt; &lt; IN, NOT IN, IS EMPTY ·
                  Functions: currentUser(), startOfDay(), now() · Dates: 2026-01-31 or -7d
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMode('basic');
                    const reset: Basic = { project: projectKey ?? '', types: [], statuses: [], priorities: [], assignee: '', text: '' };
                    setBasic(reset);
                    run(basicToJql(reset));
                  }}
                  className="text-jira-blue hover:underline shrink-0 ml-4"
                >
                  Switch to basic
                </button>
              </div>
            </form>
          )}
          {mode === 'basic' && <div className="text-xs text-gray-500 font-mono truncate" title={jql}>{jql}</div>}
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{(error as Error).message}</div>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>
                {data ? (total === 0 ? 'No issues found' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`) : 'Searching…'}
                {isFetching && data && <span className="ml-2 text-gray-400">updating…</span>}
              </span>
              {total > PAGE_SIZE && (
                <div className="flex gap-1">
                  <button type="button" disabled={page === 0} onClick={() => run(jql, { page: String(page - 1) })} className="px-2 py-1 border border-jira-border rounded bg-white disabled:opacity-40">‹ Prev</button>
                  <button type="button" disabled={page >= lastPage} onClick={() => run(jql, { page: String(page + 1) })} className="px-2 py-1 border border-jira-border rounded bg-white disabled:opacity-40">Next ›</button>
                </div>
              )}
            </div>
            <div className="bg-white rounded-lg border border-jira-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-jira-gray border-b border-jira-border">
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.label} className={`text-left px-3 py-2 font-medium whitespace-nowrap ${c.className ?? ''}`}>
                        {c.sort ? (
                          <button type="button" onClick={() => run(withSort(jql, c.sort!))} className="hover:text-jira-blue">
                            {c.label}
                            {sort?.field === c.sort && <span className="ml-1">{sort.dir === 'DESC' ? '↓' : '↑'}</span>}
                          </button>
                        ) : c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data?.issues.map((issue) => (
                    <tr key={issue.id} className="border-b border-jira-border last:border-0 hover:bg-jira-gray/50">
                      <td className="px-3 py-2"><TypeBadge type={issue.type} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link to={`/browse/${issue.key}`} className="text-jira-blue hover:underline">{issue.key}</Link>
                      </td>
                      <td className="px-3 py-2 max-w-md">
                        <Link to={`/browse/${issue.key}`} className="hover:underline line-clamp-1">{issue.summary}</Link>
                        {issue.labels && issue.labels.length > 0 && (
                          <div className="flex gap-1 mt-0.5">
                            {issue.labels.map((l) => <span key={l.label.id} className="text-[10px] bg-blue-50 text-blue-800 px-1.5 rounded">{l.label.name}</span>)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {issue.assignee ? <span className="flex items-center gap-1.5"><Avatar name={issue.assignee.name} size="xs" />{issue.assignee.name}</span> : <span className="text-gray-400">Unassigned</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{issue.reporter?.name ?? '—'}</td>
                      <td className="px-3 py-2"><PriorityIcon priority={issue.priority} /></td>
                      <td className="px-3 py-2"><StatusBadge status={issue.status} /></td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{issue.resolution ? humanize(issue.resolution) : 'Unresolved'}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{issue.createdAt && new Date(issue.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{issue.updatedAt && new Date(issue.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {data && data.issues.length === 0 && (
                    <tr><td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-gray-500">No issues match this search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
