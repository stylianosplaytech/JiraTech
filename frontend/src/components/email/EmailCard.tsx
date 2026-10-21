import { useState } from 'react';
import { api, type EmailAddress, type IssueEmail } from '../../api';
import { timeAgo } from '../../utils';
import Avatar from '../Avatar';
import { AlertIcon, ForwardIcon, MailIcon, PaperclipIcon, ReplyAllIcon, ReplyIcon } from '../Icons';
import { useToast } from '../ui';
import EmailFrame, { hasQuotedText } from './EmailFrame';
import { canReplyAll, describeAddresses, formatAddress } from './recipients';

/** Everyone in full; those reached through a group or organization listed under its name. */
function list(l: EmailAddress[]) {
  const groups = new Map<string, EmailAddress[]>();
  for (const a of l) if (a.via) groups.set(a.via, [...(groups.get(a.via) ?? []), a]);
  return [
    ...l.filter((a) => !a.via).map(formatAddress),
    ...[...groups].map(([name, members]) => `${name} (${members.length}): ${members.map((a) => a.email).join(', ')}`),
  ].join('; ');
}
const short = describeAddresses;

/** An email on a request, shown the way a mail client would, with Reply / Reply all / Forward. */
export default function EmailCard({
  email, issueId, ownAddresses, internal, onReply, onRetry, retrying,
}: {
  email: IssueEmail;
  issueId: string;
  ownAddresses: string[];
  /** Sent as an internal note: the customer doesn't see it on the portal */
  internal?: boolean;
  /** Absent when the viewer can't send emails */
  onReply?: (mode: 'reply' | 'replyAll' | 'forward') => void;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const toast = useToast();
  const [details, setDetails] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const inbound = email.direction === 'INBOUND';
  const senderName = inbound ? (email.fromName || email.fromEmail) : (email.sentBy?.name ?? email.fromName ?? email.fromEmail);
  const failed = email.status === 'FAILED';

  const open = async (a: IssueEmail['attachments'][number]) => {
    const token = localStorage.getItem('token');
    const res = await fetch(api.getAttachmentUrl(issueId, a.id), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { toast('Could not open the attachment (it may have been deleted)', 'error'); return; }
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  };

  return (
    <div className="flex gap-3">
      <Avatar name={senderName} size="md" />
      <div className={`flex-1 min-w-0 rounded-[3px] border ${failed ? 'border-[#FF8F73]' : inbound ? 'border-jira-border' : 'border-[#B3D4FF]'} ${internal ? 'bg-[#FFFAE6]' : 'bg-white'}`}>
        <div className={`px-3 py-2 border-b ${failed ? 'border-[#FF8F73]' : 'border-jira-border'} ${inbound ? 'bg-jira-gray' : 'bg-[#F4F8FF]'} rounded-t-[3px]`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <MailIcon size={14} className="text-jira-subtle shrink-0" />
            <span className="font-semibold">{senderName}</span>
            {inbound
              ? <span className="text-jira-subtle text-xs">&lt;{email.fromEmail}&gt;</span>
              : <span className="lozenge bg-[#DEEBFF] text-[#0747A6]">Email sent</span>}
            {inbound && <span className="lozenge bg-jira-gray-hover text-[#42526E]">Email received</span>}
            {internal && <span className="lozenge bg-[#FFF0B3] text-[#974F0C]">Internal</span>}
            <span className="text-jira-muted text-xs ml-auto" title={new Date(email.createdAt).toLocaleString()}>{timeAgo(email.createdAt)}</span>
          </div>
          <div className="text-xs text-jira-subtle mt-0.5">
            {details ? (
              <div className="grid grid-cols-[56px_1fr] gap-x-2 gap-y-0.5 mt-1">
                <span>From</span><span className="break-all">{formatAddress({ email: email.fromEmail, name: email.fromName })}</span>
                <span>To</span><span className="break-all">{list(email.to) || '—'}</span>
                {email.cc.length > 0 && <><span>Cc</span><span className="break-all">{list(email.cc)}</span></>}
                {email.bcc.length > 0 && <><span>Bcc</span><span className="break-all">{list(email.bcc)}</span></>}
                {email.replyTo && <><span>Reply-To</span><span className="break-all">{email.replyTo}</span></>}
                <span>Date</span><span>{new Date(email.createdAt).toLocaleString()}</span>
              </div>
            ) : (
              <span className="truncate block">
                To: {short(email.to) || '—'}
                {email.cc.length > 0 && <> · Cc: {short(email.cc)}</>}
                {email.bcc.length > 0 && <> · Bcc: {short(email.bcc)}</>}
              </span>
            )}
            <button type="button" className="text-jira-blue hover:underline" onClick={() => setDetails(!details)}>
              {details ? 'Hide details' : 'Details'}
            </button>
          </div>
          <div className="font-medium mt-1 break-words">{email.subject || '(no subject)'}</div>
        </div>

        {failed && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#FFEBE6] text-[#BF2600] text-sm">
            <AlertIcon size={14} />
            <span className="flex-1 min-w-0">Not sent: {email.error ?? 'the mail server refused it'}</span>
            {onRetry && <button type="button" className="btn btn-default btn-sm" disabled={retrying} onClick={onRetry}>{retrying ? 'Sending…' : 'Try again'}</button>}
          </div>
        )}

        <div className="px-3 py-2">
          <EmailFrame html={email.html} showQuoted={showQuoted} />
          {hasQuotedText(email.html) && (
            <button type="button" className="btn btn-subtle btn-sm mt-1 px-1.5" title={showQuoted ? 'Hide the earlier messages' : 'Show the earlier messages'} onClick={() => setShowQuoted(!showQuoted)}>
              {showQuoted ? 'Hide quoted text' : '•••'}
            </button>
          )}
        </div>

        {email.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {email.attachments.map((a) => (
              <button key={a.id} type="button" onClick={() => void open(a)} className="flex items-center gap-1.5 rounded-[3px] border border-jira-border px-2 py-1 text-xs hover:bg-jira-gray max-w-[260px]">
                <PaperclipIcon size={12} className="shrink-0" />
                <span className="truncate">{a.filename}</span>
                <span className="text-jira-muted shrink-0">{Math.max(1, Math.round(a.size / 1024))} KB</span>
              </button>
            ))}
          </div>
        )}

        {onReply && (
          <div className="flex flex-wrap gap-1 px-2 py-1.5 border-t border-jira-border">
            <button type="button" className="btn btn-subtle btn-sm" onClick={() => onReply('reply')}><ReplyIcon size={14} /> Reply</button>
            {canReplyAll(email, ownAddresses) && (
              <button type="button" className="btn btn-subtle btn-sm" onClick={() => onReply('replyAll')}><ReplyAllIcon size={14} /> Reply all</button>
            )}
            <button type="button" className="btn btn-subtle btn-sm" onClick={() => onReply('forward')}><ForwardIcon size={14} /> Forward</button>
          </div>
        )}
      </div>
    </div>
  );
}
