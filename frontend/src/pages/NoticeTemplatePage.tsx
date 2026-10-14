import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NoticeContent } from '../api';
import NoticeEditor from '../components/notices/NoticeEditor';
import NoticePreview from '../components/notices/NoticePreview';
import { blankNotice } from '../components/notices/blank';
import { EmptyState, PageHeader, Spinner, errorMessage, useToast } from '../components/ui';

/** Adding or changing a service notice template (admins). `?copy=` starts a new one from an existing one. */
export default function NoticeTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const isNew = id === 'new';
  const sourceId = isNew ? params.get('copy') : id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: user, isLoading: userLoading } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const source = useQuery({ queryKey: ['notice-template', sourceId], queryFn: () => api.getNoticeTemplate(sourceId!), enabled: !!sourceId });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState<NoticeContent | null>(null);

  useEffect(() => {
    if (content) return;
    if (!sourceId) { setContent(blankNotice()); return; }
    const t = source.data;
    if (!t) return;
    setName(isNew ? `${t.name} (copy)` : t.name);
    setDescription(t.description ?? '');
    setSubject(t.subject);
    setContent(t.content);
  }, [content, sourceId, source.data, isNew]);

  const save = useMutation({
    mutationFn: () => {
      const data = {
        name: name.trim(),
        description: description.trim() || undefined,
        subject: subject.trim(),
        // Suggested values typed one per line: drop the blank ones.
        content: { ...content!, sections: content!.sections.map((s) => (s.kind === 'field' && s.options ? { ...s, options: s.options.map((o) => o.trim()).filter(Boolean) } : s)) },
      };
      return isNew ? api.createNoticeTemplate(data) : api.updateNoticeTemplate(id!, data);
    },
    onSuccess: (t) => {
      queryClient.invalidateQueries({ queryKey: ['notice-templates'] });
      queryClient.setQueryData(['notice-template', t.id], t);
      toast(`Template ${t.name} saved`);
      navigate('/notices?tab=templates');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (userLoading || (sourceId && source.isLoading)) return <Spinner />;
  if (user?.role !== 'ADMIN') return <EmptyState title="Only administrators can manage notice templates" />;
  if (source.error) return <EmptyState title={errorMessage(source.error)} action={<Link to="/notices?tab=templates" className="btn btn-default">Back to templates</Link>} />;
  if (!content) return <Spinner />;

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        breadcrumbs={<Link to="/notices?tab=templates" className="link">Service notice templates</Link>}
        title={isNew ? 'Add template' : `Edit ${source.data?.name ?? 'template'}`}
        actions={(
          <>
            <Link to="/notices?tab=templates" className="btn btn-subtle">Cancel</Link>
            <button type="button" className="btn btn-primary" disabled={!name.trim() || !subject.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save template'}
            </button>
          </>
        )}
      />
      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <div className="space-y-4 min-w-0">
          <div className="card p-4 space-y-3">
            <div>
              <label className="field-label" htmlFor="template-name">Name</label>
              <input id="template-name" autoFocus={isNew} className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maintenance reminder" />
            </div>
            <div>
              <label className="field-label" htmlFor="template-description">Description (optional)</label>
              <input id="template-description" className="input" maxLength={255} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use it" />
            </div>
            <div>
              <label className="field-label" htmlFor="template-subject">Email subject</label>
              <input id="template-subject" className="input" maxLength={255} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Maintenance Reminder: …" />
            </div>
          </div>
          <p className="text-sm text-jira-subtle">The texts below are what a new notice starts with; whoever sends it can change any of them.</p>
          <NoticeEditor value={content} onChange={setContent} template />
        </div>
        <div className="lg:sticky lg:top-20 min-w-0">
          <div className="section-title mb-2">Preview</div>
          <NoticePreview content={content} />
        </div>
      </div>
    </div>
  );
}
