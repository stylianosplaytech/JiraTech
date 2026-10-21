import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EmailAddress } from '../api';
import EmailFrame from '../components/email/EmailFrame';
import { describeAddresses } from '../components/email/recipients';
import { AlertIcon, PaperclipIcon } from '../components/Icons';
import { formatSize, openNoticeFile } from '../components/notices/NoticeAttachments';
import { EmptyState, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

/** A service notice as it was sent, with who it went to; an update starts from it. */
export default function NoticeViewPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: notice, isLoading, error } = useQuery({ queryKey: ['service-notice', id], queryFn: () => api.getServiceNotice(id!) });

  const retry = useMutation({
    mutationFn: () => api.retryServiceNotice(id!),
    onSuccess: (n) => {
      queryClient.setQueryData(['service-notice', id], n);
      queryClient.invalidateQueries({ queryKey: ['service-notices'] });
      toast(n.status === 'SENT' ? 'Notice sent' : `Still not sent: ${n.error ?? 'the mail server refused it'}`, n.status === 'SENT' ? 'success' : 'error');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error || !notice) return <EmptyState title={errorMessage(error)} action={<Link to="/notices" className="btn btn-default">Back to notices</Link>} />;

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        breadcrumbs={<Link to="/notices" className="link">Service notices</Link>}
        title={notice.subject}
        actions={(
          <>
            {notice.status === 'FAILED' && (
              <button type="button" className="btn btn-default" disabled={retry.isPending} onClick={() => retry.mutate()}>
                {retry.isPending ? 'Sending…' : 'Send again'}
              </button>
            )}
            <Link to={`/notices/new?from=${notice.id}`} className="btn btn-primary">Send update</Link>
          </>
        )}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start">
        <div className="card p-4 space-y-3 text-sm">
          {notice.status === 'FAILED' && (
            <div className="flex gap-2 rounded-[3px] bg-[#FFEBE6] px-3 py-2">
              <AlertIcon size={16} className="text-[#DE350B] shrink-0 mt-0.5" />
              <span>Not sent: {notice.error ?? 'the mail server refused it'}</span>
            </div>
          )}
          <Meta label="Sent">{new Date(notice.createdAt).toLocaleString()}{notice.sentBy ? ` by ${notice.sentBy.name}` : ''}</Meta>
          {notice.template && <Meta label="Template">{notice.template.name}</Meta>}
          <Recipients label="To" list={notice.to} />
          <Recipients label="Cc" list={notice.cc} />
          <Recipients label="Bcc" list={notice.bcc} />
          {notice.attachments.length > 0 && (
            <Meta label="Attachments">
              <ul className="space-y-1">
                {notice.attachments.map((f) => (
                  <li key={f.id} className="flex items-center gap-1.5 min-w-0">
                    <PaperclipIcon size={12} className="shrink-0 text-jira-subtle" />
                    <button type="button" className="link truncate text-left" onClick={() => void openNoticeFile(f, (m) => toast(m, 'error'))}>{f.filename}</button>
                    <span className="text-xs text-jira-muted shrink-0">{formatSize(f.size)}</span>
                  </li>
                ))}
              </ul>
            </Meta>
          )}
          <p className="text-xs text-jira-muted">{notice.recipientCount} {notice.recipientCount === 1 ? 'recipient' : 'recipients'} in all. Groups and organizations were expanded to their members when it was sent.</p>
        </div>
        <div className="card overflow-hidden min-w-0">
          <EmailFrame html={notice.html} showQuoted />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Recipients({ label, list }: { label: string; list: EmailAddress[] }) {
  if (!list.length) return null;
  return (
    <Meta label={label}>
      <div>{describeAddresses(list)}</div>
      <details className="mt-1">
        <summary className="text-xs text-jira-blue cursor-pointer">Everyone ({list.length})</summary>
        <ul className="mt-1 text-xs text-jira-subtle space-y-0.5 max-h-60 overflow-y-auto">
          {list.map((a) => <li key={a.email}>{a.name ? `${a.name} <${a.email}>` : a.email}{a.via ? <span className="text-jira-muted"> · {a.via}</span> : null}</li>)}
        </ul>
      </details>
    </Meta>
  );
}
