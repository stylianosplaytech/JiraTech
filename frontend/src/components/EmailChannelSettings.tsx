import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api, type EmailChannel, type EmailChannelPatch, type EmailOutcome, type RequestType,
} from '../api';
import { timeAgo } from '../utils';
import { SelectPicker } from './Pickers';
import { EditIcon, MailIcon, TrashIcon } from './Icons';
import { Modal, Spinner, errorMessage, useDialogs, useToast } from './ui';

const OUTCOMES: Record<EmailOutcome, { label: string; style: string }> = {
  CREATED: { label: 'New request', style: 'bg-[#E3FCEF] text-[#006644]' },
  COMMENTED: { label: 'Reply added', style: 'bg-[#DEEBFF] text-[#0747A6]' },
  IGNORED: { label: 'Ignored', style: 'bg-[#DFE1E6] text-[#42526E]' },
  FAILED: { label: 'Failed', style: 'bg-[#FFEBE6] text-[#BF2600]' },
};

interface Draft {
  address: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  imapUser: string;
  imapPassword: string;
  imapFolder: string;
  portalId: string;
  requestTypeId: string;
  createCustomers: boolean;
}

const draftOf = (c: EmailChannel | null): Draft => ({
  address: c?.address ?? '',
  imapHost: c?.imapHost ?? '',
  imapPort: String(c?.imapPort ?? 993),
  imapSecure: c?.imapSecure ?? true,
  imapUser: c?.imapUser ?? '',
  imapPassword: '',
  imapFolder: c?.imapFolder ?? 'INBOX',
  portalId: c?.portalId ?? '',
  requestTypeId: c?.requestTypeId ?? '',
  createCustomers: c?.createCustomers ?? true,
});

