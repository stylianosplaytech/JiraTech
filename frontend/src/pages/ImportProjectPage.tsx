import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ProjectImportPreview, type StatusCategory } from '../api';
import { useProject } from '../project';
import { CATEGORY_LABELS } from '../components/Badges';
import { PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

const CATEGORIES: StatusCategory[] = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];
const TYPE_LABELS: Record<string, string> = { EPIC: 'Epics', STORY: 'Stories', DEFECT: 'Defects', TASK: 'Tasks', SUB_TASK: 'Sub-tasks' };
const LINK_LABELS: Record<string, string> = { RELATES_TO: 'relates to', BLOCKS: 'blocks', DEPENDS_ON: 'depends on', PARENT_LINK: 'parent' };

/** "Digital All 2025-2027 (Playtech JIRA) 2026-09-14T09_13_44+0200.csv" → "Digital All 2025-2027" */
function nameFromFile(file: string) {
  return file.replace(/\.csv$/i, '').replace(/\s*\(.*$/, '').replace(/\s+\d{4}-\d{2}-\d{2}T.*$/, '').trim();
}

export default function ImportProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { setProjectKey } = useProject();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });

  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ProjectImportPreview | null>(null);
  const [form, setForm] = useState({ name: '', key: '', description: '' });
  const [categories, setCategories] = useState<Record<string, StatusCategory>>({});
  // The export writes dates in the exporting user's local time, which is this browser's.
  const utcOffsetMinutes = -new Date().getTimezoneOffset();

  const analyse = useMutation({
    mutationFn: (text: string) => api.previewProjectImport({ csv: text, utcOffsetMinutes }),
    onSuccess: (p) => {
      setPreview(p);
      setCategories(Object.fromEntries(p.statuses.map((s) => [s.name, s.category])));
      setForm((f) => ({ ...f, key: p.suggestedKey }));
    },
  });

  const run = useMutation({
    mutationFn: () => api.importProject({
      csv: csv!,
      utcOffsetMinutes,
      key: form.key,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      statusCategories: categories,
    }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setProjectKey(result.key);
      toast(`Imported ${result.issues} issues into ${result.name}`);
      navigate(`/projects/${result.key}`);
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPreview(null);
    setFileName(file.name);
    setForm({ name: nameFromFile(file.name), key: '', description: '' });
    const text = await file.text();
    setCsv(text);
    analyse.mutate(text);
  };

  const canCreate = me?.role === 'ADMIN';
  const keyValid = /^[A-Z][A-Z0-9]{1,9}$/.test(form.key);
  const keyClash = preview?.keyTaken && form.key === preview.suggestedKey;
  const ready = !!preview && !!form.name.trim() && keyValid && !keyClash && !run.isPending;

  return (
    <div className="max-w-4xl">
      <PageHeader
        breadcrumbs="Administration"
        title="Import project from Jira"
      />
      {me && !canCreate && (
        <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2 mb-4">Only administrators can import projects.</div>
      )}

      <div className="card p-4 mb-6">
        <label className="block">
          <span className="field-label">Jira export (CSV)</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} disabled={!canCreate} className="block" />
          <span className="field-help">
            In Jira use Filters → Export → Export Excel CSV (all fields). Issue keys, types, summaries, priorities, statuses, created
            dates, parents and links are imported. Descriptions, comments, attachments and people aren't, so reporter and assignee stay empty.
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
            <h2 className="font-semibold mb-1">What will be imported from {fileName}</h2>
            <ul className="text-sm text-jira-subtle space-y-1 mb-4">
              <li><b className="text-jira-text">{preview.issues}</b> issues: {Object.entries(preview.byType).map(([t, n]) => `${TYPE_LABELS[t] ?? t} ${n}`).join(', ')}</li>
              <li><b className="text-jira-text">{preview.parents.linked}</b> issues placed under their parent
                {preview.parents.outsideExport > 0 && <> ({preview.parents.outsideExport} have a parent that isn't in the file and are left without one)</>}</li>
              <li><b className="text-jira-text">{preview.links.kept}</b> links between these issues ({Object.entries(preview.links.byType).map(([t, n]) => `${n} ${LINK_LABELS[t] ?? t}`).join(', ')})
                {preview.links.outsideExport > 0 && <>; {preview.links.outsideExport} links to issues outside the file are skipped</>}</li>
              <li>Link types other than Blocks, Depends and Parent become "relates to".</li>
            </ul>
            {preview.warnings.map((w) => <div key={w} className="rounded-[3px] bg-[#FFFAE6] text-[#974F0C] px-3 py-2 mb-2">{w}</div>)}

            <h3 className="font-medium mb-1">Workflow</h3>
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
