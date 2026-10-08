import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Issue, type SavedFilter } from '../api';
import { useProject } from '../project';
import { jqlValue } from '../utils';
import { PriorityIcon, StatusBadge, TypeBadge, typeLabel } from '../components/Badges';
import { ChevronDownIcon, DownloadIcon, IssueTypeIcon, SearchIcon, StarIcon, TrashIcon } from '../components/Icons';
import Avatar from '../components/Avatar';
import { Dropdown, EmptyState, errorMessage, useDialogs, useToast } from '../components/ui';

const PAGE_SIZE = 50;
const TYPES = ['EPIC', 'STORY', 'TASK', 'DEFECT', 'SUB_TASK', 'FEATURE_EPIC', 'RELEASE_EPIC', 'RELEASE_CANDIDATE'];
const STATUSES = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];
const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];

const COLUMNS: { label: string; sort?: string; className?: string }[] = [
  { label: 'Type', sort: 'type', className: 'w-12' },
  { label: 'Key', sort: 'key', className: 'w-28' },
  { label: 'Summary', sort: 'summary', className: 'min-w-[220px]' },
  { label: 'Assignee', sort: 'assignee' },
  { label: 'Reporter' },
  { label: 'Priority', sort: 'priority', className: 'w-16' },
  { label: 'Status', sort: 'status' },
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

/** Jira-style filter button: "Status: 2 ▾" with a checklist popover. */
function FilterButton({ label, options, value, onChange, render }: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  render?: (o: string) => React.ReactNode;
}) {
  const summary = value.length === 0 ? '' : value.length === 1 ? `: ${render ? '' : typeLabel(value[0])}` : `: ${value.length}`;
  return (
    <Dropdown
      width="w-60"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={`btn ${value.length || open ? 'bg-jira-blue-light text-jira-blue hover:bg-[#B3D4FF]' : 'btn-default'}`}
        >
          {label}{summary}
          {value.length === 1 && render && <span className="ml-1">{render(value[0])}</span>}
          <ChevronDownIcon size={14} />
        </button>
      )}
    >
      {() => (
        <>
          {options.map((o) => (
            <label key={o} className="menu-item cursor-pointer">
              <input
                type="checkbox"
                checked={value.includes(o)}
                onChange={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}
              />
              {render ? render(o) : typeLabel(o)}
            </label>
          ))}
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="menu-item text-jira-blue border-t border-jira-border mt-1">
              Clear selection
            </button>
          )}
        </>
      )}
    </Dropdown>
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
  const toast = useToast();
  const { confirm, prompt } = useDialogs();
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

  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const saveNew = useMutation({
    mutationFn: (name: string) => api.createFilter({ name, jql }),
    onSuccess: (f) => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      setParams({ filter: f.id });
      toast(`Filter “${f.name}” saved`);
    },
    onError,
  });
  const saveChanges = useMutation({
    mutationFn: (f: SavedFilter) => api.updateFilter(f.id, { jql }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['filters'] }); toast('Filter updated'); },
    onError,
  });
  const toggleShare = useMutation({
    mutationFn: (f: SavedFilter) => api.updateFilter(f.id, { shared: !f.shared }),
    onSuccess: (f) => { queryClient.invalidateQueries({ queryKey: ['filters'] }); toast(f.shared ? 'Filter shared with everyone' : 'Filter is now private'); },
    onError,
  });
  const removeFilter = useMutation({
    mutationFn: (id: string) => api.deleteFilter(id),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      if (id === filterId) setParams({});
    },
    onError,
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

  const saveAs = async () => {
    const name = await prompt({
      title: 'Save filter',
      label: 'Name',
      initial: activeFilter ? `${activeFilter.name} (copy)` : '',
      confirmLabel: 'Save',
    });
    if (name) saveNew.mutate(name);
  };

  const navItem = (active: boolean) =>
    `flex w-full items-center gap-2 text-left px-3 py-1.5 rounded-[3px] transition-colors ${
      active ? 'bg-jira-blue-light text-jira-blue font-medium' : 'text-jira-navy hover:bg-jira-gray-hover'
    }`;

  return (
    <div className="flex gap-8">
      <aside className="w-56 shrink-0 space-y-6 pt-1">
        <div>
          <h3 className="section-title px-3 mb-2">Filters</h3>
          {builtIns.map((f) => (
            <button key={f.name} type="button" onClick={() => setParams({ jql: f.jql })} className={navItem(!filterId && jql === f.jql)}>
              {f.name}
            </button>
          ))}
        </div>
        <div>
          <h3 className="section-title px-3 mb-2">Saved filters</h3>
          {myFilters.length === 0 && <p className="px-3 text-xs text-jira-muted">Run a search, then choose “Save as”.</p>}
          {myFilters.map((f) => (
            <div key={f.id} className="group relative">
              <button type="button" onClick={() => setParams({ filter: f.id })} className={`${navItem(f.id === filterId)} pr-8`} title={f.jql}>
                <StarIcon size={14} className="shrink-0 text-[#FFAB00]" fill="#FFAB00" />
                <span className="truncate">{f.name}</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await confirm({ title: `Delete filter “${f.name}”?`, message: 'The filter is removed for you and anyone it is shared with.', confirmLabel: 'Delete', danger: true })) {
                    removeFilter.mutate(f.id);
                  }
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 btn btn-subtle btn-sm btn-icon"
                aria-label={`Delete filter ${f.name}`}
              >
                <TrashIcon size={13} />
              </button>
            </div>
          ))}
        </div>
        {sharedFilters.length > 0 && (
          <div>
            <h3 className="section-title px-3 mb-2">Shared with you</h3>
            {sharedFilters.map((f) => (
              <button key={f.id} type="button" onClick={() => setParams({ filter: f.id })} className={navItem(f.id === filterId)} title={`${f.jql} — by ${f.owner.name}`}>
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="page-title truncate">
            {activeFilter ? activeFilter.name : 'Issues'}
            {dirty && <span className="ml-3 lozenge bg-[#FFFAE6] text-[#974F0C] align-middle">Edited</span>}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {activeFilter && activeFilter.ownerId === me?.id && (
              <>
                {dirty && <button type="button" onClick={() => saveChanges.mutate(activeFilter)} className="btn btn-primary">Save changes</button>}
                <button type="button" onClick={() => toggleShare.mutate(activeFilter)} className="btn btn-default">
                  {activeFilter.shared ? 'Make private' : 'Share'}
                </button>
              </>
            )}
            <button type="button" onClick={() => void saveAs()} className="btn btn-default">Save as</button>
            <button type="button" onClick={exportCsv} disabled={!data?.issues.length} className="btn btn-default">
              <DownloadIcon size={14} /> Export
            </button>
          </div>
        </div>

        <div className="mb-4">
          {mode === 'basic' ? (
            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={(e) => { e.preventDefault(); run(basicToJql(basic)); }} className="relative w-60">
                <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jira-muted pointer-events-none" />
                <input
                  value={basic.text}
                  onChange={(e) => setBasic({ ...basic, text: e.target.value })}
                  onBlur={() => basicToJql(basic) !== jql && run(basicToJql(basic))}
                  placeholder="Search issues"
                  className="input h-8 pl-8"
                />
              </form>
              <Dropdown
                width="w-64"
                trigger={({ toggle, open }) => (
                  <button type="button" onClick={toggle} className={`btn ${basic.project || open ? 'bg-jira-blue-light text-jira-blue hover:bg-[#B3D4FF]' : 'btn-default'}`}>
                    Project{basic.project ? `: ${basic.project}` : ''} <ChevronDownIcon size={14} />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <button type="button" className={`menu-item ${!basic.project ? 'bg-jira-blue-light/60' : ''}`} onClick={() => { updateBasic({ project: '' }); close(); }}>All projects</button>
                    {projects.map((p) => (
                      <button key={p.id} type="button" className={`menu-item ${basic.project === p.key ? 'bg-jira-blue-light/60' : ''}`} onClick={() => { updateBasic({ project: p.key }); close(); }}>
                        <span className="font-mono text-[11px] bg-jira-gray-hover rounded-[3px] px-1.5">{p.key}</span> {p.name}
                      </button>
                    ))}
                  </>
                )}
              </Dropdown>
              <FilterButton
                label="Type"
                options={TYPES}
                value={basic.types}
                onChange={(types) => updateBasic({ types })}
                render={(t) => <span className="inline-flex items-center gap-2"><IssueTypeIcon type={t} />{basic.types.length === 1 && basic.types[0] === t ? '' : typeLabel(t)}</span>}
              />
              <FilterButton
                label="Status"
                options={STATUSES}
                value={basic.statuses}
                onChange={(statuses) => updateBasic({ statuses })}
                render={(s) => <StatusBadge status={s} />}
              />
              <FilterButton
                label="Priority"
                options={PRIORITIES}
                value={basic.priorities}
                onChange={(priorities) => updateBasic({ priorities })}
                render={(p) => <PriorityIcon priority={p} showLabel={!(basic.priorities.length === 1 && basic.priorities[0] === p)} />}
              />
              <Dropdown
                trigger={({ toggle, open }) => (
                  <button type="button" onClick={toggle} className={`btn ${basic.assignee || open ? 'bg-jira-blue-light text-jira-blue hover:bg-[#B3D4FF]' : 'btn-default'}`}>
                    Assignee{basic.assignee === 'me' ? ': Me' : basic.assignee === 'unassigned' ? ': Unassigned' : ''} <ChevronDownIcon size={14} />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    {([['', 'Anyone'], ['me', 'Assigned to me'], ['unassigned', 'Unassigned']] as const).map(([v, l]) => (
                      <button key={v} type="button" className={`menu-item ${basic.assignee === v ? 'bg-jira-blue-light/60' : ''}`} onClick={() => { updateBasic({ assignee: v }); close(); }}>{l}</button>
                    ))}
                  </>
                )}
              </Dropdown>
              <button type="button" onClick={() => { setDraft(jql); setMode('jql'); }} className="btn btn-link ml-auto">Switch to JQL</button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); run(draft.trim()); }}>
              <div className="flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(draft.trim()); } }}
                  rows={2}
                  spellCheck={false}
                  className="input font-mono text-[13px]"
                  placeholder="project = SPORTS AND status != CLOSED ORDER BY priority DESC"
                  aria-label="JQL query"
                />
                <button type="submit" className="btn btn-primary self-start h-9">Search</button>
              </div>
              <div className="flex items-start justify-between gap-4 mt-1.5 text-xs text-jira-muted">
                <span>
                  Fields: project, key, type, status, priority, resolution, assignee, reporter, watcher, labels, component,
                  fixVersion, sprint, parent, summary, description, comment, text, created, updated ·
                  Operators: = != ~ !~ &gt; &lt; IN, NOT IN, IS EMPTY · Functions: currentUser(), startOfDay(), now() · Dates: 2026-01-31 or -7d
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMode('basic');
                    const reset: Basic = { project: projectKey ?? '', types: [], statuses: [], priorities: [], assignee: '', text: '' };
                    setBasic(reset);
                    run(basicToJql(reset));
                  }}
                  className="btn btn-link btn-sm shrink-0"
                >
                  Switch to basic
                </button>
              </div>
            </form>
          )}
        </div>

        {error ? (
          <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-4 py-3">{errorMessage(error)}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.label} className={c.className}>
                        {c.sort ? (
                          <button type="button" onClick={() => run(withSort(jql, c.sort!))} className="inline-flex items-center gap-1 hover:text-jira-navy">
                            {c.label}
                            {sort?.field === c.sort && <span aria-hidden="true">{sort.dir === 'DESC' ? '↓' : '↑'}</span>}
                          </button>
                        ) : c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={isFetching && data ? 'opacity-60' : ''}>
                  {data?.issues.map((issue) => (
                    <tr key={issue.id}>
                      <td><TypeBadge type={issue.type} /></td>
                      <td className="whitespace-nowrap">
                        <Link to={`/browse/${issue.key}`} className={`link ${issue.status === 'CLOSED' ? 'line-through' : ''}`}>{issue.key}</Link>
                      </td>
                      <td>
                        <Link to={`/browse/${issue.key}`} className="hover:underline line-clamp-1">{issue.summary}</Link>
                        {issue.labels && issue.labels.length > 0 && (
                          <div className="flex gap-1 mt-0.5">
                            {issue.labels.map((l) => <span key={l.label.id} className="lozenge bg-jira-gray-hover text-jira-subtle normal-case font-semibold">{l.label.name}</span>)}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {issue.assignee
                          ? <span className="flex items-center gap-2"><Avatar name={issue.assignee.name} size="xs" />{issue.assignee.name}</span>
                          : <span className="text-jira-muted">Unassigned</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        {issue.reporter ? <span className="flex items-center gap-2"><Avatar name={issue.reporter.name} size="xs" />{issue.reporter.name}</span> : '—'}
                      </td>
                      <td><PriorityIcon priority={issue.priority} /></td>
                      <td><StatusBadge status={issue.status} /></td>
                      <td className="whitespace-nowrap text-jira-subtle">{issue.createdAt && new Date(issue.createdAt).toLocaleDateString()}</td>
                      <td className="whitespace-nowrap text-jira-subtle">{issue.updatedAt && new Date(issue.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data && data.issues.length === 0 && (
                <EmptyState title="No issues found">Try changing your filters or search terms.</EmptyState>
              )}
            </div>
            <div className="flex items-center justify-between mt-3 text-jira-subtle">
              <span>{data ? (total === 0 ? '' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total} issues`) : 'Searching…'}</span>
              {total > PAGE_SIZE && (
                <div className="flex gap-1">
                  <button type="button" disabled={page === 0} onClick={() => run(jql, { page: String(page - 1) })} className="btn btn-default btn-sm">Previous</button>
                  <button type="button" disabled={page >= lastPage} onClick={() => run(jql, { page: String(page + 1) })} className="btn btn-default btn-sm">Next</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

