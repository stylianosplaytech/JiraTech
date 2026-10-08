import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, User } from '../api';

const ROLES = [
  'ADMIN', 'DEVELOPER', 'MERGE_MASTER', 'PRODUCT_MANAGER', 'PRODUCT_OWNER',
  'PROGRAM_MANAGER', 'PROJECT_MANAGER', 'QA_SPECIALIST', 'RELEASE_MANAGER',
  'SCRUM_MASTER', 'TEAM_LEAD',
];

const EMPTY_FORM = {
  email: '',
  name: '',
  password: '',
  role: 'DEVELOPER',
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: currentUser } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isAdmin = currentUser?.role === 'ADMIN';

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: () => api.getUsers(search || undefined),
  });

  const createUser = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
  });

  const updateUser = useMutation({
    mutationFn: () =>
      api.updateUser(editing!.id, {
        email: form.email,
        name: form.name,
        role: form.role,
        ...(form.password ? { password: form.password } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
      setForm(EMPTY_FORM);
    },
  });

  const openEdit = (user: User) => {
    setEditing(user);
    setForm({ email: user.email, name: user.name, password: '', role: user.role });
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => { setShowForm(true); setEditing(null); setForm(EMPTY_FORM); }}
            className="bg-jira-blue text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            + Add user
          </button>
        )}
      </div>

      <p className="text-sm text-gray-600">
        People who can log in and be assigned as Assignee, Reporter, or Watcher on issues.
      </p>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email..."
        className="w-full max-w-md border border-jira-border rounded px-3 py-2 text-sm"
      />

      {(showForm || editing) && isAdmin && (
        <div className="bg-white border border-jira-border rounded-lg p-4 max-w-lg space-y-3">
          <h2 className="font-medium">{editing ? 'Edit user' : 'New user'}</h2>
          <label className="block text-sm">
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full border border-jira-border rounded px-3 py-2"
              placeholder="e.g. Andreas Eracleous"
            />
          </label>
          <label className="block text-sm">
            Email (login)
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full border border-jira-border rounded px-3 py-2"
              placeholder="name@company.com"
            />
          </label>
          <label className="block text-sm">
            {editing ? 'New password (leave blank to keep)' : 'Password'}
            <input
              type="password"
              required={!editing}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full border border-jira-border rounded px-3 py-2"
              minLength={6}
            />
          </label>
          <label className="block text-sm">
            Role
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="mt-1 w-full border border-jira-border rounded px-3 py-2"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => (editing ? updateUser.mutate() : createUser.mutate())}
              disabled={createUser.isPending || updateUser.isPending || !form.name || !form.email}
              className="bg-jira-blue text-white px-4 py-2 rounded text-sm disabled:opacity-50"
            >
              {editing ? 'Save changes' : 'Create user'}
            </button>
            <button type="button" onClick={closeForm} className="px-4 py-2 border rounded text-sm">
              Cancel
            </button>
          </div>
          {(createUser.isError || updateUser.isError) && (
            <p className="text-red-600 text-sm">
              {(createUser.error ?? updateUser.error) instanceof Error
                ? (createUser.error ?? updateUser.error)!.message
                : 'Request failed'}
            </p>
          )}
        </div>
      )}

      <div className="bg-white border border-jira-border rounded-lg overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-gray-500 text-sm">Loading users...</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-jira-gray border-b border-jira-border">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                {isAdmin && <th className="text-right px-4 py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {users?.map((user) => (
                <tr key={user.id} className="border-b border-jira-border last:border-0">
                  <td className="px-4 py-3 font-medium">{user.name}</td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-jira-gray px-2 py-0.5 rounded">
                      {user.role.replace(/_/g, ' ')}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(user)}
                        className="text-jira-blue hover:underline text-sm"
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!isLoading && users?.length === 0 && (
          <p className="p-4 text-gray-500 text-sm">No users found.</p>
        )}
      </div>
    </div>
  );
}
