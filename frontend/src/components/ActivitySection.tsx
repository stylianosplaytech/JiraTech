import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatMinutes, type Comment, type Issue, type User } from '../api';
import { humanize, timeAgo } from '../utils';
import Avatar from './Avatar';

const FIELD_LABELS: Record<string, string> = {
  created: 'created the issue',
  fixVersions: 'Fix versions',
  affectsVersions: 'Affects versions',
  remainingEstimate: 'Remaining estimate',
  epicName: 'Epic name',
};

/** Render comment text with @mentions highlighted. */
function CommentBody({ text }: { text: string }) {
  const parts = text.split(/(@[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g);
  return (
    <p className="text-sm whitespace-pre-wrap break-words">
      {parts.map((p, i) => (p.startsWith('@') && i % 2 === 1
        ? <span key={i} className="bg-blue-50 text-jira-blue rounded px-0.5">{p}</span>
        : <Fragment key={i}>{p}</Fragment>))}
    </p>
  );
}

function CommentEditor({ initial = '', onSave, onCancel, saving, autoFocus, placeholder }: {
  initial?: string;
  onSave: (body: string) => void;
  onCancel?: () => void;
  saving: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [body, setBody] = useState(initial);
  const [focused, setFocused] = useState(!!autoFocus);
  const save = () => { if (body.trim()) { onSave(body.trim()); if (!initial) setBody(''); } };
  return (
    <div className="flex-1">
      <textarea
        autoFocus={autoFocus}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}
        rows={focused ? 4 : 1}
        placeholder={placeholder}
        className="w-full border border-jira-border rounded px-3 py-2 text-sm"
      />
      {focused && (
        <div className="flex items-center gap-2 mt-1">
          <button type="button" onClick={save} disabled={!body.trim() || saving} className="px-3 py-1 bg-jira-blue text-white rounded text-sm disabled:opacity-50">
            Save
          </button>
          <button
            type="button"
            onClick={() => { setFocused(false); setBody(initial); onCancel?.(); }}
            className="px-3 py-1 text-sm hover:bg-jira-gray rounded"
          >
            Cancel
          </button>
          <span className="text-xs text-gray-400 ml-auto">Ctrl+Enter to save · @email to mention</span>
        </div>
      )}
    </div>
  );
}

export default function ActivitySection({ issue, currentUser }: { issue: Issue; currentUser?: User }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'comments' | 'history' | 'worklog'>('comments');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newestFirst, setNewestFirst] = useState(false);

  const { data: comments } = useQuery({
    queryKey: ['comments', issue.id],
    queryFn: () => api.getComments(issue.id),
  });
  const { data: history } = useQuery({
    queryKey: ['history', issue.id],
    queryFn: () => api.getHistory(issue.id),
    enabled: tab === 'history',
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['comments', issue.id] });
    queryClient.invalidateQueries({ queryKey: ['issue'] });
  };
  const add = useMutation({ mutationFn: (body: string) => api.addComment(issue.id, body), onSuccess: refresh });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.updateComment(issue.id, id, body),
    onSuccess: () => { refresh(); setEditingId(null); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteComment(issue.id, id), onSuccess: refresh });

  const sorted = [...(comments ?? [])].sort((a, b) =>
    (newestFirst ? -1 : 1) * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));

  const renderComment = (c: Comment) => {
    const mine = c.author.id === currentUser?.id;
    const edited = new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 1000;
    return (
      <div key={c.id} className="flex gap-3 group">
        <Avatar name={c.author.name} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm mb-0.5">
            <span className="font-medium">{c.author.name}</span>
            <span className="text-gray-500 ml-2" title={new Date(c.createdAt).toLocaleString()}>{timeAgo(c.createdAt)}</span>
            {edited && <span className="text-gray-400 ml-1">(edited)</span>}
          </div>
          {editingId === c.id ? (
            <CommentEditor
              initial={c.body}
              autoFocus
              saving={edit.isPending}
              onSave={(body) => edit.mutate({ id: c.id, body })}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <CommentBody text={c.body} />
              <div className="flex gap-3 text-xs text-gray-500 mt-1">
                {mine && <button type="button" onClick={() => setEditingId(c.id)} className="hover:underline">Edit</button>}
                {(mine || currentUser?.role === 'ADMIN') && (
                  <button
                    type="button"
                    onClick={() => { if (confirm('Delete this comment? This cannot be undone.')) remove.mutate(c.id); }}
                    className="hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-jira-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">Activity</h3>
        <div className="flex gap-1 text-sm">
          {([['comments', `Comments${comments?.length ? ` (${comments.length})` : ''}`], ['history', 'History'], ['worklog', 'Work log']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-2.5 py-1 rounded ${tab === key ? 'bg-blue-50 text-jira-blue font-medium' : 'hover:bg-jira-gray'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'comments' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            {currentUser && <Avatar name={currentUser.name} size="md" />}
            <CommentEditor saving={add.isPending} onSave={(body) => add.mutate(body)} placeholder="Add a comment…" />
          </div>
          {add.isError && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}
          {sorted.length > 1 && (
            <button type="button" onClick={() => setNewestFirst(!newestFirst)} className="text-xs text-gray-500 hover:underline">
              {newestFirst ? 'Newest first ↓' : 'Oldest first ↑'}
            </button>
          )}
          {sorted.map(renderComment)}
          {comments && comments.length === 0 && <p className="text-sm text-gray-400">No comments yet.</p>}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {history?.length === 0 && <p className="text-sm text-gray-400">No history yet.</p>}
          {history?.map((h) => (
            <div key={h.id} className="flex gap-3 text-sm">
              <Avatar name={h.user?.name ?? 'System'} size="sm" />
              <div className="min-w-0">
                <div>
                  <span className="font-medium">{h.user?.name ?? 'System'}</span>{' '}
                  {h.field === 'created' ? (
                    <span className="text-gray-600">created the issue</span>
                  ) : h.field === 'link' || h.field === 'attachment' ? (
                    <span className="text-gray-600">
                      {h.toValue ? 'added' : 'removed'} {h.field === 'link' ? 'link' : 'attachment'}{' '}
                      <span className="font-medium text-jira-navy">{h.toValue ?? h.fromValue}</span>
                    </span>
                  ) : (
                    <span className="text-gray-600">changed <span className="font-medium text-jira-navy">{FIELD_LABELS[h.field] ?? humanize(h.field)}</span></span>
                  )}
                  <span className="text-gray-400 ml-2" title={new Date(h.createdAt).toLocaleString()}>{timeAgo(h.createdAt)}</span>
                </div>
                {!['created', 'link', 'attachment'].includes(h.field) && (
                  <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="bg-gray-100 rounded px-1.5 py-0.5 line-through text-gray-500 max-w-xs truncate">{h.fromValue ?? 'None'}</span>
                    <span>→</span>
                    <span className="bg-blue-50 rounded px-1.5 py-0.5 max-w-xs truncate">{h.toValue ?? 'None'}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'worklog' && (
        <div className="space-y-2">
          {!issue.workLogs?.length && <p className="text-sm text-gray-400">No work logged. Use More → Log time.</p>}
          {issue.workLogs?.map((w) => (
            <div key={w.id} className="flex gap-3 text-sm">
              <Avatar name={w.user.name} size="sm" />
              <div>
                <span className="font-medium">{w.user.name}</span> logged <span className="font-medium">{formatMinutes(w.timeSpentMinutes)}</span>
                <span className="text-gray-400 ml-2">{timeAgo(w.createdAt)}</span>
                {w.comment && <p className="text-gray-600">{w.comment}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
