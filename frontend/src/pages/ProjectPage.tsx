import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useProject } from '../project';
import { jqlValue } from '../utils';
import UserPicker from '../components/UserPicker';
import ProjectPeople, { ACCESS_INFO } from '../components/ProjectPeople';
import WorkflowEditor from '../components/WorkflowEditor';
import Avatar from '../components/Avatar';
import { StatusBadge, STATUS_LABELS, typeLabel } from '../components/Badges';
import { SelectPicker } from '../components/Pickers';
import { EditIcon, PlusIcon } from '../components/Icons';
import { EmptyState, Modal, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

const STATUSES = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];
const STATUS_BAR: Record<string, string> = { BACKLOG: '#97A0AF', TO_DO: '#5E6C84', DOING: '#0052CC', CLOSED: '#36B37E' };

function searchLink(projectKey: string, extra?: string) {
  const jql = `project = ${projectKey}${extra ? ` AND ${extra}` : ''} ORDER BY created DESC`;
  return `/search?jql=${encodeURIComponent(jql)}`;
}

export default function ProjectPage() {
  const { key = '' } = useParams<{ key: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { projectKey, setProjectKey } = useProject();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', leadId: '' });
  const [newVersion, setNewVersion] = useState({ name: '', releaseDate: '' });
  const [newComponent, setNewComponent] = useState({ name: '', type: 'SERVICE' });

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', key],
    queryFn: () => api.getProject(key),
    retry: false,
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
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const update = useMutation({
    mutationFn: () => api.updateProject(key, { name: form.name.trim(), description: form.description, leadId: form.leadId || undefined }),
    onSuccess: () => { refresh(); setEditing(false); toast('Project details saved'); },
  });
  const createVersion = useMutation({
    mutationFn: () => api.createVersion({ name: newVersion.name.trim(), releaseDate: newVersion.releaseDate || undefined }),
    onSuccess: (v) => { refresh(); setNewVersion({ name: '', releaseDate: '' }); toast(`Version ${v.name} created`); },
    onError,
  });
  const toggleRelease = useMutation({
    mutationFn: (v: { id: string; released: boolean }) => api.updateVersion(v.id, { released: v.released }),
    onSuccess: refresh,
    onError,
  });
  const createComponent = useMutation({
    mutationFn: () => api.createComponent({ name: newComponent.name.trim(), type: newComponent.type }),
    onSuccess: (c) => { refresh(); setNewComponent({ name: '', type: 'SERVICE' }); toast(`Component ${c.name} created`); },
    onError,
  });

  if (isLoading) return <Spinner />;
  if (error || !project) {
    return <EmptyState title="Project not found" action={<Link to="/projects" className="btn btn-default">All projects</Link>}>{errorMessage(error)}</EmptyState>;
  }

  const canAdmin = project.permissions.canAdmin;
  const canManageVersions = canAdmin;
  const total = project._count?.issues ?? 0;

  return (
    <div>
      <PageHeader
        breadcrumbs={<><Link to="/projects" className="hover:underline">Projects</Link> / {project.name}</>}
        title={(
          <span className="flex items-center gap-3">
            {project.name}
            <span className="font-mono text-xs bg-jira-gray-hover text-jira-subtle rounded-[3px] px-1.5 py-0.5">{project.key}</span>
          </span>
        )}
        actions={(
          <>
            <Link to={searchLink(project.key)} className="btn btn-default">View issues</Link>
            <Link to="/" className="btn btn-default">Board</Link>
            {canAdmin && (
              <button
                type="button"
                className="btn btn-default"
                onClick={() => { setForm({ name: project.name, description: project.description ?? '', leadId: project.leadId ?? '' }); setEditing(true); }}
              >
                <EditIcon size={14} /> Edit details
              </button>
            )}
          </>
        )}
      >
        {project.description && <p className="text-jira-subtle mt-2 max-w-3xl whitespace-pre-wrap">{project.description}</p>}
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
        <div className="space-y-8 min-w-0">
          <section>
            <h2 className="text-base font-semibold mb-3">Status overview</h2>
            <div className="flex h-2 rounded-full overflow-hidden bg-jira-gray-hover mb-4">
              {STATUSES.map((s) => {
                const n = project.issueCountsByStatus[s] ?? 0;
                return n ? <div key={s} style={{ width: `${(n / Math.max(total, 1)) * 100}%`, background: STATUS_BAR[s] }} title={`${STATUS_LABELS[s]}: ${n}`} /> : null;
              })}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STATUSES.map((s) => (
                <Link key={s} to={searchLink(project.key, `status = ${s}`)} className="card p-4 hover:bg-jira-gray transition-colors">
                  <div className="text-2xl font-semibold mb-1">{project.issueCountsByStatus[s] ?? 0}</div>
                  <StatusBadge status={s} />
                </Link>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">Versions</h2>
            </div>
            {project.versions.length > 0 && (
              <div className="overflow-x-auto">
                <table className="data-table mb-3">
                  <thead><tr><th>Version</th><th>Status</th><th>Release date</th><th /></tr></thead>
                  <tbody>
                    {project.versions.map((v) => (
                      <tr key={v.id}>
                        <td><Link to={searchLink(project.key, `fixVersion = ${jqlValue(v.name)}`)} className="link font-medium">{v.name}</Link></td>
                        <td>
                          <span className={`lozenge ${v.released ? 'bg-[#E3FCEF] text-[#006644]' : 'bg-jira-gray-hover text-[#42526E]'}`}>
                            {v.released ? 'Released' : 'Unreleased'}
                          </span>
                        </td>
                        <td className="text-jira-subtle">{v.releaseDate ? new Date(v.releaseDate).toLocaleDateString() : '—'}</td>
                        <td className="text-right">
                          {canManageVersions && (
                            <button type="button" onClick={() => toggleRelease.mutate({ id: v.id, released: !v.released })} className="btn btn-subtle btn-sm">
                              {v.released ? 'Unrelease' : 'Release'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {project.versions.length === 0 && <p className="text-jira-muted mb-3">No versions yet.</p>}
            {canManageVersions && (
              <form onSubmit={(e) => { e.preventDefault(); createVersion.mutate(); }} className="flex gap-2 items-center">
                <input value={newVersion.name} onChange={(e) => setNewVersion({ ...newVersion, name: e.target.value })} placeholder="Version name, e.g. 1.0" className="input h-8 max-w-xs" aria-label="Version name" />
                <input type="date" value={newVersion.releaseDate} onChange={(e) => setNewVersion({ ...newVersion, releaseDate: e.target.value })} className="input h-8 w-44" aria-label="Release date" />
                <button type="submit" disabled={!newVersion.name.trim() || createVersion.isPending} className="btn btn-default"><PlusIcon size={14} /> Add version</button>
              </form>
            )}
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3">Components</h2>
            {project.components.length > 0 && (
              <div className="overflow-x-auto">
                <table className="data-table mb-3">
                  <thead><tr><th>Component</th><th>Type</th><th>Lead</th></tr></thead>
                  <tbody>
                    {project.components.map((c) => (
                      <tr key={c.id}>
                        <td><Link to={searchLink(project.key, `component = ${jqlValue(c.name)}`)} className="link font-medium">{c.name}</Link></td>
                        <td className="text-jira-subtle">{typeLabel(c.type)}</td>
                        <td>{c.lead ? <span className="flex items-center gap-2"><Avatar name={c.lead.name} size="xs" />{c.lead.name}</span> : <span className="text-jira-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {project.components.length === 0 && <p className="text-jira-muted mb-3">No components yet.</p>}
            {canAdmin && (
              <form onSubmit={(e) => { e.preventDefault(); createComponent.mutate(); }} className="flex gap-2 items-center">
                <input value={newComponent.name} onChange={(e) => setNewComponent({ ...newComponent, name: e.target.value })} placeholder="Component name" className="input h-8 max-w-xs" aria-label="Component name" />
                <div className="w-44">
                  <SelectPicker
                    variant="field"
                    searchable={false}
                    value={newComponent.type}
                    onChange={(type) => type && setNewComponent({ ...newComponent, type })}
                    options={[{ id: 'SERVICE', label: 'Service' }, { id: 'TEAM', label: 'Team' }, { id: 'RELEASE_TRAIN', label: 'Release train' }]}
                  />
                </div>
                <button type="submit" disabled={!newComponent.name.trim() || createComponent.isPending} className="btn btn-default"><PlusIcon size={14} /> Add component</button>
              </form>
            )}
            {project.strictHierarchy && canAdmin && (
              <p className="field-help">SPORTS naming: teams start with “@”; services and release trains use “ASSETID (serviceName)”.</p>
            )}
          </section>

          <WorkflowEditor projectKey={project.key} canAdmin={canAdmin} />

          <ProjectPeople projectKey={project.key} canAdmin={canAdmin} />
        </div>

        <aside className="space-y-4">
          <div className="card">
            <div className="card-header"><h2 className="card-title">Details</h2></div>
            <dl className="px-4 py-3 space-y-3">
              <div className="flex justify-between gap-2"><dt className="text-jira-subtle">Key</dt><dd className="font-mono">{project.key}</dd></div>
              <div className="flex justify-between gap-2">
                <dt className="text-jira-subtle">Lead</dt>
                <dd>{project.lead ? <span className="flex items-center gap-2"><Avatar name={project.lead.name} size="xs" />{project.lead.name}</span> : '—'}</dd>
              </div>
              <div className="flex justify-between gap-2"><dt className="text-jira-subtle">Issues</dt><dd>{total}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-jira-subtle">Rules</dt><dd>{project.strictHierarchy ? 'SPORTS conventions' : 'Standard'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-jira-subtle">Access</dt><dd>{ACCESS_INFO[project.defaultAccess].label}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-jira-subtle">Your role</dt><dd>{project.permissions.role === 'NONE' ? '—' : project.permissions.role.charAt(0) + project.permissions.role.slice(1).toLowerCase()}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-jira-subtle">Created</dt><dd>{new Date(project.createdAt).toLocaleDateString()}</dd></div>
            </dl>
          </div>
          <div className="card">
            <div className="card-header"><h2 className="card-title">Quick filters</h2></div>
            <div className="py-1">
              {[
                ['My open issues', 'assignee = currentUser() AND status != CLOSED'],
                ['Reported by me', 'reporter = currentUser()'],
                ['Unassigned', 'assignee IS EMPTY AND status != CLOSED'],
                ['Updated in the last 7 days', 'updated >= -7d'],
              ].map(([label, q]) => (
                <Link key={label} to={searchLink(project.key, q)} className="menu-item text-jira-blue">{label}</Link>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {editing && (
        <Modal
          title="Edit project details"
          onClose={() => setEditing(false)}
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={form.name.trim().length < 2 || update.isPending} onClick={() => update.mutate()}>Save</button>
            </>
          )}
        >
          <div className="space-y-4">
            <label className="block">
              <span className="field-label">Name</span>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="field-label">Description</span>
              <textarea className="input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div>
              <span className="field-label">Project lead</span>
              <UserPicker value={form.leadId || undefined} onChange={(id) => setForm({ ...form, leadId: id ?? '' })} allowClear={false} />
            </div>
            {update.isError && <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(update.error)}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
