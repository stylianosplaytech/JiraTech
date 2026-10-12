import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type MailSettings, type MailSettingsPatch, type MailSource } from '../api';
import { SelectPicker } from '../components/Pickers';
import { CopyIcon, MailIcon } from '../components/Icons';
import { EmptyState, PageHeader, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';

interface Draft {
  transport: 'SMTP' | 'GMAIL';
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  gmailClientId: string;
  gmailClientSecret: string;
  fromName: string;
  fromAddress: string;
  appUrl: string;
}

const draftOf = (s: MailSettings): Draft => ({
  transport: s.transport,
  smtpHost: s.smtpHost ?? '',
  smtpPort: String(s.smtpPort),
  smtpSecure: s.smtpSecure,
  smtpUser: s.smtpUser ?? '',
  smtpPassword: '',
  gmailClientId: s.gmailClientId ?? '',
  gmailClientSecret: '',
  fromName: s.fromName ?? '',
  fromAddress: s.fromAddress ?? '',
  appUrl: s.appUrl ?? '',
});

const SOURCES: Record<MailSource, { label: string; style: string }> = {
  gmail: { label: 'Sending through the connected Gmail account', style: 'bg-[#E3FCEF] text-[#006644]' },
  settings: { label: 'Sending through the SMTP server below', style: 'bg-[#E3FCEF] text-[#006644]' },
  'gmail-environment': { label: 'Sending through the Gmail account in the GMAIL_* settings', style: 'bg-[#DEEBFF] text-[#0747A6]' },
  environment: { label: 'Sending through the server in the SMTP_HOST setting', style: 'bg-[#DEEBFF] text-[#0747A6]' },
  outbox: { label: 'Not sending: emails are saved as files', style: 'bg-[#FFFAE6] text-[#7A5C00]' },
};

/** /settings/email — how every project's emails and the welcome emails are sent (global admins). */
export default function EmailSettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [params, setParams] = useSearchParams();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isAdmin = me?.role === 'ADMIN';
  const { data: settings, isLoading } = useQuery({ queryKey: ['mail-settings'], queryFn: api.getMailSettings, enabled: isAdmin });
  const [d, setD] = useState<Draft | null>(null);
  const [testTo, setTestTo] = useState('');
  useEffect(() => { if (settings) setD(draftOf(settings)); }, [settings]);
  useEffect(() => { if (me && !testTo) setTestTo(me.email); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from Google's sign-in page: say how it went (once, even though development mode runs effects twice).
  const reported = useRef(false);
  useEffect(() => {
    const outcome = params.get('gmail');
    if (!outcome || reported.current) return;
    reported.current = true;
    if (outcome === 'connected') toast('Gmail account connected: JiraTech now sends email through it');
    else toast(params.get('message') ?? 'The Gmail account could not be connected', 'error');
    setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = (s: MailSettings, message: string) => { queryClient.setQueryData(['mail-settings'], s); toast(message); };
  const save = useMutation({
    mutationFn: () => {
      const data: MailSettingsPatch = {
        transport: d!.transport,
        smtpHost: d!.smtpHost.trim(),
        smtpPort: Number(d!.smtpPort) || 587,
        smtpSecure: d!.smtpSecure,
        smtpUser: d!.smtpUser.trim(),
        gmailClientId: d!.gmailClientId.trim(),
        fromName: d!.fromName.trim(),
        fromAddress: d!.fromAddress.trim(),
        appUrl: d!.appUrl.trim(),
      };
      // Left empty, the saved password and secret are kept.
      if (d!.smtpPassword) data.smtpPassword = d!.smtpPassword;
      if (d!.gmailClientSecret) data.gmailClientSecret = d!.gmailClientSecret;
      return api.saveMailSettings(data);
    },
    onSuccess: (s) => saved(s, 'Email settings saved'),
  });
  const removePassword = useMutation({
    mutationFn: () => api.saveMailSettings({ smtpPassword: '' }),
    onSuccess: (s) => saved(s, 'Password removed'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const connect = useMutation({
    mutationFn: () => api.startGmailConnect(window.location.origin),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectGmail,
    onSuccess: (s) => saved(s, 'Gmail account disconnected'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const test = useMutation({
    mutationFn: () => api.sendTestMail(testTo.trim()),
    onSuccess: (r) => toast(r.source === 'outbox' ? `No mail server set: the test email was saved in ${r.file}` : `Test email sent to ${testTo.trim()}`),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (me && !isAdmin) return <EmptyState title="Administrators only">Only global administrators can change how JiraTech sends email.</EmptyState>;
  if (isLoading || !settings || !d) return <Spinner />;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => x && ({ ...x, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(settings));
  const setSecure = (secure: boolean) => setD((x) => x && ({
    ...x,
    smtpSecure: secure,
    smtpPort: secure && x.smtpPort === '587' ? '465' : !secure && x.smtpPort === '465' ? '587' : x.smtpPort,
  }));
  const gmail = d.transport === 'GMAIL';
  const redirectUri = `${window.location.origin}/api/mail-settings/google/callback`;
  const clientSaved = !!settings.gmailClientId && settings.hasGmailSecret;
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it', 'error'); }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Email settings">
        <p className="text-jira-subtle mt-2">
          How JiraTech sends all its email: notifications for every project, replies to service desk customers and the welcome and
          password emails people get. Each service desk's own incoming address is set on its project page.
        </p>
      </PageHeader>

      <div className="card px-4 py-3 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`lozenge ${SOURCES[settings.source].style}`}>{SOURCES[settings.source].label}</span>
        <span className="text-sm text-jira-subtle">From <span className="font-mono text-xs">{settings.from}</span></span>
        <span className="text-sm text-jira-subtle">Links point to <span className="font-mono text-xs">{settings.effectiveAppUrl}</span></span>
      </div>

      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <fieldset>
          <legend className="font-semibold mb-2">Send with</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup">
            {([
              ['GMAIL', 'Gmail account', 'Through Google\'s API over HTTPS. Works on hosts that block mail ports, such as Render\'s free plan.'],
              ['SMTP', 'Mail server (SMTP)', 'Any provider\'s SMTP server, e.g. your company\'s, Brevo or SendGrid.'],
            ] as const).map(([value, title, help]) => (
              <label key={value} className={`card p-3 cursor-pointer flex gap-2 ${d.transport === value ? 'border-jira-blue ring-1 ring-jira-blue' : ''}`}>
                <input type="radio" name="transport" className="mt-1" checked={d.transport === value} onChange={() => set('transport', value)} />
                <span>
                  <span className="font-medium">{title}</span>
                  <span className="field-help mt-0">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {gmail ? (
          <fieldset>
            <legend className="font-semibold mb-1">Gmail account</legend>
            <details className="card p-3 mb-3 text-sm" open={!clientSaved}>
              <summary className="cursor-pointer font-medium">First time? Set up access in Google Cloud (once, about 10 minutes)</summary>
              <ol className="list-decimal pl-5 mt-2 space-y-1.5 text-jira-subtle">
                <li>Open <a className="link" href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a>, signed in as the Gmail account that should send, and create a project, e.g. <em>JiraTech</em>.</li>
                <li><strong>APIs &amp; Services → Library</strong>: find <em>Gmail API</em> and click <strong>Enable</strong>.</li>
                <li>
                  <strong>OAuth consent screen</strong> (Google Auth Platform): app name <em>JiraTech</em>, your email as support and developer contact,
                  audience <strong>External</strong> (or <strong>Internal</strong> for a Google Workspace account). Then <strong>Publish app</strong> so it is
                  <em> In production</em>: in <em>Testing</em>, Google stops the connection after 7 days.
                </li>
                <li>
                  <strong>Credentials → Create credentials → OAuth client ID</strong>, type <strong>Web application</strong>. Under
                  <em> Authorized redirect URIs</em> add:
                  <span className="flex items-center gap-2 mt-1">
                    <code className="font-mono text-xs bg-jira-gray rounded-[3px] px-2 py-1 break-all">{redirectUri}</code>
                    <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label="Copy the redirect URI" onClick={() => copy(redirectUri)}><CopyIcon size={14} /></button>
                  </span>
                  <span className="block mt-1 text-xs">Add one for every address you open JiraTech at (e.g. your Render URL and http://localhost:5172 for local use).</span>
                </li>
                <li>Copy the <strong>Client ID</strong> and <strong>Client secret</strong> into the fields below, <strong>Save</strong>, then click <strong>Connect Gmail account</strong>.</li>
                <li>Google may warn that it <em>hasn't verified this app</em>: it's your own, so choose <strong>Advanced → Go to JiraTech</strong> and allow sending email.</li>
              </ol>
            </details>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="field-label">Client ID</span>
                <input className="input font-mono text-xs" autoComplete="off" value={d.gmailClientId} onChange={(e) => set('gmailClientId', e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" />
              </label>
              <label className="block">
                <span className="field-label">Client secret</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={d.gmailClientSecret}
                  onChange={(e) => set('gmailClientSecret', e.target.value)}
                  placeholder={settings.hasGmailSecret ? 'Saved — leave empty to keep' : ''}
                />
              </label>
            </div>
            <div className="card p-3 mt-3 flex flex-wrap items-center gap-3">
              <MailIcon size={18} className="text-jira-muted" />
              <div className="flex-1 min-w-0">
                {settings.gmailAccount
                  ? <>Connected: <strong className="break-all">{settings.gmailAccount}</strong><span className="field-help mt-0">Emails are sent from this account.</span></>
                  : <span className="text-jira-subtle">No Gmail account connected yet.</span>}
              </div>
              <button
                type="button"
                className={`btn btn-sm ${settings.gmailAccount ? 'btn-default' : 'btn-primary'}`}
                disabled={dirty || !clientSaved || connect.isPending}
                title={dirty ? 'Save your changes first' : !clientSaved ? 'Save the Client ID and Client secret first' : undefined}
                onClick={() => connect.mutate()}
              >
                {connect.isPending ? 'Opening Google…' : settings.gmailAccount ? 'Connect another account' : 'Connect Gmail account'}
              </button>
              {settings.gmailAccount && (
                <button
                  type="button"
                  className="btn btn-subtle btn-sm text-[#DE350B]"
                  disabled={disconnect.isPending}
                  onClick={async () => {
                    if (await confirm({
                      title: `Disconnect ${settings.gmailAccount}?`,
                      message: 'JiraTech stops sending through it and asks Google to revoke its access. Emails then go through the SMTP settings, if any.',
                      confirmLabel: 'Disconnect',
                      danger: true,
                    })) disconnect.mutate();
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
            {dirty && clientSaved && <p className="field-help">Save your changes before connecting.</p>}
          </fieldset>
        ) : (
          <fieldset>
            <legend className="font-semibold mb-1">Mail server (SMTP)</legend>
            <p className="field-help mt-0 mb-2">
              {settings.environment.smtpHost
                ? <>Leave the server empty to use the one in the server's SMTP_HOST setting ({settings.environment.smtpHost}).</>
                : <>Leave the server empty to save emails as files in backend/mail-outbox instead of sending them (for local development).</>}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px_160px] gap-2">
              <label className="block">
                <span className="field-label">Server</span>
                <input className="input" value={d.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} placeholder="smtp.example.com" />
              </label>
              <label className="block">
                <span className="field-label">Port</span>
                <input className="input" inputMode="numeric" value={d.smtpPort} onChange={(e) => set('smtpPort', e.target.value.replace(/\D/g, '').slice(0, 5))} />
              </label>
              <div>
                <span className="field-label">Security</span>
                <SelectPicker
                  variant="field"
                  searchable={false}
                  value={d.smtpSecure ? 'tls' : 'starttls'}
                  onChange={(v) => v && setSecure(v === 'tls')}
                  options={[{ id: 'starttls', label: 'STARTTLS', hint: 'port 587' }, { id: 'tls', label: 'SSL/TLS', hint: 'port 465' }]}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <label className="block">
                <span className="field-label">User name</span>
                <input className="input" autoComplete="off" value={d.smtpUser} onChange={(e) => set('smtpUser', e.target.value)} placeholder="Leave empty if the server needs no login" />
              </label>
              <label className="block">
                <span className="field-label">Password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={d.smtpPassword}
                  onChange={(e) => set('smtpPassword', e.target.value)}
                  placeholder={settings.hasPassword ? 'Saved — leave empty to keep' : ''}
                />
                {settings.hasPassword && (
                  <button type="button" className="btn btn-link btn-sm mt-1 px-0" disabled={removePassword.isPending} onClick={() => removePassword.mutate()}>Remove saved password</button>
                )}
              </label>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="font-semibold mb-1">Sender</legend>
          <p className="field-help mt-0 mb-2">
            {gmail ? 'The name people see. Gmail always sends from the connected account\'s address.' : 'How emails appear in people\'s inboxes. Most mail servers only accept a sender address they own.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="field-label">Name</span>
              <input className="input" value={d.fromName} onChange={(e) => set('fromName', e.target.value)} placeholder="JiraTech" />
            </label>
            {!gmail && (
              <label className="block">
                <span className="field-label">Address</span>
                <input className="input" type="email" value={d.fromAddress} onChange={(e) => set('fromAddress', e.target.value)} placeholder={settings.environment.mailFrom ?? 'no-reply@jiratech.local'} />
              </label>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-semibold mb-1">Link to JiraTech</legend>
          <label className="block">
            <span className="field-label">Web address</span>
            <input className="input" value={d.appUrl} onChange={(e) => set('appUrl', e.target.value)} placeholder={settings.environment.appUrl ?? window.location.origin} />
            <span className="field-help">Where the links in emails (issues, requests, choosing a password) take people. Usually the address you open JiraTech at: {window.location.origin}</span>
          </label>
        </fieldset>

        {save.isError && <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(save.error)}</div>}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={!dirty || save.isPending}>Save</button>
          {dirty && <button type="button" className="btn btn-subtle" onClick={() => setD(draftOf(settings))}>Discard changes</button>}
        </div>
      </form>

      <section className="mt-8 pt-6 border-t border-jira-border">
        <h2 className="font-semibold mb-1">Send a test email</h2>
        <p className="field-help mt-0 mb-2">Uses the saved settings{dirty ? ' (save your changes first)' : ''}. If it fails, the reason is shown.</p>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); test.mutate(); }}>
          <input className="input w-72" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Send the test to" />
          <button type="submit" className="btn btn-default" disabled={!testTo.trim() || test.isPending}>{test.isPending ? 'Sending…' : 'Send test email'}</button>
        </form>
      </section>
    </div>
  );
}
