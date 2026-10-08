import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useProject } from '../project';
import { jqlValue } from '../utils';
import UserPicker from '../components/UserPicker';
import Avatar from '../components/Avatar';
import { StatusBadge } from '../components/Badges';

const STATUSES = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];

function searchLink(projectKey: string, extra?: string) {
  const jql = `project = ${projectKey}${extra ? ` AND ${extra}` : ''} ORDER BY created DESC`;
  return `/search?jql=${encodeURIComponent(jql)}`;
}

export default function ProjectPage() {
  const { key = '' } = useParams<{ key: string }>();
  const queryClient = useQueryClient();
  const { projectKey, setProjectKey } = useProject();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', leadId: '' });
  const [newVersion, setNewVersion] = useState({ name: '', releaseDate: '' });
  const [newComponent, setNewComponent] = useState({ name: '', type: 'SERVICE' });

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', key],
    queryFn: () => api.getProject(key),
  });

  // Viewing a project makes it the current one, so new versions/components land in it.
  useEffect(() => {
    if (project && project.key !== projectKey) setProjectKey(project.key);
  }, [project, projectKey, setProjectKey]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['project', key] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['versions'] });
    queryClient.invalidateQueries({ queryKey: ['components'] });
  };

  const update = useMutation({
    mutationFn: () => api.updateProject(key, {
      name: form.name.trim(),
      description: form.description,
      leadId: form.leadId || undefined,
    }),
    onSuccess: () => { refresh(); setEditing(false); },
  });
  const createVersion = useMutation({
    mutationFn: () => api.createVersion({
      name: newVersion.name.trim(),
      releaseDate: newVersion.releaseDate || undefined,
    }),
    onSuccess: () => { refresh(); setNewVersion({ name: '', releaseDate: '' }); },
  });
  const toggleRelease = useMutation({
    mutationFn: (v: { id: string; released: boolean }) => api.updateVersion(v.id, { released: v.released }),
    onSuccess: refresh,
  });
  const createComponent = useMutation({
    mutationFn: () => api.createComponent({ name: newComponent.name.trim(), type: newComponent.type }),
    onSuccess: () => { refresh(); setNewComponent({ name: '', type: 'SERVICE' }); },
  });

  if (isLoading) return <div className="text-gray-500">Loading…</div>;
  if (error || !project) return <div className="text-red-600">{(error as Error)?.message ?? 'Project not found'}</div>;

  const isAdmin = me?.role === 'ADMIN';
  const canAdmin = isAdmin || me?.id === project.leadId;
  const canManageVersions = canAdmin || ['RELEASE_MANAGER', 'PROJECT_MANAGER'].includes(me?.role ?? '');
  const total = project._count?.issues ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500 mb-1">
            <Link to="/projects" className="hover:underline">Projects</Link> / {project.key}
          </div>
          {editing ? (
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-2xl font-semibold border border-jira-border rounded px-2 py-1"
            />
          ) : (
            <h1 className="text-2xl font-semibold">{project.name}</h1>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Link to="/issues/new" className="px-3 py-1.5 bg-jira-blue text-white rounded text-sm">Create issue</Link>
          <Link to={searchLink(project.key)} className="px-3 py-1.5 bg-jira-gray rounded text-sm hover:bg-gray-200">All issues</Link>
          {canAdmin && !editing && (
            <button
              type="button"
              onClick={() => {
                setForm({ name: project.name, description: project.description ?? '', leadId: project.leadId ?? '' });
                setEditing(true);
              }}
              className="px-3 py-1.5 bg-jira-gray rounded text-sm hover:bg-gray-200"
            >
              Edit details
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <section className="bg-white rounded-lg border border-jira-border p-4">
            <h2 className="text-sm font-medium text-gray-500 mb-2">About</h2>
            {editing ? (
              <div className="space-y-3">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                  placeholder="What is this project about?"
                  className="w-full border border-jira-border rounded px-2 py-1 text-sm"
                />
                <label className="block text-sm">
                  <span className="text-gray-500">Project lead</span>
                  <div className="mt-1 w-64">
                    <UserPicker value={form.leadId || undefined} onChange={(id) => setForm({ ...form, leadId: id ?? '' })} allowClear={false} />
                  </div>
                </label>
                {update.isError && <p className="text-sm text-red-600">{(update.error as Error).message}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => update.mutate()} disabled={form.name.trim().length < 2} className="px-4 py-1.5 bg-jira-blue text-white rounded text-sm disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => setEditing(false)} className="px-4 py-1.5 border border-jira-border rounded text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap">{project.description || <span className="text-gray-400">No description</span>}</p>
            )}
          </section>

          <section className="bg-white rounded-lg border border-jira-border p-4">
            <h2 className="text-sm font-medium text-gray-500 mb-3">Issues by status</h2>
            <div className="flex h-3 rounded overflow-hidden bg-gray-100 mb-3">
              {STATUSES.map((s) => {
                const n = project.issueCountsByStatus[s] ?? 0;
                const color = { BACKLOG: 'bg-gray-400', TO_DO: 'bg-blue-400', DOING: 'bg-amber-400', CLOSED: 'bg-green-500' }[s];
                return n ? <div key={s} className={color} style={{ width: `${(n / Math.max(total, 1)) * 100}%` }} title={`${s}: ${n}`} /> : null;
              })}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {STATUSES.map((s) => (
                <Link key={s} to={searchLink(project.key, `status = ${s}`)} className="p-2 rounded hover:bg-jira-gray text-center">
                  <div className="text-2xl font-semibold">{project.issueCountsByStatus[s] ?? 0}</div>
                  <StatusBadge status={s} />
                </Link>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-jira-border p-4">
            <h2 className="text-sm font-medium text-gray-500 mb-3">Versions</h2>
            {project.versions.length === 0 ? (
              <p className="text-sm text-gray-400 mb-3">No versions yet.</p>
            ) : (
              <table className="w-full text-sm mb-3">
                <thead className="text-gray-500 text-xs">
                  <tr><th className="text-left py-1">Name</th><th className="text-left">Status</th><th className="text-left">Release date</th><th /></tr>
                </thead>
                <tbody>
                  {project.versions.map((v) => (
                    <tr key={v.id} className="border-t border-jira-border">
                      <td className="py-1.5">
                        <Link to={searchLink(project.key, `fixVersion = ${jqlValue(v.name)}`)} className="text-jira-blue hover:underline">{v.name}</Link>
                      </td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded ${v.released ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                          {v.released ? 'Released' : 'Unreleased'}
                        </span>
                      </td>
                      <td>{v.releaseDate ? new Date(v.releaseDate).toLocaleDateString() : '—'}</td>
                      <td className="text-right">
                        {canManageVersions && (
                          <button type="button" onClick={() => toggleRelease.mutate({ id: v.id, released: !v.released })} className="text-xs text-jira-blue hover:underline">
                            {v.released ? 'Unrelease' : 'Release'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canManageVersions && (
              <form onSubmit={(e) => { e.preventDefault(); createVersion.mutate(); }} className="flex gap-2 items-center">
                <input value={newVersion.name} onChange={(e) => setNewVersion({ ...newVersion, name: e.target.value })} placeholder="Version name, e.g. 1.0" className="border border-jira-border rounded px-2 py-1 text-sm flex-1" />
                <input type="date" value={newVersion.releaseDate} onChange={(e) => setNewVersion({ ...newVersion, releaseDate: e.target.value })} className="border border-jira-border rounded px-2 py-1 text-sm" />
                <button type="submit" disabled={!newVersion.name.trim()} className="px-3 py-1 bg-jira-gray rounded text-sm hover:bg-gray-200 disabled:opacity-50">Add</button>
              </form>
            )}
            {createVersion.isError && <p className="text-sm text-red-600 mt-1">{(createVersion.error as Error).message}</p>}
          </section>

          <section className="bg-white rounded-lg border border-jira-border p-4">
            <h2 className="text-sm font-medium text-gray-500 mb-3">Components</h2>
            {project.components.length === 0 ? (
              <p className="text-sm text-gray-400 mb-3">No components yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-3">
                {project.components.map((c) => (
                  <Link key={c.id} to={searchLink(project.key, `component = ${jqlValue(c.name)}`)} className="text-sm bg-jira-gray hover:bg-gray-200 rounded px-2 py-1">
                    {c.name} <span className="text-xs text-gray-500">({c.type.replace(/_/g, ' ').toLowerCase()})</span>
                  </Link>
                ))}
              </div>
            )}
            {canAdmin && (
              <form onSubmit={(e) => { e.preventDefault(); createComponent.mutate(); }} className="flex gap-2 items-center">
                <input value={newComponent.name} onChange={(e) => setNewComponent({ ...newComponent, name: e.target.value })} placeholder="Component name" className="border border-jira-border rounded px-2 py-1 text-sm flex-1" />
                <select value={newComponent.type} onChange={(e) => setNewComponent({ ...newComponent, type: e.target.value })} className="border border-jira-border rounded px-2 py-1 text-sm">
                  <option value="SERVICE">Service</option>
                  <option value="TEAM">Team</option>
                  <option value="RELEASE_TRAIN">Release train</option>
                </select>
                <button type="submit" disabled={!newComponent.name.trim()} className="px-3 py-1 bg-jira-gray rounded text-sm hover:bg-gray-200 disabled:opacity-50">Add</button>
              </form>
            )}
            {createComponent.isError && <p className="text-sm text-red-600 mt-1">{(createComponent.error as Error).message}</p>}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="bg-white rounded-lg border border-jira-border p-4 space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Key</span><span className="font-mono">{project.key}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Lead</span>
              {project.lead ? <span className="flex items-center gap-2"><Avatar name={project.lead.name} size="xs" />{project.lead.name}</span> : <span>—</span>}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Issues</span><span>{total}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Conventions</span>
              <span>{project.strictHierarchy ? 'SPORTS (strict)' : 'Standard'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Created</span><span>{new Date(project.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-jira-border p-4 text-sm space-y-2">
            <h3 className="font-medium text-gray-700">Quick filters</h3>
            <Link className="block text-jira-blue hover:underline" to={searchLink(project.key, 'assignee = currentUser() AND status != CLOSED')}>My open issues</Link>
            <Link className="block text-jira-blue hover:underline" to={searchLink(project.key, 'reporter = currentUser()')}>Reported by me</Link>
            <Link className="block text-jira-blue hover:underline" to={searchLink(project.key, 'assignee IS EMPTY AND status != CLOSED')}>Unassigned</Link>
            <Link className="block text-jira-blue hover:underline" to={searchLink(project.key, 'updated >= -7d')}>Updated in last 7 days</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
