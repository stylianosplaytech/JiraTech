import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { ProjectProvider } from './project';
import { EmptyState } from './components/ui';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import BoardPage from './pages/BoardPage';
import SearchPage from './pages/SearchPage';
import IssueDetailPage from './pages/IssueDetailPage';
import DashboardPage from './pages/DashboardPage';
import PlanningPage from './pages/PlanningPage';
import CreateIssuePage from './pages/CreateIssuePage';
import UsersPage from './pages/UsersPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled: !!localStorage.getItem('token'),
    retry: false,
  });

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <ProjectProvider>
              <Layout user={user} loading={isLoading}>
                <Routes>
                  <Route path="/" element={<BoardPage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/issues" element={<Navigate to="/search" replace />} />
                  <Route path="/issues/new" element={<CreateIssuePage />} />
                  <Route path="/issues/:id" element={<IssueDetailPage />} />
                  <Route path="/browse/:id" element={<IssueDetailPage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/projects/:key" element={<ProjectPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/planning" element={<PlanningPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="*" element={<EmptyState title="Page not found" action={<Link to="/" className="btn btn-default">Go to the board</Link>}>The page you're looking for doesn't exist.</EmptyState>} />
                </Routes>
              </Layout>
            </ProjectProvider>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
