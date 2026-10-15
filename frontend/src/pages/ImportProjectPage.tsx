import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ProjectImportColumn, type ProjectImportPreview, type StatusCategory } from '../api';
import { useProject } from '../project';
import { CATEGORY_LABELS } from '../components/Badges';
import { PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

const CATEGORIES: StatusCategory[] = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];
const TYPE_LABELS: Record<string, string> = { EPIC: 'Epics', STORY: 'Stories', DEFECT: 'Defects', TASK: 'Tasks', SUB_TASK: 'Sub-tasks' };
const LINK_LABELS: Record<string, string> = { RELATES_TO: 'relates to', BLOCKS: 'blocks', DEPENDS_ON: 'depends on', PARENT_LINK: 'parent' };
const GROUPS = ['Core', 'Content', 'People', 'Planning', 'Relationships', 'Other fields'];

/** "Digital All 2025-2027 (Playtech JIRA) 2026-09-14T09_13_44+0200.csv" → "Digital All 2025-2027" */
function nameFromFile(file: string) {
  return file.replace(/\.(csv|json)$/i, '').replace(/\s*\(.*$/, '').replace(/[\s_]*\d{4}[-_]\d{2}[-_]\d{2}.*$/, '').replace(/_/g, ' ').trim();
}

/** Columns that are on unless the user turns them off: everything the app has a field for and the file has data for. */
const recommended = (columns: ProjectImportColumn[]) =>
  new Set(columns.filter((c) => c.required || (c.group !== 'Other fields' && c.count > 0)).map((c) => c.id));

export default function ImportProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { setProjectKey } = useProject();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ProjectImportPreview | null>(null);
  const [form, setForm] = useState({ name: '', key: '', description: '' });
  const [categories, setCategories] = useState<Record<string, StatusCategory>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [hideEmpty, setHideEmpty] = useState(true);
  const [filter, setFilter] = useState('');
  // CSV dates are written in the exporting user's local time, which is this browser's. JSON dates carry their own offset.
  const utcOffsetMinutes = -new Date().getTimezoneOffset();

  const analyse = useMutation({
    mutationFn: (f: File) => api.previewProjectImport(f, utcOffsetMinutes),
    onSuccess: (p) => {
      setPreview(p);
      setCategories(Object.fromEntries(p.statuses.map((s) => [s.name, s.category])));
      setSelected(recommended(p.columns));
      setNames({});
      setForm((f) => ({ ...f, key: p.suggestedKey }));
    },
  });

  const run = useMutation({
    mutationFn: () => api.importProject(file!, {
      utcOffsetMinutes,
      key: form.key,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      columns: [...selected],
      columnNames: names,
      statusCategories: categories,
    }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setProjectKey(result.key);
      toast(`Imported ${result.issues} issues into ${result.name}`);
      navigate(`/projects/${result.key}`);
    },
  });

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setPreview(null);
    setFile(f);
    setForm({ name: nameFromFile(f.name), key: '', description: '' });
    analyse.mutate(f);
  };

  const columns = preview?.columns ?? [];
  const emptyCount = columns.filter((c) => c.count === 0).length;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return columns.filter((c) => (!hideEmpty || c.count > 0) && (!q || `${c.label} ${c.sample ?? ''}`.toLowerCase().includes(q)));
  }, [columns, hideEmpty, filter]);

  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const setVisible = (on: boolean) => setSelected((s) => {
    const n = new Set(s);
    for (const c of visible) if (!c.required) { if (on) n.add(c.id); else n.delete(c.id); }
    return n;
  });

  const canImport = me?.role === 'ADMIN';
  const keyValid = /^[A-Z][A-Z0-9]{1,9}$/.test(form.key);
  const keyClash = preview?.keyTaken && form.key === preview.suggestedKey;
  const ready = !!preview && !!form.name.trim() && keyValid && !keyClash && !run.isPending;
  const importsStatus = selected.has('status');
  const customChosen = columns.filter((c) => c.group === 'Other fields' && selected.has(c.id)).length;

  return (
    <div className="max-w-5xl">
      <PageHeader breadcrumbs="Administration" title="Import project from Jira" />
      {me && !canImport && (
        <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2 mb-4">Only administrators can import projects.</div>
      )}

      <div className="card p-4 mb-6">
        <label className="block">
          <span className="field-label">Jira export (CSV or JSON)</span>
          <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => onFile(e.target.files?.[0])} disabled={!canImport} className="block" />
          <span className="field-help">
            A CSV from Filters → Export → Export Excel CSV (all fields), or issues saved from the REST API (JSON). You choose below
            which columns to import. Attachments aren't in either format, and a JSON file only names custom fields by id.
          </span>
        </label>
        {analyse.isPending && <div className="mt-3"><Spinner /></div>}
        {analyse.isError && <div className="mt-3 rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(analyse.error)}</div>}
      </div>

      {preview && (
        <form onSubmit={(e) => { e.preventDefault(); if (ready) run.mutate(); }} className="space-y-6">
          <div className="card p-4 space-y-4">
            <h2 className="font-semibold">New project</h2>
            <label className="block">
              <span className="field-label">Name <span className="text-[#DE350B]">*</span></span>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" maxLength={80} />
            </label>
            <label className="block">
              <span className="field-label">Key <span className="text-[#DE350B]">*</span></span>
              <input
                required
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) })}
                className="input w-40 font-mono"
              />
              {keyClash
                ? <span className="field-error">A project with key {form.key} already exists. Choose another key; issues are numbered {form.key || 'KEY'}-{preview.firstNumber} to {form.key || 'KEY'}-{preview.lastNumber} either way.</span>
                : <span className={form.key && !keyValid ? 'field-error' : 'field-help'}>
                  Issues keep their numbers from the file: <span className="font-mono">{form.key || 'KEY'}-{preview.firstNumber}</span> to <span className="font-mono">{form.key || 'KEY'}-{preview.lastNumber}</span>.
                  The key can't be changed later.
                </span>}
            </label>
            <label className="block">
              <span className="field-label">Description</span>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="input" />
            </label>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-1">What's in {file?.name}</h2>
            <ul className="text-sm text-jira-subtle space-y-1 mb-3">
              <li><b className="text-jira-text">{preview.issues}</b> issues: {Object.entries(preview.byType).map(([t, n]) => `${TYPE_LABELS[t] ?? t} ${n}`).join(', ')}</li>
              <li><b className="text-jira-text">{preview.parents.linked}</b> can be placed under their parent or epic
                {preview.parents.outsideExport > 0 && <> ({preview.parents.outsideExport} have a parent that isn't in the file and are left without one)</>}</li>
              <li><b className="text-jira-text">{preview.links.kept}</b> links between these issues ({Object.entries(preview.links.byType).map(([t, n]) => `${n} ${LINK_LABELS[t] ?? t}`).join(', ') || 'none'})
                {preview.links.outsideExport > 0 && <>; {preview.links.outsideExport} links to issues outside the file are skipped</>}.
                Link types other than Blocks, Depends and Parent become "relates to".</li>
              <li>
                <b className="text-jira-text">{preview.people.matched}</b> of {preview.people.total} people match an existing user (by email, else username or name).
                Reporters and assignees who don't are left empty; their comments and work logs are recorded under you with the original author noted.
                {preview.people.unmatched.length > 0 && (
                  <details className="mt-1"><summary className="cursor-pointer">Not matched</summary>
                    <span className="block text-xs">{preview.people.unmatched.join(', ')}{preview.people.total - preview.people.matched > preview.people.unmatched.length ? ', …' : ''}</span>
                  </details>
                )}
              </li>
            </ul>
            {preview.warnings.map((w) => <div key={w} className="rounded-[3px] bg-[#FFFAE6] text-[#974F0C] px-3 py-2 mb-2">{w}</div>)}
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-1">Columns to import</h2>
            <p className="field-help mt-0 mb-3">
              Tick what you need. Columns the app has a field for go there; <b>Other fields</b> become text custom fields on the project
              (rename them to something you'll recognise). {selected.size} of {columns.length} selected{customChosen > 0 && `, ${customChosen} as custom fields`}.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter columns or values" aria-label="Filter columns" className="input h-8 w-64" />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
                Hide empty columns{emptyCount > 0 && ` (${emptyCount})`}
              </label>
              <span className="flex gap-1 ml-auto">
                <button type="button" className="btn btn-subtle btn-sm" onClick={() => setSelected(recommended(columns))}>Recommended</button>
                <button type="button" className="btn btn-subtle btn-sm" onClick={() => setVisible(true)}>Select shown</button>
                <button type="button" className="btn btn-subtle btn-sm" onClick={() => setVisible(false)}>Clear shown</button>
              </span>
            </div>
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto border border-jira-border rounded-[3px]">
              <table className="data-table">
                <thead className="sticky top-0 bg-white">
                  <tr><th className="w-8" /><th>Column</th><th>Imported as</th><th className="text-right">Issues</th><th>Example</th></tr>
                </thead>
                <tbody>
                  {GROUPS.map((group) => {
                    const rows = visible.filter((c) => c.group === group);
                    if (!rows.length) return null;
                    return (
                      <Fragment key={group}>
                        <tr><td colSpan={5} className="bg-jira-gray text-xs font-semibold uppercase text-jira-subtle">{group}</td></tr>
                        {rows.map((c) => (
                          <tr key={c.id} className={c.count === 0 ? 'text-jira-muted' : undefined}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Import ${c.label}`}
                                checked={selected.has(c.id)}
                                disabled={c.required}
                                onChange={(e) => toggle(c.id, e.target.checked)}
                              />
                            </td>
                            <td>
                              {c.group === 'Other fields' && selected.has(c.id)
                                ? <input aria-label={`Name for ${c.label}`} className="input h-7 w-56" value={names[c.id] ?? c.label} maxLength={80} onChange={(e) => setNames({ ...names, [c.id]: e.target.value })} />
                                : c.label}
                            </td>
                            <td className="text-xs text-jira-subtle">{c.target}</td>
                            <td className="text-right">{c.count}</td>
                            <td className="text-xs text-jira-subtle max-w-xs truncate" title={c.sample ?? undefined}>{c.sample}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {visible.length === 0 && <div className="p-4 text-sm text-jira-subtle">No columns match.</div>}
            </div>
          </div>

          {importsStatus ? (
            <div className="card p-4">
              <h2 className="font-semibold mb-1">Workflow</h2>
              <p className="field-help mt-0 mb-2">
                Each status in the file becomes a status in the new project. Pick the category it counts as on the board and in reports
                (closed issues are marked completed). Any status can move to any other; tighten that later under the project's workflow.
              </p>
              <table className="data-table">
                <thead><tr><th>Status in the file</th><th className="text-right">Issues</th><th>Counts as</th></tr></thead>
                <tbody>
                  {preview.statuses.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td className="text-right">{s.count}</td>
                      <td>
                        <select
                          aria-label={`Category for ${s.name}`}
                          className="input h-8 w-40"
                          value={categories[s.name]}
                          onChange={(e) => setCategories({ ...categories, [s.name]: e.target.value as StatusCategory })}
                        >
                          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="field-help">Status isn't imported, so the project starts with the standard workflow and every issue in Backlog.</p>
          )}

          {run.isError && <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(run.error)}</div>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={!ready} className="btn btn-primary">
              {run.isPending ? `Importing ${preview.issues} issues…` : `Import ${preview.issues} issues`}
            </button>
            <Link to="/projects" className="btn btn-subtle">Cancel</Link>
          </div>
        </form>
      )}
    </div>
  );
}
