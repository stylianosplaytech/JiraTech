import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type MailSettings, type MailSettingsPatch } from '../api';
import { SelectPicker } from '../components/Pickers';
import { EmptyState, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

interface Draft {
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromName: string;
  fromAddress: string;
  appUrl: string;
}

const draftOf = (s: MailSettings): Draft => ({
  smtpHost: s.smtpHost ?? '',
  smtpPort: String(s.smtpPort),
  smtpSecure: s.smtpSecure,
  smtpUser: s.smtpUser ?? '',
  smtpPassword: '',
  fromName: s.fromName ?? '',
  fromAddress: s.fromAddress ?? '',
  appUrl: s.appUrl ?? '',
});

const SOURCES = {
  settings: { label: 'Sending through the server below', style: 'bg-[#E3FCEF] text-[#006644]' },
  environment: { label: 'Sending through the server in the SMTP_HOST setting', style: 'bg-[#DEEBFF] text-[#0747A6]' },
  outbox: { label: 'Not sending: emails are saved as files', style: 'bg-[#FFFAE6] text-[#7A5C00]' },
};

/** /settings/email — the SMTP server every project's emails and the welcome emails go through (global admins). */
export default function EmailSettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isAdmin = me?.role === 'ADMIN';
  const { data: settings, isLoading } = useQuery({ queryKey: ['mail-settings'], queryFn: api.getMailSettings, enabled: isAdmin });
  const [d, setD] = useState<Draft | null>(null);
  const [testTo, setTestTo] = useState('');
  useEffect(() => { if (settings) setD(draftOf(settings)); }, [settings]);
  useEffect(() => { if (me && !testTo) setTestTo(me.email); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => {
      const data: MailSettingsPatch = {
        smtpHost: d!.smtpHost.trim(),
        smtpPort: Number(d!.smtpPort) || 587,
        smtpSecure: d!.smtpSecure,
        smtpUser: d!.smtpUser.trim(),
        fromName: d!.fromName.trim(),
        fromAddress: d!.fromAddress.trim(),
        appUrl: d!.appUrl.trim(),
      };
      // Left empty, the saved password is kept.
      if (d!.smtpPassword) data.smtpPassword = d!.smtpPassword;
      return api.saveMailSettings(data);
    },
    onSuccess: (s) => { queryClient.setQueryData(['mail-settings'], s); toast('Email settings saved'); },
  });
  const removePassword = useMutation({
    mutationFn: () => api.saveMailSettings({ smtpPassword: '' }),
    onSuccess: (s) => { queryClient.setQueryData(['mail-settings'], s); toast('Password removed'); },
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

  return (
    <div className="max-w-3xl">
      <PageHeader title="Email settings">
        <p className="text-jira-subtle mt-2">
          The mail server JiraTech sends all its email through: notifications for every project, replies to service desk customers and
          the welcome emails new people get from the <Link to="/users" className="link">People</Link> page. Each service desk's own
          incoming address is set on its project page.
        </p>
      </PageHeader>

      <div className="card px-4 py-3 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`lozenge ${SOURCES[settings.source].style}`}>{SOURCES[settings.source].label}</span>
        <span className="text-sm text-jira-subtle">From <span className="font-mono text-xs">{settings.from}</span></span>
        <span className="text-sm text-jira-subtle">Links point to <span className="font-mono text-xs">{settings.effectiveAppUrl}</span></span>
      </div>

      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
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

        <fieldset>
          <legend className="font-semibold mb-1">Sender</legend>
          <p className="field-help mt-0 mb-2">How emails appear in people's inboxes. Most mail servers only accept a sender address they own.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="field-label">Name</span>
              <input className="input" value={d.fromName} onChange={(e) => set('fromName', e.target.value)} placeholder="JiraTech" />
            </label>
            <label className="block">
              <span className="field-label">Address</span>
              <input className="input" type="email" value={d.fromAddress} onChange={(e) => set('fromAddress', e.target.value)} placeholder={settings.environment.mailFrom ?? 'no-reply@jiratech.local'} />
            </label>
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
        <p className="field-help mt-0 mb-2">Uses the saved settings{dirty ? ' (save your changes first)' : ''}. If it fails, the mail server's reason is shown.</p>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); test.mutate(); }}>
          <input className="input w-72" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Send the test to" />
          <button type="submit" className="btn btn-default" disabled={!testTo.trim() || test.isPending}>{test.isPending ? 'Sending…' : 'Send test email'}</button>
        </form>
      </section>
    </div>
  );
}
