import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatMinutes, type Comment, type Issue, type User } from '../api';
import { humanize, timeAgo } from '../utils';
import { STATUS_LABELS } from './Badges';
import Avatar from './Avatar';
import MentionTextarea from './MentionTextarea';
import { errorMessage, useDialogs, useToast } from './ui';

const FIELD_LABELS: Record<string, string> = {
  fixVersions: 'Fix versions',
  affectsVersions: 'Affects versions',
  remainingEstimate: 'Remaining estimate',
  epicName: 'Epic name',
};

const fmt = (field: string, v: string | null) =>
  v === null ? 'None' : field === 'status' ? (STATUS_LABELS[v] ?? v) : v;

/** Render comment text with @mentions highlighted. */
function CommentBody({ text }: { text: string }) {
  const parts = text.split(/(@[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g);
  return (
    <p className="whitespace-pre-wrap break-words leading-6">
      {parts.map((p, i) => (i % 2 === 1
        ? <span key={i} className="bg-jira-blue-light text-jira-blue rounded-[3px] px-1">{p}</span>
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
  const save = () => { if (body.trim()) { onSave(body.trim()); if (!initial) { setBody(''); setFocused(false); } } };
  return (
    <div className="flex-1 min-w-0">
      <MentionTextarea
        autoFocus={autoFocus}
        value={body}
        onChange={setBody}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
          if (e.key === 'Escape') { setFocused(false); setBody(initial); onCancel?.(); }
        }}
        rows={focused ? 4 : 1}
        placeholder={placeholder}
        className="input resize-y"
      />
      {focused && (
        <div className="flex items-center gap-2 mt-2">
          <button type="button" onClick={save} disabled={!body.trim() || saving} className="btn btn-primary">Save</button>
          <button type="button" onClick={() => { setFocused(false); setBody(initial); onCancel?.(); }} className="btn btn-subtle">Cancel</button>
          <span className="text-xs text-jira-muted ml-auto">Ctrl+Enter to save · type @ to mention someone</span>
        </div>
      )}
    </div>
  );
}

export default function ActivitySection({ issue, currentUser }: { issue: Issue; currentUser?: User }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [tab, setTab] = useState<'comments' | 'history' | 'worklog'>('comments');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newestFirst, setNewestFirst] = useState(true);

  const { data: comments } = useQuery({ queryKey: ['comments', issue.id], queryFn: () => api.getComments(issue.id) });
  const { data: history } = useQuery({
    queryKey: ['history', issue.id],
    queryFn: () => api.getHistory(issue.id),
    enabled: tab === 'history',
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['comments', issue.id] });
    queryClient.invalidateQueries({ queryKey: ['issue'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const add = useMutation({ mutationFn: (body: string) => api.addComment(issue.id, body), onSuccess: refresh, onError });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.updateComment(issue.id, id, body),
    onSuccess: () => { refresh(); setEditingId(null); },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteComment(issue.id, id), onSuccess: refresh, onError });

  const sorted = [...(comments ?? [])].sort((a, b) =>
    (newestFirst ? -1 : 1) * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));

  const renderComment = (c: Comment) => {
    const mine = c.author.id === currentUser?.id;
    const edited = new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 1000;
    return (
      <div key={c.id} className="flex gap-3">
        <Avatar name={c.author.name} size="md" />
        <div className="flex-1 min-w-0">
          <div className="mb-1">
            <span className="font-semibold">{c.author.name}</span>
            <span className="text-jira-muted ml-2" title={new Date(c.createdAt).toLocaleString()}>{timeAgo(c.createdAt)}</span>
            {edited && <span className="text-jira-muted ml-1">• Edited</span>}
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
              <div className="flex gap-3 text-xs font-medium text-jira-subtle mt-1">
                {mine && <button type="button" onClick={() => setEditingId(c.id)} className="hover:underline">Edit</button>}
                {(mine || currentUser?.role === 'ADMIN') && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (await confirm({ title: 'Delete this comment?', message: 'Once you delete, it\'s gone for good.', confirmLabel: 'Delete', danger: true })) {
                        remove.mutate(c.id);
                      }
                    }}
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

  const TABS = [
    ['comments', 'Comments'],
    ['history', 'History'],
    ['worklog', 'Work log'],
  ] as const;

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-jira-navy mb-2">Activity</h2>
      <div className="flex items-center gap-1 mb-4">
        <span className="text-jira-subtle mr-1">Show:</span>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`btn btn-sm ${tab === key ? 'bg-jira-blue-light text-jira-blue' : 'btn-default'}`}
          >
            {label}
            {key === 'comments' && comments?.length ? <span className="ml-0.5 opacity-70">{comments.length}</span> : null}
          </button>
        ))}
        {tab === 'comments' && sorted.length > 1 && (
          <button type="button" onClick={() => setNewestFirst(!newestFirst)} className="btn btn-subtle btn-sm ml-auto">
            {newestFirst ? 'Newest first' : 'Oldest first'}
          </button>
        )}
      </div>

      {tab === 'comments' && (
        <div className="space-y-5">
          <div className="flex gap-3">
            {currentUser && <Avatar name={currentUser.name} size="md" />}
            <CommentEditor saving={add.isPending} onSave={(body) => add.mutate(body)} placeholder="Add a comment…" />
          </div>
          {sorted.map(renderComment)}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          {history?.length === 0 && <p className="text-jira-muted">No history yet.</p>}
          {history?.map((h) => (
            <div key={h.id} className="flex gap-3">
              <Avatar name={h.user?.name ?? 'System'} size="md" />
              <div className="min-w-0">
                <div>
                  <span className="font-semibold">{h.user?.name ?? 'System'}</span>{' '}
                  {h.field === 'created' ? (
                    <span>created the issue</span>
                  ) : h.field === 'link' || h.field === 'attachment' ? (
                    <span>
                      {h.toValue ? 'added' : 'removed'} {h.field === 'link' ? 'a link' : 'an attachment'}:{' '}
                      <span className="font-medium">{h.toValue ?? h.fromValue}</span>
                    </span>
                  ) : (
                    <span>changed the <span className="font-semibold">{FIELD_LABELS[h.field] ?? humanize(h.field)}</span></span>
                  )}
                  <span className="text-jira-muted ml-2" title={new Date(h.createdAt).toLocaleString()}>{timeAgo(h.createdAt)}</span>
                </div>
                {!['created', 'link', 'attachment'].includes(h.field) && (
                  <div className="text-sm mt-1 flex items-center gap-2 flex-wrap">
                    <span className="text-jira-subtle line-through max-w-xs truncate">{fmt(h.field, h.fromValue)}</span>
                    <span className="text-jira-muted">→</span>
                    <span className="max-w-xs truncate">{fmt(h.field, h.toValue)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'worklog' && (
        <div className="space-y-4">
          {!issue.workLogs?.length && <p className="text-jira-muted">No work logged yet. Use “Time tracking” in the details panel.</p>}
          {issue.workLogs?.map((w) => (
            <div key={w.id} className="flex gap-3">
              <Avatar name={w.user.name} size="md" />
              <div>
                <span className="font-semibold">{w.user.name}</span> logged <span className="font-semibold">{formatMinutes(w.timeSpentMinutes)}</span>
                <span className="text-jira-muted ml-2">{timeAgo(w.createdAt)}</span>
                {w.comment && <p className="mt-1">{w.comment}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
