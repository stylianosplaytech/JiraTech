import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../api';
import { humanize } from '../utils';
import Avatar from '../components/Avatar';
import { SelectPicker } from '../components/Pickers';
import OrganizationsPanel from '../components/OrganizationsPanel';
import CustomerPortals from '../components/CustomerPortals';
import { EditIcon, MailIcon, PlusIcon, SearchIcon } from '../components/Icons';
import { EmptyState, Modal, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

const ROLES = [
  'ADMIN', 'DEVELOPER', 'MERGE_MASTER', 'PRODUCT_MANAGER', 'PRODUCT_OWNER',
  'PROGRAM_MANAGER', 'PROJECT_MANAGER', 'QA_SPECIALIST', 'RELEASE_MANAGER',
  'SCRUM_MASTER', 'TEAM_LEAD', 'CUSTOMER',
];

const EMPTY_FORM = { email: '', name: '', password: '', role: 'DEVELOPER', sendInvite: true };

export default function UsersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; user: User } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'organizations' ? 'organizations' : 'people';

  const { data: currentUser } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isAdmin = currentUser?.role === 'ADMIN';
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', 'all', search],
    queryFn: () => api.getUsers(search || undefined, 'all'),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (dialog?.mode === 'edit') {
        const u = await api.updateUser(dialog.user.id, {
          email: form.email, name: form.name, role: form.role, ...(form.password ? { password: form.password } : {}),
        });
        return { ...u, invitation: null };
      }
      return api.createUser({
        email: form.email, name: form.name, role: form.role, sendInvite: form.sendInvite, ...(form.sendInvite ? {} : { password: form.password }),
      });
    },
    onSuccess: (u) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      if (dialog?.mode === 'edit') toast(`${u.name} updated`);
      else if (!u.invitation) toast(`${u.name} added`);
      else if (u.invitation.sent) toast(`${u.name} added. A welcome email to choose their password is on its way to ${u.email}.`);
      else toast(`${u.name} added, but the welcome email couldn't be sent. Check Email settings, then use Resend.`, 'error');
      setDialog(null);
    },
  });
  const invite = useMutation({
    mutationFn: (u: User) => api.inviteUser(u.id),
    onSuccess: (r, u) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      if (r.sent) toast(`Email sent to ${u.email} with a link to choose a password`);
      else toast("The email couldn't be sent. Check Email settings.", 'error');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const open = (d: NonNullable<typeof dialog>) => {
    save.reset();
    setForm(d.mode === 'edit' ? { email: d.user.email, name: d.user.name, password: '', role: d.user.role, sendInvite: false } : EMPTY_FORM);
    setDialog(d);
  };

  const editing = dialog?.mode === 'edit';
  const valid = form.name.trim() && form.email.trim() && (editing || form.sendInvite || form.password.length >= 6);

  return (
    <div>
      <PageHeader
        title="People"
        actions={isAdmin && tab === 'people' && <button type="button" onClick={() => open({ mode: 'create' })} className="btn btn-primary"><PlusIcon size={14} /> Add person</button>}
      >
        <div className="flex gap-1 mt-3 border-b border-jira-border" role="tablist">
          {([['people', 'People'], ['organizations', 'Organizations']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setParams(value === 'people' ? {} : { tab: value })}
              className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === value ? 'border-jira-blue text-jira-blue' : 'border-transparent text-jira-subtle hover:text-jira-navy'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'people' && (
          <>
            <p className="text-jira-subtle mt-3">Everyone who can sign in. Customers only use the help center to raise and follow service desk requests.</p>
            <div className="relative w-72 mt-4">
              <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jira-muted pointer-events-none" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className="input h-8 pl-8" />
            </div>
          </>
        )}
      </PageHeader>

      {tab === 'organizations' ? <OrganizationsPanel isAdmin={isAdmin} /> : isLoading ? <Spinner /> : (
        <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th>{isAdmin && <th className="w-48" />}</tr>
              </thead>
              <tbody>
                {users?.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <span className="flex items-center gap-3">
                        <Avatar name={user.name} size="md" />
                        <span className="font-medium">{user.name}</span>
                        {user.invitePending && <span className="lozenge bg-[#FFFAE6] text-[#7A5C00]" title="Added without a password; they haven't chosen one from the welcome email yet">Invited</span>}
                      </span>
                    </td>
                    <td className="text-jira-subtle">{user.email}</td>
                    <td><span className={`lozenge ${user.role === 'CUSTOMER' ? 'bg-[#EAE6FF] text-[#403294]' : 'bg-jira-gray-hover text-[#42526E]'}`}>{humanize(user.role)}</span></td>
                    {isAdmin && (
                      <td className="text-right whitespace-nowrap">
                        {user.invitePending && (
                          <button type="button" onClick={() => invite.mutate(user)} disabled={invite.isPending} className="btn btn-subtle btn-sm" title="Send the welcome email again with a new link">
                            <MailIcon size={13} /> Resend
                          </button>
                        )}
                        <button type="button" onClick={() => open({ mode: 'edit', user })} className="btn btn-subtle btn-sm"><EditIcon size={13} /> Edit</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users?.length === 0 && <EmptyState title="No people found">Try a different name or email.</EmptyState>}
        </>
      )}

      {dialog && (
        <Modal
          title={editing ? `Edit ${dialog.mode === 'edit' ? dialog.user.name : ''}` : 'Add person'}
          onClose={() => setDialog(null)}
          width={dialog.mode === 'edit' && dialog.user.role === 'CUSTOMER' ? 'max-w-lg' : 'max-w-md'}
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setDialog(null)}>Cancel</button>
              <button type="submit" form="user-form" className="btn btn-primary" disabled={!valid || save.isPending}>
                {editing ? 'Save changes' : 'Add person'}
              </button>
            </>
          )}
        >
          <form id="user-form" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }} className="space-y-4">
            <label className="block">
              <span className="field-label">Full name <span className="text-[#DE350B]">*</span></span>
              <input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="e.g. Andreas Eracleous" />
            </label>
            <label className="block">
              <span className="field-label">Email (used to log in) <span className="text-[#DE350B]">*</span></span>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" placeholder="name@company.com" />
            </label>
            {!editing && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={form.sendInvite} onChange={(e) => setForm({ ...form, sendInvite: e.target.checked })} />
                <span>
                  Send a welcome email
                  <span className="field-help mt-0">
                    They get a link to choose their own password (valid for 7 days), sent with the <Link to="/settings/email" className="link">Email settings</Link>.
                    Untick to set a password for them.
                  </span>
                </span>
              </label>
            )}
            {(editing || !form.sendInvite) && (
              <label className="block">
                <span className="field-label">{editing ? 'New password' : <>Password <span className="text-[#DE350B]">*</span></>}</span>
                <input type="password" autoComplete="new-password" required={!editing} minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" />
                <span className="field-help">{editing ? 'Leave blank to keep the current password.' : 'At least 6 characters.'}</span>
              </label>
            )}
            {dialog.mode === 'edit' && (
              <button type="button" className="btn btn-link btn-sm px-0" disabled={invite.isPending} onClick={() => invite.mutate(dialog.user)}>
                <MailIcon size={13} /> Email them a link to choose a new password
              </button>
            )}
            <div>
              <span className="field-label">Role</span>
              <SelectPicker variant="field" value={form.role} onChange={(role) => role && setForm({ ...form, role })} options={ROLES.map((r) => ({ id: r, label: humanize(r), hint: r === 'CUSTOMER' ? 'Help center only' : undefined }))} />
            </div>
            {dialog.mode === 'edit' && dialog.user.role === 'CUSTOMER' && <CustomerPortals userId={dialog.user.id} />}
            {save.isError && <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(save.error)}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
