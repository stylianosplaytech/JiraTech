import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Issue } from '../api';
import { StatusBadge, TypeBadge } from './Badges';
import { PlusIcon, XIcon } from './Icons';
import IssuePicker from './IssuePicker';
import { errorMessage, useToast } from './ui';

// Each option is stored as one link type; "inward" options create the link from the other issue.
const RELATIONS = [
  { label: 'blocks', type: 'BLOCKS', inward: false },
  { label: 'is blocked by', type: 'BLOCKS', inward: true },
  { label: 'depends on', type: 'DEPENDS_ON', inward: false },
  { label: 'is depended on by', type: 'DEPENDS_ON', inward: true },
  { label: 'relates to', type: 'RELATES_TO', inward: false },
];

const OUTWARD: Record<string, string> = {
  BLOCKS: 'blocks', DEPENDS_ON: 'depends on', RELATES_TO: 'relates to', PARENT_LINK: 'is parent of',
};
const INWARD: Record<string, string> = {
  BLOCKS: 'is blocked by', DEPENDS_ON: 'is depended on by', RELATES_TO: 'relates to', PARENT_LINK: 'is child of',
};

type LinkedIssue = { id: string; key: string; summary: string; type: string; status?: string; workflowStatus?: { name: string } | null };

export default function IssueLinks({ issue, adding, onAddingChange, readOnly }: {
  issue: Issue;
  adding: boolean;
  onAddingChange: (v: boolean) => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [relation, setRelation] = useState(0);
  const [target, setTarget] = useState<Issue | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['issue'] });
    queryClient.invalidateQueries({ queryKey: ['history'] });
  };

  const create = useMutation({
    mutationFn: () => {
      const r = RELATIONS[relation];
      return r.inward
        ? api.createLink(target!.id, { targetId: issue.id }, r.type)
        : api.createLink(issue.id, { targetId: target!.id }, r.type);
    },
    onSuccess: () => { refresh(); setTarget(null); onAddingChange(false); },
  });
  const remove = useMutation({
    mutationFn: (linkId: string) => api.deleteLink(issue.id, linkId),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const groups = new Map<string, { linkId: string; other: LinkedIssue }[]>();
  for (const l of issue.linksFrom ?? []) {
    if (!l.target) continue;
    const label = OUTWARD[l.type] ?? l.type;
    groups.set(label, [...(groups.get(label) ?? []), { linkId: l.id, other: l.target }]);
  }
  for (const l of issue.linksTo ?? []) {
    if (!l.source) continue;
    const label = INWARD[l.type] ?? l.type;
    groups.set(label, [...(groups.get(label) ?? []), { linkId: l.id, other: l.source }]);
  }
  const linkedIds = [issue.id, ...[...groups.values()].flat().map((g) => g.other.id)];
  const total = [...groups.values()].reduce((n, g) => n + g.length, 0);

  if (total === 0 && !adding) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-jira-navy">Linked issues</h2>
        {!adding && !readOnly && (
          <button type="button" onClick={() => onAddingChange(true)} className="btn btn-subtle btn-sm btn-icon" aria-label="Link an issue">
            <PlusIcon size={16} />
          </button>
        )}
      </div>

      {adding && !readOnly && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (target) create.mutate(); }}
          className="card p-3 mb-3 space-y-3"
        >
          <div className="flex gap-2">
            <select
              value={relation}
              onChange={(e) => setRelation(Number(e.target.value))}
              className="input w-44 shrink-0"
              aria-label="Link type"
            >
              {RELATIONS.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
            </select>
            <div className="flex-1 min-w-0">
              <IssuePicker value={target} onChange={setTarget} excludeIds={linkedIds} autoFocus />
            </div>
          </div>
          {create.isError && <p className="field-error">{errorMessage(create.error)}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { onAddingChange(false); setTarget(null); }} className="btn btn-subtle">Cancel</button>
            <button type="submit" disabled={!target || create.isPending} className="btn btn-primary">Link</button>
          </div>
        </form>
      )}

      {[...groups.entries()].map(([label, items]) => (
        <div key={label} className="mb-3">
          <div className="text-xs font-semibold text-jira-subtle mb-1">{label}</div>
          <div className="card divide-y divide-jira-border">
            {items.map(({ linkId, other }) => (
              <div key={linkId} className="group flex items-center gap-3 px-3 py-2 hover:bg-jira-gray">
                <TypeBadge type={other.type} />
                <Link to={`/browse/${other.key}`} className={`link shrink-0 ${other.status === 'CLOSED' ? 'line-through' : ''}`}>{other.key}</Link>
                <Link to={`/browse/${other.key}`} className="truncate flex-1 hover:underline">{other.summary}</Link>
                {other.status && <StatusBadge status={other.status} name={other.workflowStatus?.name} />}
                {!readOnly && <button
                  type="button"
                  onClick={() => remove.mutate(linkId)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-jira-muted hover:text-jira-navy"
                  title="Remove link"
                  aria-label={`Remove link to ${other.key}`}
                >
                  <XIcon size={14} />
                </button>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
