import { Routes, Route, Navigate, Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, isCustomer, type User } from './api';
import { ProjectProvider } from './project';
import { EmptyState, Spinner } from './components/ui';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import SetPasswordPage from './pages/SetPasswordPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import EmailSettingsPage from './pages/EmailSettingsPage';
import EmailTemplatesPage from './pages/EmailTemplatesPage';
import NotificationSettingsPage from './pages/NotificationSettingsPage';
import ApiTokensPage from './pages/ApiTokensPage';
import WebhooksPage from './pages/WebhooksPage';
import AutomationPage from './pages/AutomationPage';
import BoardPage from './pages/BoardPage';
import SearchPage from './pages/SearchPage';
import IssueDetailPage from './pages/IssueDetailPage';
import DashboardPage from './pages/DashboardPage';
import ReportsPage from './pages/ReportsPage';
import PlanningPage from './pages/PlanningPage';
import CreateIssuePage from './pages/CreateIssuePage';
import UsersPage from './pages/UsersPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import QueuesPage from './pages/QueuesPage';
import ServiceNoticesPage from './pages/ServiceNoticesPage';
import NoticeComposePage from './pages/NoticeComposePage';
import NoticeViewPage from './pages/NoticeViewPage';
import NoticeTemplatePage from './pages/NoticeTemplatePage';
import PortalLayout from './portal/PortalLayout';
import PortalHomePage from './portal/PortalHomePage';
import PortalDeskPage from './portal/PortalDeskPage';
import MyRequestsPage from './portal/MyRequestsPage';
import PortalRequestPage from './portal/PortalRequestPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Issue links (e.g. from notifications) take customers to the request in the help center. */
function BrowseRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/portal/requests/${id}`} replace />;
}

function Portal({ user }: { user?: User }) {
  return (
    <PortalLayout user={user}>
      <Routes>
        <Route index element={<PortalHomePage />} />
        <Route path="requests" element={<MyRequestsPage />} />
        <Route path="requests/:key" element={<PortalRequestPage />} />
        <Route path=":slug" element={<PortalDeskPage />} />
        <Route path=":slug/:typeId" element={<PortalDeskPage />} />
        <Route path="*" element={<EmptyState title="Page not found" action={<Link to="/portal" className="btn btn-default">Help center</Link>} />} />
      </Routes>
    </PortalLayout>
  );
}

export default function App() {
  // Re-render on every navigation: logging in or out changes the token, and the query below must notice.
  useLocation();
  const { data: user, isLoading, isPending } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled: !!localStorage.getItem('token'),
    retry: false,
  });
  // Wait to know who this is: customers must never load the agent app (its requests would be refused).
  // isPending, not isLoading: right after login the query is enabled but hasn't started fetching yet.
  const deciding = isPending && !!localStorage.getItem('token');

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/portal/*" element={<ProtectedRoute>{deciding ? <Spinner /> : <Portal user={user} />}</ProtectedRoute>} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            {deciding ? <Spinner /> : isCustomer(user) ? (
              <Routes>
                <Route path="/browse/:id" element={<BrowseRedirect />} />
                <Route path="*" element={<Navigate to="/portal" replace />} />
              </Routes>
            ) : (
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
                    <Route path="/queues" element={<QueuesPage />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/planning" element={<PlanningPage />} />
                    <Route path="/users" element={<UsersPage />} />
                    <Route path="/notices" element={<ServiceNoticesPage />} />
                    <Route path="/notices/new" element={<NoticeComposePage />} />
                    <Route path="/notices/templates/:id" element={<NoticeTemplatePage />} />
                    <Route path="/notices/:id" element={<NoticeViewPage />} />
                    <Route path="/settings/email" element={<EmailSettingsPage />} />
                    <Route path="/settings/email-templates" element={<EmailTemplatesPage />} />
                    <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
                    <Route path="/settings/api-tokens" element={<ApiTokensPage />} />
                    <Route path="/settings/webhooks" element={<WebhooksPage />} />
                    <Route path="/settings/automation" element={<AutomationPage />} />
                    <Route path="*" element={<EmptyState title="Page not found" action={<Link to="/" className="btn btn-default">Go to the board</Link>}>The page you're looking for doesn't exist.</EmptyState>} />
                  </Routes>
                </Layout>
              </ProjectProvider>
            )}
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
