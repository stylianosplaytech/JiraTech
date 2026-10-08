import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Issue } from '../api';
import { TypeBadge } from './Badges';
import IssuePicker from './IssuePicker';

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

export default function IssueLinks({ issue, adding, onAddingChange }: {
  issue: Issue;
  adding: boolean;
  onAddingChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [relation, setRelation] = useState(0);
  const [target, setTarget] = useState<Issue | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['issue'] });
    queryClient.invalidateQueries({ queryKey: ['history', issue.id] });
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
  });

  const groups = new Map<string, { linkId: string; other: NonNullable<Issue['linksFrom']>[number]['target'] }[]>();
  for (const l of issue.linksFrom ?? []) {
    const label = OUTWARD[l.type] ?? l.type;
    groups.set(label, [...(groups.get(label) ?? []), { linkId: l.id, other: l.target }]);
  }
  for (const l of issue.linksTo ?? []) {
    const label = INWARD[l.type] ?? l.type;
    groups.set(label, [...(groups.get(label) ?? []), { linkId: l.id, other: l.source }]);
  }
  const linkedIds = [issue.id, ...[...groups.values()].flat().map((g) => g.other!.id)];

  return (
    <div className="bg-white rounded-lg border border-jira-border p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-500">Linked issues</h3>
        {!adding && (
          <button type="button" onClick={() => onAddingChange(true)} className="text-xs text-jira-blue hover:underline">+ Link issue</button>
        )}
      </div>

      {groups.size === 0 && !adding && <p className="text-sm text-gray-400">No linked issues</p>}

      {[...groups.entries()].map(([label, items]) => (
        <div key={label} className="mb-2">
          <div className="text-xs text-gray-500 mb-1">{label}</div>
          {items.map(({ linkId, other }) => other && (
            <div key={linkId} className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-jira-gray text-sm">
              <TypeBadge type={other.type} />
              <Link to={`/browse/${other.key}`} className="text-jira-blue hover:underline shrink-0">{other.key}</Link>
              <span className="truncate flex-1">{other.summary}</span>
              <button
                type="button"
                onClick={() => remove.mutate(linkId)}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 px-1"
                title="Remove link"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ))}

      {adding && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (target) create.mutate(); }}
          className="mt-2 space-y-2 border-t border-jira-border pt-3"
        >
          <div className="flex gap-2">
            <select
              value={relation}
              onChange={(e) => setRelation(Number(e.target.value))}
              className="border border-jira-border rounded px-2 py-1.5 text-sm"
            >
              {RELATIONS.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
            </select>
            <div className="flex-1">
              <IssuePicker value={target} onChange={setTarget} excludeIds={linkedIds} autoFocus />
            </div>
          </div>
          {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { onAddingChange(false); setTarget(null); }} className="px-3 py-1 border border-jira-border rounded text-sm">Cancel</button>
            <button type="submit" disabled={!target || create.isPending} className="px-3 py-1 bg-jira-blue text-white rounded text-sm disabled:opacity-50">Link</button>
          </div>
        </form>
      )}
    </div>
  );
}
