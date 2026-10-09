import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BulkRequest, type BulkResult, type Issue } from '../api';
import { MultiPicker, SelectPicker } from './Pickers';
import { CATEGORY_LABELS, PriorityIcon } from './Badges';
import UserPicker from './UserPicker';
import { EditIcon, EyeIcon, TrashIcon, XIcon } from './Icons';
import { Modal, errorMessage, useDialogs, useToast } from './ui';

const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];
type Dialog = 'edit' | 'transition' | null;

function NotifySwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-jira-subtle cursor-pointer">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Send notifications to watchers
    </label>
  );
}

/** Bar shown above the results when issues are selected, with the bulk-change dialogs. */
export default function BulkActions({ selected, onClear }: { selected: Issue[]; onClear: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [result, setResult] = useState<{ title: string; data: BulkResult } | null>(null);
  const [notify, setNotify] = useState(true);

  // Edit form
  const [assignee, setAssignee] = useState<'keep' | 'unassign' | 'set'>('keep');
  const [assigneeId, setAssigneeId] = useState<string | undefined>();
  const [priority, setPriority] = useState<string | null>(null);
  const [addLabels, setAddLabels] = useState<string[]>([]);
  const [removeLabels, setRemoveLabels] = useState<string[]>([]);
  const [addComponents, setAddComponents] = useState<string[]>([]);
  const [addVersions, setAddVersions] = useState<string[]>([]);
  // Transition form
  const [statusName, setStatusName] = useState<string | null>(null);
  const [resolution, setResolution] = useState('COMPLETED');

  const projectKeys = useMemo(() => [...new Set(selected.map((i) => i.project?.key).filter(Boolean) as string[])], [selected]);
  const singleProject = projectKeys.length === 1 ? projectKeys[0] : null;

  // Project-specific lists are only offered when every selected issue is in one project.
  const { data: labels } = useQuery({ queryKey: ['labels', 'bulk', singleProject], queryFn: () => api.getLabels(singleProject!), enabled: dialog === 'edit' && !!singleProject });
  const { data: components } = useQuery({ queryKey: ['components', 'bulk', singleProject], queryFn: () => api.getComponents(undefined, singleProject!), enabled: dialog === 'edit' && !!singleProject });
  const { data: versions } = useQuery({ queryKey: ['versions', 'bulk', singleProject], queryFn: () => api.getVersions(singleProject!), enabled: dialog === 'edit' && !!singleProject });
  const workflows = useQueries({
    queries: projectKeys.map((key) => ({ queryKey: ['workflow', key], queryFn: () => api.getWorkflow(key), enabled: dialog === 'transition' })),
  });

  // Status names across the selected projects; note how many projects have each one.
  const statusOptions = useMemo(() => {
    const byName = new Map<string, { category: string; projects: number }>();
    for (const w of workflows) {
      for (const s of w.data?.statuses ?? []) {
        const e = byName.get(s.name);
        byName.set(s.name, { category: s.category, projects: (e?.projects ?? 0) + 1 });
      }
    }
    return [...byName.entries()].map(([name, v]) => ({
      id: name,
      label: name,
      category: v.category,
      hint: projectKeys.length > 1 && v.projects < projectKeys.length ? `${v.projects}/${projectKeys.length} projects` : CATEGORY_LABELS[v.category],
    }));
  }, [workflows, projectKeys.length]);
  const targetCategory = statusOptions.find((o) => o.id === statusName)?.category;

  const run = useMutation({
    mutationFn: (req: Omit<BulkRequest, 'issueIds'>) => api.bulkChange({ ...req, issueIds: selected.map((i) => i.id) }),
    onSuccess: (data, req) => {
      queryClient.invalidateQueries({ queryKey: ['search'] });
      queryClient.invalidateQueries({ queryKey: ['issue'] });
      queryClient.invalidateQueries({ queryKey: ['board'] });
      setDialog(null);
      const verb = { edit: 'Updated', transition: 'Moved', watch: 'Watching', delete: 'Deleted' }[req.action];
      if (data.failed.length) {
        setResult({ title: `${verb} ${data.succeeded.length} of ${selected.length} issues`, data });
      } else {
        toast(`${verb} ${data.succeeded.length} issue${data.succeeded.length === 1 ? '' : 's'}`);
      }
      onClear();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const openEdit = () => {
    setAssignee('keep'); setAssigneeId(undefined); setPriority(null);
    setAddLabels([]); setRemoveLabels([]); setAddComponents([]); setAddVersions([]);
    setNotify(true); setDialog('edit');
  };
  const openTransition = () => { setStatusName(null); setResolution('COMPLETED'); setNotify(true); setDialog('transition'); };

  const editRequest = (): Omit<BulkRequest, 'issueIds'> => ({
    action: 'edit',
    notify,
    ...(assignee === 'unassign' ? { assigneeId: null } : assignee === 'set' && assigneeId ? { assigneeId } : {}),
    ...(priority ? { priority } : {}),
    ...(addLabels.length ? { addLabelIds: addLabels } : {}),
    ...(removeLabels.length ? { removeLabelIds: removeLabels } : {}),
    ...(addComponents.length ? { addComponentIds: addComponents } : {}),
    ...(addVersions.length ? { addFixVersionIds: addVersions } : {}),
  });
  const editChosen = Object.keys(editRequest()).length > 2;

  const n = selected.length;
  const label = `${n} issue${n === 1 ? '' : 's'}`;

  return (
    <>
      <div className="sticky top-14 z-30 flex items-center gap-2 mb-3 rounded-[3px] bg-jira-navy text-white px-3 py-2 shadow-card" role="toolbar" aria-label="Bulk actions">
        <span className="font-medium mr-2">{n} selected</span>
        <button type="button" className="btn btn-sm bg-white/10 hover:bg-white/20 text-white" onClick={openEdit}><EditIcon size={13} /> Edit</button>
        <button type="button" className="btn btn-sm bg-white/10 hover:bg-white/20 text-white" onClick={openTransition}>Change status</button>
        <button type="button" className="btn btn-sm bg-white/10 hover:bg-white/20 text-white" disabled={run.isPending} onClick={() => run.mutate({ action: 'watch' })}><EyeIcon size={13} /> Watch</button>
        <button
          type="button"
          className="btn btn-sm bg-white/10 hover:bg-[#DE350B] text-white"
          disabled={run.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: `Delete ${label}?`,
              message: 'Each issue is deleted with its comments, history, links, work logs and attachments. Issues you are not allowed to delete, or that still have child issues, are skipped. This can\'t be undone.',
              confirmLabel: `Delete ${label}`,
              danger: true,
            });
            if (ok) run.mutate({ action: 'delete' });
          }}
        >
          <TrashIcon size={13} /> Delete
        </button>
        <button type="button" className="btn btn-sm btn-icon ml-auto bg-transparent hover:bg-white/10 text-white" onClick={onClear} aria-label="Clear selection"><XIcon size={14} /></button>
      </div>

      {dialog === 'edit' && (
        <Modal
          title={`Edit ${label}`}
          onClose={() => setDialog(null)}
          width="max-w-xl"
          footer={(
            <div className="flex items-center justify-between w-full">
              <NotifySwitch value={notify} onChange={setNotify} />
              <div className="flex gap-2">
                <button type="button" className="btn btn-subtle" onClick={() => setDialog(null)}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={!editChosen || run.isPending} onClick={() => run.mutate(editRequest())}>
                  {run.isPending ? 'Applying…' : `Apply to ${label}`}
                </button>
              </div>
            </div>
          )}
        >
          <p className="text-jira-subtle mb-4">Only the fields you change are updated; everything else stays as it is on each issue.</p>
          <div className="space-y-4">
            <div>
              <span className="field-label">Assignee</span>
              <div className="flex gap-2">
                <div className="w-40">
                  <SelectPicker
                    variant="field"
                    searchable={false}
                    value={assignee}
                    onChange={(v) => v && setAssignee(v as typeof assignee)}
                    options={[{ id: 'keep', label: 'Keep current' }, { id: 'set', label: 'Change to…' }, { id: 'unassign', label: 'Unassign' }]}
                  />
                </div>
                {assignee === 'set' && <div className="flex-1"><UserPicker value={assigneeId} onChange={setAssigneeId} allowClear={false} placeholder="Choose a person" /></div>}
              </div>
            </div>
            <div>
              <span className="field-label">Priority</span>
              <div className="w-56">
                <SelectPicker
                  variant="field"
                  searchable={false}
                  allowClear
                  clearLabel="Keep current"
                  placeholder="Keep current"
                  value={priority}
                  onChange={setPriority}
                  options={PRIORITIES.map((p) => ({ id: p, label: p.charAt(0) + p.slice(1).toLowerCase(), icon: <PriorityIcon priority={p} /> }))}
                />
              </div>
            </div>
            {singleProject ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="field-label">Add labels</span>
                    <div className="rounded-[3px] border-2 border-jira-border bg-jira-input">
                      <MultiPicker value={addLabels} onChange={setAddLabels} options={(labels ?? []).map((l) => ({ id: l.id, label: l.name }))} placeholder="None" />
                    </div>
                  </div>
                  <div>
                    <span className="field-label">Remove labels</span>
                    <div className="rounded-[3px] border-2 border-jira-border bg-jira-input">
                      <MultiPicker value={removeLabels} onChange={setRemoveLabels} options={(labels ?? []).map((l) => ({ id: l.id, label: l.name }))} placeholder="None" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="field-label">Add components</span>
                    <div className="rounded-[3px] border-2 border-jira-border bg-jira-input">
                      <MultiPicker value={addComponents} onChange={setAddComponents} options={(components ?? []).map((c) => ({ id: c.id, label: c.name }))} placeholder="None" emptyText="This project has no components" />
                    </div>
                  </div>
                  <div>
                    <span className="field-label">Add fix versions</span>
                    <div className="rounded-[3px] border-2 border-jira-border bg-jira-input">
                      <MultiPicker value={addVersions} onChange={setAddVersions} options={(versions ?? []).map((v) => ({ id: v.id, label: v.name }))} placeholder="None" emptyText="This project has no versions" />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="rounded-[3px] bg-jira-gray px-3 py-2 text-xs text-jira-subtle">
                Labels, components and versions belong to a project. Select issues from a single project to change them
                (your selection spans {projectKeys.join(', ')}).
              </p>
            )}
          </div>
        </Modal>
      )}

      {dialog === 'transition' && (
        <Modal
          title={`Change the status of ${label}`}
          onClose={() => setDialog(null)}
          width="max-w-md"
          footer={(
            <div className="flex items-center justify-between w-full">
              <NotifySwitch value={notify} onChange={setNotify} />
              <div className="flex gap-2">
                <button type="button" className="btn btn-subtle" onClick={() => setDialog(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!statusName || run.isPending}
                  onClick={() => run.mutate({ action: 'transition', statusName: statusName!, notify, ...(targetCategory === 'CLOSED' ? { resolution } : {}) })}
                >
                  {run.isPending ? 'Moving…' : 'Move issues'}
                </button>
              </div>
            </div>
          )}
        >
          <div className="space-y-4">
            <div>
              <span className="field-label">New status</span>
              <SelectPicker
                variant="field"
                value={statusName}
                onChange={setStatusName}
                placeholder="Choose a status"
                options={statusOptions.map((o) => ({ id: o.id, label: o.label, hint: o.hint, icon: <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${o.category === 'CLOSED' ? 'bg-[#36B37E]' : o.category === 'DOING' ? 'bg-jira-blue' : 'bg-[#97A0AF]'}`} /> }))}
              />
            </div>
            {targetCategory === 'CLOSED' && (
              <div>
                <span className="field-label">Resolution</span>
                <SelectPicker
                  variant="field"
                  searchable={false}
                  value={resolution}
                  onChange={(r) => r && setResolution(r)}
                  options={[{ id: 'COMPLETED', label: 'Done' }, { id: 'REJECTED', label: "Won't do" }]}
                />
              </div>
            )}
            <p className="text-xs text-jira-muted">
              Each issue follows its own project's workflow. Issues that can't move to this status from where they are,
              or that you can't edit, are skipped and listed afterwards.
            </p>
          </div>
        </Modal>
      )}

      {result && (
        <Modal title={result.title} onClose={() => setResult(null)} width="max-w-lg" footer={<button type="button" className="btn btn-primary" onClick={() => setResult(null)}>Close</button>}>
          <p className="mb-3 text-jira-subtle">These issues were not changed:</p>
          <ul className="divide-y divide-jira-border border border-jira-border rounded-[3px] max-h-72 overflow-y-auto">
            {result.data.failed.map((f) => (
              <li key={f.id} className="px-3 py-2">
                <span className="font-medium text-jira-blue mr-2">{f.key}</span>
                <span className="text-sm">{f.error}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
