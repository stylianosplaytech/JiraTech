import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Organization } from '../api';
import Avatar from './Avatar';
import { SelectPicker } from './Pickers';
import { EditIcon, PlusIcon, TrashIcon, XIcon } from './Icons';
import { EmptyState, Spinner, errorMessage, useDialogs, useToast } from './ui';

/** Customer organizations: global admins manage them; everyone else can look. */
export default function OrganizationsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, prompt } = useDialogs();
  const [name, setName] = useState('');
  const { data: organizations, isLoading } = useQuery({ queryKey: ['organizations'], queryFn: api.getOrganizations });
  const { data: customers = [] } = useQuery({ queryKey: ['users', 'customers'], queryFn: () => api.getUsers(undefined, 'customers'), enabled: isAdmin });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['organizations'] });
    queryClient.invalidateQueries({ queryKey: ['desk-customers'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const create = useMutation({
    mutationFn: () => api.createOrganization(name.trim()),
    onSuccess: (o) => { refresh(); setName(''); toast(`${o.name} created`); },
    onError,
  });
  const rename = useMutation({ mutationFn: ({ id, name: n }: { id: string; name: string }) => api.renameOrganization(id, n), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (o: Organization) => api.deleteOrganization(o.id), onSuccess: (_r, o) => { refresh(); toast(`${o.name} deleted`); }, onError });
  const addMember = useMutation({ mutationFn: ({ id, userId }: { id: string; userId: string }) => api.addOrganizationMember(id, userId), onSuccess: refresh, onError });
  const removeMember = useMutation({ mutationFn: ({ id, userId }: { id: string; userId: string }) => api.removeOrganizationMember(id, userId), onSuccess: refresh, onError });

  return (
    <div>
      <p className="text-jira-subtle mb-4 max-w-3xl">
        Organizations group customers by company. A service desk can open its help center to whole organizations, and customers
        can share their requests with colleagues in their organization. Link organizations to a service desk on its project page.
      </p>
      {isAdmin && (
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="flex gap-2 mb-4 max-w-md">
          <input className="input h-8" value={name} onChange={(e) => setName(e.target.value)} placeholder="New organization, e.g. Acme Retail" aria-label="Organization name" />
          <button type="submit" className="btn btn-primary" disabled={name.trim().length < 2 || create.isPending}><PlusIcon size={14} /> Create</button>
        </form>
      )}
      {isLoading ? <Spinner /> : !organizations?.length ? (
        <EmptyState title="No organizations yet">{isAdmin ? 'Create one above, then add customers to it.' : 'A global admin can create them.'}</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {organizations.map((o) => {
            const memberIds = new Set(o.members.map((m) => m.userId));
            return (
              <div key={o.id} className="card">
                <div className="card-header">
                  <span className="card-title">{o.name}</span>
                  {isAdmin && (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Rename ${o.name}`}
                        onClick={async () => {
                          const next = await prompt({ title: 'Rename organization', label: 'Name', initial: o.name, confirmLabel: 'Rename' });
                          if (next && next !== o.name) rename.mutate({ id: o.id, name: next });
                        }}
                      >
                        <EditIcon size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Delete ${o.name}`}
                        onClick={async () => {
                          if (await confirm({
                            title: `Delete ${o.name}?`,
                            message: 'Its members lose access to help centers they could only use through it, and requests shared with it become private to their requesters.',
                            confirmLabel: 'Delete',
                            danger: true,
                          })) remove.mutate(o);
                        }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </span>
                  )}
                </div>
                <div className="px-4 py-2">
                  <div className="text-xs text-jira-muted mb-2">
                    {o.projects.length
                      ? <>Help centers: {o.projects.map((p, i) => <span key={p.projectId}>{i > 0 && ', '}<Link to={`/projects/${p.project.key}#service-desk`} className="link">{p.project.name}</Link></span>)}</>
                      : 'Not linked to any service desk yet'}
                    {' · '}{o._count.issues} shared {o._count.issues === 1 ? 'request' : 'requests'}
                  </div>
                  {o.members.length === 0 && <p className="text-jira-muted text-sm py-1">No members yet.</p>}
                  {o.members.map((m) => (
                    <div key={m.userId} className="group flex items-center gap-2 py-1">
                      <Avatar name={m.user.name} size="xs" />
                      <span className="flex-1 truncate">{m.user.name} <span className="text-jira-muted text-xs">{m.user.email}</span></span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeMember.mutate({ id: o.id, userId: m.userId })}
                          className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 text-jira-muted hover:text-jira-navy"
                          aria-label={`Remove ${m.user.name} from ${o.name}`}
                        >
                          <XIcon size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {isAdmin && (
                    <SelectPicker
                      value={undefined}
                      onChange={(userId) => userId && addMember.mutate({ id: o.id, userId })}
                      placeholder="+ Add customer"
                      options={customers.filter((c) => !memberIds.has(c.id)).map((c) => ({ id: c.id, label: c.name, hint: c.email, icon: <Avatar name={c.name} size="xs" /> }))}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
