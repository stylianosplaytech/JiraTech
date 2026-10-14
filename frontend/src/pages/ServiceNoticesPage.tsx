import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NoticeTemplate } from '../api';
import { timeAgo } from '../utils';
import { CopyIcon, EditIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { EmptyState, Modal, PageHeader, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';

/** Service notices: the ones sent so far and the templates new ones start from. */
export default function ServiceNoticesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'templates' ? 'templates' : 'sent';
  const [choosing, setChoosing] = useState(false);
  const { data: user } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Service notices"
        actions={<button type="button" className="btn btn-primary" onClick={() => setChoosing(true)}><PlusIcon size={14} /> New notice</button>}
      >
        <p className="text-jira-subtle text-sm mt-1">Maintenance reminders, incident notifications and other notices emailed to companies, groups and people.</p>
        <div className="flex gap-1 mt-3 border-b border-jira-border" role="tablist">
          {([['sent', 'Sent'], ['templates', 'Templates']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setParams(value === 'sent' ? {} : { tab: value })}
              className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === value ? 'border-jira-blue text-jira-blue' : 'border-transparent text-jira-subtle hover:text-jira-navy'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHeader>

      {tab === 'sent' ? <SentList onNew={() => setChoosing(true)} /> : <TemplateList isAdmin={isAdmin} />}
      {choosing && <ChooseTemplate onClose={() => setChoosing(false)} />}
    </div>
  );
}

function SentList({ onNew }: { onNew: () => void }) {
  const navigate = useNavigate();
  const { data: notices, isLoading, error } = useQuery({ queryKey: ['service-notices'], queryFn: api.getServiceNotices });
  if (isLoading) return <Spinner />;
  if (error) return <p className="field-error">{errorMessage(error)}</p>;
  if (!notices?.length) {
    return <EmptyState title="No notices sent yet" action={<button type="button" className="btn btn-primary" onClick={onNew}>Write the first one</button>}>Start from a template and change any text before sending.</EmptyState>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead><tr><th>Subject</th><th>Template</th><th>Sent to</th><th>By</th><th>When</th><th /></tr></thead>
        <tbody>
          {notices.map((n) => (
            <tr key={n.id} className="cursor-pointer" onClick={() => navigate(`/notices/${n.id}`)}>
              <td className="font-medium"><Link to={`/notices/${n.id}`} className="link" onClick={(e) => e.stopPropagation()}>{n.subject}</Link></td>
              <td className="text-jira-subtle">{n.template?.name ?? <span className="text-jira-muted">—</span>}</td>
              <td className="text-jira-subtle max-w-[320px] truncate" title={n.summary}>{n.summary}</td>
              <td className="text-jira-subtle whitespace-nowrap">{n.sentBy?.name ?? '—'}</td>
              <td className="text-jira-subtle whitespace-nowrap" title={new Date(n.createdAt).toLocaleString()}>{timeAgo(n.createdAt)}</td>
              <td className="text-right">
                {n.status === 'FAILED' && <span className="lozenge bg-[#FFEBE6] text-[#BF2600]" title={n.error ?? undefined}>Not sent</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplateList({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const { data: templates, isLoading, error } = useQuery({ queryKey: ['notice-templates'], queryFn: api.getNoticeTemplates });
  const remove = useMutation({
    mutationFn: (t: NoticeTemplate) => api.deleteNoticeTemplate(t.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notice-templates'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <p className="field-error">{errorMessage(error)}</p>;
  return (
    <div>
      {isAdmin && (
        <div className="flex justify-end mb-3">
          <Link to="/notices/templates/new" className="btn btn-default btn-sm"><PlusIcon size={14} /> Add template</Link>
        </div>
      )}
      {!templates?.length ? (
        <EmptyState title="No templates yet">{isAdmin ? 'Add one to give everyone a ready-made notice to start from.' : 'An administrator can add some.'}</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="card flex flex-col">
              <div className="h-2 rounded-t-[3px]" style={{ background: t.content.color }} />
              <div className="p-4 flex-1">
                <div className="font-semibold">{t.name}</div>
                {t.description && <p className="text-sm text-jira-subtle mt-1">{t.description}</p>}
                <p className="text-xs text-jira-muted mt-2">Updated {timeAgo(t.updatedAt)}</p>
              </div>
              <div className="flex items-center gap-1 px-3 py-2 border-t border-jira-border">
                <Link to={`/notices/new?template=${t.id}`} className="btn btn-primary btn-sm">Use</Link>
                {isAdmin && (
                  <>
                    <span className="flex-1" />
                    <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Edit ${t.name}`} onClick={() => navigate(`/notices/templates/${t.id}`)}><EditIcon size={14} /></button>
                    <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Duplicate ${t.name}`} onClick={() => navigate(`/notices/templates/new?copy=${t.id}`)}><CopyIcon size={14} /></button>
                    <button
                      type="button"
                      className="btn btn-subtle btn-sm btn-icon"
                      aria-label={`Delete ${t.name}`}
                      onClick={async () => { if (await confirm({ title: `Delete the ${t.name} template?`, message: 'Notices already sent from it are kept.', confirmLabel: 'Delete', danger: true })) remove.mutate(t); }}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChooseTemplate({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data: templates, isLoading } = useQuery({ queryKey: ['notice-templates'], queryFn: api.getNoticeTemplates });
  const go = (to: string) => { onClose(); navigate(to); };
  return (
    <Modal title="New notice" onClose={onClose} width="max-w-xl">
      <p className="text-sm text-jira-subtle mb-3">Pick a template to start from. You can change any text before sending.</p>
      {isLoading ? <Spinner /> : (
        <div className="space-y-2">
          {templates?.map((t) => (
            <button key={t.id} type="button" className="card w-full text-left p-3 flex gap-3 hover:bg-jira-gray" onClick={() => go(`/notices/new?template=${t.id}`)}>
              <span className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: t.content.color }} />
              <span className="min-w-0">
                <span className="block font-medium">{t.name}</span>
                {t.description && <span className="block text-sm text-jira-subtle">{t.description}</span>}
              </span>
            </button>
          ))}
          <button type="button" className="card w-full text-left p-3 flex gap-3 hover:bg-jira-gray" onClick={() => go('/notices/new')}>
            <span className="w-1.5 self-stretch rounded-full shrink-0 bg-jira-border" />
            <span>
              <span className="block font-medium">Blank notice</span>
              <span className="block text-sm text-jira-subtle">Start from scratch.</span>
            </span>
          </button>
        </div>
      )}
    </Modal>
  );
}
