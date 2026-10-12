import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isCustomer } from '../api';
import { timeAgo } from '../utils';
import { StatusBadge } from '../components/Badges';
import { RichTextEditor, RichTextView } from '../components/RichText';
import Avatar from '../components/Avatar';
import { EmptyState, Spinner, errorMessage, useToast } from '../components/ui';
import { SelectPicker } from '../components/Pickers';
import { usePortalBrand } from './PortalLayout';

/** The customer's view of a request: public conversation only. */
export default function PortalRequestPage() {
  const { key = '' } = useParams<{ key: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: request, isLoading, error } = useQuery({
    queryKey: ['portal-request', key],
    queryFn: () => api.getPortalRequest(key),
    retry: false,
    refetchInterval: 60_000,
  });

  // Opening a request counts as reading its notifications.
  const requestId = request?.id;
  useEffect(() => {
    if (!requestId) return;
    api.markIssueNotificationsRead(requestId)
      .then((r) => queryClient.setQueryData(['notifications', 'count'], r))
      .catch(() => undefined);
  }, [requestId, queryClient]);

  // Take on the look of the portal the request was raised through.
  usePortalBrand(request?.portal && { slug: request.portal.slug, name: request.portal.name, branding: request.portal.branding });

  const share = useMutation({
    mutationFn: (organizationId: string | null) => api.shareRequest(key, organizationId),
    onSuccess: (r) => {
      queryClient.setQueryData(['portal-request', key], r);
      queryClient.invalidateQueries({ queryKey: ['portal-requests'] });
      toast(r.organization ? `Shared with ${r.organization.name}` : 'Only you and the support team can see this request now');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const send = useMutation({
    mutationFn: () => api.replyToRequest(key, reply),
    onSuccess: (r) => {
      queryClient.setQueryData(['portal-request', key], r);
      queryClient.invalidateQueries({ queryKey: ['portal-requests'] });
      setReply('');
      toast('Reply sent');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (isLoading) return <Spinner />;
  if (!request) {
    return (
      <EmptyState title="Request not found" action={<Link to="/portal/requests" className="btn btn-default">Your requests</Link>}>
        {error ? errorMessage(error) : `${key} doesn't exist or isn't shared with you.`}
      </EmptyState>
    );
  }

  const resolved = request.status.category === 'CLOSED';
  return (
    <div>
      <nav className="text-sm text-jira-subtle mb-2" aria-label="Breadcrumb">
        <Link to="/portal" className="hover:underline">Help center</Link>
        {request.portal && <> / <Link to={`/portal/${request.portal.slug}`} className="hover:underline">{request.portal.name}</Link></>}
      </nav>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 mb-6">
        <h1 className="page-title min-w-0 break-words flex-1">{request.summary}</h1>
        {me && !isCustomer(me) && <Link to={`/browse/${request.key}`} className="btn btn-default">Open in JiraTech</Link>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6">
        <div className="min-w-0 space-y-6">
          <section className="card bg-white p-5">
            <div className="flex items-center gap-3 mb-3">
              {request.reporter && <Avatar name={request.reporter.name} size="md" />}
              <div className="text-sm">
                <span className="font-semibold">{request.reporter?.name ?? 'Someone'}</span> raised this request
                <span className="text-jira-muted ml-2" title={new Date(request.createdAt).toLocaleString()}>{timeAgo(request.createdAt)}</span>
              </div>
            </div>
            <RichTextView value={request.description} empty={<p className="text-jira-muted">No description.</p>} />
            {request.fields.length > 0 && (
              <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-jira-border pt-4">
                {request.fields.map((f) => (
                  <div key={f.name}>
                    <dt className="text-xs font-semibold text-jira-muted">{f.name}</dt>
                    <dd className="break-words">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">Activity</h2>
            <div className="space-y-4">
              {request.comments.length === 0 && <p className="text-jira-muted">No replies yet. We'll let you know when there's an update.</p>}
              {request.comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <Avatar name={c.author.name} size="md" />
                  <div className={`flex-1 min-w-0 rounded-[3px] px-4 py-3 ${c.author.agent ? 'bg-white border border-jira-border' : 'bg-jira-blue-light/50'}`}>
                    <div className="mb-1 text-sm">
                      <span className="font-semibold">{c.author.name}</span>
                      {c.author.agent && <span className="lozenge bg-jira-gray-hover text-[#42526E] ml-2">Support</span>}
                      <span className="text-jira-muted ml-2" title={new Date(c.createdAt).toLocaleString()}>{timeAgo(c.createdAt)}</span>
                    </div>
                    <RichTextView value={c.body} />
                  </div>
                </div>
              ))}
            </div>

            <form className="mt-6" onSubmit={(e) => { e.preventDefault(); if (reply) send.mutate(); }}>
              <label className="field-label" htmlFor="reply">{resolved ? 'Still need help? Reply to re-open the conversation' : 'Add a reply'}</label>
              <RichTextEditor value={reply} onChange={setReply} mentions={false} placeholder="Type your reply…" minHeight={90} onSubmit={() => reply && send.mutate()} />
              <div className="flex items-center gap-2 mt-2">
                <button type="submit" className="btn btn-primary" disabled={!reply || send.isPending}>{send.isPending ? 'Sending…' : 'Send'}</button>
                <span className="text-xs text-jira-muted">Ctrl+Enter to send</span>
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="card bg-white p-4 space-y-3 text-sm">
            <div>
              <div className="text-xs font-semibold text-jira-muted mb-1">Status</div>
              <StatusBadge status={request.status.category} name={request.status.name} />
              {resolved && request.resolution === 'REJECTED' && <span className="text-jira-subtle ml-2">Won't do</span>}
            </div>
            <div><div className="text-xs font-semibold text-jira-muted">Reference</div><span className="font-mono">{request.key}</span></div>
            {request.requestType && <div><div className="text-xs font-semibold text-jira-muted">Request type</div>{request.requestType.name}</div>}
            <div><div className="text-xs font-semibold text-jira-muted">Raised by</div>{request.reporter?.name ?? '—'}</div>
            {request.shareWith && (request.shareWith.length > 0 || request.organization) ? (
              <div>
                <div className="text-xs font-semibold text-jira-muted mb-1">Shared with</div>
                <SelectPicker
                  variant="field"
                  searchable={false}
                  disabled={share.isPending}
                  value={request.organization?.id ?? 'private'}
                  onChange={(v) => {
                    const next = !v || v === 'private' ? null : v;
                    if (next !== (request.organization?.id ?? null)) share.mutate(next);
                  }}
                  options={[
                    ...request.shareWith.map((o) => ({ id: o.id, label: o.name, hint: 'Your colleagues can see it' })),
                    { id: 'private', label: 'No one', hint: 'Only you and the support team' },
                  ]}
                />
              </div>
            ) : request.organization && (
              <div><div className="text-xs font-semibold text-jira-muted">Shared with</div>{request.organization.name}</div>
            )}
            {request.participants.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-jira-muted mb-1">Shared with</div>
                <ul className="space-y-1">
                  {request.participants.map((p) => <li key={p.id} className="flex items-center gap-2"><Avatar name={p.name} size="xs" />{p.name}</li>)}
                </ul>
              </div>
            )}
            <div><div className="text-xs font-semibold text-jira-muted">Last updated</div>{timeAgo(request.updatedAt)}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
