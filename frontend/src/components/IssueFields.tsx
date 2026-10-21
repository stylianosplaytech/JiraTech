import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatMinutes, isEpicType, type Issue, type UpdateIssuePayload } from '../api';
import { useProject } from '../project';
import { PriorityIcon, StatusBadge, STATUS_LABELS, TypeBadge, typeLabel } from './Badges';
import { ChevronDownIcon } from './Icons';
import { Dropdown } from './ui';
import { MultiPicker, SelectPicker } from './Pickers';
import { InlineText } from './InlineEdit';
import UserPicker from './UserPicker';
import CustomFieldRows from './CustomFieldsPanel';
import { dueStatus, formatDueDate } from '../utils';

/** A due date with how close it is, in red once overdue (unless the issue is closed). */
function DueDateText({ due, closed }: { due: string; closed: boolean }) {
  const status = dueStatus(due);
  return (
    <span>
      {formatDueDate(due)}
      {!closed && <span className={`ml-2 text-xs ${status.overdue ? 'text-[#BF2600] font-semibold' : 'text-jira-muted'}`}>{status.label}</span>}
    </span>
  );
}

export const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];
export const priorityLabel = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();

export const RAG_BUTTON: Record<string, string> = {
  GREEN: 'bg-[#E3FCEF] text-[#006644]',
  AMBER: 'bg-[#FFFAE6] text-[#974F0C]',
  RED: 'bg-[#FFEBE6] text-[#BF2600]',
};

const STATUS_BUTTON: Record<string, string> = {
  BACKLOG: 'bg-[#091E420F] text-jira-navy hover:bg-[#091E4224]',
  TO_DO: 'bg-[#091E420F] text-jira-navy hover:bg-[#091E4224]',
  DOING: 'bg-jira-blue text-white hover:bg-jira-blue-hover',
  CLOSED: 'bg-[#00875A] text-white hover:bg-[#006644]',
};

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-2 py-1">
      <span className="text-jira-subtle font-medium text-[13px] pt-[7px]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Where an issue may go next per its workflow; done statuses are offered twice, as Done and Won't do. */
export function transitionOptions(transitions: { id: string; name: string; category: string }[]) {
  return transitions.flatMap((t) => (t.category === 'CLOSED'
    ? [
      { key: `${t.id}-done`, label: t.name, hint: 'Done' as string | undefined, statusId: t.id, resolution: 'COMPLETED' as string | undefined, category: t.category },
      { key: `${t.id}-rejected`, label: t.name, hint: "Won't do", statusId: t.id, resolution: 'REJECTED', category: t.category },
    ]
    : [{ key: t.id, label: t.name, hint: undefined, statusId: t.id, resolution: undefined, category: t.category }]));
}

