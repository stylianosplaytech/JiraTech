import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type InboundDelivery, type InboundTestResult, type InboundWebhook } from '../api';
import { humanize, timeAgo } from '../utils';
import SecretReveal from '../components/SecretReveal';
import { EditIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { EmptyState, Modal, PageHeader, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';
import { canManageAny, defaultProjectKey, useAdminScope } from '../useAdminScope';

interface Form {
  id?: string;
  name: string;
  projectKey: string;
  enabled: boolean;
  issueType: string;
  priority: string;
  priorityFrom: string;
  summary: string;
  description: string;
  labels: string;
  assigneeId: string;
  dedupe: string;
  resolvePath: string;
  resolveEquals: string;
  includePayload: boolean;
}

const STATUS_STYLE: Record<InboundDelivery['status'], string> = {
  CREATED: 'bg-[#E3FCEF] text-[#006644]',
  COMMENTED: 'bg-[#DEEBFF] text-[#0747A6]',
  RESOLVED: 'bg-[#E3FCEF] text-[#006644]',
  IGNORED: 'bg-[#DFE1E6] text-[#42526E]',
  FAILED: 'bg-[#FFEBE6] text-[#BF2600]',
};

const SAMPLE = `{
  "status": "firing",
  "title": "High CPU on web-1",
  "message": "CPU is at 95%",
  "severity": "critical",
  "alerts": [{ "fingerprint": "abc123", "labels": { "host": "web-1" } }]
}`;

function formFor(hook?: InboundWebhook): Form {
  if (!hook) {
    return {
      name: '', projectKey: '', enabled: true, issueType: 'TASK', priority: 'MEDIUM', priorityFrom: '', summary: '{{title}}', description: '{{message}}',
      labels: '', assigneeId: '', dedupe: '', resolvePath: '', resolveEquals: '', includePayload: true,
    };
  }
  const c = hook.config;
  return {
    id: hook.id, name: hook.name, projectKey: hook.project.key, enabled: hook.enabled, issueType: c.issueType, priority: c.priority, priorityFrom: c.priorityFrom,
    summary: c.summary, description: c.description, labels: c.labels.join(' '), assigneeId: c.assigneeId ?? '', dedupe: c.dedupe,
    resolvePath: c.resolveWhen?.path ?? '', resolveEquals: c.resolveWhen?.equals ?? '', includePayload: c.includePayload,
  };
}

const payloadFor = (f: Form) => ({
  name: f.name.trim(),
  projectKey: f.projectKey,
  enabled: f.enabled,
  issueType: f.issueType,
  priority: f.priority,
  priorityFrom: f.priorityFrom.trim(),
  summary: f.summary.trim(),
  description: f.description.trim(),
  labels: f.labels.split(/[\s,]+/).filter(Boolean),
  assigneeId: f.assigneeId || undefined,
  dedupe: f.dedupe.trim(),
  resolvePath: f.resolvePath.trim(),
  resolveEquals: f.resolveEquals.trim(),
  includePayload: f.includePayload,
});

/** /settings/incoming-webhooks — addresses other systems POST events to, turned into issues (global admins). */
export default function InboundWebhooksPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const { data: scope, isLoading: loadingScope } = useAdminScope();
  const allowed = canManageAny(scope);
  const { data: hooks, isLoading, error } = useQuery({ queryKey: ['inbound-webhooks'], queryFn: api.getInboundWebhooks, enabled: allowed });
  const { data: meta } = useQuery({ queryKey: ['inbound-meta'], queryFn: api.getInboundWebhookMeta, enabled: allowed });
  const [form, setForm] = useState<Form | null>(null);
  const [address, setAddress] = useState<{ title: string; url: string } | null>(null);
  const [logFor, setLogFor] = useState<InboundWebhook | null>(null);
  const [tryFor, setTryFor] = useState<InboundWebhook | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['inbound-webhooks'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const save = useMutation({
    mutationFn: async () => {
      if (form!.id) return { hook: await api.updateInboundWebhook(form!.id, payloadFor(form!)), url: null as string | null };
      const { url, ...hook } = await api.createInboundWebhook(payloadFor(form!));
      return { hook, url };
    },
    onSuccess: ({ hook, url }) => {
      refresh();
      setForm(null);
      if (url) setAddress({ title: `${hook.name} created`, url });
      else toast(`${hook.name} saved`);
    },
    onError,
  });
  const remove = useMutation({ mutationFn: (h: InboundWebhook) => api.deleteInboundWebhook(h.id), onSuccess: () => { refresh(); toast('Incoming webhook deleted'); }, onError });
  const rotate = useMutation({
    mutationFn: (h: InboundWebhook) => api.rotateInboundWebhook(h.id),
    onSuccess: (h) => { refresh(); setForm(null); setAddress({ title: `New address for ${h.name}`, url: h.url }); },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (h: InboundWebhook) => api.updateInboundWebhook(h.id, payloadFor({ ...formFor(h), enabled: !h.enabled })),
    onSuccess: (h) => { refresh(); toast(h.enabled ? `${h.name} is on` : `${h.name} is paused`); },
    onError,
  });

  if (loadingScope || (allowed && isLoading)) return <Spinner />;
  if (!allowed) return <EmptyState title="Only administrators of a project can manage incoming webhooks" />;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Incoming webhooks"
        actions={<button type="button" className="btn btn-primary" onClick={() => setForm({ ...formFor(), projectKey: defaultProjectKey(scope) })}><PlusIcon size={14} /> Add incoming webhook</button>}
      />
      <p className="text-jira-subtle mb-4 max-w-3xl">
        Give a monitoring tool, CI system or script a secret address to POST JSON to, and Conductor turns each message into an issue in the project you choose.
        Repeated alerts can be added to the open issue instead of raising a new one, and a &ldquo;resolved&rdquo; message can close it. Issues are created as the person who
        last saved the webhook. Rules and outgoing webhooks react to these issues like any other.
      </p>
      <div className="card p-4">
        {error ? <p className="field-error">{errorMessage(error)}</p> : !hooks?.length ? (
          <p className="text-jira-muted text-sm">No incoming webhooks yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Project</th><th>Address</th><th>Status</th><th>Received</th><th /></tr></thead>
              <tbody>
                {hooks.map((h) => (
                  <tr key={h.id}>
                    <td className="font-medium"><button type="button" className="link text-left" onClick={() => setLogFor(h)}>{h.name}</button></td>
                    <td className="text-jira-subtle whitespace-nowrap">{h.project.key}</td>
                    <td className="font-mono text-xs text-jira-subtle">…/hooks/{h.tokenPrefix}…</td>
                    <td><span className={`lozenge ${h.enabled ? 'bg-[#E3FCEF] text-[#006644]' : 'bg-[#DFE1E6] text-[#42526E]'}`}>{h.enabled ? 'On' : 'Paused'}</span></td>
                    <td className="text-jira-subtle whitespace-nowrap" title={h.lastReceivedAt ? new Date(h.lastReceivedAt).toLocaleString() : undefined}>
                      {h.receivedCount}{h.lastReceivedAt && <span className="text-xs text-jira-muted"> · {timeAgo(h.lastReceivedAt)}</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button type="button" className="btn btn-subtle btn-sm" onClick={() => setTryFor(h)}>Try a message</button>
                      <button type="button" className="btn btn-subtle btn-sm" disabled={toggle.isPending} onClick={() => toggle.mutate(h)}>{h.enabled ? 'Pause' : 'Turn on'}</button>
                      <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Edit ${h.name}`} onClick={() => setForm(formFor(h))}><EditIcon size={14} /></button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Delete ${h.name}`}
                        onClick={async () => { if (await confirm({ title: `Delete ${h.name}?`, message: 'Its address stops working and its log is deleted. Issues it created stay.', confirmLabel: 'Delete', danger: true })) remove.mutate(h); }}
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

      {form && meta && (
        <Editor
          form={form}
          setForm={setForm}
          meta={meta}
          saving={save.isPending}
          onSave={() => save.mutate()}
          onRotate={async () => {
            const h = hooks?.find((x) => x.id === form.id);
            if (h && await confirm({ title: 'Generate a new address?', message: 'The current address stops working: give the new one to whatever sends the messages.', confirmLabel: 'Generate' })) rotate.mutate(h);
          }}
        />
      )}
      {address && (
        <SecretReveal
          title={address.title}
          intro="Give this address to the system that sends the events (POST, JSON body). Anyone who has it can create issues, so keep it secret. Copy it now: it cannot be shown again (editing the webhook lets you generate a new one)."
          label="Webhook address"
          secret={address.url}
          onClose={() => setAddress(null)}
        />
      )}
      {logFor && <DeliveryLog hook={logFor} onClose={() => setLogFor(null)} />}
      {tryFor && <TryMessage hook={tryFor} onClose={() => setTryFor(null)} />}
    </div>
  );
}

function Editor({ form, setForm, meta, saving, onSave, onRotate }: {
  form: Form;
  setForm: (f: Form | null) => void;
  meta: { issueTypes: string[]; priorities: string[] };
  saving: boolean;
  onSave: () => void;
  onRotate: () => void;
}) {
  const { data: scope } = useAdminScope();
  const projects = scope?.projects;
  const { data: users } = useQuery({ queryKey: ['users', 'staff'], queryFn: () => api.getUsers() });
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const valid = form.name.trim() && form.projectKey && (!form.resolvePath.trim() || form.dedupe.trim());

  return (
    <Modal
      title={form.id ? 'Edit incoming webhook' : 'Add incoming webhook'}
      onClose={() => setForm(null)}
      width="max-w-3xl"
      footer={(
        <>
          {form.id && <button type="button" className="btn btn-subtle mr-auto" onClick={onRotate}>New address…</button>}
          <button type="button" className="btn btn-subtle" onClick={() => setForm(null)}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!valid || saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="in-name">Name</label>
            <input id="in-name" autoFocus className="input" maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Grafana alerts" />
          </div>
          <div>
            <label className="field-label" htmlFor="in-project">Create issues in</label>
            <select id="in-project" className="input" value={form.projectKey} onChange={(e) => set({ projectKey: e.target.value })}>
              <option value="">Choose a project…</option>
              {projects?.map((p) => <option key={p.id} value={p.key}>{p.key} — {p.name}</option>)}
            </select>
          </div>
        </div>

        <p className="text-sm text-jira-subtle">
          Templates take values from the JSON that is sent: <code className="text-xs">{'{{title}}'}</code>, or nested ones such as{' '}
          <code className="text-xs">{'{{alerts.0.labels.alertname}}'}</code> (numbers pick list items). Use <strong>Try a message</strong> afterwards to check them against a sample.
        </p>

        <section className="card p-3 space-y-3">
          <h3 className="section-title">The issue</h3>
          <div>
            <label className="field-label" htmlFor="in-summary">Summary</label>
            <input id="in-summary" className="input" value={form.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="[{{severity}}] {{title}}" />
          </div>
          <div>
            <label className="field-label" htmlFor="in-description">Description</label>
            <textarea id="in-description" className="input" rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="{{message}}" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.includePayload} onChange={(e) => set({ includePayload: e.target.checked })} /> Add the received JSON to the description</label>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="field-label" htmlFor="in-type">Issue type</label>
              <select id="in-type" className="input" value={form.issueType} onChange={(e) => set({ issueType: e.target.value })}>
                {meta.issueTypes.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="in-priority">Priority</label>
              <select id="in-priority" className="input" value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
                {meta.priorities.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="in-assignee">Assign to</label>
              <select id="in-assignee" className="input" value={form.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
                <option value="">Nobody</option>
                {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="in-priority-from">Priority from the message (optional)</label>
              <input id="in-priority-from" className="input" value={form.priorityFrom} onChange={(e) => set({ priorityFrom: e.target.value })} placeholder="{{severity}}" />
              <span className="field-help">critical, high, warning, info, P1–P5 … are recognised; anything else uses the priority above.</span>
            </div>
            <div>
              <label className="field-label" htmlFor="in-labels">Labels</label>
              <input id="in-labels" className="input" value={form.labels} onChange={(e) => set({ labels: e.target.value })} placeholder="alert monitoring" />
              <span className="field-help">One word each, separated by spaces.</span>
            </div>
          </div>
        </section>

        <section className="card p-3 space-y-3">
          <h3 className="section-title">Repeated alerts (optional)</h3>
          <div>
            <label className="field-label" htmlFor="in-dedupe">Same alert when this is equal</label>
            <input id="in-dedupe" className="input" value={form.dedupe} onChange={(e) => set({ dedupe: e.target.value })} placeholder="{{alerts.0.fingerprint}}" />
            <span className="field-help">While the issue for an alert is open, a message with the same value is added to it as a comment instead of raising a new issue.</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="in-resolve-path">Close the issue when this field…</label>
              <input id="in-resolve-path" className="input" value={form.resolvePath} onChange={(e) => set({ resolvePath: e.target.value })} placeholder="status" />
            </div>
            <div>
              <label className="field-label" htmlFor="in-resolve-equals">…equals</label>
              <input id="in-resolve-equals" className="input" value={form.resolveEquals} onChange={(e) => set({ resolveEquals: e.target.value })} placeholder="resolved" />
            </div>
          </div>
          {form.resolvePath.trim() && !form.dedupe.trim() && <p className="field-error">Closing needs the &ldquo;same alert&rdquo; value, to know which issue to close.</p>}
        </section>

        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Webhook is on</label>
      </div>
    </Modal>
  );
}

/** Dry run: paste a sample message to see what would happen to it. */
function TryMessage({ hook, onClose }: { hook: InboundWebhook; onClose: () => void }) {
  const [text, setText] = useState(SAMPLE);
  const [parseError, setParseError] = useState<string | null>(null);
  const test = useMutation({ mutationFn: (payload: unknown) => api.testInboundWebhook(hook.id, payload) });
  const result: InboundTestResult | undefined = test.data;
  const run = () => {
    try {
      setParseError(null);
      test.mutate(JSON.parse(text));
    } catch (e) {
      setParseError(`That is not valid JSON: ${(e as Error).message}`);
    }
  };
  const verdict = (r: InboundTestResult) => {
    switch (r.action) {
      case 'create': return 'It would raise a new issue:';
      case 'comment': return `It would add a comment to the open issue ${r.existingKey}.`;
      case 'resolve': return `It would close the open issue ${r.existingKey}.`;
      case 'ignore': return 'It would be ignored: it says resolved, but no issue is open for this alert.';
    }
  };

  return (
    <Modal title={`Try a message: ${hook.name}`} onClose={onClose} width="max-w-2xl" footer={<button type="button" className="btn btn-subtle" onClick={onClose}>Close</button>}>
      <label className="field-label" htmlFor="try-json">Sample JSON (nothing is created)</label>
      <textarea id="try-json" className="input font-mono text-xs" rows={8} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="mt-2 mb-3"><button type="button" className="btn btn-primary" disabled={test.isPending} onClick={run}>{test.isPending ? 'Checking…' : 'Check'}</button></div>
      {parseError && <p className="field-error">{parseError}</p>}
      {test.error && <p className="field-error">{errorMessage(test.error)}</p>}
      {result && (
        <div className="space-y-2 text-sm">
          <p>{verdict(result)}</p>
          {result.action === 'create' && (
            <div className="card p-3 space-y-1">
              <div><span className="text-jira-muted">Summary:</span> <strong>{result.summary}</strong></div>
              <div><span className="text-jira-muted">Type / priority:</span> {humanize(result.issueType)} / {humanize(result.priority)}{result.assignee && <> · assigned to {result.assignee}</>}</div>
              {result.labels.length > 0 && <div><span className="text-jira-muted">Labels:</span> {result.labels.join(', ')}</div>}
              {result.description && <div className="whitespace-pre-wrap text-jira-subtle">{result.description}</div>}
            </div>
          )}
          {result.dedupeKey && <p className="text-xs text-jira-muted">Alert key: {result.dedupeKey}</p>}
        </div>
      )}
    </Modal>
  );
}

/** What was received lately and what became of it (14 days). */
function DeliveryLog({ hook, onClose }: { hook: InboundWebhook; onClose: () => void }) {
  const { data: deliveries, isLoading, error } = useQuery({
    queryKey: ['inbound-deliveries', hook.id],
    queryFn: () => api.getInboundDeliveries(hook.id),
    refetchInterval: 10_000,
  });
  const [shown, setShown] = useState<InboundDelivery | null>(null);
  return (
    <Modal title={`Received: ${hook.name}`} onClose={onClose} width="max-w-4xl">
      {isLoading ? <Spinner /> : error ? <p className="field-error">{errorMessage(error)}</p> : !deliveries?.length ? (
        <p className="text-jira-muted text-sm">Nothing has been received yet. Messages from the last 14 days are kept.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Result</th><th>Issue</th><th>Detail</th><th>When</th><th /></tr></thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td><span className={`lozenge ${STATUS_STYLE[d.status]}`}>{humanize(d.status)}</span></td>
                  <td className="font-mono text-xs">{d.issueKey ?? '—'}</td>
                  <td className={`text-xs max-w-[20rem] ${d.status === 'FAILED' ? 'text-[#BF2600]' : 'text-jira-subtle'}`}>{d.message ?? (d.dedupeKey ? `Alert ${d.dedupeKey}` : '')}</td>
                  <td className="text-jira-subtle whitespace-nowrap" title={new Date(d.createdAt).toLocaleString()}>{timeAgo(d.createdAt)}</td>
                  <td className="text-right"><button type="button" className="btn btn-subtle btn-sm" onClick={() => setShown(shown?.id === d.id ? null : d)}>Payload</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown && <pre className="card p-3 mt-3 text-xs overflow-auto max-h-72">{(() => { try { return JSON.stringify(JSON.parse(shown.payload), null, 2); } catch { return shown.payload; } })()}</pre>}
    </Modal>
  );
}
