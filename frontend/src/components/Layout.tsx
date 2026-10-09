import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { User } from '../api';
import { useProject } from '../project';
import { humanize } from '../utils';
import QuickSearch from './QuickSearch';
import NotificationBell from './NotificationBell';
import Avatar from './Avatar';
import { Dropdown, Modal, useToast } from './ui';
import { ChevronDownIcon, LogoutIcon, MenuIcon, PlusIcon, XIcon } from './Icons';
import CreateIssueForm from './CreateIssueForm';

const NAV = [
  { path: '/', label: 'Board', end: true },
  { path: '/search', label: 'Issues' },
  { path: '/projects', label: 'Projects' },
  { path: '/planning', label: 'Planning' },
  { path: '/dashboard', label: 'Dashboards' },
  { path: '/reports', label: 'Reports' },
  { path: '/users', label: 'People' },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 pr-2 shrink-0" aria-label="JiraTech home">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="jt-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2684FF" />
            <stop offset="1" stopColor="#0052CC" />
          </linearGradient>
        </defs>
        <path d="M12 2 22 12 12 22 2 12Z" fill="url(#jt-g)" />
        <path d="M12 7.5 16.5 12 12 16.5 7.5 12Z" fill="white" />
      </svg>
      <span className="hidden sm:inline font-semibold text-[17px] text-jira-navy tracking-tight">JiraTech</span>
    </Link>
  );
}

function ProjectSwitcher() {
  const { project, projects, setProjectKey } = useProject();
  const navigate = useNavigate();
  return (
    <Dropdown
      width="w-72"
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} className={`btn ${open ? 'bg-jira-blue-light text-jira-blue' : 'btn-subtle text-jira-navy'}`} title="Switch project">
          <span className="font-mono text-[11px] bg-jira-gray-hover text-jira-subtle rounded-[3px] px-1.5 py-0.5">{project?.key ?? '—'}</span>
          <span className="hidden sm:inline max-w-[150px] truncate">{project?.name ?? 'Select project'}</span>
          <ChevronDownIcon size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-heading">Switch project</div>
          <div className="max-h-72 overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setProjectKey(p.key); close(); }}
                className={`menu-item ${p.key === project?.key ? 'bg-jira-blue-light/60' : ''}`}
              >
                <span className="font-mono text-[11px] bg-jira-gray-hover rounded-[3px] px-1.5 py-0.5">{p.key}</span>
                <span className="truncate flex-1">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-jira-border mt-1 pt-1">
            <button type="button" className="menu-item" onClick={() => { navigate('/projects'); close(); }}>View all projects</button>
            <button type="button" className="menu-item" onClick={() => { navigate('/projects?create=1'); close(); }}>
              <PlusIcon size={14} /> Create project
            </button>
          </div>
        </>
      )}
    </Dropdown>
  );
}

/** Account-menu switch for notification emails (in-app notifications are always on). */
function EmailPreference() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['notification-prefs'], queryFn: api.getNotificationPreferences });
  const save = useMutation({
    mutationFn: (emailNotifications: boolean) => api.setNotificationPreferences({ emailNotifications }),
    onSuccess: (p) => {
      queryClient.setQueryData(['notification-prefs'], p);
      toast(p.emailNotifications ? 'Email notifications turned on' : 'Email notifications turned off');
    },
  });
  const on = data?.emailNotifications ?? true;
  return (
    <div className="border-t border-jira-border mt-1 pt-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={!data || save.isPending}
        onClick={() => save.mutate(!on)}
        className="menu-item justify-between"
      >
        <span>
          Email notifications
          <span className="block text-xs text-jira-muted">For assignments, mentions and issues you watch</span>
        </span>
        <span className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${on ? 'bg-[#36B37E]' : 'bg-jira-border'}`}>
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
      </button>
    </div>
  );
}

export default function Layout({ children, user, loading }: { children: React.ReactNode; user?: User; loading: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setMenuOpen(false), [pathname]);

  const logout = () => {
    localStorage.removeItem('token');
    queryClient.clear();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-white border-b border-jira-border print:hidden">
        <div className="h-14 px-2 sm:px-4 flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="btn btn-subtle btn-icon lg:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
          >
            {menuOpen ? <XIcon /> : <MenuIcon />}
          </button>
          <Logo />
          <ProjectSwitcher />
          <nav className="hidden lg:flex items-stretch h-14 ml-1" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={({ isActive }) =>
                  `relative flex items-center px-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-jira-blue after:absolute after:left-2 after:right-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-jira-blue'
                      : 'text-jira-subtle hover:text-jira-navy'
                  }`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button type="button" onClick={() => setCreating(true)} className="btn btn-primary max-sm:w-8 max-sm:px-0 sm:ml-2" aria-label="Create issue">
            <PlusIcon size={14} /> <span className="hidden sm:inline">Create</span>
          </button>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <QuickSearch />
            <NotificationBell />
            {!loading && user && (
              <Dropdown
                align="right"
                width="w-64"
                trigger={({ toggle }) => (
                  <button type="button" onClick={toggle} className="rounded-full p-0.5 hover:ring-2 hover:ring-jira-border" aria-label="Your profile and settings">
                    <Avatar name={user.name} size="md" />
                  </button>
                )}
              >
                {() => (
                  <>
                    <div className="flex items-center gap-3 px-3 py-2">
                      <Avatar name={user.name} size="md" />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{user.name}</div>
                        <div className="text-xs text-jira-muted truncate">{user.email}</div>
                        <div className="text-xs text-jira-muted">{humanize(user.role)}</div>
                      </div>
                    </div>
                    <EmailPreference />
                    <div className="border-t border-jira-border mt-1 pt-1">
                      <button type="button" className="menu-item" onClick={logout}><LogoutIcon size={14} /> Log out</button>
                    </div>
                  </>
                )}
              </Dropdown>
            )}
          </div>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" className="lg:hidden border-t border-jira-border py-2" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={({ isActive }) =>
                  `block px-4 py-2.5 text-sm font-medium border-l-[3px] ${
                    isActive ? 'border-jira-blue bg-jira-blue-light/60 text-jira-blue' : 'border-transparent text-jira-navy hover:bg-jira-gray'
                  }`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1 w-full min-w-0 px-4 py-4 sm:px-6 sm:py-6 print:p-0">{children}</main>

      {creating && (
        <Modal title="Create issue" onClose={() => !createPending && setCreating(false)} width="max-w-2xl">
          <CreateIssueForm
            formId="create-issue-modal"
            onPendingChange={setCreatePending}
            onCancel={() => setCreating(false)}
            onCreated={(issue, another) => {
              toast(`${issue.key} created`);
              if (!another) {
                setCreating(false);
                navigate(`/browse/${issue.key}`);
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}
