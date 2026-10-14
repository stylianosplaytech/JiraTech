import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Attachment, type EmailAddress, type EmailMode, type Issue, type IssueEmail, type IssueEmails } from '../../api';
import { RichTextEditor } from '../RichText';
import { SelectPicker } from '../Pickers';
import { AlertIcon, PaperclipIcon } from '../Icons';
import { Modal, errorMessage, useDialogs, useToast } from '../ui';
import AddressInput from './AddressInput';
import {
  cleanAddresses, defaultSubject, describeAddresses, isRef, replyRecipients, subjectWithKey, type Recipient,
} from './recipients';
import { useRecipientRefs } from './useRecipientRefs';

export interface ComposeRequest {
  mode: EmailMode;
  /** The email replied to or forwarded */
  original?: IssueEmail | null;
}

interface Draft {
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  html: string;
}

const draftKey = (issueId: string, r: ComposeRequest) => `jt-email-draft:${issueId}:${r.mode}:${r.original?.id ?? 'new'}`;

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as Draft : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    // Private windows may refuse storage; the draft just isn't kept.
  }
}

const TITLES: Record<EmailMode, string> = { reply: 'Reply', replyAll: 'Reply all', forward: 'Forward email', new: 'New email' };

/** Writing an email from a request: reply, reply all, forward or a new one, optionally from a template. */
export default function EmailComposer({
  issue, request, data, onClose,
}: {
  issue: Issue;
  request: ComposeRequest;
  data: IssueEmails;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const { mode, original } = request;
  const own = data.ownAddresses;
  const key = draftKey(issue.id, request);

  const initial = useMemo<Draft>(() => {
    const saved = readDraft(key);
    if (saved) return saved;
    const recipients = original && (mode === 'reply' || mode === 'replyAll')
      ? replyRecipients(original, mode, own)
      : { to: mode === 'new' && issue.reporter?.email ? cleanAddresses([{ email: issue.reporter.email, name: issue.reporter.name }], own) : [], cc: [] };
    return { ...recipients, bcc: [] as Recipient[], subject: defaultSubject(mode, issue, original), html: '' };
    // Only when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [restored] = useState(() => !!readDraft(key));

  const [to, setTo] = useState<Recipient[]>(initial.to);
  const [cc, setCc] = useState<Recipient[]>(initial.cc);
  const [bcc, setBcc] = useState<Recipient[]>(initial.bcc);
  const [showCc, setShowCc] = useState(initial.cc.length > 0);
  const [showBcc, setShowBcc] = useState(initial.bcc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [html, setHtml] = useState(initial.html);
  const [includeQuote, setIncludeQuote] = useState(true);
  // Forwarding usually goes to a supplier or colleague, so it stays off the customer's portal unless chosen.
  const [internal, setInternal] = useState(mode === 'forward');
  const [attachmentIds, setAttachmentIds] = useState<string[]>(mode === 'forward' && original ? original.attachments.map((a) => a.id) : []);
  const [uploaded, setUploaded] = useState<Attachment[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = !!html || subject !== initial.subject || to.length !== initial.to.length || cc.length !== initial.cc.length || bcc.length > 0;
  useEffect(() => {
    writeDraft(key, dirty ? { to, cc, bcc, subject, html } : null);
  }, [key, dirty, to, cc, bcc, subject, html]);

  const { data: templates = [] } = useQuery({
    queryKey: ['email-templates', issue.project?.key],
    queryFn: () => api.getEmailTemplates({ project: issue.project?.key }),
    enabled: !!issue.project?.key,
  });

  const { data: users = [] } = useQuery({ queryKey: ['users', 'all', ''], queryFn: () => api.getUsers(undefined, 'all') });
  const refs = useRecipientRefs();

  // Everyone on the request or in its emails first, then everyone else with an account, to suggest as recipients.
  const suggestions = useMemo(() => {
    const people: EmailAddress[] = [];
    if (issue.reporter?.email) people.push({ email: issue.reporter.email, name: issue.reporter.name });
    for (const w of issue.watchers ?? []) people.push({ email: w.user.email, name: w.user.name });
    for (const e of data.emails) people.push({ email: e.fromEmail, name: e.direction === 'INBOUND' ? e.fromName : null }, ...e.to, ...e.cc);
    for (const u of users) people.push({ email: u.email, name: u.name });
    return cleanAddresses(people.map(({ email, name }) => ({ email, name })), own);
  }, [issue.reporter, issue.watchers, data.emails, users, own]);

  const files = useMemo(() => {
    const all = [...(issue.attachments ?? []), ...uploaded];
    return all.filter((a, i) => all.findIndex((b) => b.id === a.id) === i);
  }, [issue.attachments, uploaded]);

  const applyTemplate = async (id: string | null) => {
    setTemplateId(id);
    if (!id) return;
    if (html && !(await confirm({ title: 'Replace what you have written?', message: 'The template replaces the text of the email.', confirmLabel: 'Use template' }))) {
      setTemplateId(null);
      return;
    }
    try {
      const firstPerson = to.find((r) => !isRef(r)) as EmailAddress | undefined;
      const rendered = await api.renderEmailTemplate(issue.id, id, firstPerson?.email);
      if (editorRef.current) editorRef.current.commands.setContent(rendered.html, true);
      else setHtml(rendered.html);
      if (rendered.subject && mode === 'new') setSubject(subjectWithKey(rendered.subject, issue.key));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const upload = useMutation({
    mutationFn: async (list: File[]) => Promise.all(list.map((f) => api.uploadAttachment(issue.id, f))),
    onSuccess: (added) => {
      setUploaded((u) => [...u, ...added]);
      setAttachmentIds((ids) => [...ids, ...added.map((a) => a.id)]);
      queryClient.invalidateQueries({ queryKey: ['issue'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const people = (list: Recipient[]) => list.filter((r): r is EmailAddress => !isRef(r));
  const picked = (list: Recipient[]) => list.filter(isRef).map(({ type, id }) => ({ type, id }));
  const send = useMutation({
    mutationFn: () => api.sendIssueEmail(issue.id, {
      mode,
      replyToId: original?.id,
      to: people(to),
      cc: showCc ? people(cc) : [],
      bcc: showBcc ? people(bcc) : [],
      toGroups: picked(to),
      ccGroups: showCc ? picked(cc) : [],
      bccGroups: showBcc ? picked(bcc) : [],
      subject,
      html,
      includeQuote: !!original && (mode === 'forward' || includeQuote),
      attachmentIds,
      internal,
    }),
    onSuccess: (email) => {
      writeDraft(key, null);
      queryClient.invalidateQueries({ queryKey: ['comments', issue.id] });
      queryClient.invalidateQueries({ queryKey: ['issue-emails', issue.id] });
      queryClient.invalidateQueries({ queryKey: ['issue'] });
      if (email.status === 'FAILED') toast(`Saved on the request but not sent: ${email.error ?? 'the mail server refused it'}`, 'error');
      else toast(`Email sent to ${describeAddresses(email.to)}`);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const canSend = to.length > 0 && (!!html || (mode === 'forward' && !!original)) && !send.isPending && !upload.isPending;
  const close = async () => {
    // The draft is kept either way, so closing by accident loses nothing.
    if (!dirty || await confirm({ title: 'Close this email?', message: 'Your draft is kept: open the same reply again to carry on.', confirmLabel: 'Close' })) onClose();
  };
  const discard = async () => {
    if (await confirm({ title: 'Discard this email?', message: 'What you have written will be lost.', confirmLabel: 'Discard', danger: true })) {
      writeDraft(key, null);
      onClose();
    }
  };

  const first = to[0] && !isRef(to[0]) ? to[0] : null;
  const recipientName = first ? (first.name || first.email) : null;
  const title = mode === 'reply' && recipientName ? `Reply to ${recipientName}` : TITLES[mode];

  return (
    <Modal
      title={title}
      onClose={() => void close()}
      width="max-w-3xl"
      footer={(
        <>
          {dirty && <button type="button" className="btn btn-subtle mr-auto" onClick={() => void discard()}>Discard</button>}
          <button type="button" className="btn btn-subtle" onClick={() => void close()}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!canSend} onClick={() => send.mutate()}>
            {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
        {restored && <p className="text-xs text-jira-subtle">Your unsent draft was restored.</p>}
        {!data.channelAddress && (
          <div className="flex gap-2 rounded-[3px] bg-[#FFFAE6] px-3 py-2 text-sm text-[#172B4D]">
            <AlertIcon size={16} className="text-[#FF8B00] shrink-0 mt-0.5" />
            <span>This service desk has no enabled email address, so answers to this email won't come back to the request. Set one up in the project's service desk settings.</span>
          </div>
        )}

        <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-2 items-start">
          <span className="field-label pt-2.5 mb-0">Template</span>
          <div className="max-w-sm">
            <SelectPicker
              variant="field"
              value={templateId}
              onChange={(id) => void applyTemplate(id)}
              allowClear
              placeholder={templates.length ? 'Choose a template…' : 'No templates yet'}
              clearLabel="No template"
              disabled={!templates.length}
              options={templates.map((t) => ({ id: t.id, label: t.name, hint: t.projectId ? 'This service desk' : 'Global' }))}
            />
          </div>

          <label className="field-label pt-2.5 mb-0" htmlFor="email-to">To</label>
          <div>
            <AddressInput id="email-to" value={to} onChange={setTo} suggestions={suggestions} refs={refs} autoFocus={mode === 'forward' || to.length === 0} />
            {(!showCc || !showBcc) && (
              <div className="flex gap-2 mt-1 text-xs">
                {!showCc && <button type="button" className="text-jira-blue hover:underline" onClick={() => setShowCc(true)}>Add Cc</button>}
                {!showBcc && <button type="button" className="text-jira-blue hover:underline" onClick={() => setShowBcc(true)}>Add Bcc</button>}
              </div>
            )}
          </div>

          {showCc && (
            <>
              <label className="field-label pt-2.5 mb-0" htmlFor="email-cc">Cc</label>
              <AddressInput id="email-cc" value={cc} onChange={setCc} suggestions={suggestions} refs={refs} />
            </>
          )}
          {showBcc && (
            <>
              <label className="field-label pt-2.5 mb-0" htmlFor="email-bcc">Bcc</label>
              <AddressInput id="email-bcc" value={bcc} onChange={setBcc} suggestions={suggestions} refs={refs} />
            </>
          )}

          <label className="field-label pt-2.5 mb-0" htmlFor="email-subject">Subject</label>
          <input id="email-subject" className="input" value={subject} maxLength={255} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <RichTextEditor
          value={html}
          onChange={setHtml}
          editorRef={editorRef}
          mentions={false}
          minHeight={200}
          autoFocus={to.length > 0 && mode !== 'forward'}
          placeholder={mode === 'forward' ? 'Add a message (optional)…' : 'Write your email…'}
          onSubmit={() => { if (canSend) send.mutate(); }}
        />

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {original && mode !== 'forward' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeQuote} onChange={(e) => setIncludeQuote(e.target.checked)} />
              Include the original message
            </label>
          )}
          <label className="flex items-center gap-2" title="Unticked, it is kept as an internal note that only agents see">
            <input type="checkbox" checked={!internal} onChange={(e) => setInternal(!e.target.checked)} />
            Show on the customer's portal
          </label>
          {mode === 'forward' && original && <span className="text-jira-muted">The original email is included below your message.</span>}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="field-label mb-0">Attachments</span>
            <button type="button" className="btn btn-subtle btn-sm" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              <PaperclipIcon size={14} /> {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) upload.mutate(list); }}
            />
          </div>
          {files.length === 0
            ? <p className="text-xs text-jira-muted">No files on this request. Uploaded files are also added to the request.</p>
            : (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {files.map((a) => (
                  <label key={a.id} className="flex items-center gap-1.5 text-sm max-w-[280px]">
                    <input
                      type="checkbox"
                      checked={attachmentIds.includes(a.id)}
                      onChange={(e) => setAttachmentIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                    />
                    <span className="truncate">{a.filename}</span>
                    <span className="text-xs text-jira-muted shrink-0">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                  </label>
                ))}
              </div>
            )}
        </div>
      </div>
    </Modal>
  );
}
