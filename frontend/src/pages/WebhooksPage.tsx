import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Webhook, type WebhookDelivery } from '../api';
import { timeAgo } from '../utils';
import SecretReveal from '../components/SecretReveal';
import { EditIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { EmptyState, Modal, PageHeader, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';
import { canManageAny, defaultProjectKey, useAdminScope } from '../useAdminScope';

interface Form {
  id?: string;
  name: string;
  url: string;
  projectKey: string;
  events: string[];
  active: boolean;
}

const STATUS_STYLE: Record<WebhookDelivery['status'], string> = {
  SUCCESS: 'bg-[#E3FCEF] text-[#006644]',
  FAILED: 'bg-[#FFEBE6] text-[#BF2600]',
  PENDING: 'bg-[#FFF0B3] text-[#172B4D]',
};

/** /settings/webhooks — addresses JiraTech sends signed events to (global admins). */
export default function WebhooksPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const { data: scope, isLoading: loadingScope } = useAdminScope();
  const allowed = canManageAny(scope);
  const { data: webhooks, isLoading, error } = useQuery({ queryKey: ['webhooks'], queryFn: api.getWebhooks, enabled: allowed });
  const { data: events } = useQuery({ queryKey: ['webhook-events'], queryFn: api.getWebhookEvents, enabled: allowed });
  const [form, setForm] = useState<Form | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [logFor, setLogFor] = useState<Webhook | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['webhooks'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const save = useMutation({
    mutationFn: async () => {
      const data = {
        name: form!.name.trim(), url: form!.url.trim(), events: form!.events, projectKey: form!.projectKey || undefined, active: form!.active,
      };
      if (form!.id) return { hook: await api.updateWebhook(form!.id, data), secret: null as string | null };
      const { secret: created, ...hook } = await api.createWebhook(data);
      return { hook, secret: created };
    },
    onSuccess: ({ hook, secret: created }) => {
      refresh();
      setForm(null);
      if (created) setSecret({ title: `Webhook ${hook.name} created`, value: created });
      else toast(`Webhook ${hook.name} saved`);
    },
    onError,
  });
  const remove = useMutation({ mutationFn: (w: Webhook) => api.deleteWebhook(w.id), onSuccess: () => { refresh(); toast('Webhook deleted'); }, onError });
  const rotate = useMutation({
    mutationFn: (w: Webhook) => api.rotateWebhookSecret(w.id),
    onSuccess: (w) => { setForm(null); setSecret({ title: `New secret for ${w.name}`, value: w.secret }); },
    onError,
  });
  const test = useMutation({
    mutationFn: (w: Webhook) => api.testWebhook(w.id),
    onSuccess: (d) => {
      refresh();
      if (d.status === 'SUCCESS') toast(`Test event delivered (answered ${d.responseStatus})`);
      else toast(`Test event failed: ${d.error ?? 'unknown error'}`, 'error');
    },
    onError,
  });

  if (loadingScope || (allowed && isLoading)) return <Spinner />;
  if (!allowed) return <EmptyState title="Only administrators of a project can manage webhooks" />;

  const toggleEvent = (name: string) => setForm((f) => (f ? { ...f, events: f.events.includes(name) ? f.events.filter((e) => e !== name) : [...f.events, name] } : f));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Webhooks"
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setForm({ name: '', url: '', projectKey: defaultProjectKey(scope), events: events?.map((e) => e.name) ?? [], active: true })}>
            <PlusIcon size={14} /> Add webhook
          </button>
        )}
      />
      <p className="text-jira-subtle mb-4 max-w-3xl">
        JiraTech sends a signed POST with the event as JSON to each webhook when something happens to an issue. Failed deliveries are retried
        over several hours. Every request carries an <code className="text-xs">X-JiraTech-Signature</code> header (HMAC-SHA256 of{' '}
        <code className="text-xs">timestamp.body</code> with the webhook&apos;s secret) so the receiver can check it is genuine. To call JiraTech
        from scripts instead, create an <Link to="/settings/api-tokens" className="link">API token</Link>.
      </p>
      <div className="card p-4">
        {error ? <p className="field-error">{errorMessage(error)}</p> : !webhooks?.length ? (
          <p className="text-jira-muted text-sm">No webhooks yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Address</th><th>Project</th><th>Events</th><th>Status</th><th /></tr></thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="font-medium">
                      <button type="button" className="link text-left" onClick={() => setLogFor(w)}>{w.name}</button>
                    </td>
                    <td className="text-jira-subtle max-w-xs truncate" title={w.url}>{w.url}</td>
                    <td className="text-jira-subtle whitespace-nowrap">{w.project ? w.project.key : 'All projects'}</td>
                    <td className="text-jira-subtle whitespace-nowrap">{w.events.length} of {events?.length ?? '…'}</td>
                    <td className="whitespace-nowrap">
                      {w.active
                        ? <span className="lozenge bg-[#E3FCEF] text-[#006644]">Active</span>
                        : <span className="lozenge bg-[#DFE1E6] text-[#42526E]" title={w.disabledReason ?? undefined}>{w.disabledReason ? 'Switched off' : 'Paused'}</span>}
                      {w.failureCount > 0 && <span className="text-xs text-[#BF2600] ml-2">{w.failureCount} failed</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button type="button" className="btn btn-subtle btn-sm" disabled={test.isPending} onClick={() => test.mutate(w)}>Send test</button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Edit ${w.name}`}
                        onClick={() => setForm({ id: w.id, name: w.name, url: w.url, projectKey: w.project?.key ?? '', events: w.events, active: w.active })}
                      >
                        <EditIcon size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Delete ${w.name}`}
                        onClick={async () => {
                          if (await confirm({ title: `Delete ${w.name}?`, message: 'Its delivery history is deleted too.', confirmLabel: 'Delete', danger: true })) remove.mutate(w);
                        }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <Modal
          title={form.id ? 'Edit webhook' : 'Add webhook'}
          onClose={() => setForm(null)}
          width="max-w-xl"
          footer={(
            <>
              {form.id && (
                <button
                  type="button"
                  className="btn btn-subtle mr-auto"
                  disabled={rotate.isPending}
                  onClick={async () => {
                    const w = webhooks?.find((x) => x.id === form.id);
                    if (w && await confirm({ title: 'Generate a new secret?', message: 'The current secret stops working: update the receiver with the new one.', confirmLabel: 'Generate' })) rotate.mutate(w);
                  }}
                >
                  New secret…
                </button>
              )}
              <button type="button" className="btn btn-subtle" onClick={() => setForm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!form.name.trim() || !form.url.trim() || !form.events.length || (!scope?.global && !form.projectKey) || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        >
          <div className="space-y-3">
            <div>
              <label className="field-label" htmlFor="hook-name">Name</label>
              <input id="hook-name" autoFocus className="input" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Incident bot" />
            </div>
            <div>
              <label className="field-label" htmlFor="hook-url">Address</label>
              <input id="hook-url" className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/hooks/jiratech" />
              <span className="field-help">Servers on internal networks are refused unless the administrator sets WEBHOOK_ALLOW_PRIVATE=true.</span>
            </div>
            <div>
              <label className="field-label" htmlFor="hook-project">Projects</label>
              <select id="hook-project" className="input" value={form.projectKey} onChange={(e) => setForm({ ...form, projectKey: e.target.value })}>
                {scope?.global && <option value="">All projects</option>}
                {scope?.projects.map((p) => <option key={p.id} value={p.key}>{p.key} — {p.name}</option>)}
              </select>
            </div>
            <fieldset>
              <legend className="field-label">Events</legend>
              <div className="space-y-1">
                {events?.map((e) => (
                  <label key={e.name} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.events.includes(e.name)} onChange={() => toggleEvent(e.name)} />
                    <span>{e.label}</span>
                    <code className="text-xs text-jira-muted">{e.name}</code>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </div>
        </Modal>
      )}

      {secret && (
        <SecretReveal
          title={secret.title}
          intro="Use this secret to verify the X-JiraTech-Signature header of each request. Copy it now: it cannot be shown again (you can generate a new one by editing the webhook)."
          label="Signing secret"
          secret={secret.value}
          onClose={() => setSecret(null)}
        />
      )}
      {logFor && <DeliveryLog webhook={logFor} onClose={() => setLogFor(null)} />}
    </div>
  );
}

/** The recent events sent to a webhook, and how each went. */
function DeliveryLog({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: deliveries, isLoading, error } = useQuery({
    queryKey: ['webhook-deliveries', webhook.id],
    queryFn: () => api.getWebhookDeliveries(webhook.id),
    refetchInterval: 10_000,
  });
  const [shown, setShown] = useState<WebhookDelivery | null>(null);
  const resend = useMutation({
    mutationFn: (d: WebhookDelivery) => api.redeliverWebhook(webhook.id, d.id),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', webhook.id] });
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast(d.status === 'SUCCESS' ? 'Delivered again' : `Failed again: ${d.error ?? 'unknown error'}`, d.status === 'SUCCESS' ? 'success' : 'error');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Modal title={`Deliveries: ${webhook.name}`} onClose={onClose} width="max-w-4xl">
      {webhook.disabledReason && <p className="text-sm text-[#BF2600] mb-3">{webhook.disabledReason}</p>}
      {isLoading ? <Spinner /> : error ? <p className="field-error">{errorMessage(error)}</p> : !deliveries?.length ? (
        <p className="text-jira-muted text-sm">Nothing has been sent yet. Events from the last 14 days are kept.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Result</th><th>When</th><th /></tr></thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td><button type="button" className="link text-left font-mono text-xs" onClick={() => setShown(shown?.id === d.id ? null : d)}>{d.event}</button></td>
                  <td><span className={`lozenge ${STATUS_STYLE[d.status]}`}>{d.status === 'PENDING' ? 'Retrying' : d.status === 'SUCCESS' ? 'Delivered' : 'Failed'}</span></td>
                  <td>{d.attempts}</td>
                  <td className="text-jira-subtle text-xs max-w-[16rem]">
                    {d.error ?? (d.responseStatus ? `${d.responseStatus} in ${d.durationMs} ms` : '—')}
                    {d.status === 'PENDING' && d.nextAttemptAt && <div>Next try {new Date(d.nextAttemptAt).toLocaleTimeString()}</div>}
                  </td>
                  <td className="text-jira-subtle whitespace-nowrap" title={new Date(d.createdAt).toLocaleString()}>{timeAgo(d.createdAt)}</td>
                  <td className="text-right">
                    <button type="button" className="btn btn-subtle btn-sm" disabled={resend.isPending} onClick={() => resend.mutate(d)}>Resend</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown && (
        <div className="mt-3">
          <div className="field-label">Payload ({shown.event})</div>
          <pre className="card p-3 text-xs overflow-auto max-h-72">{JSON.stringify(shown.payload, null, 2)}</pre>
        </div>
      )}
    </Modal>
  );
}
