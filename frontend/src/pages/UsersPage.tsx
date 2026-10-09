import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../api';
import { humanize } from '../utils';
import Avatar from '../components/Avatar';
import { SelectPicker } from '../components/Pickers';
import { EditIcon, PlusIcon, SearchIcon } from '../components/Icons';
import { EmptyState, Modal, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

const ROLES = [
  'ADMIN', 'DEVELOPER', 'MERGE_MASTER', 'PRODUCT_MANAGER', 'PRODUCT_OWNER',
  'PROGRAM_MANAGER', 'PROJECT_MANAGER', 'QA_SPECIALIST', 'RELEASE_MANAGER',
  'SCRUM_MASTER', 'TEAM_LEAD',
];

const EMPTY_FORM = { email: '', name: '', password: '', role: 'DEVELOPER' };

export default function UsersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; user: User } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: currentUser } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isAdmin = currentUser?.role === 'ADMIN';
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: () => api.getUsers(search || undefined),
  });

  const save = useMutation({
    mutationFn: () => (dialog?.mode === 'edit'
      ? api.updateUser(dialog.user.id, {
        email: form.email, name: form.name, role: form.role, ...(form.password ? { password: form.password } : {}),
      })
      : api.createUser(form)),
    onSuccess: (u) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast(dialog?.mode === 'edit' ? `${u.name} updated` : `${u.name} added`);
      setDialog(null);
    },
  });

  const open = (d: NonNullable<typeof dialog>) => {
    save.reset();
    setForm(d.mode === 'edit' ? { email: d.user.email, name: d.user.name, password: '', role: d.user.role } : EMPTY_FORM);
    setDialog(d);
  };

  const editing = dialog?.mode === 'edit';
  const valid = form.name.trim() && form.email.trim() && (editing || form.password.length >= 6);

  return (
    <div>
      <PageHeader
        title="People"
        actions={isAdmin && <button type="button" onClick={() => open({ mode: 'create' })} className="btn btn-primary"><PlusIcon size={14} /> Add person</button>}
      >
        <p className="text-jira-subtle mt-2">Everyone who can sign in and be an assignee, reporter or watcher.</p>
        <div className="relative w-72 mt-4">
          <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jira-muted pointer-events-none" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className="input h-8 pl-8" />
        </div>
      </PageHeader>

      {isLoading ? <Spinner /> : (
        <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th>{isAdmin && <th className="w-24" />}</tr>
              </thead>
              <tbody>
                {users?.map((user) => (
                  <tr key={user.id}>
                    <td><span className="flex items-center gap-3"><Avatar name={user.name} size="md" /><span className="font-medium">{user.name}</span></span></td>
                    <td className="text-jira-subtle">{user.email}</td>
                    <td><span className="lozenge bg-jira-gray-hover text-[#42526E]">{humanize(user.role)}</span></td>
                    {isAdmin && (
                      <td className="text-right">
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
          width="max-w-md"
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
            <label className="block">
              <span className="field-label">{editing ? 'New password' : <>Password <span className="text-[#DE350B]">*</span></>}</span>
              <input type="password" autoComplete="new-password" required={!editing} minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" />
              <span className="field-help">{editing ? 'Leave blank to keep the current password.' : 'At least 6 characters.'}</span>
            </label>
            <div>
              <span className="field-label">Role</span>
              <SelectPicker variant="field" value={form.role} onChange={(role) => role && setForm({ ...form, role })} options={ROLES.map((r) => ({ id: r, label: humanize(r) }))} />
            </div>
            {save.isError && <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(save.error)}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