function ChannelForm({ projectKey, channel, requestTypes, onClose }: {
  projectKey: string; channel: EmailChannel | null; requestTypes: RequestType[]; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => draftOf(channel));
  const { data: portals = [] } = useQuery({ queryKey: ['portals', projectKey], queryFn: () => api.getPortals(projectKey) });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const data: EmailChannelPatch = {
        address: d.address.trim(),
        imapHost: d.imapHost.trim(),
        imapPort: Number(d.imapPort) || 993,
        imapSecure: d.imapSecure,
        imapUser: d.imapUser.trim(),
        imapFolder: d.imapFolder.trim() || 'INBOX',
        portalId: d.portalId,
        requestTypeId: d.requestTypeId,
        createCustomers: d.createCustomers,
      };
      // Left empty, the saved password is kept.
      if (d.imapPassword) data.imapPassword = d.imapPassword;
      return api.saveEmailChannel(projectKey, data);
    },
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ['email-channel', projectKey] });
      toast(channel ? 'Email settings saved' : `${c.address} added. Test the connection, then turn it on.`);
      onClose();
    },
  });

  // Switching TLS mode moves the port along when it was the usual one.
  const setSecure = (secure: boolean) => setD((x) => ({
    ...x,
    imapSecure: secure,
    imapPort: secure && x.imapPort === '143' ? '993' : !secure && x.imapPort === '993' ? '143' : x.imapPort,
  }));

  return (
    <Modal
      title={channel ? 'Email settings' : 'Set up email'}
      onClose={onClose}
      width="max-w-2xl"
      footer={(
        <>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" form="email-channel-form" className="btn btn-primary" disabled={!d.address.trim() || save.isPending}>Save</button>
        </>
      )}
    >
      <form id="email-channel-form" className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="block">
          <span className="field-label">Email address <span className="text-[#DE350B]">*</span></span>
          <input className="input" type="email" autoFocus value={d.address} onChange={(e) => set('address', e.target.value)} placeholder="e.g. support@acme.com" />
          <span className="field-help">The address customers write to. Each service desk has its own. Emails to customers are sent with this as the reply address.</span>
        </label>

        <fieldset>
          <legend className="font-semibold text-sm mb-1">Mailbox (IMAP)</legend>
          <p className="field-help mt-0 mb-2">Where Conductor reads that address's emails. Your email provider lists these settings (Gmail needs an app password).</p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px_160px] gap-2">
            <label className="block">
              <span className="field-label">Mail server</span>
              <input className="input" value={d.imapHost} onChange={(e) => set('imapHost', e.target.value)} placeholder="imap.example.com" />
            </label>
            <label className="block">
              <span className="field-label">Port</span>
              <input className="input" inputMode="numeric" value={d.imapPort} onChange={(e) => set('imapPort', e.target.value.replace(/\D/g, '').slice(0, 5))} />
            </label>
            <div>
              <span className="field-label">Security</span>
              <SelectPicker
                variant="field"
                searchable={false}
                value={d.imapSecure ? 'tls' : 'starttls'}
                onChange={(v) => v && setSecure(v === 'tls')}
                options={[{ id: 'tls', label: 'SSL/TLS' }, { id: 'starttls', label: 'STARTTLS' }]}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px] gap-2 mt-2">
            <label className="block">
              <span className="field-label">User name</span>
              <input className="input" autoComplete="off" value={d.imapUser} onChange={(e) => set('imapUser', e.target.value)} placeholder="Usually the email address" />
            </label>
            <label className="block">
              <span className="field-label">Password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={d.imapPassword}
                onChange={(e) => set('imapPassword', e.target.value)}
                placeholder={channel?.hasPassword ? 'Saved — leave empty to keep' : ''}
              />
            </label>
            <label className="block">
              <span className="field-label">Folder</span>
              <input className="input" value={d.imapFolder} onChange={(e) => set('imapFolder', e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-semibold text-sm mb-1">New requests</legend>
          <p className="field-help mt-0 mb-2">
            A customer's email goes to the portal of their organization. Otherwise it goes to the default portal.
            Replies whose subject has a request's key, e.g. ({projectKey}-12), are added to that request.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span className="field-label">Default portal</span>
              <SelectPicker
                variant="field"
                searchable={false}
                value={d.portalId || ''}
                onChange={(v) => set('portalId', v ?? '')}
                options={[{ id: '', label: 'The first portal' }, ...portals.map((p) => ({ id: p.id, label: p.name, hint: `/portal/${p.slug}` }))]}
              />
            </div>
            <div>
              <span className="field-label">Request type</span>
              <SelectPicker
                variant="field"
                searchable={false}
                value={d.requestTypeId || ''}
                onChange={(v) => set('requestTypeId', v ?? '')}
                options={[{ id: '', label: 'The portal\'s first request type' }, ...requestTypes.map((t) => ({ id: t.id, label: t.name }))]}
              />
              <span className="field-help">If the portal doesn't offer it, its first request type is used.</span>
            </div>
          </div>
          <label className="flex items-start gap-2 cursor-pointer mt-3">
            <input type="checkbox" className="mt-1" checked={d.createCustomers} onChange={(e) => set('createCustomers', e.target.checked)} />
            <span>
              Accept emails from anyone
              <span className="field-help mt-0">
                Unknown senders get a customer account and access to the default portal. Untick this to accept only existing customers
                of this service desk, e.g. when the default portal belongs to one client company.
              </span>
            </span>
          </label>
        </fieldset>
        {save.isError && <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(save.error)}</div>}
      </form>
    </Modal>
  );
}

function TestEmailDialog({ projectKey, onClose }: { projectKey: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ from: '', fromName: '', subject: '', body: '' });
  const send = useMutation({
    mutationFn: () => api.sendTestEmail(projectKey, { ...form, fromName: form.fromName || undefined }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['email-messages', projectKey] });
      if (r.outcome === 'CREATED') toast(`Request ${r.issueKey} raised`);
      else if (r.outcome === 'COMMENTED') toast(`Reply added to ${r.issueKey}`);
      else toast(`${OUTCOMES[r.outcome].label}: ${r.detail ?? ''}`, 'error');
      onClose();
    },
  });
  return (
    <Modal
      title="Send a test email"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" form="test-email-form" className="btn btn-primary" disabled={!form.from.trim() || send.isPending}>Send</button>
        </>
      )}
    >
      <form id="test-email-form" className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        <p className="text-jira-subtle text-sm">
          Handled exactly like an email arriving in the mailbox, without a mail server. Put a request key in the subject, e.g. ({projectKey}-1), to try a reply.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="field-label">From <span className="text-[#DE350B]">*</span></span>
            <input className="input" type="email" autoFocus value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="anna@customer.local" />
          </label>
          <label className="block">
            <span className="field-label">Sender name</span>
            <input className="input" value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} placeholder="For new customers" />
          </label>
        </div>
        <label className="block">
          <span className="field-label">Subject</span>
          <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="The printer on floor 2 is jammed" />
        </label>
        <label className="block">
          <span className="field-label">Message</span>
          <textarea className="input" rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
        {send.isError && <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(send.error)}</div>}
      </form>
    </Modal>
  );
}

