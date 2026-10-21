import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type Issue } from '../api';
import { useProject } from '../project';
import { CATEGORY_LABELS } from './Badges';
import { SelectPicker } from './Pickers';
import IssuePicker from './IssuePicker';
import { AlertIcon } from './Icons';
import { Modal, Spinner, errorMessage } from './ui';

const dot = (category: string) => (
  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${category === 'CLOSED' ? 'bg-[#36B37E]' : category === 'DOING' ? 'bg-jira-blue' : 'bg-[#97A0AF]'}`} />
);

/** Moves an issue (with its sub-tasks) to another project the user can edit. */
export default function MoveIssueDialog({ issue, onClose, onMoved }: {
  issue: Issue;
  onClose: () => void;
  onMoved: (moved: Issue) => void;
}) {
  const { projects } = useProject();
  const targets = projects.filter((p) => p.key !== issue.project?.key && (p.myRole === 'MEMBER' || p.myRole === 'ADMIN'));
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [requestTypeId, setRequestTypeId] = useState<string | null>(null);
  const [parent, setParent] = useState<Issue | null>(null);

  const { data: preview, isFetching, error } = useQuery({
    queryKey: ['move-preview', issue.id, projectKey],
    queryFn: () => api.getMovePreview(issue.id, projectKey!),
    enabled: !!projectKey,
    retry: false,
  });

  // Start from what the server suggests for the chosen project.
  useEffect(() => {
    setStatusId(preview?.suggestedStatusId ?? null);
    setRequestTypeId(preview?.suggestedRequestTypeId ?? null);
    setParent(null);
  }, [preview]);

  const move = useMutation({
    mutationFn: () => api.moveIssue(issue.id, {
      projectKey: projectKey!,
      statusId: statusId ?? undefined,
      parentId: parent?.id ?? null,
      requestTypeId,
    }),
    onSuccess: onMoved,
  });

  const ready = !!preview && preview.target.key === projectKey && !isFetching;
  const dropped = preview ? [
    ['Components', preview.dropped.components],
    ['Versions', preview.dropped.versions],
    ['Custom fields', preview.dropped.customFields],
    ['Sprint', preview.dropped.sprints],
    ['Program increment', preview.dropped.pis],
  ].filter(([, names]) => names.length) as [string, string[]][] : [];

  return (
    <Modal
      title={`Move ${issue.key}`}
      onClose={onClose}
      width="max-w-xl"
      footer={(
        <>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || move.isPending || (!!preview?.parentRequired && !parent)}
            onClick={() => move.mutate()}
          >
            {move.isPending ? 'Moving…' : 'Move'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <span className="field-label">Move to project</span>
          <SelectPicker
            variant="field"
            value={projectKey}
            onChange={setProjectKey}
            placeholder="Choose a project"
            options={targets.map((p) => ({ id: p.key, label: p.name, hint: p.key }))}
          />
          {targets.length === 0 && (
            <p className="text-xs text-jira-muted mt-1">You aren't a member of any other project, so there is nowhere to move this issue.</p>
          )}
        </div>

        {projectKey && !ready && !error && <Spinner />}
        {error && <p className="text-sm text-[#DE350B]">{errorMessage(error)}</p>}

        {ready && (
          <>
            <p className="text-sm text-jira-subtle">
              It becomes the next {preview.target.key} issue. Links and searches using {issue.key} keep finding it.
            </p>

            <div>
              <span className="field-label">Status in {preview.target.key}</span>
              <SelectPicker
                variant="field"
                value={statusId}
                onChange={(id) => id && setStatusId(id)}
                options={preview.statuses.map((s) => ({ id: s.id, label: s.name, hint: CATEGORY_LABELS[s.category], icon: dot(s.category) }))}
              />
            </div>

            {preview.target.type === 'SERVICE_DESK' && preview.requestTypes.length > 0 && (
              <div>
                <span className="field-label">Request type</span>
                <SelectPicker
                  variant="field"
                  allowClear
                  value={requestTypeId}
                  onChange={setRequestTypeId}
                  options={preview.requestTypes.map((r) => ({ id: r.id, label: r.name }))}
                />
              </div>
            )}

            <div>
              <span className="field-label">
                Parent in {preview.target.key}{preview.parentRequired ? ' (required)' : ' (optional)'}
              </span>
              <IssuePicker
                value={parent}
                onChange={setParent}
                filter={(i) => i.key.startsWith(`${preview.target.key}-`)}
                placeholder={`Search ${preview.target.key} issues…`}
              />
              {preview.currentParent && (
                <p className="text-xs text-jira-muted mt-1">Its current parent, {preview.currentParent.key}, stays where it is.</p>
              )}
              {preview.parentRequired && (
                <p className="text-xs text-jira-muted mt-1">{preview.target.name} requires a parent for every issue except epics.</p>
              )}
            </div>

            {preview.subtasks.length > 0 && (
              <div className="rounded-[3px] bg-jira-gray px-3 py-2 text-sm">
                <p className="font-medium mb-1">
                  {preview.subtasks.length === 1 ? 'Its sub-task moves too:' : `Its ${preview.subtasks.length} sub-tasks move too:`}
                </p>
                <ul className="text-jira-subtle max-h-28 overflow-y-auto">
                  {preview.subtasks.map((s) => <li key={s.id} className="truncate">{s.key} {s.summary}</li>)}
                </ul>
              </div>
            )}

            {dropped.length > 0 && (
              <div className="flex gap-2 rounded-[3px] bg-[#FFFAE6] px-3 py-2 text-sm text-[#172B4D]">
                <AlertIcon size={16} className="text-[#FF8B00] shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{preview.target.name} has no match for these, so they will be cleared:</p>
                  <ul className="mt-1 space-y-0.5">
                    {dropped.map(([label, names]) => (
                      <li key={label}><span className="text-jira-subtle">{label}:</span> {names.join(', ')}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {move.error && <p className="text-sm text-[#DE350B]">{errorMessage(move.error)}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
