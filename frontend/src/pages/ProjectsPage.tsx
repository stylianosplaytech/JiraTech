import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useProject } from '../project';
import { suggestProjectKey } from '../utils';
import UserPicker from '../components/UserPicker';
import { ACCESS_INFO } from '../components/ProjectPeople';
import Avatar from '../components/Avatar';
import { FolderIcon, PlusIcon, SearchIcon } from '../components/Icons';
import { EmptyState, Modal, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

const CREATOR_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'PROGRAM_MANAGER', 'PRODUCT_MANAGER'];

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
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
      toast(`Project ${project.name} created`);
      navigate(`/projects/${project.key}`);
    },
  });

  const keyValid = /^[A-Z][A-Z0-9]{1,9}$/.test(form.key);

  return (
    <Modal
      title="Create project"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn btn-subtle">Cancel</button>
          <button type="submit" form="create-project" disabled={!form.name.trim() || !keyValid || create.isPending} className="btn btn-primary">
            {create.isPending ? 'Creating…' : 'Create project'}
          </button>
        </>
      )}
    >
      <form id="create-project" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
        <p className="text-jira-subtle">Projects group issues with their own key, people, versions and components.</p>
        <label className="block">
          <span className="field-label">Name <span className="text-[#DE350B]">*</span></span>
          <input
            autoFocus
            required
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name, key: keyEdited ? f.key : suggestProjectKey(name) }));
            }}
            placeholder="e.g. Web Platform"
            className="input"
          />
        </label>
        <label className="block">
          <span className="field-label">Key <span className="text-[#DE350B]">*</span></span>
          <input
            required
            value={form.key}
            onChange={(e) => { setKeyEdited(true); setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) }); }}
            className="input w-40 font-mono"
          />
          <span className={form.key && !keyValid ? 'field-error' : 'field-help'}>
            Issues will be numbered <span className="font-mono">{form.key || 'KEY'}-1</span>, <span className="font-mono">{form.key || 'KEY'}-2</span>…
            Use 2–10 letters or digits, starting with a letter. The key can't be changed later.
          </span>
        </label>
        <label className="block">
          <span className="field-label">Description</span>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="input" />
        </label>
        <div>
          <span className="field-label">Project lead</span>
          <UserPicker value={form.leadId || undefined} onChange={(id) => setForm({ ...form, leadId: id ?? '' })} placeholder="Me (default)" />
        </div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={form.strictHierarchy} onChange={(e) => setForm({ ...form, strictHierarchy: e.target.checked })} className="mt-1" />
          <span>
            Enforce SPORTS conventions
            <span className="field-help mt-0">Stories, tasks and defects must sit under an epic; components must follow the ASSETID / @team naming.</span>
          </span>
        </label>
        {create.isError && <div className="rounded-[3px] bg-[#FFEBE6] text-[#BF2600] px-3 py-2">{errorMessage(create.error)}</div>}
      </form>
    </Modal>
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
  const visible = projects?.filter((p) => `${p.key} ${p.name}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Projects"
        actions={canCreate && (
          <button type="button" onClick={() => setSearchParams({ create: '1' })} className="btn btn-primary">
            <PlusIcon size={14} /> Create project
          </button>
        )}
      >
        <div className="relative w-64 mt-4">
          <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jira-muted pointer-events-none" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search projects" className="input h-8 pl-8" />
        </div>
      </PageHeader>

      {isLoading ? <Spinner /> : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Type</th>
                <th>Access</th>
                <th>Your role</th>
                <th>Lead</th>
                <th className="text-right">Issues</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible?.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/projects/${p.key}`} className="flex items-center gap-3 group">
                      <span className="flex items-center justify-center w-6 h-6 rounded-[3px] bg-jira-blue-light text-jira-blue shrink-0"><FolderIcon size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-jira-blue group-hover:underline">{p.name}</span>
                        {p.description && <span className="block text-xs text-jira-muted truncate max-w-md">{p.description}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{p.key}</td>
                  <td className="text-jira-subtle">{p.strictHierarchy ? 'SPORTS conventions' : 'Standard'}</td>
                  <td>
                    <span className={`lozenge ${p.defaultAccess === 'NONE' ? 'bg-[#FFEBE6] text-[#BF2600]' : p.defaultAccess === 'VIEWER' ? 'bg-[#FFFAE6] text-[#974F0C]' : 'bg-[#E3FCEF] text-[#006644]'}`} title={ACCESS_INFO[p.defaultAccess].help}>
                      {ACCESS_INFO[p.defaultAccess].label}
                    </span>
                  </td>
                  <td className="text-jira-subtle">{p.myRole && p.myRole !== 'NONE' ? p.myRole.charAt(0) + p.myRole.slice(1).toLowerCase() : '—'}</td>
                  <td>
                    {p.lead ? <span className="flex items-center gap-2"><Avatar name={p.lead.name} size="xs" />{p.lead.name}</span> : <span className="text-jira-muted">—</span>}
                  </td>
                  <td className="text-right">{p._count?.issues ?? 0}</td>
                  <td className="text-right w-28">
                    {p.key === projectKey
                      ? <span className="lozenge bg-jira-blue-light text-jira-blue">Current</span>
                      : <button type="button" onClick={() => setProjectKey(p.key)} className="btn btn-subtle btn-sm">Switch to</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible?.length === 0 && <EmptyState title="No projects match your search">Check the spelling or try another keyword.</EmptyState>}
        </>
      )}
      {showCreate && canCreate && <CreateProjectDialog onClose={() => setSearchParams({})} />}
      {showCreate && me && !canCreate && (
        <Modal title="You can't create projects" onClose={() => setSearchParams({})} footer={<button type="button" className="btn btn-primary" onClick={() => setSearchParams({})}>OK</button>}>
          Only admins and managers can create projects. Ask one of them to create it for you.
        </Modal>
      )}
    </div>
  );
}
