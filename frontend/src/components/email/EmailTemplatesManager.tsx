import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EmailTemplate } from '../../api';
import { timeAgo } from '../../utils';
import { RichTextEditor, RichTextView } from '../RichText';
import { EditIcon, PlusIcon, TrashIcon } from '../Icons';
import { Dropdown, Modal, Spinner, errorMessage, useDialogs, useToast } from '../ui';

/** Filled in when an agent picks the template on a request. */
export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'customer.name', label: 'Customer\'s name' },
  { key: 'customer.firstName', label: 'Customer\'s first name' },
  { key: 'customer.email', label: 'Customer\'s email' },
  { key: 'agent.name', label: 'Your name' },
  { key: 'agent.firstName', label: 'Your first name' },
  { key: 'agent.email', label: 'Your email' },
  { key: 'issue.key', label: 'Request key (HELP-12)' },
  { key: 'issue.summary', label: 'Request summary' },
  { key: 'issue.status', label: 'Status' },
  { key: 'issue.priority', label: 'Priority' },
  { key: 'issue.assignee', label: 'Assignee' },
  { key: 'request.type', label: 'Request type' },
  { key: 'request.link', label: 'Link to the request on the portal' },
  { key: 'project.name', label: 'Service desk name' },
];

interface Form {
  id?: string;
  name: string;
  subject: string;
  body: string;
}

/**
 * The email templates agents pick from when writing an email on a request. Without `projectKey` it manages the
 * global ones (admins); with it, that service desk's own (its project admins).
 */
export default function EmailTemplatesManager({ projectKey, canManage }: { projectKey?: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [form, setForm] = useState<Form | null>(null);
  const [preview, setPreview] = useState<EmailTemplate | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const queryKey = ['email-templates', projectKey ?? null, projectKey ? 'project' : 'global'];

  const { data: templates, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => api.getEmailTemplates(projectKey ? { project: projectKey, scope: 'project' } : { scope: 'global' }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['email-templates'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const save = useMutation({
    mutationFn: () => {
      const data = { name: form!.name.trim(), subject: form!.subject.trim() || undefined, body: form!.body };
      return form!.id ? api.updateEmailTemplate(form!.id, data) : api.createEmailTemplate({ ...data, projectKey });
    },
    onSuccess: (t) => { refresh(); toast(`Template ${t.name} saved`); setForm(null); },
    onError,
  });
  const remove = useMutation({ mutationFn: (t: EmailTemplate) => api.deleteEmailTemplate(t.id), onSuccess: refresh, onError });

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    if (editorRef.current) {
      editorRef.current.chain().insertContent(token).run();
      // Focus straight away (the editor's own focus command waits for the next frame) so typing carries on after it.
      editorRef.current.view.focus();
    } else {
      setForm((f) => (f ? { ...f, body: `${f.body}${token}` } : f));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="font-semibold">{projectKey ? 'Email templates' : 'Templates'}</h3>
        {canManage && (
          <button type="button" className="btn btn-default btn-sm" onClick={() => setForm({ name: '', subject: '', body: '' })}>
            <PlusIcon size={14} /> Add template
          </button>
        )}
      </div>
      <p className="text-jira-subtle text-sm mb-3">
        {projectKey
          ? 'Agents pick these when replying to or emailing customers from this service desk, along with the global templates on the Email templates page.'
          : 'Offered on every service desk when agents reply to or email customers. Each service desk can add its own in its project settings.'}
      </p>
      {isLoading ? <Spinner /> : error ? <p className="field-error">{errorMessage(error)}</p> : !templates?.length ? (
        <p className="text-jira-muted text-sm">No templates yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Subject</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">
                    <button type="button" className="link text-left" onClick={() => setPreview(t)}>{t.name}</button>
                  </td>
                  <td className="text-jira-subtle">{t.subject || <span className="text-jira-muted">—</span>}</td>
                  <td className="text-jira-subtle whitespace-nowrap" title={new Date(t.updatedAt).toLocaleString()}>{timeAgo(t.updatedAt)}</td>
                  <td className="text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Edit ${t.name}`} onClick={() => setForm({ id: t.id, name: t.name, subject: t.subject ?? '', body: t.body })}><EditIcon size={14} /></button>
                        <button
                          type="button"
                          className="btn btn-subtle btn-sm btn-icon"
                          aria-label={`Delete ${t.name}`}
                          onClick={async () => { if (await confirm({ title: `Delete the ${t.name} template?`, confirmLabel: 'Delete', danger: true })) remove.mutate(t); }}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} width="max-w-2xl">
          {preview.subject && <p className="mb-2"><span className="text-jira-subtle">Subject:</span> {preview.subject}</p>}
          <div className="card p-3"><RichTextView value={preview.body} /></div>
        </Modal>
      )}

      {form && (
        <Modal
          title={form.id ? 'Edit template' : 'Add template'}
          onClose={() => setForm(null)}
          width="max-w-3xl"
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setForm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!form.name.trim() || !form.body || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        >
          <div className="space-y-3">
            <div>
              <label className="field-label" htmlFor="template-name">Name</label>
              <input id="template-name" autoFocus className="input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Waiting for your reply" />
            </div>
            <div>
              <label className="field-label" htmlFor="template-subject">Subject (optional)</label>
              <input id="template-subject" className="input" maxLength={255} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Used for new emails; replies keep “Re: …”" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="field-label mb-0">Text</span>
                <Dropdown
                  align="right"
                  width="w-80"
                  trigger={({ toggle }) => <button type="button" className="btn btn-subtle btn-sm" onClick={toggle}>Insert placeholder</button>}
                >
                  {(close) => (
                    <div className="max-h-72 overflow-y-auto">
                      {PLACEHOLDERS.map((p) => (
                        <button key={p.key} type="button" className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); insert(p.key); }}>
                          <span className="flex-1">{p.label}</span>
                          <span className="font-mono text-xs text-jira-muted">{`{{${p.key}}}`}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Dropdown>
              </div>
              <RichTextEditor
                value={form.body}
                onChange={(body) => setForm((f) => (f ? { ...f, body } : f))}
                editorRef={editorRef}
                mentions={false}
                minHeight={220}
                placeholder="Hi {{customer.firstName}}, …"
              />
              <p className="field-help">Placeholders such as {'{{customer.firstName}}'} are filled in for the request when an agent picks the template; they can still edit the text before sending.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
