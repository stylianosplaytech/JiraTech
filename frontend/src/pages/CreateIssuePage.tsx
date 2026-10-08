import { useNavigate, useSearchParams } from 'react-router-dom';
import CreateIssueForm from '../components/CreateIssueForm';
import { useToast } from '../components/ui';

export default function CreateIssuePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  return (
    <div className="max-w-3xl">
      <h1 className="page-title mb-6">Create issue</h1>
      <div className="card p-6">
        <CreateIssueForm
          parentId={params.get('parentId') ?? undefined}
          initialType={params.get('type') ?? undefined}
          onCancel={() => navigate(-1)}
          onCreated={(issue, another) => {
            toast(`${issue.key} created`);
            if (!another) navigate(`/browse/${issue.key}`);
          }}
        />
      </div>
    </div>
  );
}
