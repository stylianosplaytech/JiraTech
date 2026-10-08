import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatMinutes, isEpicType, type UpdateIssuePayload } from '../api';
import { useProject } from '../project';
import { timeAgo } from '../utils';
import { PriorityIcon, StatusBadge, STATUS_LABELS, TypeBadge, typeLabel } from '../components/Badges';
import {
  ChevronDownIcon, ClockIcon, CopyIcon, EyeIcon, LinkIcon, MoreIcon, PaperclipIcon, SubtaskIcon, TrashIcon, XIcon,
} from '../components/Icons';
import { Dropdown, EmptyState, Modal, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';
import { MultiPicker, SelectPicker } from '../components/Pickers';
import { InlineText, InlineTextarea } from '../components/InlineEdit';
import UserPicker from '../components/UserPicker';
import Avatar from '../components/Avatar';
import CustomFieldRows from '../components/CustomFieldsPanel';
import IssueLinks from '../components/IssueLinks';
import ActivitySection from '../components/ActivitySection';

const TRANSITIONS: Record<string, { status: string; label: string; resolution?: string }[]> = {
  BACKLOG: [{ status: 'TO_DO', label: 'Select for work' }],
  TO_DO: [
    { status: 'DOING', label: 'Start progress' },
    { status: 'BACKLOG', label: 'Move to backlog' },
  ],
  DOING: [
    { status: 'CLOSED', label: 'Done', resolution: 'COMPLETED' },
    { status: 'CLOSED', label: 'Reject', resolution: 'REJECTED' },
    { status: 'TO_DO', label: 'Stop progress' },
  ],
  CLOSED: [{ status: 'TO_DO', label: 'Re-open' }],
};

const STATUS_BUTTON: Record<string, string> = {
  BACKLOG: 'bg-[#091E420F] text-jira-navy hover:bg-[#091E4224]',
  TO_DO: 'bg-[#091E420F] text-jira-navy hover:bg-[#091E4224]',
  DOING: 'bg-jira-blue text-white hover:bg-jira-blue-hover',
  CLOSED: 'bg-[#00875A] text-white hover:bg-[#006644]',
};

const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-2 py-1">
      <span className="text-jira-subtle font-medium text-[13px] pt-[7px]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-jira-navy">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function IssueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { projectKey, setProjectKey } = useProject();

  const [addingLink, setAddingLink] = useState(false);
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [logTimeForm, setLogTimeForm] = useState({ hours: '', minutes: '30', comment: '' });

  const { data: currentUser } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: issue, isLoading, error } = useQuery({
    queryKey: ['issue', id],
    queryFn: () => api.getIssue(id!),
    enabled: !!id,
    retry: false,
  });

  // Labels, components and versions are per project: follow the issue's project.
  useEffect(() => {
    if (issue?.project && issue.project.key !== projectKey) setProjectKey(issue.project.key);
  }, [issue?.project, projectKey, setProjectKey]);

  // Opening an issue counts as reading its notifications.
  const issueId = issue?.id;
  useEffect(() => {
    if (!issueId) return;
    api.markIssueNotificationsRead(issueId)
      .then((r) => queryClient.setQueryData(['notifications', 'count'], r))
      .catch(() => undefined);
  }, [issueId, queryClient]);

  const sameProject = issue?.project?.key === projectKey;
  const { data: labels } = useQuery({ queryKey: ['labels'], queryFn: () => api.getLabels(), enabled: sameProject });
  const { data: components } = useQuery({ queryKey: ['components'], queryFn: () => api.getComponents(), enabled: sameProject });
  const { data: versions } = useQuery({ queryKey: ['versions'], queryFn: () => api.getVersions(), enabled: sameProject });
  const { data: teams } = useQuery({ queryKey: ['components', 'TEAM'], queryFn: () => api.getComponents('TEAM'), enabled: sameProject });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['issue'] });
    queryClient.invalidateQueries({ queryKey: ['history'] });
    queryClient.invalidateQueries({ queryKey: ['search'] });
    queryClient.invalidateQueries({ queryKey: ['board'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const update = useMutation({
    mutationFn: (data: UpdateIssuePayload) => api.updateIssue(id!, data),
    onSuccess: refresh,
    onError,
  });
  const transition = useMutation({
    mutationFn: ({ status, resolution }: { status: string; resolution?: string }) => api.transitionIssue(id!, status, resolution),
    onSuccess: refresh,
    onError,
  });
  const escalate = useMutation({
    mutationFn: ({ action, toTeam }: { action: string; toTeam?: string }) => api.escalate(issue!.id, action, toTeam),
    onSuccess: () => { refresh(); toast('Incident updated'); },
    onError,
  });
  const updateRag = useMutation({ mutationFn: (rag: string) => api.updateRag(issue!.id, rag), onSuccess: refresh, onError });
  const watch = useMutation({
    mutationFn: (on: boolean) => (on ? api.addWatcher(issue!.id) : api.removeWatcher(issue!.id, currentUser!.id)),
    onSuccess: refresh,
    onError,
  });
  const addWatcher = useMutation({ mutationFn: (userId: string) => api.addWatcher(issue!.id, userId), onSuccess: refresh, onError });
  const removeWatcher = useMutation({ mutationFn: (userId: string) => api.removeWatcher(issue!.id, userId), onSuccess: refresh, onError });
  const logTime = useMutation({
    mutationFn: () => {
      const mins = parseInt(logTimeForm.hours || '0', 10) * 60 + parseInt(logTimeForm.minutes || '0', 10);
      return api.createWorkLog(id!, mins, logTimeForm.comment || undefined);
    },
    onSuccess: () => {
      refresh();
      setLogTimeOpen(false);
      setLogTimeForm({ hours: '', minutes: '30', comment: '' });
      toast('Time logged');
    },
    onError,
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadAttachment(id!, file),
    onSuccess: (_d, file) => { refresh(); toast(`Attached ${file.name}`); },
    onError,
  });
  const deleteAttachment = useMutation({ mutationFn: (aid: string) => api.deleteAttachment(id!, aid), onSuccess: refresh, onError });
  const deleteIssue = useMutation({
    mutationFn: () => api.deleteIssue(id!),
    onSuccess: (r) => {
      queryClient.removeQueries({ queryKey: ['issue', id] });
      queryClient.invalidateQueries({ queryKey: ['search'] });
      toast(`${r.key} deleted`);
      navigate('/search');
    },
    onError,
  });

  if (isLoading) return <Spinner />;
  if (!issue) {
    return (
      <EmptyState title="Issue not found" action={<Link to="/search" className="btn btn-default">Back to issues</Link>}>
        {error ? errorMessage(error) : `${id} does not exist or was deleted.`}
      </EmptyState>
    );
  }

  const strict = issue.project?.strictHierarchy !== false;
  const isIncident = strict && (issue.type === 'DEFECT' || issue.type === 'TASK');
  const epicParent = issue.parent && isEpicType(issue.parent.type) ? issue.parent : null;
  const transitions = TRANSITIONS[issue.status] ?? [];
  const isWatching = issue.watchers?.some((w) => w.userId === currentUser?.id) ?? false;
  // The server sends what this user may do in the issue's project.
  const canEdit = issue.permissions?.canEdit ?? false;
  const canDelete = issue.permissions?.canDelete ?? false;
  const roleName = issue.permissions?.role === 'VIEWER' ? 'viewer' : 'limited';

  const fixIds = issue.versions?.filter((v) => v.isFix).map((v) => v.versionId) ?? [];
  const affectsIds = issue.versions?.filter((v) => !v.isFix).map((v) => v.versionId) ?? [];
  const versionOptions = (versions ?? []).map((v) => ({ id: v.id, label: v.name, hint: v.released ? 'Released' : undefined }));

  const loggedMinutes = issue.workLogs?.reduce((sum, w) => sum + w.timeSpentMinutes, 0) ?? 0;
  const estimatedMinutes = (issue.estimate ?? 0) * 60;
  const remainingMinutes = issue.remainingEstimate != null ? issue.remainingEstimate * 60 : Math.max(0, estimatedMinutes - loggedMinutes);
  const totalBar = Math.max(estimatedMinutes, loggedMinutes + remainingMinutes, 1);

  const children = issue.children ?? [];
  const doneChildren = children.filter((c) => c.status === 'CLOSED').length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/browse/${issue.key}`);
      toast('Link copied');
    } catch {
      toast('Could not copy the link', 'error');
    }
  };

  const confirmDelete = async () => {
    const ok = await confirm({
      title: `Delete ${issue.key}?`,
      message: 'This permanently deletes the issue with its comments, history, links, work logs and attachments. You can\'t undo this.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteIssue.mutate();
  };

  return (
    <div>
      {/* Breadcrumbs + top-right actions */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <nav className="flex items-center gap-1.5 text-sm text-jira-subtle min-w-0" aria-label="Breadcrumb">
          <Link to="/projects" className="hover:underline">Projects</Link>
          <span>/</span>
          {issue.project && <Link to={`/projects/${issue.project.key}`} className="hover:underline truncate">{issue.project.name}</Link>}
          {issue.parent && (
            <>
              <span>/</span>
              <Link to={`/browse/${issue.parent.key}`} className="inline-flex items-center gap-1 hover:underline">
                {issue.parent.type && <TypeBadge type={issue.parent.type} />}{issue.parent.key}
              </Link>
            </>
          )}
          <span>/</span>
          <span className="inline-flex items-center gap-1 text-jira-navy">
            <TypeBadge type={issue.type} />
            <span>{issue.key}</span>
          </span>
        </nav>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => watch.mutate(!isWatching)}
            className={`btn btn-sm ${isWatching ? 'bg-jira-blue-light text-jira-blue hover:bg-[#B3D4FF]' : 'btn-subtle'}`}
            title={isWatching ? 'Stop watching' : 'Start watching'}
          >
            <EyeIcon size={14} /> {issue.watchers?.length ?? 0}
          </button>
          <button type="button" onClick={copyLink} className="btn btn-subtle btn-sm btn-icon" title="Copy link"><CopyIcon size={14} /></button>
          <Dropdown
            align="right"
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className="btn btn-subtle btn-sm btn-icon" aria-label="More actions"><MoreIcon /></button>
            )}
          >
            {(close) => (
              <>
                {canEdit && (
                  <>
                    <button type="button" className="menu-item" onClick={() => { close(); setLogTimeOpen(true); }}><ClockIcon size={14} /> Log time</button>
                    <button type="button" className="menu-item" onClick={() => { close(); navigate(`/issues/new?parentId=${issue.id}&type=SUB_TASK`); }}><SubtaskIcon size={14} /> Create sub-task</button>
                    <button type="button" className="menu-item" onClick={() => { close(); setAddingLink(true); }}><LinkIcon size={14} /> Link issue</button>
                  </>
                )}
                <button type="button" className="menu-item" onClick={() => { close(); void copyLink(); }}><CopyIcon size={14} /> Copy link</button>
                {canDelete && (
                  <button type="button" className="menu-item text-[#DE350B] border-t border-jira-border mt-1" onClick={() => { close(); void confirmDelete(); }}>
                    <TrashIcon size={14} /> Delete
                  </button>
                )}
              </>
            )}
          </Dropdown>
        </div>
      </div>

      {!canEdit && (
        <div className="flex items-start gap-2 rounded-[3px] bg-jira-blue-light text-[#0747A6] px-4 py-3 mb-4" role="status">
          <span className="font-semibold">View only.</span>
          <span>Your {roleName} access to {issue.project?.name ?? 'this project'} lets you read, comment on and watch this issue. Ask a project administrator for member access to change it.</span>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_440px] gap-8">
        {/* ─── Main column ─── */}
        <div className="min-w-0">
          <InlineText
            readOnly={!canEdit}
            value={issue.summary}
            onSave={(summary) => update.mutate({ summary })}
            className="text-2xl font-medium leading-tight"
            inputClassName="text-2xl font-medium h-11"
            validate={(v) => (v.length < 3 ? 'Summary must be at least 3 characters' : null)}
          />

          {canEdit && <div className="flex flex-wrap gap-2 mt-3 mb-6">
            <button type="button" className="btn btn-default" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
              <PaperclipIcon size={14} /> {upload.isPending ? 'Uploading…' : 'Attach'}
            </button>
            <button type="button" className="btn btn-default" onClick={() => navigate(`/issues/new?parentId=${issue.id}&type=SUB_TASK`)}>
              <SubtaskIcon size={14} /> Add child issue
            </button>
            <button type="button" className="btn btn-default" onClick={() => setAddingLink(true)}>
              <LinkIcon size={14} /> Link issue
            </button>
          </div>}
          {!canEdit && <div className="mb-6" />}
          <div className="hidden">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
          </div>

          <Section title="Description">
            <InlineTextarea
              readOnly={!canEdit}
              value={issue.description ?? ''}
              onSave={(description) => update.mutate({ description })}
              saving={update.isPending}
            />
          </Section>

          {(issue.attachments?.length ?? 0) > 0 && (
            <Section
              title={`Attachments (${issue.attachments!.length})`}
              action={canEdit && <button type="button" className="btn btn-subtle btn-sm" onClick={() => fileInputRef.current?.click()}><PaperclipIcon size={14} /> Add</button>}
            >
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                {issue.attachments!.map((a) => (
                  <div key={a.id} className="group relative card hover:bg-jira-gray transition-colors">
                    <button
                      type="button"
                      onClick={async () => {
                        const token = localStorage.getItem('token');
                        const res = await fetch(api.getAttachmentUrl(issue.id, a.id), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                        if (!res.ok) { toast('Could not open the attachment', 'error'); return; }
                        window.open(URL.createObjectURL(await res.blob()), '_blank');
                      }}
                      className="flex w-full items-center gap-3 p-3 text-left"
                    >
                      <span className="flex items-center justify-center w-9 h-9 rounded-[3px] bg-jira-gray-hover text-jira-subtle shrink-0">
                        <PaperclipIcon size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium pr-5">{a.filename}</span>
                        <span className="block text-xs text-jira-muted">{Math.max(1, Math.round(a.size / 1024))} KB · {timeAgo(a.createdAt)}</span>
                      </span>
                    </button>
                    {canEdit && (a.uploadedBy.id === currentUser?.id || issue.permissions?.canAdmin) && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (await confirm({ title: 'Delete attachment?', message: `“${a.filename}” will be permanently removed.`, confirmLabel: 'Delete', danger: true })) {
                            deleteAttachment.mutate(a.id);
                          }
                        }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 btn btn-subtle btn-sm btn-icon"
                        aria-label={`Delete ${a.filename}`}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {children.length > 0 && (
            <Section
              title="Child issues"
              action={canEdit && <Link to={`/issues/new?parentId=${issue.id}&type=SUB_TASK`} className="btn btn-subtle btn-sm">+ Add</Link>}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 h-1.5 rounded-full bg-jira-gray-hover overflow-hidden">
                  <div className="h-full bg-[#36B37E]" style={{ width: `${(doneChildren / children.length) * 100}%` }} />
                </div>
                <span className="text-xs text-jira-muted">{Math.round((doneChildren / children.length) * 100)}% done</span>
              </div>
              <div className="card divide-y divide-jira-border">
                {children.map((child) => (
                  <Link key={child.id} to={`/browse/${child.key}`} className="flex items-center gap-3 px-3 py-2 hover:bg-jira-gray">
                    <TypeBadge type={child.type} />
                    <span className={`text-jira-blue shrink-0 ${child.status === 'CLOSED' ? 'line-through' : ''}`}>{child.key}</span>
                    <span className="flex-1 truncate">{child.summary}</span>
                    <StatusBadge status={child.status} />
                  </Link>
                ))}
              </div>
            </Section>
          )}

          <IssueLinks issue={issue} adding={addingLink} onAddingChange={setAddingLink} readOnly={!canEdit} />

          {isIncident && canEdit && (
            <Section title="Incident handling">
              <div className="flex flex-wrap gap-2">
                {teams?.map((team) => (
                  <button key={team.id} type="button" className="btn btn-default" onClick={() => escalate.mutate({ action: 'ESCALATE', toTeam: team.name })}>
                    Escalate to {team.name}
                  </button>
                ))}
                <button type="button" className="btn btn-default" onClick={() => escalate.mutate({ action: 'REJECT' })}>Reject</button>
                <button type="button" className="btn btn-default" onClick={() => escalate.mutate({ action: 'REOPEN' })}>Re-open</button>
              </div>
            </Section>
          )}

          <ActivitySection issue={issue} currentUser={currentUser} />
        </div>

        {/* ─── Sidebar ─── */}
        <aside className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Dropdown
              width="w-60"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  disabled={transition.isPending || !canEdit}
                  title={canEdit ? undefined : 'You need member access to change the status'}
                  className={`btn font-semibold disabled:opacity-100 disabled:cursor-default ${STATUS_BUTTON[issue.status] ?? 'btn-default'}`}
                >
                  {STATUS_LABELS[issue.status] ?? issue.status}
                  <ChevronDownIcon size={14} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="menu-heading">Transition to</div>
                  {transitions.map((t) => (
                    <button
                      key={`${t.status}-${t.resolution ?? ''}`}
                      type="button"
                      className="menu-item justify-between"
                      onClick={() => { close(); transition.mutate({ status: t.status, resolution: t.resolution }); }}
                    >
                      <span>{t.label}</span>
                      <StatusBadge status={t.status} />
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
            {issue.resolution && (
              <span className="text-sm text-jira-subtle">
                Resolution: <span className="text-jira-navy">{issue.resolution === 'COMPLETED' ? 'Done' : 'Rejected'}</span>
              </span>
            )}
            {issue.blocked && <span className="lozenge bg-[#FFEBE6] text-[#BF2600]">Blocked</span>}
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Details</h2></div>
            <div className="px-4 py-2">
              <DetailRow label="Assignee">
                <UserPicker
                  variant="inline"
                  disabled={!canEdit}
                  value={issue.assignee?.id}
                  onChange={(assigneeId) => update.mutate({ assigneeId: assigneeId ?? '' })}
                  currentUserId={currentUser?.id}
                />
              </DetailRow>
              <DetailRow label="Reporter">
                <UserPicker
                  variant="inline"
                  disabled={!canEdit}
                  value={issue.reporter?.id}
                  onChange={(reporterId) => reporterId && update.mutate({ reporterId })}
                  allowClear={false}
                  placeholder="None"
                />
              </DetailRow>
              <DetailRow label="Priority">
                <SelectPicker
                  disabled={!canEdit}
                  value={issue.priority}
                  onChange={(priority) => priority && update.mutate({ priority })}
                  searchable={false}
                  options={PRIORITIES.map((p) => ({ id: p, label: p.charAt(0) + p.slice(1).toLowerCase(), icon: <PriorityIcon priority={p} /> }))}
                />
              </DetailRow>
              <DetailRow label="Labels">
                <MultiPicker
                  disabled={!canEdit}
                  commitOnClose
                  value={issue.labels?.map((l) => l.label.id) ?? []}
                  onChange={(labelIds) => update.mutate({ labelIds })}
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
                  onChange={(componentIds) => update.mutate({ componentIds })}
                  options={(components ?? []).map((c) => ({ id: c.id, label: c.name, hint: typeLabel(c.type) }))}
                  emptyText="This project has no components"
                />
              </DetailRow>
              <DetailRow label="Fix versions">
                <MultiPicker
                  disabled={!canEdit}
                  commitOnClose
                  value={fixIds}
                  onChange={(fixVersionIds) => update.mutate({ fixVersionIds })}
                  options={versionOptions}
                  emptyText="This project has no versions"
                />
              </DetailRow>
              <DetailRow label="Affects versions">
                <MultiPicker
                  disabled={!canEdit}
                  commitOnClose
                  value={affectsIds}
                  onChange={(affectsVersionIds) => update.mutate({ affectsVersionIds })}
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
                  <InlineText readOnly={!canEdit} value={issue.epicName ?? ''} onSave={(epicName) => update.mutate({ epicName })} className="mx-0" />
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
                  onSave={(v) => v !== '' && update.mutate({ estimate: Number(v) })}
                  validate={(v) => (v !== '' && (isNaN(Number(v)) || Number(v) < 0) ? 'Enter hours, e.g. 4 or 1.5' : null)}
                  className="mx-0"
                />
              </DetailRow>
              <DetailRow label="Time tracking">
                <button type="button" onClick={() => setLogTimeOpen(true)} disabled={!canEdit} className="w-full text-left px-2 py-1.5 rounded-[3px] hover:bg-jira-gray-hover disabled:hover:bg-transparent disabled:cursor-default" title={canEdit ? 'Log time' : undefined}>
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
                        onClick={() => updateRag.mutate(r)}
                        disabled={!canEdit}
                        className={`px-2 py-0.5 rounded-[3px] text-xs font-semibold border-2 ${issue.ragStatus === r ? 'border-jira-navy' : 'border-transparent opacity-60 hover:opacity-100'}
                          ${r === 'GREEN' ? 'bg-[#E3FCEF] text-[#006644]' : r === 'AMBER' ? 'bg-[#FFFAE6] text-[#974F0C]' : 'bg-[#FFEBE6] text-[#BF2600]'}`}
                      >
                        {r.charAt(0) + r.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </DetailRow>
              )}
              <DetailRow label="Blocked">
                <label className="flex items-center gap-2 px-2 py-[7px] cursor-pointer">
                  <input type="checkbox" disabled={!canEdit} checked={!!issue.blocked} onChange={(e) => update.mutate({ blocked: e.target.checked })} />
                  <span className="text-jira-subtle">{issue.blocked ? 'Yes' : 'No'}</span>
                </label>
              </DetailRow>
              <CustomFieldRows issue={issue} Row={DetailRow} readOnly={!canEdit} />
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">
              <h2 className="card-title">Watchers ({issue.watchers?.length ?? 0})</h2>
              {currentUser && (
                <button type="button" className="btn btn-link btn-sm" onClick={() => watch.mutate(!isWatching)}>
                  {isWatching ? 'Stop watching' : 'Watch'}
                </button>
              )}
            </div>
            <div className="px-4 py-2 space-y-1">
              {issue.watchers?.map((w) => (
                <div key={w.userId} className="group flex items-center gap-2 py-1">
                  <Avatar name={w.user.name} size="xs" />
                  <span className="flex-1 truncate">{w.user.name}</span>
                  {(canEdit || w.userId === currentUser?.id) && <button
                    type="button"
                    onClick={() => removeWatcher.mutate(w.userId)}
                    className="opacity-0 group-hover:opacity-100 text-jira-muted hover:text-jira-navy"
                    aria-label={`Remove ${w.user.name}`}
                  >
                    <XIcon size={14} />
                  </button>}
                </div>
              ))}
              {canEdit && <UserPicker
                variant="inline"
                value={undefined}
                onChange={(uid) => uid && addWatcher.mutate(uid)}
                placeholder="+ Add watcher"
                allowClear={false}
              />}
            </div>
          </div>

          <div className="text-xs text-jira-muted mt-4 space-y-0.5 px-1">
            {issue.createdAt && <p title={new Date(issue.createdAt).toLocaleString()}>Created {timeAgo(issue.createdAt)}</p>}
            {issue.updatedAt && <p title={new Date(issue.updatedAt).toLocaleString()}>Updated {timeAgo(issue.updatedAt)}</p>}
          </div>
        </aside>
      </div>

      {logTimeOpen && (
        <Modal
          title="Log time"
          onClose={() => setLogTimeOpen(false)}
          width="max-w-md"
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setLogTimeOpen(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={logTime.isPending || (!Number(logTimeForm.hours) && !Number(logTimeForm.minutes))}
                onClick={() => logTime.mutate()}
              >
                Log time
              </button>
            </>
          )}
        >
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label>
              <span className="field-label">Hours</span>
              <input type="number" min={0} className="input" value={logTimeForm.hours} onChange={(e) => setLogTimeForm({ ...logTimeForm, hours: e.target.value })} />
            </label>
            <label>
              <span className="field-label">Minutes</span>
              <input type="number" min={0} max={59} className="input" value={logTimeForm.minutes} onChange={(e) => setLogTimeForm({ ...logTimeForm, minutes: e.target.value })} />
            </label>
          </div>
          <label>
            <span className="field-label">Work description</span>
            <textarea rows={3} className="input" value={logTimeForm.comment} onChange={(e) => setLogTimeForm({ ...logTimeForm, comment: e.target.value })} />
          </label>
        </Modal>
      )}
    </div>
  );
}
