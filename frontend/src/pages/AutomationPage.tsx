import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AutomationAction, type AutomationRule, type AutomationRun, type AutomationTestResult } from '../api';
import { humanize, timeAgo } from '../utils';
import { EditIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { EmptyState, Modal, PageHeader, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';

const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];
const ACTION_LABELS: Record<AutomationAction['type'], string> = {
  assign: 'Assign the issue',
  set_priority: 'Set the priority',
  transition: 'Move to a status',
  comment: 'Add a comment',
  add_label: 'Add a label',
  email: 'Send an email',
};
const EMAIL_ROLES = [
  { value: 'assignee', label: 'The assignee' },
  { value: 'reporter', label: 'The reporter' },
  { value: 'lead', label: 'The project lead' },
];
const RUN_STYLE: Record<AutomationRun['status'], string> = {
  SUCCESS: 'bg-[#E3FCEF] text-[#006644]',
  FAILED: 'bg-[#FFEBE6] text-[#BF2600]',
  SKIPPED: 'bg-[#FFF0B3] text-[#172B4D]',
};

interface Form {
  id?: string;
  name: string;
  description: string;
  projectKey: string;
  enabled: boolean;
  event: string;
  fields: string[];
  toStatus: string;
  jql: string;
  actions: AutomationAction[];
}

/** remainingEstimate → Remaining estimate */
const fieldLabel = (f: string) => {
  const words = f.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const blankAction = (type: AutomationAction['type']): AutomationAction => {
  switch (type) {
    case 'assign': return { type, to: 'unassigned' };
    case 'set_priority': return { type, priority: 'HIGH' };
    case 'transition': return { type, status: '' };
    case 'comment': return { type, body: '', internal: false };
    case 'add_label': return { type, label: '' };
    case 'email': return { type, to: ['assignee'], subject: '', body: '' };
  }
};

function formFor(rule?: AutomationRule): Form {
  return rule
    ? {
      id: rule.id, name: rule.name, description: rule.description ?? '', projectKey: rule.project?.key ?? '', enabled: rule.enabled,
      event: rule.event, fields: rule.trigger.fields ?? [], toStatus: rule.trigger.toStatus ?? '', jql: rule.jql ?? '', actions: rule.actions,
    }
    : {
      name: '', description: '', projectKey: '', enabled: true, event: 'issue.created', fields: [], toStatus: '', jql: '', actions: [blankAction('comment')],
    };
}

/** /settings/automation — rules that react to what happens to issues (global admins). */
export default function AutomationPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const { data: me, isLoading: loadingMe } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isAdmin = me?.role === 'ADMIN';
  const { data: rules, isLoading, error } = useQuery({ queryKey: ['automation-rules'], queryFn: api.getAutomationRules, enabled: isAdmin });
  const { data: meta } = useQuery({ queryKey: ['automation-meta'], queryFn: api.getAutomationMeta, enabled: isAdmin });
  const [form, setForm] = useState<Form | null>(null);
  const [logFor, setLogFor] = useState<AutomationRule | null>(null);
  const [testFor, setTestFor] = useState<AutomationRule | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const payload = (f: Form) => ({
    name: f.name.trim(),
    description: f.description.trim() || undefined,
    projectKey: f.projectKey || undefined,
    enabled: f.enabled,
    event: f.event,
    trigger: f.event === 'issue.updated' ? { fields: f.fields } : f.event === 'issue.transitioned' ? { toStatus: f.toStatus.trim() || undefined } : {},
    jql: f.jql.trim() || undefined,
    actions: f.actions,
  });
  const save = useMutation({
    mutationFn: () => (form!.id ? api.updateAutomationRule(form!.id, payload(form!)) : api.createAutomationRule(payload(form!))),
    onSuccess: (r) => { refresh(); setForm(null); toast(`Rule ${r.name} saved`); },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (r: AutomationRule) => api.updateAutomationRule(r.id, payload(formFor({ ...r, enabled: !r.enabled }))),
    onSuccess: (r) => { refresh(); toast(r.enabled ? `${r.name} is on` : `${r.name} is paused`); },
    onError,
  });
  const remove = useMutation({ mutationFn: (r: AutomationRule) => api.deleteAutomationRule(r.id), onSuccess: () => { refresh(); toast('Rule deleted'); }, onError });

  if (loadingMe || (isAdmin && isLoading)) return <Spinner />;
  if (!isAdmin) return <EmptyState title="Only administrators can manage automation" />;
  const triggerLabel = (name: string) => meta?.triggers.find((t) => t.name === name)?.label ?? name;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Automation"
        actions={<button type="button" className="btn btn-primary" onClick={() => setForm(formFor())}><PlusIcon size={14} /> Create rule</button>}
      />
      <p className="text-jira-subtle mb-4 max-w-3xl">
        A rule does something when something happens to an issue: <strong>when</strong> an event occurs, <strong>if</strong> the issue matches a
        JQL condition, <strong>then</strong> run its actions. Rules act as the person who last saved them, so they can only do what that person can.
        Changes made by a rule can start other rules, but never in a loop. Use <em>Test</em> to see what a rule would do to an issue first.
      </p>
      <div className="card p-4">
        {error ? <p className="field-error">{errorMessage(error)}</p> : !rules?.length ? (
          <p className="text-jira-muted text-sm">No rules yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Rule</th><th>When</th><th>Project</th><th>Status</th><th>Runs</th><th /></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">
                      <button type="button" className="link text-left" onClick={() => setLogFor(r)}>{r.name}</button>
                      {r.description && <div className="text-xs text-jira-muted font-normal">{r.description}</div>}
                    </td>
                    <td className="text-jira-subtle">{triggerLabel(r.event)}{r.jql && <div className="text-xs text-jira-muted font-mono truncate max-w-[16rem]" title={r.jql}>if {r.jql}</div>}</td>
                    <td className="text-jira-subtle whitespace-nowrap">{r.project ? r.project.key : 'All projects'}</td>
                    <td className="whitespace-nowrap">
                      {r.enabled
                        ? <span className="lozenge bg-[#E3FCEF] text-[#006644]">On</span>
                        : <span className="lozenge bg-[#DFE1E6] text-[#42526E]" title={r.disabledReason ?? undefined}>{r.disabledReason ? 'Switched off' : 'Paused'}</span>}
                    </td>
                    <td className="text-jira-subtle whitespace-nowrap" title={r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : undefined}>
                      {r.runCount}{r.lastRunAt && <span className="text-xs text-jira-muted"> · {timeAgo(r.lastRunAt)}</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button type="button" className="btn btn-subtle btn-sm" onClick={() => setTestFor(r)}>Test</button>
                      <button type="button" className="btn btn-subtle btn-sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.enabled ? 'Pause' : 'Turn on'}</button>
                      <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Edit ${r.name}`} onClick={() => setForm(formFor(r))}><EditIcon size={14} /></button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Delete ${r.name}`}
                        onClick={async () => { if (await confirm({ title: `Delete ${r.name}?`, message: 'Its run history is deleted too.', confirmLabel: 'Delete', danger: true })) remove.mutate(r); }}
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
      {form && meta && <RuleEditor form={form} setForm={setForm} meta={meta} saving={save.isPending} onSave={() => save.mutate()} />}
      {logFor && <RunLog rule={logFor} onClose={() => setLogFor(null)} />}
      {testFor && <TestRule rule={testFor} onClose={() => setTestFor(null)} />}
    </div>
  );
}

function RuleEditor({ form, setForm, meta, saving, onSave }: {
  form: Form;
  setForm: (f: Form | null) => void;
  meta: { triggers: { name: string; label: string }[]; fields: string[]; placeholders: string[] };
  saving: boolean;
  onSave: () => void;
}) {
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: api.getProjects });
  const { data: users } = useQuery({ queryKey: ['users', 'staff'], queryFn: () => api.getUsers() });
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setAction = (i: number, a: AutomationAction) => set({ actions: form.actions.map((x, j) => (j === i ? a : x)) });
  const valid = form.name.trim() && form.actions.length && form.actions.every((a) => {
    switch (a.type) {
      case 'transition': return a.status.trim();
      case 'comment': return a.body.trim();
      case 'add_label': return a.label.trim() && !/\s/.test(a.label);
      case 'email': return a.to.length && a.subject.trim() && a.body.trim();
      default: return true;
    }
  });

  return (
    <Modal
      title={form.id ? 'Edit rule' : 'Create rule'}
      onClose={() => setForm(null)}
      width="max-w-3xl"
      footer={(
        <>
          <button type="button" className="btn btn-subtle" onClick={() => setForm(null)}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!valid || saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="rule-name">Name</label>
            <input id="rule-name" autoFocus className="input" maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Escalate urgent requests" />
          </div>
          <div>
            <label className="field-label" htmlFor="rule-project">Project</label>
            <select id="rule-project" className="input" value={form.projectKey} onChange={(e) => set({ projectKey: e.target.value })}>
              <option value="">All projects</option>
              {projects?.map((p) => <option key={p.id} value={p.key}>{p.key} — {p.name}</option>)}
            </select>
          </div>
        </div>

        <section className="card p-3 space-y-3">
          <h3 className="section-title">When</h3>
          <select aria-label="When" className="input" value={form.event} onChange={(e) => set({ event: e.target.value, fields: [], toStatus: '' })}>
            {meta.triggers.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
          </select>
          {form.event === 'issue.updated' && (
            <fieldset>
              <legend className="field-label">Only when one of these changes (none ticked: any change)</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {meta.fields.map((f) => (
                  <label key={f} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={form.fields.includes(f)} onChange={() => set({ fields: form.fields.includes(f) ? form.fields.filter((x) => x !== f) : [...form.fields, f] })} />
                    {fieldLabel(f)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {form.event === 'issue.transitioned' && (
            <div>
              <label className="field-label" htmlFor="rule-status">Only when it moves to this status (empty: any)</label>
              <input id="rule-status" className="input" value={form.toStatus} onChange={(e) => set({ toStatus: e.target.value })} placeholder="e.g. Resolved" />
            </div>
          )}
        </section>

        <section className="card p-3 space-y-2">
          <h3 className="section-title">If (optional)</h3>
          <input aria-label="JQL condition" className="input font-mono text-xs" value={form.jql} onChange={(e) => set({ jql: e.target.value })} placeholder='priority = Highest AND labels IS EMPTY' />
          <span className="field-help">The issue must match this JQL query for the actions to run. Leave empty to run for every issue.</span>
        </section>

        <section className="card p-3 space-y-3">
          <h3 className="section-title">Then</h3>
          {form.actions.map((a, i) => (
            <div key={i} className="rounded-[3px] border border-jira-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-jira-muted w-4">{i + 1}.</span>
                <select
                  aria-label={`Action ${i + 1}`}
                  className="input"
                  value={a.type}
                  onChange={(e) => setAction(i, blankAction(e.target.value as AutomationAction['type']))}
                >
                  {(Object.keys(ACTION_LABELS) as AutomationAction['type'][]).map((t) => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
                </select>
                <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Remove action ${i + 1}`} onClick={() => set({ actions: form.actions.filter((_, j) => j !== i) })}>
                  <TrashIcon size={14} />
                </button>
              </div>
              <ActionFields action={a} onChange={(next) => setAction(i, next)} users={users ?? []} />
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="btn btn-default btn-sm" disabled={form.actions.length >= 10} onClick={() => set({ actions: [...form.actions, blankAction('comment')] })}>
              <PlusIcon size={14} /> Add action
            </button>
            <span className="field-help mt-0">
              Placeholders in comments and emails: {meta.placeholders.map((p) => <code key={p} className="mr-1">{`{{${p}}}`}</code>)}
            </span>
          </div>
        </section>

        <div>
          <label className="field-label" htmlFor="rule-description">Description (optional)</label>
          <input id="rule-description" className="input" maxLength={500} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Rule is on
        </label>
      </div>
    </Modal>
  );
}

function ActionFields({ action, onChange, users }: { action: AutomationAction; onChange: (a: AutomationAction) => void; users: { id: string; name: string }[] }) {
  switch (action.type) {
    case 'assign':
      return (
        <select aria-label="Assign to" className="input" value={action.to} onChange={(e) => onChange({ ...action, to: e.target.value })}>
          <option value="unassigned">Nobody (unassigned)</option>
          <option value="reporter">The reporter</option>
          <option value="lead">The project lead</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      );
    case 'set_priority':
      return (
        <select aria-label="Priority" className="input" value={action.priority} onChange={(e) => onChange({ ...action, priority: e.target.value })}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
        </select>
      );
    case 'transition':
      return (
        <>
          <input aria-label="Status" className="input" value={action.status} onChange={(e) => onChange({ ...action, status: e.target.value })} placeholder="Status name (In Progress) or category (TO_DO, DOING, CLOSED)" />
          <span className="field-help">It must be a status the issue's workflow allows from where it is; otherwise the run fails and is logged. Closing uses the resolution Completed.</span>
        </>
      );
    case 'comment':
      return (
        <>
          <textarea aria-label="Comment" className="input" rows={3} value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} placeholder="Hello {{issue.assignee}}, {{issue.key}} needs a look." />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!action.internal} onChange={(e) => onChange({ ...action, internal: e.target.checked })} /> Internal note (service desk agents only)</label>
        </>
      );
    case 'add_label':
      return <input aria-label="Label" className="input" value={action.label} onChange={(e) => onChange({ ...action, label: e.target.value })} placeholder="one-word-label" />;
    case 'email': {
      const roles = action.to.filter((t) => EMAIL_ROLES.some((r) => r.value === t));
      const addresses = action.to.filter((t) => !EMAIL_ROLES.some((r) => r.value === t));
      const setTo = (nextRoles: string[], nextAddresses: string[]) => onChange({ ...action, to: [...nextRoles, ...nextAddresses] });
      return (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {EMAIL_ROLES.map((r) => (
              <label key={r.value} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={roles.includes(r.value)} onChange={() => setTo(roles.includes(r.value) ? roles.filter((x) => x !== r.value) : [...roles, r.value], addresses)} />
                {r.label}
              </label>
            ))}
          </div>
          <input
            aria-label="Other email addresses"
            className="input"
            defaultValue={addresses.join(', ')}
            onChange={(e) => setTo(roles, e.target.value.split(/[,;\s]+/).filter(Boolean))}
            placeholder="Other addresses, separated by commas"
          />
          <input aria-label="Subject" className="input" value={action.subject} onChange={(e) => onChange({ ...action, subject: e.target.value })} placeholder="Subject, e.g. {{issue.key}} is overdue" />
          <textarea aria-label="Message" className="input" rows={3} value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} placeholder="Message. A link to the issue is added." />
        </>
      );
    }
  }
}

/** What a rule did lately: only runs whose trigger and condition matched are kept (30 days). */
function RunLog({ rule, onClose }: { rule: AutomationRule; onClose: () => void }) {
  const { data: runs, isLoading, error } = useQuery({
    queryKey: ['automation-runs', rule.id],
    queryFn: () => api.getAutomationRuns(rule.id),
    refetchInterval: 10_000,
  });
  return (
    <Modal title={`Runs: ${rule.name}`} onClose={onClose} width="max-w-4xl">
      {rule.disabledReason && <p className="text-sm text-[#BF2600] mb-3">{rule.disabledReason}</p>}
      {isLoading ? <Spinner /> : error ? <p className="field-error">{errorMessage(error)}</p> : !runs?.length ? (
        <p className="text-jira-muted text-sm">It has not run yet. Runs are kept for 30 days.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Issue</th><th>Result</th><th>What happened</th><th>When</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.issueKey}</td>
                  <td><span className={`lozenge ${RUN_STYLE[r.status]}`}>{r.status === 'SKIPPED' ? 'Stopped' : humanize(r.status)}</span></td>
                  <td className="text-xs text-jira-subtle">
                    {r.message && <div className={r.status === 'FAILED' ? 'text-[#BF2600]' : ''}>{r.message}</div>}
                    {r.results.map((x, i) => <div key={i}>{x.ok ? '✓' : '✗'} {humanize(x.type)}: {x.detail}</div>)}
                  </td>
                  <td className="text-jira-subtle whitespace-nowrap" title={new Date(r.createdAt).toLocaleString()}>{timeAgo(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** A dry run: what the rule would do to one issue, without doing it. */
function TestRule({ rule, onClose }: { rule: AutomationRule; onClose: () => void }) {
  const [key, setKey] = useState('');
  const test = useMutation({ mutationFn: () => api.testAutomationRule(rule.id, key.trim()) });
  const result: AutomationTestResult | undefined = test.data;
  return (
    <Modal
      title={`Test: ${rule.name}`}
      onClose={onClose}
      footer={<button type="button" className="btn btn-subtle" onClick={onClose}>Close</button>}
    >
      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); if (key.trim()) test.mutate(); }}>
        <input aria-label="Issue key" autoFocus className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Issue key, e.g. HELP-12" />
        <button type="submit" className="btn btn-primary shrink-0" disabled={!key.trim() || test.isPending}>{test.isPending ? 'Checking…' : 'Check'}</button>
      </form>
      {test.error && <p className="field-error">{errorMessage(test.error)}</p>}
      {result && (
        <div className="space-y-2 text-sm">
          <p>
            {result.wouldRun
              ? <><strong>{result.issueKey}</strong> would run this rule (when its trigger happens), doing:</>
              : !result.inScope ? <><strong>{result.issueKey}</strong> is in another project than this rule.</>
              : <><strong>{result.issueKey}</strong> does not match the condition{result.conditionError ? `: ${result.conditionError}` : ''}, so nothing would happen.</>}
          </p>
          {result.wouldRun && (
            <ol className="list-decimal pl-5 space-y-1">
              {result.actions.map((a, i) => (
                <li key={i}>{a.summary}{a.text && <div className="card p-2 mt-1 text-xs whitespace-pre-wrap text-jira-subtle">{a.text}</div>}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}