function ReceivedEmails({ projectKey }: { projectKey: string }) {
  const { data: messages } = useQuery({
    queryKey: ['email-messages', projectKey],
    queryFn: () => api.getEmailMessages(projectKey),
    refetchInterval: 30_000,
  });
  if (!messages) return <Spinner />;
  if (!messages.length) return <p className="text-jira-muted text-sm">No emails received yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead><tr><th>Received</th><th>From</th><th>Subject</th><th>Result</th></tr></thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap text-jira-subtle" title={new Date(m.receivedAt).toLocaleString()}>{timeAgo(m.receivedAt)}</td>
              <td className="max-w-[220px]">
                <span className="block truncate">{m.fromName || m.fromEmail || '—'}</span>
                {m.fromName && m.fromEmail && <span className="block truncate text-xs text-jira-muted">{m.fromEmail}</span>}
              </td>
              <td className="max-w-[280px]">
                <span className="block truncate">{m.subject || <span className="text-jira-muted">(no subject)</span>}</span>
                {m.test && <span className="lozenge bg-[#EAE6FF] text-[#403294] mt-0.5">Test</span>}
              </td>
              <td>
                <span className={`lozenge ${OUTCOMES[m.outcome].style}`}>{OUTCOMES[m.outcome].label}</span>
                {m.issueKey && <Link to={`/browse/${m.issueKey}`} className="link ml-2 whitespace-nowrap">{m.issueKey}</Link>}
                {m.detail && <span className="block text-xs text-jira-muted mt-0.5">{m.detail}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A service desk's own email address: emails become requests, replies become comments. */
export default function EmailChannelSettings({ projectKey, requestTypes, canAdmin }: {
  projectKey: string; requestTypes: RequestType[]; canAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['email-channel', projectKey], queryFn: () => api.getEmailChannel(projectKey) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['email-channel', projectKey] });
    queryClient.invalidateQueries({ queryKey: ['email-messages', projectKey] });
  };
  const onError = (e: unknown) => { refresh(); toast(errorMessage(e), 'error'); };

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.saveEmailChannel(projectKey, { enabled }),
    onSuccess: (c) => { refresh(); toast(c.enabled ? `Now receiving emails sent to ${c.address}` : 'Email channel turned off'); },
    onError,
  });
  const testConnection = useMutation({
    mutationFn: () => api.testEmailConnection(projectKey),
    onSuccess: (r) => toast(`Connected: ${r.messages} email${r.messages === 1 ? '' : 's'} in the folder, ${r.unseen} unread`),
    onError,
  });
  const check = useMutation({
    mutationFn: () => api.checkEmail(projectKey),
    onSuccess: (r) => {
      refresh();
      toast(r.received
        ? `${r.received} email${r.received === 1 ? '' : 's'}: ${r.created} new request${r.created === 1 ? '' : 's'}, ${r.commented} repl${r.commented === 1 ? 'y' : 'ies'}${r.ignored ? `, ${r.ignored} ignored` : ''}${r.failed ? `, ${r.failed} failed` : ''}`
        : 'No new emails');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteEmailChannel(projectKey),
    onSuccess: () => { refresh(); toast('Email channel removed'); },
    onError,
  });

  if (isLoading || !data) return <Spinner />;
  const c = data.channel;
  const complete = !!(c?.imapHost && c.imapUser && c.hasPassword);
  const busy = toggle.isPending || testConnection.isPending || check.isPending;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">Email</h3>
        {canAdmin && !c && <button type="button" className="btn btn-default btn-sm" onClick={() => setEditing(true)}><MailIcon size={14} /> Set up email</button>}
      </div>
      <p className="text-jira-subtle text-sm mb-3">
        Give this service desk its own email address. Each new email becomes a request from the sender, and replies are added to their request as comments.
        Attachments are included.
      </p>

      {!c ? (
        <p className="text-jira-muted text-sm">No email address yet{canAdmin ? '' : ': a project administrator can set one up'}.</p>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-jira-border">
            <MailIcon size={20} className="text-jira-muted" />
            <div className="min-w-0 flex-1">
              <a href={`mailto:${c.address}`} className="font-semibold link break-all">{c.address}</a>
              <div className="text-xs text-jira-subtle">
                {c.enabled
                  ? `Checked ${c.lastCheckedAt ? timeAgo(c.lastCheckedAt) : 'within a minute'}${data.polling ? `, every ${data.pollSeconds < 120 ? `${data.pollSeconds} seconds` : `${Math.round(data.pollSeconds / 60)} minutes`}` : ''}`
                  : complete ? 'Not receiving emails' : 'Mailbox settings not filled in'}
                {c.imapHost && <> · {c.imapUser}@{c.imapHost}:{c.imapPort} / {c.imapFolder}</>}
              </div>
            </div>
            {c.environmentPrefix && <span className="lozenge bg-[#EAE6FF] text-[#403294]" title={`Set by the ${c.environmentPrefix}* environment variables`}>Environment</span>}
            {c.lastError && c.enabled
              ? <span className="lozenge bg-[#FFEBE6] text-[#BF2600]">Error</span>
              : c.enabled
                ? <span className="lozenge bg-[#E3FCEF] text-[#006644]">Receiving</span>
                : <span className="lozenge bg-[#DFE1E6] text-[#42526E]">Off</span>}
          </div>
          <div className="p-4 space-y-4">
            {c.enabled && c.lastError && (
              <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2 text-sm">Last check failed: {c.lastError}</div>
            )}
            {c.enabled && !data.polling && (
              <div className="rounded-[3px] bg-[#FFFAE6] text-[#7A5C00] px-3 py-2 text-sm">
                The server was started with MAIL_POLLING=false, so mailboxes are only read when you click <em>Check now</em>.
              </div>
            )}
            {c.environmentPrefix && (
              <div className="rounded-[3px] bg-[#EAE6FF] text-[#403294] px-3 py-2 text-sm">
                Set by the <code>{c.environmentPrefix}*</code> environment variables, so it survives a database reset. To change it, edit them where
                the server is hosted (e.g. Render → Environment); they apply when it restarts.
                {!complete && <> Add <code>{c.environmentPrefix}IMAP_HOST</code> and <code>{c.environmentPrefix}IMAP_PASSWORD</code> to start receiving.</>}
              </div>
            )}
            {canAdmin && (
              <div className="flex flex-wrap gap-2">
                {/* Environment-defined desks are changed where the server is hosted. */}
                {!c.environmentPrefix && (
                  <>
                    <button type="button" className="btn btn-default btn-sm" onClick={() => setEditing(true)}><EditIcon size={14} /> Edit settings</button>
                    <button
                      type="button"
                      className={`btn btn-sm ${c.enabled ? 'btn-default' : 'btn-primary'}`}
                      disabled={busy || (!c.enabled && !complete)}
                      title={!c.enabled && !complete ? 'Fill in the mail server, user name and password first' : undefined}
                      onClick={() => toggle.mutate(!c.enabled)}
                    >
                      {c.enabled ? 'Turn off' : 'Turn on'}
                    </button>
                  </>
                )}
                <button type="button" className="btn btn-default btn-sm" disabled={busy || !complete} onClick={() => testConnection.mutate()}>
                  {testConnection.isPending ? 'Connecting…' : 'Test connection'}
                </button>
                <button type="button" className="btn btn-default btn-sm" disabled={busy || !complete} onClick={() => check.mutate()}>
                  {check.isPending ? 'Checking…' : 'Check now'}
                </button>
                <button type="button" className="btn btn-default btn-sm" onClick={() => setTesting(true)}>Send a test email</button>
                {!c.environmentPrefix && (
                  <button
                    type="button"
                    className="btn btn-subtle btn-sm text-[#DE350B]"
                    onClick={async () => {
                      if (await confirm({
                        title: `Remove ${c.address}?`,
                        message: 'Conductor stops reading the mailbox and forgets its settings. Requests raised by email stay.',
                        confirmLabel: 'Remove',
                        danger: true,
                      })) remove.mutate();
                    }}
                  >
                    <TrashIcon size={14} /> Remove
                  </button>
                )}
              </div>
            )}
            <div>
              <h4 className="font-semibold text-sm mb-2">Received emails</h4>
              <ReceivedEmails projectKey={projectKey} />
            </div>
          </div>
        </div>
      )}
      {editing && <ChannelForm projectKey={projectKey} channel={c} requestTypes={requestTypes} onClose={() => setEditing(false)} />}
      {testing && <TestEmailDialog projectKey={projectKey} onClose={() => setTesting(false)} />}
    </div>
  );
}
