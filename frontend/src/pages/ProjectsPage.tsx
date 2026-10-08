import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useProject } from '../project';
import { suggestProjectKey } from '../utils';
import UserPicker from '../components/UserPicker';
import Avatar from '../components/Avatar';

const CREATOR_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'PROGRAM_MANAGER', 'PRODUCT_MANAGER'];

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setProjectKey } = useProject();
  const [form, setForm] = useState({ name: '', key: '', description: '', leadId: '', strictHierarchy: false });
  const [keyEdited, setKeyEdited] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.createProject({
        name: form.name.trim(),
        key: form.key,
        description: form.description.trim() || undefined,
        leadId: form.leadId || undefined,
        strictHierarchy: form.strictHierarchy,
      }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setProjectKey(project.key);
      navigate(`/projects/${project.key}`);
    },
  });

  const keyValid = /^[A-Z][A-Z0-9]{1,9}$/.test(form.key);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onMouseDown={onClose}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        className="bg-white rounded-lg p-6 w-[480px] space-y-4 shadow-xl"
      >
        <h2 className="text-lg font-semibold">Create project</h2>
        <label className="block text-sm">
          <span className="font-medium">Name *</span>
          <input
            autoFocus
            required
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name, key: keyEdited ? f.key : suggestProjectKey(name) }));
            }}
            placeholder="e.g. Web Platform"
            className="mt-1 w-full border border-jira-border rounded px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Key *</span>
          <input
            required
            value={form.key}
            onChange={(e) => { setKeyEdited(true); setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) }); }}
            className="mt-1 w-40 border border-jira-border rounded px-3 py-2 font-mono"
          />
          <span className="block text-xs text-gray-500 mt-1">
            Issue keys will look like <span className="font-mono">{form.key || 'KEY'}-1</span>. 2–10 letters or digits, starting with a letter. Cannot be changed later.
          </span>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Description</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="mt-1 w-full border border-jira-border rounded px-3 py-2"
          />
        </label>
        <div className="text-sm">
          <span className="font-medium">Project lead</span>
          <div className="mt-1">
            <UserPicker value={form.leadId || undefined} onChange={(id) => setForm({ ...form, leadId: id ?? '' })} placeholder="Me (default)" />
          </div>
                  </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.strictHierarchy}
            onChange={(e) => setForm({ ...form, strictHierarchy: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            Enforce SPORTS conventions
            <span className="block text-xs text-gray-500">
              Stories, tasks and defects must sit under an epic; components must follow the ASSETID / @team naming.
            </span>
          </span>
        </label>
        {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-1.5 border border-jira-border rounded text-sm">Cancel</button>
          <button
            type="submit"
            disabled={!form.name.trim() || !keyValid || create.isPending}
            className="px-4 py-1.5 bg-jira-blue text-white rounded text-sm disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectKey, setProjectKey } = useProject();
  const [filter, setFilter] = useState('');
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: api.getProjects });

  const showCreate = searchParams.get('create') === '1';
  const canCreate = !!me && CREATOR_ROLES.includes(me.role);
  const visible = projects?.filter((p) =>
    `${p.key} ${p.name}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Projects</h1>
        {canCreate && (
          <button
            type="button"
            onClick={() => setSearchParams({ create: '1' })}
            className="bg-jira-blue text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            Create project
          </button>
        )}
      </div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search projects"
        className="border border-jira-border rounded px-3 py-2 text-sm w-72 mb-4"
      />
      {isLoading ? (
        <div className="text-gray-500">Loading…</div>
      ) : (
        <div className="bg-white rounded-lg border border-jira-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-jira-gray border-b border-jira-border">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Key</th>
                <th className="text-left px-4 py-2 font-medium">Lead</th>
                <th className="text-right px-4 py-2 font-medium">Issues</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible?.map((p) => (
                <tr key={p.id} className="border-b border-jira-border last:border-0 hover:bg-jira-gray/50">
                  <td className="px-4 py-2">
                    <Link to={`/projects/${p.key}`} className="text-jira-blue hover:underline font-medium">{p.name}</Link>
                    {p.description && <div className="text-xs text-gray-500 truncate max-w-md">{p.description}</div>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{p.key}</td>
                  <td className="px-4 py-2">
                    {p.lead ? (
                      <span className="flex items-center gap-2"><Avatar name={p.lead.name} size="xs" />{p.lead.name}</span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right">{p._count?.issues ?? 0}</td>
                  <td className="px-4 py-2 text-right">
                    {p.key === projectKey ? (
                      <span className="text-xs text-gray-500">Current</span>
                    ) : (
                      <button type="button" onClick={() => setProjectKey(p.key)} className="text-xs text-jira-blue hover:underline">
                        Switch to
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visible?.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">No projects match “{filter}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {showCreate && canCreate && <CreateProjectDialog onClose={() => setSearchParams({})} />}
      {showCreate && me && !canCreate && (
        <p className="mt-4 text-sm text-gray-600">Only admins and managers can create projects.</p>
      )}
    </div>
  );
}
