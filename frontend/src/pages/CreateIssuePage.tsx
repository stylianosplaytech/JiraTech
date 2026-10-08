import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type Issue } from '../api';
import { useProject } from '../project';
import UserPicker from '../components/UserPicker';
import IssuePicker from '../components/IssuePicker';

const ISSUE_TYPES = [
  'FEATURE_EPIC', 'BAU_EPIC', 'RELEASE_EPIC', 'EPIC',
  'STORY', 'DEFECT', 'TASK', 'RELEASE_CANDIDATE',
  'ANALYSIS', 'BUG_FIX', 'CODE', 'CODE_REVIEW', 'ARCH_REVIEW',
  'CODE_MERGE', 'DOCUMENTATION', 'TEST_CASE', 'TEST_RUN',
  'DEPLOYMENT', 'CONFIGURATION', 'SUB_TASK',
];

// The everyday Jira types first; SPORTS-specific ones follow.
const COMMON_TYPES = ['TASK', 'STORY', 'DEFECT', 'EPIC', 'SUB_TASK'];

const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];

export default function CreateIssuePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentIdParam = searchParams.get('parentId') ?? '';
  const { project, projects, setProjectKey } = useProject();
  const typeParam = searchParams.get('type') ?? (project?.strictHierarchy === false ? 'TASK' : 'STORY');
  const [parent, setParent] = useState<Issue | null>(null);

  const [form, setForm] = useState({
    type: typeParam,
    summary: '',
    description: '',
    priority: 'MEDIUM',
    parentId: parentIdParam,
    epicName: '',
    estimate: '',
    assigneeId: '',
    labelIds: [] as string[],
    componentIds: [] as string[],
    fixVersionIds: [] as string[],
    affectsVersionIds: [] as string[],
  });

  useEffect(() => {
    if (parentIdParam) setForm((f) => ({ ...f, parentId: parentIdParam }));
    if (typeParam) setForm((f) => ({ ...f, type: typeParam }));
  }, [parentIdParam, typeParam]);

  // "Create sub-task" passes the parent's id: show it in the picker.
  const { data: paramParent } = useQuery({
    queryKey: ['issue', parentIdParam],
    queryFn: () => api.getIssue(parentIdParam),
    enabled: !!parentIdParam,
  });
  useEffect(() => {
    if (paramParent) setParent(paramParent);
  }, [paramParent]);

  const { data: labels } = useQuery({
    queryKey: ['labels'],
    queryFn: () => api.getLabels(),
  });

  const { data: components } = useQuery({
    queryKey: ['components'],
    queryFn: () => api.getComponents(),
  });

  const { data: versions } = useQuery({
    queryKey: ['versions'],
    queryFn: () => api.getVersions(),
  });

  const create = useMutation({
    mutationFn: () =>
      api.createIssue({
        projectKey: parent?.project?.key ?? project?.key,
        type: form.type,
        summary: form.summary,
        description: form.description || undefined,
        priority: form.priority,
        parentId: parent?.id,
        epicName: form.epicName || undefined,
        estimate: form.estimate ? Number(form.estimate) : undefined,
        assigneeId: form.assigneeId || undefined,
        labelIds: form.labelIds.length ? form.labelIds : undefined,
        componentIds: form.componentIds.length ? form.componentIds : undefined,
        fixVersionIds: form.fixVersionIds.length ? form.fixVersionIds : undefined,
        affectsVersionIds: form.affectsVersionIds.length ? form.affectsVersionIds : undefined,
      }),
    onSuccess: (issue) => navigate(`/browse/${issue.key}`),
  });

  const toggleMulti = (field: 'labelIds' | 'componentIds' | 'fixVersionIds' | 'affectsVersionIds', id: string) => {
    setForm((f) => {
      const arr = f[field];
      return {
        ...f,
        [field]: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id],
      };
    });
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">Create Issue</h1>
      <form
        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        className="bg-white rounded-lg border border-jira-border p-6 space-y-4"
      >
        <label className="block">
          <span className="text-sm font-medium">Project</span>
          <select
            value={project?.key ?? ''}
            onChange={(e) => {
              setProjectKey(e.target.value);
              setParent(null);
              // Labels, components and versions belong to the old project.
              setForm((f) => ({ ...f, labelIds: [], componentIds: [], fixVersionIds: [], affectsVersionIds: [] }));
            }}
            disabled={!!parent}
            className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm disabled:bg-jira-gray"
          >
            {projects.map((p) => <option key={p.id} value={p.key}>{p.name} ({p.key})</option>)}
          </select>
          {parent && <span className="text-xs text-gray-500">Child issues are created in their parent's project.</span>}
        </label>

        <label className="block">
          <span className="text-sm font-medium">Issue Type</span>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm"
          >
            <optgroup label="Standard">
              {COMMON_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </optgroup>
            <optgroup label="SPORTS">
              {ISSUE_TYPES.filter((t) => !COMMON_TYPES.includes(t)).map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Summary *</span>
          <input
            required
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm"
            placeholder="As a role, I want to..."
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Description</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={4}
            className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">Priority</span>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm"
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Estimate (hours)</span>
            <input
              type="number"
              value={form.estimate}
              onChange={(e) => setForm({ ...form, estimate: e.target.value })}
              className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium">Assignee</span>
          <div className="mt-1">
            <UserPicker
              value={form.assigneeId || undefined}
              onChange={(assigneeId) => setForm({ ...form, assigneeId: assigneeId ?? '' })}
            />
          </div>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Parent Issue</span>
          <div className="mt-1">
            <IssuePicker value={parent} onChange={setParent} placeholder="None — search to pick a parent epic or story" />
          </div>
          {project?.strictHierarchy && !form.type.includes('EPIC') && !parent && (
            <span className="text-xs text-amber-700">{project.key} requires a parent for this issue type.</span>
          )}
        </label>

        {form.type.includes('EPIC') && (
          <label className="block">
            <span className="text-sm font-medium">Epic Name</span>
            <input
              value={form.epicName}
              onChange={(e) => setForm({ ...form, epicName: e.target.value })}
              className="mt-1 block w-full border border-jira-border rounded px-3 py-2 text-sm"
              placeholder="e.g. In-play Overask"
            />
          </label>
        )}

        {labels && labels.length > 0 && (
          <div>
            <span className="text-sm font-medium">Labels</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {labels.map((l) => (
                <label key={l.id} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.labelIds.includes(l.id)}
                    onChange={() => toggleMulti('labelIds', l.id)}
                  />
                  {l.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {components && components.length > 0 && (
          <div>
            <span className="text-sm font-medium">Components</span>
            <div className="mt-1 flex flex-wrap gap-2 max-h-24 overflow-y-auto">
              {components.map((c) => (
                <label key={c.id} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.componentIds.includes(c.id)}
                    onChange={() => toggleMulti('componentIds', c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {versions && versions.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm font-medium">Fix Versions</span>
              <div className="mt-1 space-y-1 max-h-24 overflow-y-auto">
                {versions.map((v) => (
                  <label key={`fix-${v.id}`} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={form.fixVersionIds.includes(v.id)} onChange={() => toggleMulti('fixVersionIds', v.id)} />
                    {v.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <span className="text-sm font-medium">Affects Versions</span>
              <div className="mt-1 space-y-1 max-h-24 overflow-y-auto">
                {versions.map((v) => (
                  <label key={`aff-${v.id}`} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={form.affectsVersionIds.includes(v.id)} onChange={() => toggleMulti('affectsVersionIds', v.id)} />
                    {v.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {create.isError && (
          <div className="text-red-600 text-sm">
            {create.error instanceof Error ? create.error.message : 'Failed to create'}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={create.isPending || !form.summary}
            className="bg-jira-blue text-white px-6 py-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {create.isPending ? 'Creating...' : 'Create Issue'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-6 py-2 rounded border border-jira-border text-sm hover:bg-jira-gray"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
