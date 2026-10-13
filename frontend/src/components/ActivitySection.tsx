import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatMinutes, type Comment, type Issue, type IssueEmail, type User } from '../api';
import { humanize, timeAgo } from '../utils';
import { STATUS_LABELS } from './Badges';
import Avatar from './Avatar';
import { RichTextEditor, RichTextView } from './RichText';
import { errorMessage, useDialogs, useToast } from './ui';
import { MailIcon } from './Icons';
import EmailCard from './email/EmailCard';
import EmailComposer, { type ComposeRequest } from './email/EmailComposer';

const FIELD_LABELS: Record<string, string> = {
  fixVersions: 'Fix versions',
  affectsVersions: 'Affects versions',
  remainingEstimate: 'Remaining estimate',
  epicName: 'Epic name',
};

const fmt = (field: string, v: string | null) =>
  v === null ? 'None' : field === 'status' ? (STATUS_LABELS[v] ?? v) : v;

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
  const save = () => { if (body) { onSave(body); if (!initial) { setBody(''); setFocused(false); } } };
  const cancel = () => { setFocused(false); setBody(initial); onCancel?.(); };
  if (!focused) {
    return (
      <button type="button" onClick={() => setFocused(true)} className="input flex-1 text-left text-jira-muted cursor-text">
        {placeholder}
      </button>
    );
  }
  return (
    <div className="flex-1 min-w-0">
      <RichTextEditor
        autoFocus
        value={body}
        onChange={setBody}
        onSubmit={save}
        onCancel={cancel}
        placeholder={placeholder ?? 'Write a comment…'}
        minHeight={90}
      />
      {focused && (
        <div className="flex items-center gap-2 mt-2">
          <button type="button" onClick={save} disabled={!body || saving} className="btn btn-primary">Save</button>
          <button type="button" onClick={cancel} className="btn btn-subtle">Cancel</button>
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
  const [tab, setTab] = useState<'comments' | 'emails' | 'history' | 'worklog'>('comments');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newestFirst, setNewestFirst] = useState(true);
  // Service desks: agents either reply to the customer or leave an internal note.
  const serviceDesk = issue.project?.type === 'SERVICE_DESK';
  const [internal, setInternal] = useState(false);
  // Agents on a service desk can answer by email: replies, reply all, forwards and new emails.
  const canEmail = serviceDesk && !!currentUser && currentUser.role !== 'CUSTOMER';
  const [compose, setCompose] = useState<ComposeRequest | null>(null);

  const { data: comments } = useQuery({ queryKey: ['comments', issue.id], queryFn: () => api.getComments(issue.id) });
  const { data: emailData } = useQuery({
    queryKey: ['issue-emails', issue.id],
    queryFn: () => api.getIssueEmails(issue.id),
    enabled: serviceDesk,
  });
  const { data: history } = useQuery({
    queryKey: ['history', issue.id],
    queryFn: () => api.getHistory(issue.id),
    enabled: tab === 'history',
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['comments', issue.id] });
    queryClient.invalidateQueries({ queryKey: ['issue-emails', issue.id] });
    queryClient.invalidateQueries({ queryKey: ['issue'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const add = useMutation({
    mutationFn: ({ body, internal: note }: { body: string; internal: boolean }) => api.addComment(issue.id, body, note),
    onSuccess: (_c, v) => { refresh(); if (serviceDesk) toast(v.internal ? 'Internal note added' : 'Reply sent to the customer'); },
    onError,
  });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.updateComment(issue.id, id, body),
    onSuccess: () => { refresh(); setEditingId(null); },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteComment(issue.id, id), onSuccess: refresh, onError });
  const retry = useMutation({
    mutationFn: (emailId: string) => api.retryIssueEmail(issue.id, emailId),
    onSuccess: (e) => { refresh(); toast(e.status === 'SENT' ? 'Email sent' : `Still not sent: ${e.error ?? 'the mail server refused it'}`, e.status === 'SENT' ? undefined : 'error'); },
    onError,
  });

  // Emails are shown in place of their comment; the one that raised the request has none and stands on its own.
  const emailOf = new Map((emailData?.emails ?? []).filter((e) => e.commentId).map((e) => [e.commentId!, e]));
  type Item = { at: string; comment?: Comment; email?: IssueEmail };
  const items: Item[] = [
    ...(comments ?? []).map((c) => ({ at: c.createdAt, comment: c, email: emailOf.get(c.id) })),
    ...(emailData?.emails ?? []).filter((e) => !e.commentId).map((e) => ({ at: e.createdAt, email: e })),
  ];
  const sorted = items
    .filter((i) => tab !== 'emails' || i.email)
    .sort((a, b) => (newestFirst ? -1 : 1) * (new Date(a.at).getTime() - new Date(b.at).getTime()));
  const emailCount = emailData?.emails.length ?? 0;

  const renderEmail = (e: IssueEmail, c?: Comment) => (
    <EmailCard
      key={e.id}
      email={e}
      issueId={issue.id}
      ownAddresses={emailData?.ownAddresses ?? []}
      internal={c?.internal}
      onReply={canEmail ? (mode) => setCompose({ mode, original: e }) : undefined}
      onRetry={canEmail ? () => retry.mutate(e.id) : undefined}
      retrying={retry.isPending && retry.variables === e.id}
    />
  );

  const renderComment = (c: Comment) => {
    const mine = c.author.id === currentUser?.id;
    const edited = new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 1000;
    return (
      <div key={c.id} className="flex gap-3">
        <Avatar name={c.author.name} size="md" />
        <div className={`flex-1 min-w-0 ${c.internal ? 'rounded-[3px] bg-[#FFFAE6] px-3 py-2' : ''}`}>
          <div className="mb-1">
            <span className="font-semibold">{c.author.name}</span>
            {serviceDesk && (c.internal
              ? <span className="lozenge bg-[#FFF0B3] text-[#974F0C] ml-2">Internal note</span>
              : <span className="lozenge bg-[#DEEBFF] text-[#0747A6] ml-2">Shared with customer</span>)}
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
              <RichTextView value={c.body} />
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
    ...(serviceDesk ? [['emails', 'Emails'] as const] : []),
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
            {key === 'comments' && items.length ? <span className="ml-0.5 opacity-70">{items.length}</span> : null}
            {key === 'emails' && emailCount ? <span className="ml-0.5 opacity-70">{emailCount}</span> : null}
          </button>
        ))}
        {(tab === 'comments' || tab === 'emails') && sorted.length > 1 && (
          <button type="button" onClick={() => setNewestFirst(!newestFirst)} className="btn btn-subtle btn-sm ml-auto">
            {newestFirst ? 'Newest first' : 'Oldest first'}
          </button>
        )}
      </div>

      {(tab === 'comments' || tab === 'emails') && (
        <div className="space-y-5">
          {tab === 'emails' && canEmail && (
            <div className="ml-11">
              <button type="button" className="btn btn-default btn-sm" onClick={() => setCompose({ mode: 'new' })}><MailIcon size={14} /> Send email</button>
            </div>
          )}
          {tab === 'emails' && !sorted.length && <p className="text-jira-muted ml-11">No emails on this request yet.</p>}
          {tab === 'comments' && <div>
            {serviceDesk && (
              <div className="flex gap-1 mb-2 ml-11" role="group" aria-label="Comment visibility">
                <button type="button" aria-pressed={!internal} onClick={() => setInternal(false)} className={`btn btn-sm ${!internal ? 'bg-jira-blue-light text-jira-blue' : 'btn-subtle'}`}>Reply to customer</button>
                <button type="button" aria-pressed={internal} onClick={() => setInternal(true)} className={`btn btn-sm ${internal ? 'bg-[#FFF0B3] text-[#974F0C]' : 'btn-subtle'}`}>Add internal note</button>
                {canEmail && <button type="button" onClick={() => setCompose({ mode: 'new' })} className="btn btn-sm btn-subtle ml-auto"><MailIcon size={14} /> Send email</button>}
              </div>
            )}
            <div className="flex gap-3">
              {currentUser && <Avatar name={currentUser.name} size="md" />}
              <CommentEditor
                saving={add.isPending}
                onSave={(body) => add.mutate({ body, internal: serviceDesk && internal })}
                placeholder={!serviceDesk ? 'Add a comment…' : internal ? 'Add an internal note (only agents see it)…' : 'Reply to the customer…'}
              />
            </div>
          </div>}
          {sorted.map((i) => (i.email ? renderEmail(i.email, i.comment) : renderComment(i.comment!)))}
        </div>
      )}
      {compose && emailData && (
        <EmailComposer issue={issue} request={compose} data={emailData} onClose={() => setCompose(null)} />
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
