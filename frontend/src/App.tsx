import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import BoardPage from './pages/BoardPage';
import IssuesPage from './pages/IssuesPage';
import IssueDetailPage from './pages/IssueDetailPage';
import DashboardPage from './pages/DashboardPage';
import PlanningPage from './pages/PlanningPage';
import CreateIssuePage from './pages/CreateIssuePage';
import UsersPage from './pages/UsersPage';

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
            <Layout user={user} loading={isLoading}>
              <Routes>
                <Route path="/" element={<BoardPage />} />
                <Route path="/issues" element={<IssuesPage />} />
                <Route path="/issues/new" element={<CreateIssuePage />} />
                <Route path="/issues/:id" element={<IssueDetailPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/planning" element={<PlanningPage />} />
                <Route path="/users" element={<UsersPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
