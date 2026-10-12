import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDuration, type DeskCustomers, type Queue, type RequestType, type SlaTarget } from '../api';
import { PortalHero, PortalLogo } from '../portal/Branding';
import { PriorityIcon, typeLabel } from './Badges';
import { SelectPicker } from './Pickers';
import Avatar from './Avatar';
import { EditIcon, PlusIcon, TrashIcon, UsersIcon, XIcon } from './Icons';
import { Modal, Spinner, errorMessage, useDialogs, useToast } from './ui';

const ISSUE_TYPES = ['TASK', 'DEFECT', 'STORY', 'ANALYSIS', 'CONFIGURATION', 'DEPLOYMENT', 'DOCUMENTATION'];
const FIELD_TYPES = [
  { id: 'TEXT', label: 'Text' },
  { id: 'SELECT', label: 'Select list' },
  { id: 'NUMBER', label: 'Number' },
  { id: 'DATE', label: 'Date' },
];
const PORTAL_TYPES = new Set(FIELD_TYPES.map((t) => t.id));

function useSd(projectKey: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return {
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: ['service-desk', projectKey] });
      queryClient.invalidateQueries({ queryKey: ['queues', projectKey] });
    },
    onError: (e: unknown) => toast(errorMessage(e), 'error'),
    toast,
  };
}

// ─── Request types ───────────────────────────────────────────────────────────

function RequestTypeDialog({ projectKey, type, onClose }: { projectKey: string; type: RequestType | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { refresh, toast } = useSd(projectKey);
  const [form, setForm] = useState({
    name: type?.name ?? '',
    description: type?.description ?? '',
    issueType: type?.issueType ?? 'TASK',
    fields: type?.fields.map((f) => ({ fieldId: f.fieldId, required: f.required })) ?? [],
  });
  const [newField, setNewField] = useState<{ name: string; type: string; options: string } | null>(null);
  const { data: definitions = [] } = useQuery({ queryKey: ['custom-fields', projectKey], queryFn: api.getCustomFieldDefinitions });
  const usable = definitions.filter((d) => PORTAL_TYPES.has(d.type));

  const save = useMutation({
    mutationFn: () => {
      const data = { name: form.name.trim(), description: form.description.trim(), issueType: form.issueType, fields: form.fields };
      return type ? api.updateRequestType(projectKey, type.id, data) : api.createRequestType(projectKey, data);
    },
    onSuccess: () => { refresh(); toast(type ? 'Request type saved' : `Request type ${form.name.trim()} added`); onClose(); },
  });
  const createField = useMutation({
    mutationFn: () => {
      const base = newField!.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
      let key = base;
      for (let i = 2; definitions.some((d) => d.key === key); i++) key = `${base}_${i}`;
      const options = newField!.type === 'SELECT' ? newField!.options.split(',').map((o) => o.trim()).filter(Boolean) : undefined;
      return api.createCustomField({ key, name: newField!.name.trim(), type: newField!.type, options });
    },
    onSuccess: (f) => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields'] });
      setForm((x) => ({ ...x, fields: [...x.fields, { fieldId: f.id, required: false }] }));
      setNewField(null);
    },
  });

  const selected = new Map(form.fields.map((f) => [f.fieldId, f]));
  const toggle = (fieldId: string) => setForm((x) => ({
    ...x,
    fields: selected.has(fieldId) ? x.fields.filter((f) => f.fieldId !== fieldId) : [...x.fields, { fieldId, required: false }],
  }));
  const setRequired = (fieldId: string, required: boolean) =>
    setForm((x) => ({ ...x, fields: x.fields.map((f) => (f.fieldId === fieldId ? { ...f, required } : f)) }));

  return (
    <Modal
      title={type ? `Edit ${type.name}` : 'Add request type'}
      onClose={onClose}
      width="max-w-xl"
      footer={(
        <>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" form="request-type-form" className="btn btn-primary" disabled={form.name.trim().length < 2 || save.isPending}>Save</button>
        </>
      )}
    >
      <form id="request-type-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="block">
          <span className="field-label">Name <span className="text-[#DE350B]">*</span></span>
          <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Request new hardware" />
        </label>
        <label className="block">
          <span className="field-label">Description</span>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Shown to customers on the portal" />
        </label>
        <div>
          <span className="field-label">Created as</span>
          <SelectPicker variant="field" searchable={false} value={form.issueType} onChange={(v) => v && setForm({ ...form, issueType: v })} options={ISSUE_TYPES.map((t) => ({ id: t, label: typeLabel(t) }))} />
        </div>
        <div>
          <span className="field-label">Portal fields</span>
          <p className="field-help mt-0 mb-2">Every request asks for a summary and description. Add project fields for anything else you need to know.</p>
          {usable.length === 0 && !newField && <p className="text-jira-muted text-sm mb-2">This project has no fields yet.</p>}
          <div className="space-y-1">
            {usable.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-[3px] px-2 py-1 hover:bg-jira-gray">
                <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  <span className="truncate">{d.name}</span>
                  <span className="text-xs text-jira-muted">{FIELD_TYPES.find((t) => t.id === d.type)?.label}</span>
                </label>
                {selected.has(d.id) && (
                  <label className="flex items-center gap-1 text-xs text-jira-subtle cursor-pointer">
                    <input type="checkbox" checked={selected.get(d.id)!.required} onChange={(e) => setRequired(d.id, e.target.checked)} /> Required
                  </label>
                )}
              </div>
            ))}
          </div>
          {newField ? (
            <div className="card p-3 mt-2 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-2">
                <input className="input" placeholder="Field name, e.g. Asset tag" value={newField.name} onChange={(e) => setNewField({ ...newField, name: e.target.value })} aria-label="Field name" />
                <SelectPicker variant="field" searchable={false} value={newField.type} onChange={(v) => v && setNewField({ ...newField, type: v })} options={FIELD_TYPES} />
              </div>
              {newField.type === 'SELECT' && (
                <input className="input" placeholder="Options, separated by commas" value={newField.options} onChange={(e) => setNewField({ ...newField, options: e.target.value })} aria-label="Options" />
              )}
              {createField.isError && <p className="field-error">{errorMessage(createField.error)}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-default btn-sm"
                  disabled={!newField.name.trim() || (newField.type === 'SELECT' && !newField.options.trim()) || createField.isPending}
                  onClick={() => createField.mutate()}
                >
                  Create field
                </button>
                <button type="button" className="btn btn-subtle btn-sm" onClick={() => setNewField(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-link btn-sm mt-1" onClick={() => setNewField({ name: '', type: 'TEXT', options: '' })}><PlusIcon size={14} /> New field</button>
          )}
        </div>
        {save.isError && <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(save.error)}</div>}
      </form>
    </Modal>
  );
}

