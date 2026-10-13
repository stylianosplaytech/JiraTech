import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EmailAddress, type RecipientGroup } from '../api';
import Avatar from './Avatar';
import { SelectPicker } from './Pickers';
import { EditIcon, MailIcon, PlusIcon, TrashIcon, UsersIcon, XIcon } from './Icons';
import { EmptyState, Modal, Spinner, errorMessage, useDialogs, useToast } from './ui';
import AddressInput from './email/AddressInput';
import { isRef, type Recipient } from './email/recipients';

interface Form {
  id?: string;
  name: string;
  description: string;
  userIds: string[];
  organizationIds: string[];
  addresses: EmailAddress[];
}

const EMPTY: Form = { name: '', description: '', userIds: [], organizationIds: [], addresses: [] };
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Recipient groups: named lists of people, organizations and other addresses that agents pick as one recipient
 * when emailing from a request. Global admins manage them; everyone on staff can look.
 */
export default function RecipientGroupsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [form, setForm] = useState<Form | null>(null);
  const { data: groups, isLoading } = useQuery({ queryKey: ['recipient-groups'], queryFn: api.getRecipientGroups });
  const { data: users = [] } = useQuery({ queryKey: ['users', 'all', ''], queryFn: () => api.getUsers(undefined, 'all'), enabled: isAdmin });
  const { data: organizations = [] } = useQuery({ queryKey: ['organizations'], queryFn: api.getOrganizations, enabled: isAdmin });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recipient-groups'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const save = useMutation({
    mutationFn: () => {
      const data = {
        name: form!.name.trim(),
        description: form!.description.trim() || undefined,
        userIds: form!.userIds,
        organizationIds: form!.organizationIds,
        addresses: form!.addresses,
      };
      return form!.id ? api.updateRecipientGroup(form!.id, data) : api.createRecipientGroup(data);
    },
    onSuccess: (g) => { refresh(); setForm(null); toast(`${g.name} saved`); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (g: RecipientGroup) => api.deleteRecipientGroup(g.id),
    onSuccess: (_r, g) => { refresh(); toast(`${g.name} deleted`); },
    onError,
  });

  const edit = (g: RecipientGroup) => setForm({
    id: g.id,
    name: g.name,
    description: g.description ?? '',
    userIds: g.users.map((u) => u.id),
    organizationIds: g.organizations.map((o) => o.id),
    addresses: g.addresses,
  });

  const userById = new Map(users.map((u) => [u.id, u]));
  const orgById = new Map(organizations.map((o) => [o.id, o]));
  const empty = !!form && !form.userIds.length && !form.organizationIds.length && !form.addresses.length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <p className="text-jira-subtle max-w-3xl">
          Recipient groups gather people, whole organizations and other email addresses under one name. When writing an email from a
          request, type the group's name in To, Cc or Bcc to send it to everyone in it. An organization in a group always means its
          members at the time the email is sent.
        </p>
        {isAdmin && <button type="button" className="btn btn-primary" onClick={() => setForm(EMPTY)}><PlusIcon size={14} /> Create group</button>}
      </div>

      {isLoading ? <Spinner /> : !groups?.length ? (
        <EmptyState title="No recipient groups yet">{isAdmin ? 'Create one to email several people or companies in one go.' : 'A global admin can create them.'}</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {groups.map((g) => (
            <div key={g.id} className="card">
              <div className="card-header">
                <span className="card-title flex items-center gap-2"><UsersIcon size={14} className="text-[#403294]" /> {g.name}</span>
                <span className="flex items-center gap-1">
                  <span className="lozenge bg-[#EAE6FF] text-[#403294]" title={g.recipients.map((a) => a.email).join(', ')}>{people(g.recipients.length)}</span>
                  {isAdmin && (
                    <>
                      <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Edit ${g.name}`} onClick={() => edit(g)}><EditIcon size={14} /></button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Delete ${g.name}`}
                        onClick={async () => {
                          if (await confirm({ title: `Delete ${g.name}?`, message: 'Emails already sent to it are not affected.', confirmLabel: 'Delete', danger: true })) remove.mutate(g);
                        }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </>
                  )}
                </span>
              </div>
              <div className="px-4 py-2 space-y-2 text-sm">
                {g.description && <p className="text-jira-subtle">{g.description}</p>}
                {g.organizations.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-jira-muted mb-1">Organizations</div>
                    <div className="flex flex-wrap gap-1">
                      {g.organizations.map((o) => <span key={o.id} className="lozenge bg-jira-gray-hover text-[#42526E]">{o.name} · {people(o.memberCount)}</span>)}
                    </div>
                  </div>
                )}
                {g.users.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-jira-muted mb-1">People</div>
                    {g.users.map((u) => (
                      <div key={u.id} className="flex items-center gap-2 py-0.5">
                        <Avatar name={u.name} size="xs" />
                        <span className="truncate">{u.name} <span className="text-jira-muted text-xs">{u.email}</span></span>
                      </div>
                    ))}
                  </div>
                )}
                {g.addresses.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-jira-muted mb-1">Other addresses</div>
                    {g.addresses.map((a) => (
                      <div key={a.email} className="flex items-center gap-2 py-0.5">
                        <MailIcon size={14} className="text-jira-muted shrink-0" />
                        <span className="truncate">{a.name ? <>{a.name} <span className="text-jira-muted text-xs">{a.email}</span></> : a.email}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal
          title={form.id ? 'Edit recipient group' : 'Create recipient group'}
          onClose={() => setForm(null)}
          width="max-w-2xl"
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setForm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={form.name.trim().length < 2 || empty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        >
          <div className="space-y-4">
            <div>
              <label className="field-label" htmlFor="group-name">Name</label>
              <input id="group-name" autoFocus className="input" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. All retail customers" />
            </div>
            <div>
              <label className="field-label" htmlFor="group-description">Description (optional)</label>
              <input id="group-description" className="input" maxLength={255} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Who it's for" />
            </div>

            <div>
              <span className="field-label">Organizations</span>
              <div className="flex flex-wrap gap-1 mb-1">
                {form.organizationIds.map((id) => {
                  const o = orgById.get(id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-[3px] bg-jira-gray-hover px-1.5 py-0.5 text-xs">
                      {o?.name ?? 'Unknown'}{o && <span className="text-jira-muted">· {people(o.members.length)}</span>}
                      <button type="button" aria-label={`Remove ${o?.name ?? 'organization'}`} onClick={() => setForm({ ...form, organizationIds: form.organizationIds.filter((x) => x !== id) })}><XIcon size={12} /></button>
                    </span>
                  );
                })}
              </div>
              <SelectPicker
                variant="field"
                value={undefined}
                onChange={(id) => id && setForm({ ...form, organizationIds: [...form.organizationIds, id] })}
                placeholder="+ Add an organization"
                options={organizations.filter((o) => !form.organizationIds.includes(o.id)).map((o) => ({ id: o.id, label: o.name, hint: people(o.members.length) }))}
              />
              <p className="field-help">Everyone in the organization when the email is sent.</p>
            </div>

            <div>
              <span className="field-label">People</span>
              {form.userIds.map((id) => {
                const u = userById.get(id);
                return (
                  <div key={id} className="group flex items-center gap-2 py-0.5">
                    <Avatar name={u?.name ?? '?'} size="xs" />
                    <span className="flex-1 truncate text-sm">{u?.name ?? 'Unknown'} <span className="text-jira-muted text-xs">{u?.email}</span></span>
                    <button type="button" className="text-jira-muted hover:text-jira-navy" aria-label={`Remove ${u?.name ?? 'person'}`} onClick={() => setForm({ ...form, userIds: form.userIds.filter((x) => x !== id) })}><XIcon size={14} /></button>
                  </div>
                );
              })}
              <SelectPicker
                variant="field"
                value={undefined}
                onChange={(id) => id && setForm({ ...form, userIds: [...form.userIds, id] })}
                placeholder="+ Add a person"
                options={users.filter((u) => !form.userIds.includes(u.id)).map((u) => ({ id: u.id, label: u.name, hint: u.email, icon: <Avatar name={u.name} size="xs" /> }))}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="group-addresses">Other addresses</label>
              <AddressInput
                id="group-addresses"
                value={form.addresses}
                onChange={(v: Recipient[]) => setForm({ ...form, addresses: v.filter((r): r is EmailAddress => !isRef(r)) })}
                placeholder="People without an account, e.g. supplier@example.com"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
