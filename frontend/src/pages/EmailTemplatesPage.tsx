import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import EmailTemplatesManager from '../components/email/EmailTemplatesManager';
import { EmptyState, PageHeader, Spinner } from '../components/ui';

/** Global email templates, offered on every service desk (admins). */
export default function EmailTemplatesPage() {
  const { data: user, isLoading } = useQuery({ queryKey: ['me'], queryFn: api.me });
  if (isLoading) return <Spinner />;
  if (user?.role !== 'ADMIN') return <EmptyState title="Only administrators can manage email templates" />;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Email templates" />
      <div className="card p-4">
        <EmailTemplatesManager canManage />
      </div>
    </div>
  );
}
