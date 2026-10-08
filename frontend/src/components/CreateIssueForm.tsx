import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Issue } from '../api';
import { useProject } from '../project';
import { MultiPicker, SelectPicker } from './Pickers';
import { PriorityIcon, typeLabel } from './Badges';
import { IssueTypeIcon } from './Icons';
import UserPicker from './UserPicker';
import IssuePicker from './IssuePicker';
import { errorMessage } from './ui';
import { RichTextEditor } from './RichText';

// The everyday Jira types first; SPORTS-specific ones follow.
const COMMON_TYPES = ['TASK', 'STORY', 'DEFECT', 'EPIC', 'SUB_TASK'];
const SPORTS_TYPES = [
  'FEATURE_EPIC', 'BAU_EPIC', 'RELEASE_EPIC', 'RELEASE_CANDIDATE', 'ANALYSIS', 'BUG_FIX', 'CODE', 'CODE_REVIEW',
  'ARCH_REVIEW', 'CODE_MERGE', 'DOCUMENTATION', 'TEST_CASE', 'TEST_RUN', 'DEPLOYMENT', 'CONFIGURATION',
];
const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];

/** The "Create issue" form, used both in the header dialog and on /issues/new. */
export default function CreateIssueForm({
  parentId, initialType, onCreated, onCancel, formId = 'create-issue-form', onPendingChange,
}: {
  parentId?: string;
  initialType?: string;
  onCreated: (issue: Issue, createAnother: boolean) => void;
  onCancel?: () => void;
  formId?: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { project, projects, setProjectKey } = useProject();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [parent, setParent] = useState<Issue | null>(null);
  const [createAnother, setCreateAnother] = useState(false);
  const [form, setForm] = useState({
    type: initialType ?? (project?.strictHierarchy === false ? 'TASK' : 'STORY'),
    summary: '',
    description: '',
    priority: 'MEDIUM',
    epicName: '',
    estimate: '',
    assigneeId: '',
    labelIds: [] as string[],
    componentIds: [] as string[],
    fixVersionIds: [] as string[],
  });

  // "Create sub-task" passes the parent's id: show it in the picker.
  const { data: paramParent } = useQuery({
    queryKey: ['issue', parentId],
    queryFn: () => api.getIssue(parentId!),
    enabled: !!parentId,
  });
  useEffect(() => { if (paramParent) setParent(paramParent); }, [paramParent]);

  const { data: labels } = useQuery({ queryKey: ['labels'], queryFn: () => api.getLabels() });
  const { data: components } = useQuery({ queryKey: ['components'], queryFn: () => api.getComponents() });
  const { data: versions } = useQuery({ queryKey: ['versions'], queryFn: () => api.getVersions() });

  const create = useMutation({
    mutationFn: () =>
      api.createIssue({
        projectKey: parent?.project?.key ?? project?.key,
        type: form.type,
        summary: form.summary.trim(),
        description: form.description || undefined,
        priority: form.priority,
        parentId: parent?.id,
        epicName: form.epicName.trim() || undefined,
        estimate: form.estimate ? Number(form.estimate) : undefined,
        assigneeId: form.assigneeId || undefined,
        labelIds: form.labelIds.length ? form.labelIds : undefined,
        componentIds: form.componentIds.length ? form.componentIds : undefined,
        fixVersionIds: form.fixVersionIds.length ? form.fixVersionIds : undefined,
      }),
    onSuccess: (issue) => {
      queryClient.invalidateQueries({ queryKey: ['search'] });
      queryClient.invalidateQueries({ queryKey: ['board'] });
      queryClient.invalidateQueries({ queryKey: ['issue'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (createAnother) setForm((f) => ({ ...f, summary: '', description: '', epicName: '' }));
      onCreated(issue, createAnother);
    },
  });
  useEffect(() => { onPendingChange?.(create.isPending); }, [create.isPending, onPendingChange]);

  const isEpic = form.type.includes('EPIC');
  const needsParent = project?.strictHierarchy && !isEpic && !parent;
  const typeOptions = [...COMMON_TYPES, ...(project?.strictHierarchy !== false ? SPORTS_TYPES : [])].map((t) => ({
    id: t, label: typeLabel(t), icon: <IssueTypeIcon type={t} />,
  }));

  return (
    <form
      id={formId}
      onSubmit={(e) => { e.preventDefault(); if (form.summary.trim().length >= 3) create.mutate(); }}
      className="space-y-4"
    >
      <p className="text-xs text-jira-muted">Required fields are marked with an asterisk <span className="text-[#DE350B]">*</span></p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="field-label">Project <span className="text-[#DE350B]">*</span></span>
          <SelectPicker
            variant="field"
            value={parent?.project?.key ?? project?.key}
            disabled={!!parent}
            onChange={(key) => {
              if (!key) return;
              setProjectKey(key);
              // Labels, components and versions belong to the old project.
              setForm((f) => ({ ...f, labelIds: [], componentIds: [], fixVersionIds: [] }));
            }}
            // Only projects where the user may create issues.
            options={projects.filter((p) => p.myRole === 'MEMBER' || p.myRole === 'ADMIN').map((p) => ({ id: p.key, label: `${p.name} (${p.key})` }))}
          />
        </div>
        <div>
          <span className="field-label">Issue type <span className="text-[#DE350B]">*</span></span>
          <SelectPicker variant="field" value={form.type} onChange={(type) => type && setForm({ ...form, type })} options={typeOptions} />
        </div>
      </div>

      <label className="block">
        <span className="field-label">Summary <span className="text-[#DE350B]">*</span></span>
        <input
          autoFocus
          required
          minLength={3}
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
          className="input"
        />
      </label>

      {isEpic && (
        <label className="block">
          <span className="field-label">Epic name</span>
          <input value={form.epicName} onChange={(e) => setForm({ ...form, epicName: e.target.value })} className="input" placeholder="Short name shown on child issues" />
        </label>
      )}

      <div>
        <span className="field-label">Description</span>
        <RichTextEditor
          value={form.description}
          onChange={(description) => setForm((f) => ({ ...f, description }))}
          placeholder="Describe the work. Type @ to mention someone."
          minHeight={110}
        />
      </div>

      <div>
        <span className="field-label">Parent {needsParent && <span className="text-[#DE350B]">*</span>}</span>
        <IssuePicker value={parent} onChange={setParent} placeholder="Search for an epic or story…" />
        {needsParent && <span className="field-help">{project?.key} requires a parent for this issue type.</span>}
        {parent && <span className="field-help">Child issues are created in their parent's project.</span>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="field-label">Assignee</span>
          <UserPicker value={form.assigneeId || undefined} onChange={(id) => setForm({ ...form, assigneeId: id ?? '' })} currentUserId={me?.id} />
        </div>
        <div>
          <span className="field-label">Priority</span>
          <SelectPicker
            variant="field"
            searchable={false}
            value={form.priority}
            onChange={(p) => p && setForm({ ...form, priority: p })}
            options={PRIORITIES.map((p) => ({ id: p, label: p.charAt(0) + p.slice(1).toLowerCase(), icon: <PriorityIcon priority={p} /> }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="field-label">Labels</span>
          <div className="rounded-[3px] border-2 border-jira-border bg-jira-input">
            <MultiPicker
              value={form.labelIds}
              onChange={(labelIds) => setForm({ ...form, labelIds })}
              options={(labels ?? []).map((l) => ({ id: l.id, label: l.name }))}
              placeholder="Select labels"
              onCreate={async (name) => {
                const l = await api.createLabel(name);
                queryClient.invalidateQueries({ queryKey: ['labels'] });
                return { id: l.id, label: l.name };
              }}
              createLabel="Create label"
            />
          </div>
        </div>
        <label className="block">
          <span className="field-label">Original estimate (hours)</span>
          <input type="number" min={0} step={0.5} value={form.estimate} onChange={(e) => setForm({ ...form, estimate: e.target.value })} className="input" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="field-label">Components</span>
          <div className="rounded-[3px] border-2 border-jira-border bg-jira-input">
            <MultiPicker
              value={form.componentIds}
              onChange={(componentIds) => setForm({ ...form, componentIds })}
              options={(components ?? []).map((c) => ({ id: c.id, label: c.name, hint: typeLabel(c.type) }))}
              placeholder="Select components"
              emptyText="This project has no components"
            />
          </div>
        </div>
        <div>
          <span className="field-label">Fix versions</span>
          <div className="rounded-[3px] border-2 border-jira-border bg-jira-input">
            <MultiPicker
              value={form.fixVersionIds}
              onChange={(fixVersionIds) => setForm({ ...form, fixVersionIds })}
              options={(versions ?? []).map((v) => ({ id: v.id, label: v.name }))}
              placeholder="Select versions"
              emptyText="This project has no versions"
            />
          </div>
        </div>
      </div>

      {create.isError && (
        <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(create.error)}</div>
      )}

      <div className="flex items-center justify-between pt-2">
        <label className="flex items-center gap-2 text-sm text-jira-subtle cursor-pointer">
          <input type="checkbox" checked={createAnother} onChange={(e) => setCreateAnother(e.target.checked)} />
          Create another
        </label>
        <div className="flex gap-2">
          {onCancel && <button type="button" onClick={onCancel} className="btn btn-subtle">Cancel</button>}
          <button type="submit" disabled={create.isPending || form.summary.trim().length < 3} className="btn btn-primary">
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </form>
  );
}
