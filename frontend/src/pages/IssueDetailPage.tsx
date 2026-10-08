import { useState, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatMinutes, isEpicType } from '../api';
import { useProject } from '../project';
import { TypeBadge, StatusBadge, PriorityIcon } from '../components/Badges';
import PeopleSection from '../components/PeopleSection';
import CustomFieldsPanel from '../components/CustomFieldsPanel';
import IssueLinks from '../components/IssueLinks';
import ActivitySection from '../components/ActivitySection';

const TRANSITIONS: Record<string, { status: string; label: string; resolution?: string }[]> = {
  CLOSED: [{ status: 'TO_DO', label: 'Re-open' }],
  BACKLOG: [{ status: 'TO_DO', label: 'Move to To Do' }],
  TO_DO: [
    { status: 'DOING', label: 'Start Progress' },
    { status: 'BACKLOG', label: 'Move to Backlog' },
  ],
  DOING: [
    { status: 'CLOSED', label: 'Complete', resolution: 'COMPLETED' },
    { status: 'CLOSED', label: 'Reject', resolution: 'REJECTED' },
    { status: 'TO_DO', label: 'Stop Progress' },
  ],
};

export default function IssueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ summary: '', description: '' });
  const [showMore, setShowMore] = useState(false);
  const [showLogTime, setShowLogTime] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [showManageLabels, setShowManageLabels] = useState(false);
  const [logTimeForm, setLogTimeForm] = useState({ hours: '', minutes: '30', comment: '' });
  const [newLabelName, setNewLabelName] = useState('');
  const { projectKey, setProjectKey } = useProject();

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

  const invalidateIssue = () => {
    queryClient.invalidateQueries({ queryKey: ['issue', id] });
    queryClient.invalidateQueries({ queryKey: ['history'] });
  };

  const { data: teams } = useQuery({
    queryKey: ['components', 'TEAM'],
    queryFn: () => api.getComponents('TEAM'),
  });

  const { data: labels } = useQuery({
    queryKey: ['labels'],
    queryFn: () => api.getLabels(),
  });

  const { data: components } = useQuery({
    queryKey: ['components'],
    queryFn: () => api.getComponents(),
  });

  const transition = useMutation({
    mutationFn: ({ status, resolution }: { status: string; resolution?: string }) =>
      api.transitionIssue(id!, status, resolution),
    onSuccess: invalidateIssue,
  });

  const escalate = useMutation({
    mutationFn: ({ action, toTeam }: { action: string; toTeam?: string }) =>
      api.escalate(id!, action, toTeam),
    onSuccess: invalidateIssue,
  });

  const updateRag = useMutation({
    mutationFn: (ragStatus: string) => api.updateRag(id!, ragStatus),
    onSuccess: invalidateIssue,
  });

  const updateIssue = useMutation({
    mutationFn: (data: Parameters<typeof api.updateIssue>[1]) => api.updateIssue(id!, data),
    onSuccess: () => {
      invalidateIssue();
      setEditing(false);
    },
  });

  const logTime = useMutation({
    mutationFn: () => {
      const mins = (parseInt(logTimeForm.hours || '0', 10) * 60) + parseInt(logTimeForm.minutes || '0', 10);
      return api.createWorkLog(id!, mins, logTimeForm.comment || undefined);
    },
    onSuccess: () => {
      invalidateIssue();
      setShowLogTime(false);
      setLogTimeForm({ hours: '', minutes: '30', comment: '' });
    },
  });

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => api.uploadAttachment(id!, file),
    onSuccess: invalidateIssue,
  });

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => api.deleteAttachment(id!, attachmentId),
    onSuccess: invalidateIssue,
  });

  const deleteIssue = useMutation({
    mutationFn: () => api.deleteIssue(id!),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['issue', id] });
      queryClient.invalidateQueries({ queryKey: ['search'] });
      navigate('/search');
    },
    onError: (e) => alert((e as Error).message),
  });

  const createLabel = useMutation({
    mutationFn: (name: string) => api.createLabel(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['labels'] }),
  });

  if (isLoading) return <div className="text-gray-500">Loading...</div>;
  if (!issue) {
    return (
      <div className="bg-white border border-jira-border rounded-lg p-8 text-center">
        <h1 className="text-lg font-semibold mb-1">Issue not found</h1>
        <p className="text-sm text-gray-500 mb-4">{(error as Error)?.message ?? `${id} does not exist or was deleted.`}</p>
        <Link to="/search" className="text-jira-blue hover:underline text-sm">Back to issues</Link>
      </div>
    );
  }

  const canDelete = !!currentUser && (
    currentUser.role === 'ADMIN' || currentUser.id === issue.reporter?.id || currentUser.id === issue.project?.leadId
  );

  const transitions = TRANSITIONS[issue.status] ?? [];
  // Escalation between @teams is a SPORTS process.
  const isIncident = issue.project?.strictHierarchy !== false && (issue.type === 'DEFECT' || issue.type === 'TASK');
  const epicParent = issue.parent && isEpicType(issue.parent.type) ? issue.parent : null;

  const fixVersions = issue.versions?.filter((v) => v.isFix).map((v) => v.version.name) ?? [];
  const affectsVersions = issue.versions?.filter((v) => !v.isFix).map((v) => v.version.name) ?? [];

  const loggedMinutes = issue.workLogs?.reduce((sum, w) => sum + w.timeSpentMinutes, 0) ?? 0;
  const estimatedMinutes = (issue.estimate ?? 0) * 60;
  const remainingMinutes = issue.remainingEstimate != null ? issue.remainingEstimate * 60 : Math.max(0, estimatedMinutes - loggedMinutes);
  const totalBar = Math.max(estimatedMinutes, loggedMinutes, 1);

  const startEdit = () => {
    setEditForm({ summary: issue.summary, description: issue.description ?? '' });
    setEditing(true);
  };

  const toggleLabel = (labelId: string) => {
    const current = issue.labels?.map((l) => l.label.id) ?? [];
    const next = current.includes(labelId)
      ? current.filter((id) => id !== labelId)
      : [...current, labelId];
    updateIssue.mutate({ labelIds: next });
  };

  return (
    <div className="space-y-4">
      {issue.project && (
        <div className="text-sm text-gray-500">
          <Link to="/projects" className="hover:underline">Projects</Link>
          {' / '}
          <Link to={`/projects/${issue.project.key}`} className="hover:underline">{issue.project.name}</Link>
          {issue.parent && (
            <>
              {' / '}
              <Link to={`/browse/${issue.parent.key}`} className="hover:underline">{issue.parent.key}</Link>
            </>
          )}
          {' / '}
          <span className="text-jira-navy">{issue.key}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={editing ? () => setEditing(false) : startEdit}
          className="px-3 py-1.5 bg-jira-gray rounded text-sm hover:bg-gray-200"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className="px-3 py-1.5 bg-jira-gray rounded text-sm hover:bg-gray-200"
          >
            More
          </button>
          {showMore && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-jira-border rounded shadow-lg z-10 min-w-[180px]">
              <button type="button" onClick={() => { setShowLogTime(true); setShowMore(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-jira-gray">Log time</button>
              <button type="button" onClick={() => { navigate(`/issues/new?parentId=${issue.id}&type=SUB_TASK`); setShowMore(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-jira-gray">Create sub-task</button>
              <button type="button" onClick={() => { setAddingLink(true); setShowMore(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-jira-gray">Link issue</button>
              <button type="button" onClick={() => { setShowManageLabels(true); setShowMore(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-jira-gray">Labels</button>
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/browse/${issue.key}`); setShowMore(false); }}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-jira-gray"
              >
                Copy link
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMore(false);
                    if (confirm(`Delete ${issue.key}? Its comments, history, links and attachments are deleted too. This cannot be undone.`)) {
                      deleteIssue.mutate();
                    }
                  }}
                  className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 border-t border-jira-border"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TypeBadge type={issue.type} />
              <span className="text-gray-500 text-sm">{issue.key}</span>
              {issue.blocked && <span className="text-red-500 text-sm font-bold">BLOCKED</span>}
            </div>
            {editing ? (
              <input
                value={editForm.summary}
                onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
                className="text-2xl font-semibold w-full border border-jira-border rounded px-2 py-1"
              />
            ) : (
              <h1 className="text-2xl font-semibold">{issue.summary}</h1>
            )}
          </div>

          <div className="bg-white rounded-lg border border-jira-border p-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-500">Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Type</span><TypeBadge type={issue.type} /></div>
              <div className="flex justify-between items-center"><span className="text-gray-500">Priority</span><PriorityIcon priority={issue.priority} /></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><StatusBadge status={issue.status} /></div>
              <div className="flex justify-between"><span className="text-gray-500">Resolution</span><span>{issue.resolution ?? 'Unresolved'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Affects Version/s</span><span>{affectsVersions.length ? affectsVersions.join(', ') : 'None'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Fix Version/s</span><span>{fixVersions.length ? fixVersions.join(', ') : 'None'}</span></div>
              <div className="col-span-2">
                <span className="text-gray-500 block mb-1">Component/s</span>
                <select
                  multiple
                  value={issue.components?.map((c) => c.component.id) ?? []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                    updateIssue.mutate({ componentIds: selected });
                  }}
                  className="w-full border border-jira-border rounded px-2 py-1 text-sm h-20"
                >
                  {components?.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500 block mb-1">Labels</span>
                <div className="flex flex-wrap gap-1">
                  {issue.labels?.length ? issue.labels.map((l) => (
                    <span key={l.label.id} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{l.label.name}</span>
                  )) : <span className="text-sm text-gray-400">None</span>}
                </div>
              </div>
              {epicParent && (
                <div className="col-span-2 flex justify-between">
                  <span className="text-gray-500">Epic Link</span>
                  <Link to={`/issues/${epicParent.id}`} className="text-jira-blue hover:underline text-sm">
                    {epicParent.epicName ?? epicParent.summary} ({epicParent.key})
                  </Link>
                </div>
              )}
            </div>
          </div>

          <CustomFieldsPanel issue={issue} />

          <div className="bg-white rounded-lg border border-jira-border p-4">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Description</h3>
            {editing ? (
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={6}
                className="w-full border border-jira-border rounded px-2 py-1 text-sm"
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{issue.description || 'No description'}</p>
            )}
            {editing && (
              <button
                type="button"
                onClick={() => updateIssue.mutate({ summary: editForm.summary, description: editForm.description })}
                className="mt-2 px-4 py-1.5 bg-jira-blue text-white rounded text-sm"
              >
                Save
              </button>
            )}
          </div>

          <div className="bg-white rounded-lg border border-jira-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-500">Attachments</h3>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-jira-blue hover:underline"
              >
                Attach file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAttachment.mutate(file);
                  e.target.value = '';
                }}
              />
            </div>
            {issue.attachments?.length ? (
              <div className="grid grid-cols-4 gap-2">
                {issue.attachments.map((a) => (
                  <div key={a.id} className="group relative">
                    <button
                      type="button"
                      onClick={async () => {
                        const token = localStorage.getItem('token');
                        const res = await fetch(api.getAttachmentUrl(issue.id, a.id), {
                          headers: token ? { Authorization: `Bearer ${token}` } : {},
                        });
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        window.open(url, '_blank');
                      }}
                      className="w-full border border-jira-border rounded p-2 text-xs hover:bg-jira-gray text-left"
                      title={`${a.filename} — ${a.uploadedBy.name}, ${new Date(a.createdAt).toLocaleString()}`}
                    >
                      <span className="block truncate pr-4">{a.filename}</span>
                      <span className="block text-gray-400">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                    </button>
                    {(a.uploadedBy.id === currentUser?.id || currentUser?.role === 'ADMIN') && (
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Delete attachment ${a.filename}?`)) deleteAttachment.mutate(a.id); }}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 text-sm leading-none px-1"
                        title="Delete attachment"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No attachments</p>
            )}
          </div>

          {issue.children && issue.children.length > 0 && (
            <div className="bg-white rounded-lg border border-jira-border p-4">
              <h3 className="text-sm font-medium text-gray-500 mb-3">Sub-tasks / Children</h3>
              <div className="space-y-2">
                {issue.children.map((child) => (
                  <Link key={child.id} to={`/browse/${child.key}`} className="flex items-center gap-3 p-2 hover:bg-jira-gray rounded">
                    <TypeBadge type={child.type} />
                    <span className="text-jira-blue text-sm">{child.key}</span>
                    <span className="text-sm flex-1 truncate">{child.summary}</span>
                    <StatusBadge status={child.status} />
                  </Link>
                ))}
              </div>
            </div>
          )}

          <IssueLinks issue={issue} adding={addingLink} onAddingChange={setAddingLink} />

          {isIncident && (
            <div className="bg-white rounded-lg border border-jira-border p-4">
              <h3 className="text-sm font-medium text-gray-500 mb-3">Incident Actions</h3>
              <div className="flex flex-wrap gap-2">
                {teams?.map((team) => (
                  <button key={team.id} onClick={() => escalate.mutate({ action: 'ESCALATE', toTeam: team.name })} className="px-3 py-1.5 bg-orange-100 text-orange-800 rounded text-sm hover:bg-orange-200">
                    Escalate to {team.name}
                  </button>
                ))}
                <button onClick={() => escalate.mutate({ action: 'REJECT' })} className="px-3 py-1.5 bg-gray-100 text-gray-800 rounded text-sm hover:bg-gray-200">Reject</button>
                <button onClick={() => escalate.mutate({ action: 'REOPEN' })} className="px-3 py-1.5 bg-blue-100 text-blue-800 rounded text-sm hover:bg-blue-200">Re-open</button>
              </div>
            </div>
          )}

          <ActivitySection issue={issue} currentUser={currentUser} />
        </div>

        <div className="space-y-4">
          <PeopleSection issue={issue} currentUserId={currentUser?.id} />

          <div className="bg-white rounded-lg border border-jira-border p-4 space-y-2 text-sm">
            <h3 className="text-sm font-medium text-gray-700">Dates</h3>
            <div className="flex justify-between"><span className="text-gray-500">Created</span><span>{issue.createdAt ? new Date(issue.createdAt).toLocaleString() : '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Updated</span><span>{issue.updatedAt ? new Date(issue.updatedAt).toLocaleString() : '—'}</span></div>
          </div>

          <div className="bg-white rounded-lg border border-jira-border p-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-700">Issue Hierarchy</h3>
            {issue.parent && !epicParent && (
              <div className="text-sm">
                <span className="text-gray-500">Parent: </span>
                <Link to={`/browse/${issue.parent.key}`} className="text-jira-blue hover:underline">{issue.parent.key}</Link>
              </div>
            )}
            {epicParent && (
              <div className="text-sm">
                <span className="text-gray-500">Epic: </span>
                <Link to={`/browse/${epicParent.key}`} className="text-jira-blue hover:underline">{epicParent.key}</Link>
              </div>
            )}
            <div className="text-sm">
              <span className="text-gray-500">Children: </span>
              {issue.children?.length ?? 0}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-jira-border p-4 space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Time Tracking</h3>
            <div className="h-2 bg-gray-200 rounded overflow-hidden flex">
              <div className="bg-blue-500 h-full" style={{ width: `${(loggedMinutes / totalBar) * 100}%` }} title="Logged" />
              <div className="bg-green-400 h-full" style={{ width: `${(remainingMinutes / totalBar) * 100}%` }} title="Remaining" />
            </div>
            <div className="grid grid-cols-3 text-xs text-center">
              <div><div className="text-gray-500">Estimated</div><div>{formatMinutes(estimatedMinutes)}</div></div>
              <div><div className="text-gray-500">Remaining</div><div>{formatMinutes(remainingMinutes)}</div></div>
              <div><div className="text-gray-500">Logged</div><div>{formatMinutes(loggedMinutes)}</div></div>
            </div>
            {issue.workLogs && issue.workLogs.length > 0 && (
              <div className="mt-2 space-y-1">
                {issue.workLogs.slice(0, 3).map((w) => (
                  <div key={w.id} className="text-xs text-gray-600">
                    {w.user.name} logged {formatMinutes(w.timeSpentMinutes)}
                    {w.comment && ` — ${w.comment}`}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-jira-border p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Agile</h3>
            <Link to={issue.sprint ? `/board?sprintId=${issue.sprint.id}` : '/board'} className="text-sm text-jira-blue hover:underline">
              Find on a board
            </Link>
            {issue.sprint && <p className="text-xs text-gray-500 mt-1">Sprint: {issue.sprint.name}</p>}
          </div>

          <div className="bg-white rounded-lg border border-jira-border p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">RAG</span>
              <div className="flex gap-1">
                {(['GREEN', 'AMBER', 'RED'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => updateRag.mutate(r)}
                    className={`w-6 h-6 rounded-full border-2 ${issue.ragStatus === r ? 'border-jira-navy' : 'border-transparent'} ${r === 'GREEN' ? 'bg-green-500' : r === 'AMBER' ? 'bg-amber-500' : 'bg-red-500'}`}
                    title={r}
                  />
                ))}
              </div>
            </div>
          </div>

          {transitions.length > 0 && (
            <div className="bg-white rounded-lg border border-jira-border p-4">
              <h3 className="text-sm font-medium text-gray-500 mb-3">Workflow</h3>
              <div className="space-y-2">
                {transitions.map((t) => (
                  <button
                    key={`${t.status}-${t.resolution}`}
                    onClick={() => transition.mutate({ status: t.status, resolution: t.resolution })}
                    disabled={transition.isPending}
                    className="w-full text-left px-3 py-2 bg-jira-gray hover:bg-gray-200 rounded text-sm"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showLogTime && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 space-y-4">
            <h3 className="font-medium">Log Time</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Hours<input type="number" value={logTimeForm.hours} onChange={(e) => setLogTimeForm({ ...logTimeForm, hours: e.target.value })} className="mt-1 w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">Minutes<input type="number" value={logTimeForm.minutes} onChange={(e) => setLogTimeForm({ ...logTimeForm, minutes: e.target.value })} className="mt-1 w-full border rounded px-2 py-1" /></label>
            </div>
            <label className="block text-sm">Comment<textarea value={logTimeForm.comment} onChange={(e) => setLogTimeForm({ ...logTimeForm, comment: e.target.value })} className="mt-1 w-full border rounded px-2 py-1" rows={2} /></label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowLogTime(false)} className="px-4 py-1.5 border rounded text-sm">Cancel</button>
              <button type="button" onClick={() => logTime.mutate()} className="px-4 py-1.5 bg-jira-blue text-white rounded text-sm">Log</button>
            </div>
          </div>
        </div>
      )}

      {showManageLabels && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 space-y-4">
            <h3 className="font-medium">Manage Labels</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {labels?.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={issue.labels?.some((il) => il.label.id === l.id) ?? false}
                    onChange={() => toggleLabel(l.id)}
                  />
                  {l.name}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} placeholder="New label" className="flex-1 border rounded px-2 py-1 text-sm" />
              <button type="button" onClick={() => { if (newLabelName) { createLabel.mutate(newLabelName); setNewLabelName(''); } }} className="px-3 py-1 bg-jira-gray rounded text-sm">Add</button>
            </div>
            <button type="button" onClick={() => setShowManageLabels(false)} className="w-full px-4 py-1.5 border rounded text-sm">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
