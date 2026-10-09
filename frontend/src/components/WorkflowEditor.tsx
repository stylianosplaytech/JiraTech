import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Workflow, type WorkflowStatus } from '../api';
import { CATEGORY_LABELS, StatusBadge } from './Badges';
import { SelectPicker } from './Pickers';
import { InlineText } from './InlineEdit';
import { ChevronDownIcon, PlusIcon, TrashIcon } from './Icons';
import { Modal, errorMessage, useToast } from './ui';

const CATEGORIES = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'] as const;
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c] }));

const pairKey = (from: string, to: string) => `${from}>${to}`;

/** Project admins edit statuses and allowed transitions; everyone else sees the workflow read-only. */
export default function WorkflowEditor({ projectKey, canAdmin }: { projectKey: string; canAdmin: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: wf } = useQuery({ queryKey: ['workflow', projectKey], queryFn: () => api.getWorkflow(projectKey) });
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [newStatus, setNewStatus] = useState({ name: '', category: 'DOING' });
  const [deleting, setDeleting] = useState<WorkflowStatus | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);

  const saved = useMemo(() => new Set(wf?.transitions.map((t) => pairKey(t.fromStatusId, t.toStatusId)) ?? []), [wf]);
  useEffect(() => setDraft(null), [wf]);
  const current = draft ?? saved;
  const dirty = draft !== null && (draft.size !== saved.size || [...draft].some((k) => !saved.has(k)));

  const applied = (w: Workflow) => {
    queryClient.setQueryData(['workflow', projectKey], w);
    queryClient.invalidateQueries({ queryKey: ['board'] });
    queryClient.invalidateQueries({ queryKey: ['transitions'] });
  };
  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ['workflow', projectKey] });
    queryClient.invalidateQueries({ queryKey: ['board'] });
    queryClient.invalidateQueries({ queryKey: ['transitions'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const add = useMutation({
    mutationFn: () => api.addWorkflowStatus(projectKey, { name: newStatus.name.trim(), category: newStatus.category }),
    onSuccess: (s) => { refetch(); setNewStatus({ name: '', category: newStatus.category }); toast(`Status ${s.name} added — allow transitions to and from it below`); },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; category?: string } }) => api.updateWorkflowStatus(projectKey, id, data),
    onSuccess: refetch,
    onError,
  });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.reorderWorkflow(projectKey, ids), onSuccess: applied, onError });
  const remove = useMutation({
    mutationFn: ({ id, to }: { id: string; to?: string }) => api.deleteWorkflowStatus(projectKey, id, to),
    onSuccess: (w) => { applied(w); setDeleting(null); toast('Status deleted'); },
    onError,
  });
  const saveTransitions = useMutation({
    mutationFn: () => api.setWorkflowTransitions(projectKey, [...current].map((k) => {
      const [fromStatusId, toStatusId] = k.split('>');
      return { fromStatusId, toStatusId };
    })),
    onSuccess: (w) => { applied(w); toast('Transitions saved'); },
    onError,
  });

  if (!wf) return null;
  const statuses = wf.statuses;

  const toggle = (from: string, to: string) => {
    const next = new Set(current);
    const k = pairKey(from, to);
    if (next.has(k)) next.delete(k); else next.add(k);
    setDraft(next);
  };
  const move = (i: number, dir: -1 | 1) => {
    const ids = statuses.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder.mutate(ids);
  };
  const outgoing = (id: string) => statuses.filter((s) => current.has(pairKey(id, s.id)));

  return (
    <section>
      <h2 className="text-base font-semibold mb-1">Workflow</h2>
      <p className="text-jira-subtle mb-4">
        The statuses an issue moves through and which moves are allowed. Each status belongs to a category
        (Backlog, To Do, In Progress or Done) used by reports, the dashboard and the <span className="font-mono text-xs">statusCategory</span> search field.
      </p>

      {/* Flow overview */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {statuses.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <StatusBadge status={s.category} name={s.name} />
            {i < statuses.length - 1 && <span className="text-jira-muted" aria-hidden="true">›</span>}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="data-table mb-3">
          <thead>
            <tr>
              {canAdmin && <th className="w-16">Order</th>}
              <th>Status</th>
              <th className="w-44">Category</th>
              <th>Can move to</th>
              <th className="w-20 text-right">Issues</th>
              {canAdmin && <th className="w-12" />}
            </tr>
          </thead>
          <tbody>
            {statuses.map((s, i) => (
              <tr key={s.id}>
                {canAdmin && (
                  <td>
                    <div className="flex">
                      <button type="button" className="btn btn-subtle btn-sm btn-icon" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Move ${s.name} up`}>
                        <ChevronDownIcon size={14} className="rotate-180" />
                      </button>
                      <button type="button" className="btn btn-subtle btn-sm btn-icon" disabled={i === statuses.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Move ${s.name} down`}>
                        <ChevronDownIcon size={14} />
                      </button>
                    </div>
                  </td>
                )}
                <td>
                  <div className="flex items-center gap-2">
                    {i === 0 && <span className="lozenge bg-jira-gray-hover text-jira-subtle" title="New issues start here">Start</span>}
                    <div className="flex-1 min-w-0">
                      <InlineText
                        readOnly={!canAdmin}
                        value={s.name}
                        onSave={(name) => update.mutate({ id: s.id, data: { name } })}
                        validate={(v) => (!v ? 'Name is required' : null)}
                        className="mx-0 font-medium"
                      />
                    </div>
                  </div>
                </td>
                <td>
                  <SelectPicker
                    disabled={!canAdmin}
                    searchable={false}
                    value={s.category}
                    onChange={(category) => category && category !== s.category && update.mutate({ id: s.id, data: { category } })}
                    options={CATEGORY_OPTIONS}
                  />
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {outgoing(s.id).map((t) => <StatusBadge key={t.id} status={t.category} name={t.name} />)}
                    {outgoing(s.id).length === 0 && <span className="text-xs text-[#974F0C]">No way out</span>}
                  </div>
                </td>
                <td className="text-right">{s.issueCount ?? 0}</td>
                {canAdmin && (
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-subtle btn-sm btn-icon"
                      disabled={statuses.length <= 1}
                      aria-label={`Delete status ${s.name}`}
                      onClick={() => { setDeleting(s); setMoveTo(statuses.find((x) => x.id !== s.id)?.id ?? null); }}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canAdmin && (
        <form onSubmit={(e) => { e.preventDefault(); if (newStatus.name.trim()) add.mutate(); }} className="flex items-end gap-2 mb-8">
          <label className="w-64">
            <span className="field-label">New status</span>
            <input className="input" value={newStatus.name} onChange={(e) => setNewStatus({ ...newStatus, name: e.target.value })} placeholder="e.g. In Review" />
          </label>
          <div className="w-44">
            <span className="field-label">Category</span>
            <SelectPicker variant="field" searchable={false} value={newStatus.category} onChange={(c) => c && setNewStatus({ ...newStatus, category: c })} options={CATEGORY_OPTIONS} />
          </div>
          <button type="submit" className="btn btn-default h-9" disabled={!newStatus.name.trim() || add.isPending}><PlusIcon size={14} /> Add status</button>
        </form>
      )}

      <h3 className="text-sm font-semibold mb-1">Allowed transitions</h3>
      <p className="text-xs text-jira-muted mb-2">Tick a cell to allow moving an issue from the row's status to the column's status.</p>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left text-xs font-semibold text-jira-subtle px-2 py-2">From ↓ / To →</th>
              {statuses.map((s) => (
                <th key={s.id} className="px-2 py-2 text-center"><StatusBadge status={s.category} name={s.name} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statuses.map((from) => (
              <tr key={from.id} className="border-t border-jira-border">
                <th className="text-left px-2 py-2 font-normal"><StatusBadge status={from.category} name={from.name} /></th>
                {statuses.map((to) => (
                  <td key={to.id} className="text-center px-2 py-2">
                    {from.id === to.id ? <span className="text-jira-border" aria-hidden="true">—</span> : (
                      <input
                        type="checkbox"
                        disabled={!canAdmin}
                        checked={current.has(pairKey(from.id, to.id))}
                        onChange={() => toggle(from.id, to.id)}
                        aria-label={`Allow ${from.name} to ${to.name}`}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canAdmin && (
        <div className="flex items-center gap-2 mt-3">
          <button type="button" className="btn btn-primary" disabled={!dirty || saveTransitions.isPending} onClick={() => saveTransitions.mutate()}>Save transitions</button>
          <button
            type="button"
            className="btn btn-subtle"
            onClick={() => setDraft(new Set(statuses.flatMap((a) => statuses.filter((b) => b.id !== a.id).map((b) => pairKey(a.id, b.id)))))}
          >
            Allow all
          </button>
          {dirty && <button type="button" className="btn btn-subtle" onClick={() => setDraft(null)}>Discard changes</button>}
          {dirty && <span className="text-xs text-[#974F0C]">Unsaved changes</span>}
        </div>
      )}

      {deleting && (
        <Modal
          title={`Delete status “${deleting.name}”?`}
          onClose={() => setDeleting(null)}
          width="max-w-md"
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setDeleting(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={remove.isPending || (!!deleting.issueCount && !moveTo)}
                onClick={() => remove.mutate({ id: deleting.id, to: deleting.issueCount ? moveTo ?? undefined : undefined })}
              >
                Delete status
              </button>
            </>
          )}
        >
          {deleting.issueCount ? (
            <div className="space-y-3">
              <p>{deleting.issueCount} issue{deleting.issueCount === 1 ? ' is' : 's are'} in this status. Move {deleting.issueCount === 1 ? 'it' : 'them'} to:</p>
              <SelectPicker
                variant="field"
                searchable={false}
                value={moveTo}
                onChange={setMoveTo}
                options={statuses.filter((s) => s.id !== deleting.id).map((s) => ({ id: s.id, label: s.name, hint: CATEGORY_LABELS[s.category] }))}
              />
            </div>
          ) : (
            <p>No issues use this status. Its transitions will be removed too.</p>
          )}
        </Modal>
      )}
    </section>
  );
}