function RequestTypes({ projectKey, types, canAdmin }: { projectKey: string; types: RequestType[]; canAdmin: boolean }) {
  const { refresh, onError, toast } = useSd(projectKey);
  const { confirm } = useDialogs();
  const [editing, setEditing] = useState<RequestType | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (t: RequestType) => api.deleteRequestType(projectKey, t.id),
    onSuccess: (_r, t) => { refresh(); toast(`${t.name} removed`); },
    onError,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Request types</h3>
        {canAdmin && <button type="button" className="btn btn-default btn-sm" onClick={() => setEditing('new')}><PlusIcon size={14} /> Add request type</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Created as</th><th>Portal fields</th><th className="text-right">Requests</th><th /></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="font-medium">{t.name}</span>
                  {t.description && <span className="block text-xs text-jira-muted">{t.description}</span>}
                </td>
                <td className="text-jira-subtle whitespace-nowrap">{typeLabel(t.issueType)}</td>
                <td className="text-jira-subtle">
                  {t.fields.length ? t.fields.map((f) => `${f.field.name}${f.required ? ' *' : ''}`).join(', ') : '—'}
                </td>
                <td className="text-right">{t._count?.issues ?? 0}</td>
                <td className="text-right whitespace-nowrap">
                  {canAdmin && (
                    <>
                      <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><EditIcon size={14} /></button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Delete ${t.name}`}
                        onClick={async () => {
                          if (await confirm({
                            title: `Delete ${t.name}?`,
                            message: 'Customers can no longer choose it. Existing requests keep their details but lose the request type.',
                            confirmLabel: 'Delete',
                            danger: true,
                          })) remove.mutate(t);
                        }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {types.length === 0 && <p className="text-jira-muted mt-2">No request types: customers can't raise requests until you add one.</p>}
      {editing && <RequestTypeDialog projectKey={projectKey} type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── SLA goals ───────────────────────────────────────────────────────────────

const toHours = (m: number | null) => (m == null ? '' : String(Math.round((m / 60) * 100) / 100));
const toMinutes = (h: string) => (h.trim() === '' ? null : Math.max(1, Math.round(Number(h) * 60)));

function SlaGoals({ projectKey, targets, canAdmin }: { projectKey: string; targets: SlaTarget[]; canAdmin: boolean }) {
  const { refresh, onError, toast } = useSd(projectKey);
  const initial = () => Object.fromEntries(targets.map((t) => [t.priority, { first: toHours(t.firstResponseMinutes), resolution: toHours(t.resolutionMinutes) }]));
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial()), [targets]); // eslint-disable-line react-hooks/exhaustive-deps
  const invalid = Object.values(draft).some((d) => [d.first, d.resolution].some((v) => v.trim() !== '' && !(Number(v) > 0)));
  const dirty = targets.some((t) => draft[t.priority]?.first !== toHours(t.firstResponseMinutes) || draft[t.priority]?.resolution !== toHours(t.resolutionMinutes));
  const save = useMutation({
    mutationFn: () => api.setSlaTargets(projectKey, targets.map((t) => ({
      priority: t.priority,
      firstResponseMinutes: toMinutes(draft[t.priority].first),
      resolutionMinutes: toMinutes(draft[t.priority].resolution),
    }))),
    onSuccess: () => { refresh(); toast('SLA goals saved'); },
    onError,
  });

  return (
    <div>
      <h3 className="font-semibold mb-1">SLA goals</h3>
      <p className="text-jira-subtle text-sm mb-2">
        In hours, per priority. Clocks start when a request is raised and run around the clock. First response stops at the first
        reply to the customer; resolution pauses in statuses marked <em>Pauses SLA</em> (see the workflow) and stops when resolved. Leave empty for no goal.
      </p>
      <div className="overflow-x-auto">
        <table className="data-table max-w-xl">
          <thead><tr><th>Priority</th><th>Time to first response (h)</th><th>Time to resolution (h)</th></tr></thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.priority}>
                <td><PriorityIcon priority={t.priority} showLabel /></td>
                {(['first', 'resolution'] as const).map((k) => (
                  <td key={k}>
                    {canAdmin ? (
                      <input
                        className="input h-8 w-28"
                        type="number"
                        min={0}
                        step="0.25"
                        value={draft[t.priority]?.[k] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [t.priority]: { ...d[t.priority], [k]: e.target.value } }))}
                        placeholder="No goal"
                        aria-label={`${t.priority} ${k === 'first' ? 'first response' : 'resolution'} hours`}
                      />
                    ) : (
                      <span>{(k === 'first' ? t.firstResponseMinutes : t.resolutionMinutes) != null ? formatDuration((k === 'first' ? t.firstResponseMinutes : t.resolutionMinutes)!) : '—'}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canAdmin && (
        <div className="flex items-center gap-2 mt-2">
          <button type="button" className="btn btn-default" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>Save SLA goals</button>
          {dirty && <button type="button" className="btn btn-subtle" onClick={() => setDraft(initial())}>Discard</button>}
          {invalid && <span className="field-error mt-0">Enter a positive number of hours</span>}
        </div>
      )}
    </div>
  );
}

// ─── Queues ──────────────────────────────────────────────────────────────────

function QueueEditor({ projectKey, queues, canAdmin }: { projectKey: string; queues: Queue[]; canAdmin: boolean }) {
  const { refresh, onError, toast } = useSd(projectKey);
  const { confirm } = useDialogs();
  const [form, setForm] = useState<{ id?: string; name: string; jql: string } | null>(null);
  const save = useMutation({
    mutationFn: () => (form!.id
      ? api.updateQueue(projectKey, form!.id, { name: form!.name.trim(), jql: form!.jql.trim() })
      : api.createQueue(projectKey, { name: form!.name.trim(), jql: form!.jql.trim() })),
    onSuccess: (q) => { refresh(); toast(`Queue ${q.name} saved`); setForm(null); },
  });
  const remove = useMutation({ mutationFn: (q: Queue) => api.deleteQueue(projectKey, q.id), onSuccess: refresh, onError });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Queues</h3>
        <div className="flex gap-2">
          <Link to="/queues" className="btn btn-subtle btn-sm">Open queues</Link>
          {canAdmin && <button type="button" className="btn btn-default btn-sm" onClick={() => setForm({ name: '', jql: 'statusCategory != Done' })}><PlusIcon size={14} /> Add queue</button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Queue</th><th>JQL (within this project)</th><th /></tr></thead>
          <tbody>
            {queues.map((q) => (
              <tr key={q.id}>
                <td className="font-medium whitespace-nowrap">{q.name}</td>
                <td className="font-mono text-xs text-jira-subtle break-all">{q.jql}</td>
                <td className="text-right whitespace-nowrap">
                  {canAdmin && (
                    <>
                      <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Edit ${q.name}`} onClick={() => setForm({ id: q.id, name: q.name, jql: q.jql })}><EditIcon size={14} /></button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Delete ${q.name}`}
                        onClick={async () => { if (await confirm({ title: `Delete the ${q.name} queue?`, confirmLabel: 'Delete', danger: true })) remove.mutate(q); }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <Modal
          title={form.id ? 'Edit queue' : 'Add queue'}
          onClose={() => setForm(null)}
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" form="queue-form" className="btn btn-primary" disabled={!form.name.trim() || !form.jql.trim() || save.isPending}>Save</button>
            </>
          )}
        >
          <form id="queue-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <label className="block">
              <span className="field-label">Name</span>
              <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Urgent bugs" />
            </label>
            <label className="block">
              <span className="field-label">JQL</span>
              <textarea className="input font-mono" rows={3} value={form.jql} onChange={(e) => setForm({ ...form, jql: e.target.value })} />
              <span className="field-help">
                Only this project's requests are included. Example: <code>priority IN (Highest, High) AND requestType = &quot;Report a bug&quot;</code>.
                Without ORDER BY, the request closest to breaching its SLA comes first.
              </span>
            </label>
            {save.isError && <div role="alert" className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(save.error)}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Portal access and branding ──────────────────────────────────────────────

const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function Branding({ projectKey, projectName, data, canAdmin }: {
  projectKey: string; projectName: string; data: DeskCustomers; canAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const { onError, toast } = useSd(projectKey);
  const [welcome, setWelcome] = useState(data.branding.welcome ?? '');
  const [color, setColor] = useState(data.branding.color ?? '');
  useEffect(() => { setWelcome(data.branding.welcome ?? ''); setColor(data.branding.color ?? ''); }, [data.branding.welcome, data.branding.color]);
  const save = useMutation({
    mutationFn: (patch: { welcome?: string; color?: string; logo?: string }) => api.updatePortal(projectKey, patch),
    onSuccess: (d) => {
      queryClient.setQueryData(['desk-customers', projectKey], d);
      queryClient.invalidateQueries({ queryKey: ['portal-desk', projectKey] });
      queryClient.invalidateQueries({ queryKey: ['portal-desks'] });
      toast('Help center updated');
    },
    onError,
  });
  const dirty = welcome !== (data.branding.welcome ?? '') || color !== (data.branding.color ?? '');

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { toast('Use a PNG, JPEG, GIF, WebP or SVG image', 'error'); return; }
    if (file.size > MAX_LOGO_BYTES) { toast('The logo must be smaller than 256 KB', 'error'); return; }
    save.mutate({ logo: await readAsDataUrl(file) });
  };

  return (
    <div className="mt-6">
      <h4 className="font-semibold text-sm mb-2">Look and feel</h4>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="space-y-3">
          <div>
            <span className="field-label">Logo</span>
            <div className="flex items-center gap-3">
              <PortalLogo branding={data.branding} name={projectName} size={40} />
              {canAdmin && (
                <>
                  <label className="btn btn-default btn-sm cursor-pointer">
                    Upload…
                    <input type="file" accept={LOGO_TYPES.join(',')} className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                  {data.branding.logo && <button type="button" className="btn btn-subtle btn-sm" onClick={() => save.mutate({ logo: '' })}>Remove</button>}
                </>
              )}
            </div>
            <span className="field-help">Square images work best; up to 256 KB.</span>
          </div>
          <div>
            <label className="field-label" htmlFor="portal-color">Accent colour</label>
            <div className="flex items-center gap-2">
              <input
                id="portal-color"
                type="color"
                disabled={!canAdmin}
                value={color || '#0052CC'}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="h-8 w-12 rounded-[3px] border border-jira-border cursor-pointer disabled:cursor-default"
              />
              <span className="font-mono text-xs text-jira-subtle">{color || 'Default'}</span>
              {canAdmin && color && <button type="button" className="btn btn-subtle btn-sm" onClick={() => setColor('')}>Use default</button>}
            </div>
          </div>
          <label className="block">
            <span className="field-label">Welcome message</span>
            <textarea className="input" rows={3} maxLength={1000} disabled={!canAdmin} value={welcome} onChange={(e) => setWelcome(e.target.value)} placeholder="Shown at the top of this help center" />
          </label>
          {canAdmin && (
            <button type="button" className="btn btn-default" disabled={!dirty || save.isPending} onClick={() => save.mutate({ welcome, color })}>
              Save look and feel
            </button>
          )}
        </div>
        <div>
          <span className="field-label">Preview</span>
          <div className="rounded-[3px] overflow-hidden border border-jira-border">
            <PortalHero branding={{ ...data.branding, welcome: welcome || null, color: color || null }} title={projectName} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalAccess({ projectKey, projectName, canAdmin }: { projectKey: string; projectName: string; canAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { onError, toast } = useSd(projectKey);
  const { data } = useQuery({ queryKey: ['desk-customers', projectKey], queryFn: () => api.getDeskCustomers(projectKey) });
  const { data: allCustomers = [] } = useQuery({ queryKey: ['users', 'customers'], queryFn: () => api.getUsers(undefined, 'customers'), enabled: canAdmin });
  const { data: allOrganizations = [] } = useQuery({ queryKey: ['organizations'], queryFn: api.getOrganizations, enabled: canAdmin });
  const done = (d: DeskCustomers) => queryClient.setQueryData(['desk-customers', projectKey], d);
  const setOpen = useMutation({
    mutationFn: (portalOpen: boolean) => api.updatePortal(projectKey, { portalOpen }),
    onSuccess: (d) => { done(d); toast(d.portalOpen ? 'Any customer can now raise requests' : 'Only the customers and organizations listed can raise requests'); },
    onError,
  });
  const add = useMutation({ mutationFn: (id: string) => api.addDeskCustomer(projectKey, id), onSuccess: done, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.removeDeskCustomer(projectKey, id), onSuccess: done, onError });
  const addOrg = useMutation({ mutationFn: (id: string) => api.addDeskOrganization(projectKey, id), onSuccess: done, onError });
  const removeOrg = useMutation({ mutationFn: (id: string) => api.removeDeskOrganization(projectKey, id), onSuccess: done, onError });
  if (!data) return <Spinner />;
  const listed = new Set(data.customers.map((c) => c.id));
  const linked = new Set(data.organizations.map((o) => o.id));
  const portalUrl = `${window.location.origin}/portal/${projectKey}`;

  return (
    <div>
      <h3 className="font-semibold mb-1">Help center</h3>
      <p className="text-jira-subtle text-sm mb-3">
        This service desk's own help center is at <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="link">{portalUrl}</a>.
        Customer accounts and organizations are managed on the <Link to="/users?tab=organizations" className="link">People</Link> page.
        Agents are the project's members; anyone who can browse the project can also raise requests.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header"><span className="card-title">Organizations ({data.organizations.length})</span></div>
          <div className="px-4 py-2">
            <p className="text-xs text-jira-muted mb-1">Their members can use this help center, and requests can be shared with the whole organization.</p>
            {data.organizations.length === 0 && <p className="text-jira-muted text-sm py-1">No organizations yet.</p>}
            {data.organizations.map((o) => (
              <div key={o.id} className="group flex items-center gap-2 py-1">
                <UsersIcon size={14} className="text-jira-muted" />
                <span className="flex-1 truncate">{o.name} <span className="text-jira-muted text-xs">{o.members} {o.members === 1 ? 'member' : 'members'}</span></span>
                {canAdmin && (
                  <button type="button" onClick={() => removeOrg.mutate(o.id)} className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 text-jira-muted hover:text-jira-navy" aria-label={`Remove ${o.name}`}>
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            ))}
            {canAdmin && (
              <SelectPicker
                value={undefined}
                onChange={(id) => id && addOrg.mutate(id)}
                placeholder="+ Add organization"
                options={allOrganizations.filter((o) => !linked.has(o.id)).map((o) => ({ id: o.id, label: o.name, hint: `${o.members.length} members` }))}
              />
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Who else can raise requests</span></div>
          <div className="px-4 py-2">
            <div className="space-y-2 mb-2" role="radiogroup" aria-label="Who can raise requests">
              {([[true, 'Any customer', 'Every customer account can use this help center.'], [false, 'Only the organizations and customers listed', 'Use this for a portal that belongs to specific clients.']] as const).map(([value, label, help]) => (
                <label key={String(value)} className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name={`portal-open-${projectKey}`} className="mt-1" disabled={!canAdmin || setOpen.isPending} checked={data.portalOpen === value} onChange={() => setOpen.mutate(value)} />
                  <span>{label}<span className="field-help mt-0">{help}</span></span>
                </label>
              ))}
            </div>
            {!data.portalOpen && (
              <>
                <div className="text-xs font-semibold text-jira-muted mt-3 mb-1">Individual customers ({data.customers.length})</div>
                {data.customers.map((c) => (
                  <div key={c.id} className="group flex items-center gap-2 py-1">
                    <Avatar name={c.name} size="xs" />
                    <span className="flex-1 truncate">{c.name} <span className="text-jira-muted text-xs">{c.email}</span></span>
                    {canAdmin && (
                      <button type="button" onClick={() => remove.mutate(c.id)} className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 text-jira-muted hover:text-jira-navy" aria-label={`Remove ${c.name}`}>
                        <XIcon size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {canAdmin && (
                  <SelectPicker
                    value={undefined}
                    onChange={(id) => id && add.mutate(id)}
                    placeholder="+ Add customer"
                    options={allCustomers.filter((c) => !listed.has(c.id)).map((c) => ({ id: c.id, label: c.name, hint: c.email, icon: <Avatar name={c.name} size="xs" /> }))}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <Branding projectKey={projectKey} projectName={projectName} data={data} canAdmin={canAdmin} />
    </div>
  );
}

export default function ServiceDeskSettings({ projectKey, canAdmin }: { projectKey: string; canAdmin: boolean }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['service-desk', projectKey], queryFn: () => api.getServiceDesk(projectKey) });
  // Links such as /projects/HELP#service-desk land here once the section has rendered.
  const loaded = !!data;
  useEffect(() => {
    if (loaded && window.location.hash === '#service-desk') document.getElementById('service-desk')?.scrollIntoView();
  }, [loaded]);
  return (
    <section id="service-desk" className="scroll-mt-20">
      <h2 className="text-base font-semibold mb-1">Service desk</h2>
      <p className="text-jira-subtle mb-4">What customers can ask for, how fast you aim to answer, and how agents see their work.</p>
      {isLoading ? <Spinner /> : !data ? <p className="field-error">{errorMessage(error)}</p> : (
        <div className="space-y-8">
          <RequestTypes projectKey={projectKey} types={data.requestTypes} canAdmin={canAdmin} />
          <SlaGoals projectKey={projectKey} targets={data.slaTargets} canAdmin={canAdmin} />
          <QueueEditor projectKey={projectKey} queues={data.queues} canAdmin={canAdmin} />
          <PortalAccess projectKey={projectKey} projectName={data.project.name} canAdmin={canAdmin} />
        </div>
      )}
    </section>
  );
}