/** The status button with a menu of the moves the workflow allows. */
export function StatusDropdown({ issue, canEdit, pending, onTransition }: {
  issue: Issue;
  canEdit: boolean;
  pending?: boolean;
  onTransition: (t: { statusId: string; resolution?: string }) => void;
}) {
  const { data: transitions = [] } = useQuery({
    queryKey: ['transitions', issue.id, issue.workflowStatus?.id],
    queryFn: () => api.getTransitions(issue.id),
    enabled: canEdit,
  });
  return (
    <Dropdown
      width="w-60"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          disabled={pending || !canEdit}
          title={canEdit ? undefined : 'You need member access to change the status'}
          className={`btn font-semibold disabled:opacity-100 disabled:cursor-default ${STATUS_BUTTON[issue.status] ?? 'btn-default'}`}
        >
          {issue.workflowStatus?.name ?? STATUS_LABELS[issue.status] ?? issue.status}
          {canEdit && <ChevronDownIcon size={14} />}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-heading">Move to</div>
          {transitions.length === 0 && (
            <p className="px-3 py-2 text-xs text-jira-muted">The workflow has no transitions out of this status.</p>
          )}
          {transitionOptions(transitions).map((o) => (
            <button
              key={o.key}
              type="button"
              className="menu-item justify-between"
              onClick={() => { close(); onTransition({ statusId: o.statusId, resolution: o.resolution }); }}
            >
              <StatusBadge status={o.category} name={o.label} />
              {o.hint && <span className="text-xs text-jira-muted">{o.hint}</span>}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}

/** The editable rows of an issue's Details panel, shared by the issue page and the board's quick-edit panel. */
export function IssueDetailsFields({
  issue, canEdit, currentUserId, onUpdate, onUpdateRag, onLogTime,
}: {
  issue: Issue;
  canEdit: boolean;
  currentUserId?: string;
  onUpdate: (data: UpdateIssuePayload) => void;
  onUpdateRag: (rag: string) => void;
  /** Without it the time tracking row is read-only. */
  onLogTime?: () => void;
}) {
  const queryClient = useQueryClient();
  const { projectKey } = useProject();
  const sameProject = issue.project?.key === projectKey;
  const { data: labels } = useQuery({ queryKey: ['labels'], queryFn: () => api.getLabels(), enabled: sameProject });
  const { data: components } = useQuery({ queryKey: ['components'], queryFn: () => api.getComponents(), enabled: sameProject });
  const { data: versions } = useQuery({ queryKey: ['versions'], queryFn: () => api.getVersions(), enabled: sameProject });

  const strict = issue.project?.strictHierarchy !== false;
  const epicParent = issue.parent && isEpicType(issue.parent.type) ? issue.parent : null;
  const fixIds = issue.versions?.filter((v) => v.isFix).map((v) => v.versionId) ?? [];
  const affectsIds = issue.versions?.filter((v) => !v.isFix).map((v) => v.versionId) ?? [];
  const versionOptions = (versions ?? []).map((v) => ({ id: v.id, label: v.name, hint: v.released ? 'Released' : undefined }));

  const loggedMinutes = issue.workLogs?.reduce((sum, w) => sum + w.timeSpentMinutes, 0) ?? 0;
  const estimatedMinutes = (issue.estimate ?? 0) * 60;
  const remainingMinutes = issue.remainingEstimate != null ? issue.remainingEstimate * 60 : Math.max(0, estimatedMinutes - loggedMinutes);
  const totalBar = Math.max(estimatedMinutes, loggedMinutes + remainingMinutes, 1);

  return (
    <>
      <DetailRow label="Assignee">
        <UserPicker
          variant="inline"
          disabled={!canEdit}
          value={issue.assignee?.id}
          selected={issue.assignee}
          onChange={(assigneeId) => onUpdate({ assigneeId: assigneeId ?? '' })}
          currentUserId={currentUserId}
        />
      </DetailRow>
      <DetailRow label="Reporter">
        <UserPicker
          variant="inline"
          disabled={!canEdit}
          value={issue.reporter?.id}
          selected={issue.reporter}
          onChange={(reporterId) => reporterId && onUpdate({ reporterId })}
          allowClear={false}
          placeholder="None"
        />
      </DetailRow>
      <DetailRow label="Priority">
        <SelectPicker
          disabled={!canEdit}
          value={issue.priority}
          onChange={(priority) => priority && onUpdate({ priority })}
          searchable={false}
          options={PRIORITIES.map((p) => ({ id: p, label: priorityLabel(p), icon: <PriorityIcon priority={p} /> }))}
        />
      </DetailRow>
      <DetailRow label="Labels">
        <MultiPicker
          disabled={!canEdit}
          commitOnClose
          value={issue.labels?.map((l) => l.label.id) ?? []}
          onChange={(labelIds) => onUpdate({ labelIds })}
          options={(labels ?? []).map((l) => ({ id: l.id, label: l.name }))}
          onCreate={async (name) => {
            const l = await api.createLabel(name);
            queryClient.invalidateQueries({ queryKey: ['labels'] });
            return { id: l.id, label: l.name };
          }}
          createLabel="Create label"
          emptyText="No labels yet — type to create one"
        />
      </DetailRow>
      <DetailRow label="Components">
        <MultiPicker
          disabled={!canEdit}
          commitOnClose
          value={issue.components?.map((c) => c.component.id) ?? []}
          onChange={(componentIds) => onUpdate({ componentIds })}
          options={(components ?? []).map((c) => ({ id: c.id, label: c.name, hint: typeLabel(c.type) }))}
          emptyText="This project has no components"
        />
      </DetailRow>
      <DetailRow label="Fix versions">
        <MultiPicker
          disabled={!canEdit}
          commitOnClose
          value={fixIds}
          onChange={(fixVersionIds) => onUpdate({ fixVersionIds })}
          options={versionOptions}
          emptyText="This project has no versions"
        />
      </DetailRow>
      <DetailRow label="Affects versions">
        <MultiPicker
          disabled={!canEdit}
          commitOnClose
          value={affectsIds}
          onChange={(affectsVersionIds) => onUpdate({ affectsVersionIds })}
          options={versionOptions}
          emptyText="This project has no versions"
        />
      </DetailRow>
      {issue.parent && (
        <DetailRow label={epicParent ? 'Epic' : 'Parent'}>
          <Link to={`/browse/${issue.parent.key}`} className="flex items-center gap-2 px-2 py-[7px] link">
            {issue.parent.type && <TypeBadge type={issue.parent.type} />}
            <span className="truncate">{issue.parent.key} {epicParent?.epicName ?? issue.parent.summary}</span>
          </Link>
        </DetailRow>
      )}
      {isEpicType(issue.type) && (
        <DetailRow label="Epic name">
          <InlineText readOnly={!canEdit} value={issue.epicName ?? ''} onSave={(epicName) => onUpdate({ epicName })} className="mx-0" />
        </DetailRow>
      )}
      {issue.sprint && (
        <DetailRow label="Sprint"><span className="block px-2 py-[7px]">{issue.sprint.name}</span></DetailRow>
      )}
      <DetailRow label="Estimate">
        <InlineText
          readOnly={!canEdit}
          type="number"
          value={issue.estimate != null ? String(issue.estimate) : ''}
          display={issue.estimate != null ? `${issue.estimate}h` : undefined}
          placeholder="None"
          onSave={(v) => v !== '' && onUpdate({ estimate: Number(v) })}
          validate={(v) => (v !== '' && (isNaN(Number(v)) || Number(v) < 0) ? 'Enter hours, e.g. 4 or 1.5' : null)}
          className="mx-0"
        />
      </DetailRow>
      <DetailRow label="Due date">
        <InlineText
          readOnly={!canEdit}
          type="date"
          value={issue.dueDate ? issue.dueDate.slice(0, 10) : ''}
          display={issue.dueDate ? <DueDateText due={issue.dueDate} closed={issue.status === 'CLOSED'} /> : undefined}
          placeholder="None"
          onSave={(dueDate) => onUpdate({ dueDate })}
          className="mx-0"
        />
      </DetailRow>
      <DetailRow label="Time tracking">
        <button
          type="button"
          onClick={onLogTime}
          disabled={!canEdit || !onLogTime}
          className="w-full text-left px-2 py-1.5 rounded-[3px] hover:bg-jira-gray-hover disabled:hover:bg-transparent disabled:cursor-default"
          title={canEdit && onLogTime ? 'Log time' : undefined}
        >
          <div className="h-1.5 rounded-full bg-jira-gray-hover overflow-hidden flex">
            <div className="bg-jira-blue" style={{ width: `${(loggedMinutes / totalBar) * 100}%` }} />
          </div>
          <div className="flex justify-between text-xs text-jira-muted mt-1">
            <span>{loggedMinutes ? `${formatMinutes(loggedMinutes)} logged` : 'No time logged'}</span>
            <span>{formatMinutes(remainingMinutes)} remaining</span>
          </div>
        </button>
      </DetailRow>
      {strict && (
        <DetailRow label="RAG">
          <div className="flex gap-1 px-2 py-1.5">
            {(['GREEN', 'AMBER', 'RED'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onUpdateRag(r)}
                disabled={!canEdit}
                className={`px-2 py-0.5 rounded-[3px] text-xs font-semibold border-2 ${issue.ragStatus === r ? 'border-jira-navy' : 'border-transparent opacity-60 hover:opacity-100'} ${RAG_BUTTON[r]}`}
              >
                {priorityLabel(r)}
              </button>
            ))}
          </div>
        </DetailRow>
      )}
      <DetailRow label="Blocked">
        <label className="flex items-center gap-2 px-2 py-[7px] cursor-pointer">
          <input type="checkbox" disabled={!canEdit} checked={!!issue.blocked} onChange={(e) => onUpdate({ blocked: e.target.checked })} />
          <span className="text-jira-subtle">{issue.blocked ? 'Yes' : 'No'}</span>
        </label>
      </DetailRow>
      <CustomFieldRows issue={issue} Row={DetailRow} readOnly={!canEdit} />
    </>
  );
}
