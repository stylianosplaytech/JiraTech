import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isCustomer, type User } from '../api';
import { EmailPreference, Logo } from '../components/Layout';
import NotificationBell from '../components/NotificationBell';
import Avatar from '../components/Avatar';
import { Dropdown } from '../components/ui';
import { LogoutIcon } from '../components/Icons';

/** The help center chrome: what customers see instead of the full app. Staff get a way back. */
export default function PortalLayout({ user, children }: { user?: User; children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = () => {
    localStorage.removeItem('token');
    queryClient.clear();
    navigate('/login');
  };
  const link = ({ isActive }: { isActive: boolean }) =>
    `relative flex items-center px-3 text-sm font-medium ${isActive
      ? 'text-jira-blue after:absolute after:left-2 after:right-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-jira-blue'
      : 'text-jira-subtle hover:text-jira-navy'}`;

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFBFC]">
      <header className="sticky top-0 z-40 bg-white border-b border-jira-border">
        <div className="h-14 px-2 sm:px-4 flex items-center gap-1 sm:gap-2 max-w-5xl mx-auto">
          <Logo to="/portal" label="Help center" />
          <nav className="flex items-stretch h-14" aria-label="Help center">
            <NavLink to="/portal" end className={link}>Home</NavLink>
            <NavLink to="/portal/requests" className={link}>Requests</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {user && !isCustomer(user) && <Link to="/" className="btn btn-subtle hidden sm:inline-flex">Back to JiraTech</Link>}
            <NotificationBell />
            {user && (
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
                      </div>
                    </div>
                    <EmailPreference />
                    <div className="border-t border-jira-border mt-1 pt-1">
                      {!isCustomer(user) && <Link to="/" className="menu-item sm:hidden">Back to JiraTech</Link>}
                      <button type="button" className="menu-item" onClick={logout}><LogoutIcon size={14} /> Log out</button>
                    </div>
                  </>
                )}
              </Dropdown>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto min-w-0 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
