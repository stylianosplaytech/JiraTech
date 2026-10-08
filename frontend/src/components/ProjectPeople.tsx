import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ProjectAccess, type ProjectRole } from '../api';
import Avatar from './Avatar';
import UserPicker from './UserPicker';
import { SelectPicker } from './Pickers';
import { PlusIcon, TrashIcon } from './Icons';
import { errorMessage, useDialogs, useToast } from './ui';

export const ROLE_INFO: Record<ProjectRole, { label: string; help: string }> = {
  ADMIN: { label: 'Administrator', help: 'Manage settings, people, versions, components and workflow; delete any issue' },
  MEMBER: { label: 'Member', help: 'Create, edit, assign and transition issues' },
  VIEWER: { label: 'Viewer', help: 'Read, comment on and watch issues' },
};

export const ACCESS_INFO: Record<ProjectAccess, { label: string; help: string }> = {
  MEMBER: { label: 'Open', help: 'Everyone can view and edit issues' },
  VIEWER: { label: 'Limited', help: 'Everyone can view and comment; only members can edit' },
  NONE: { label: 'Private', help: 'Only people added below can see this project' },
};

const ROLE_OPTIONS = (Object.keys(ROLE_INFO) as ProjectRole[]).map((r) => ({ id: r, label: ROLE_INFO[r].label, hint: undefined }));

/** "People and access" section of the project page. Editable by project administrators. */
export default function ProjectPeople({ projectKey, canAdmin }: { projectKey: string; canAdmin: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [newUser, setNewUser] = useState<string | undefined>();
  const [newRole, setNewRole] = useState<ProjectRole>('MEMBER');

  const { data } = useQuery({ queryKey: ['project-members', projectKey], queryFn: () => api.getProjectMembers(projectKey) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['project-members', projectKey] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['project', projectKey] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const setAccess = useMutation({
    mutationFn: (defaultAccess: ProjectAccess) => api.updateProject(projectKey, { defaultAccess }),
    onSuccess: (_d, a) => { refresh(); toast(`Project access set to ${ACCESS_INFO[a].label.toLowerCase()}`); },
    onError,
  });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) => api.setProjectMember(projectKey, userId, role),
    onSuccess: (m) => { refresh(); toast(`${m.user.name} is now ${ROLE_INFO[m.role].label.toLowerCase()}`); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeProjectMember(projectKey, userId),
    onSuccess: refresh,
    onError,
  });

  if (!data) return null;
  const memberIds = new Set(data.members.map((m) => m.userId));

  return (
    <section>
      <h2 className="text-base font-semibold mb-1">People and access</h2>
      <p className="text-jira-subtle mb-4">Members get the role you choose. Everyone else gets the project's general access.</p>

      <div className="card p-4 mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">General access</div>
          <div className="text-xs text-jira-muted">{ACCESS_INFO[data.defaultAccess].help}</div>
        </div>
        <div className="w-44 shrink-0">
          <SelectPicker
            variant="field"
            searchable={false}
            disabled={!canAdmin}
            value={data.defaultAccess}
            onChange={(a) => a && a !== data.defaultAccess && setAccess.mutate(a as ProjectAccess)}
            options={(Object.keys(ACCESS_INFO) as ProjectAccess[]).map((a) => ({ id: a, label: ACCESS_INFO[a].label, hint: undefined }))}
          />
        </div>
      </div>

      <table className="data-table mb-3">
        <thead><tr><th>Name</th><th>Email</th><th className="w-48">Role</th>{canAdmin && <th className="w-12" />}</tr></thead>
        <tbody>
          {data.members.map((m) => {
            const isLead = m.userId === data.leadId;
            return (
              <tr key={m.userId}>
                <td>
                  <span className="flex items-center gap-2">
                    <Avatar name={m.user.name} size="xs" />{m.user.name}
                    {isLead && <span className="lozenge bg-jira-blue-light text-jira-blue">Lead</span>}
                  </span>
                </td>
                <td className="text-jira-subtle">{m.user.email}</td>
                <td>
                  {canAdmin && !isLead ? (
                    <SelectPicker
                      searchable={false}
                      value={m.role}
                      onChange={(role) => role && role !== m.role && setRole.mutate({ userId: m.userId, role: role as ProjectRole })}
                      options={ROLE_OPTIONS}
                    />
                  ) : (
                    <span className="px-2" title={isLead ? 'The project lead is always an administrator' : undefined}>{ROLE_INFO[m.role].label}</span>
                  )}
                </td>
                {canAdmin && (
                  <td className="text-right">
                    {!isLead && (
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`Remove ${m.user.name}`}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Remove ${m.user.name}?`,
                            message: data.defaultAccess === 'NONE'
                              ? 'They will lose access to this private project.'
                              : `They will fall back to the project's general access (${ACCESS_INFO[data.defaultAccess].label.toLowerCase()}).`,
                            confirmLabel: 'Remove',
                            danger: true,
                          });
                          if (ok) remove.mutate(m.userId);
                        }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.members.length === 0 && <p className="text-jira-muted mb-3">No members yet — everyone uses the general access.</p>}

      {canAdmin && (
        <div className="flex items-end gap-2">
          <div className="w-72">
            <span className="field-label">Add people</span>
            <UserPicker value={newUser} onChange={setNewUser} placeholder="Choose a person" allowClear={false} />
          </div>
          <div className="w-44">
            <span className="field-label">Role</span>
            <SelectPicker variant="field" searchable={false} value={newRole} onChange={(r) => r && setNewRole(r as ProjectRole)} options={ROLE_OPTIONS} />
          </div>
          <button
            type="button"
            className="btn btn-default h-9"
            disabled={!newUser || memberIds.has(newUser) || setRole.isPending}
            onClick={() => { setRole.mutate({ userId: newUser!, role: newRole }); setNewUser(undefined); }}
            title={newUser && memberIds.has(newUser) ? 'Already a member — change their role in the table' : undefined}
          >
            <PlusIcon size={14} /> Add
          </button>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-3 text-xs text-jira-subtle">
        {(Object.keys(ROLE_INFO) as ProjectRole[]).map((r) => (
          <div key={r}><dt className="font-semibold text-jira-navy">{ROLE_INFO[r].label}</dt><dd>{ROLE_INFO[r].help}</dd></div>
        ))}
      </dl>
    </section>
  );
}
