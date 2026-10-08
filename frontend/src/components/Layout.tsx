import { Link, useLocation } from 'react-router-dom';
import type { User } from '../api';

const NAV = [
  { path: '/', label: 'Board' },
  { path: '/issues', label: 'Issues' },
  { path: '/users', label: 'Users' },
  { path: '/planning', label: 'Planning' },
  { path: '/dashboard', label: 'Dashboard' },
];

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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-jira-blue text-white shadow">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="font-bold text-lg tracking-tight">
              JiraTech
            </Link>
            <nav className="flex gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    location.pathname === item.path
                      ? 'bg-white/20'
                      : 'hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/issues/new"
              className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded text-sm font-medium"
            >
              + Create
            </Link>
            {!loading && user && (
              <span className="text-sm opacity-90">
                {user.name} <span className="opacity-60">({user.role})</span>
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
