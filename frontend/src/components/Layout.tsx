import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '../api';
import { useProject } from '../project';
import QuickSearch from './QuickSearch';
import Avatar from './Avatar';

const NAV = [
  { path: '/', label: 'Board' },
  { path: '/search', label: 'Issues' },
  { path: '/projects', label: 'Projects' },
  { path: '/planning', label: 'Planning' },
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/users', label: 'Users' },
];

function ProjectSwitcher() {
  const { project, projects, setProjectKey } = useProject();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 rounded text-sm font-medium hover:bg-white/10"
        title="Switch project"
      >
        <span className="font-mono text-xs bg-white/20 rounded px-1.5 py-0.5">{project?.key ?? '—'}</span>
        <span className="max-w-[140px] truncate">{project?.name ?? 'Select project'}</span>
        <span className="text-xs opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-white text-jira-navy border border-jira-border rounded shadow-lg z-50 py-1">
          <div className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase text-gray-500">Projects</div>
          <div className="max-h-72 overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setProjectKey(p.key); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-jira-gray ${p.key === project?.key ? 'bg-blue-50' : ''}`}
              >
                <span className="font-mono text-xs bg-jira-gray rounded px-1.5 py-0.5">{p.key}</span>
                <span className="truncate flex-1">{p.name}</span>
                {p.key === project?.key && <span className="text-jira-blue text-xs">current</span>}
              </button>
            ))}
          </div>
          <div className="border-t border-jira-border mt-1 pt-1">
            <button
              type="button"
              onClick={() => { navigate('/projects'); setOpen(false); }}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-jira-gray"
            >
              View all projects
            </button>
            <button
              type="button"
              onClick={() => { navigate('/projects?create=1'); setOpen(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-jira-blue hover:bg-jira-gray"
            >
              + Create project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout({
  children,
  user,
  loading,
}: {
  children: React.ReactNode;
  user?: User;
  loading: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const logout = () => {
    localStorage.removeItem('token');
    queryClient.clear();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-jira-blue text-white shadow">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link to="/" className="font-bold text-lg tracking-tight shrink-0">
              JiraTech
            </Link>
            <ProjectSwitcher />
            <nav className="flex gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    isActive(item.path) ? 'bg-white/20' : 'hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <QuickSearch />
            <Link
              to="/issues/new"
              className="bg-white text-jira-blue hover:bg-blue-50 px-3 py-1.5 rounded text-sm font-semibold"
            >
              + Create
            </Link>
            {!loading && user && (
              <div className="flex items-center gap-2">
                <Avatar name={user.name} />
                <button type="button" onClick={logout} className="text-xs opacity-80 hover:opacity-100 hover:underline">
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
