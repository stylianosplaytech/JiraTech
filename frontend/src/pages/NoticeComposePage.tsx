import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EmailAddress, type NoticeAttachment, type NoticeContent, type RecipientRefPayload } from '../api';
import AddressInput from '../components/email/AddressInput';
import { cleanAddresses, isRef, type Recipient, type RecipientRef } from '../components/email/recipients';
import { useRecipientRefs } from '../components/email/useRecipientRefs';
import NoticeEditor from '../components/notices/NoticeEditor';
import NoticePreview from '../components/notices/NoticePreview';
import NoticeAttachments from '../components/notices/NoticeAttachments';
import { blankNotice } from '../components/notices/blank';
import { EmptyState, PageHeader, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';

/**
 * Writing a service notice: from a template (`?template=`), as an update to one already sent (`?from=`, same
 * content and recipients) or from scratch. Every text can be changed; the preview is the email as it will be sent.
 */
export default function NoticeComposePage() {
  const [params] = useSearchParams();
  const templateId = params.get('template');
  const fromId = params.get('from');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();

  const template = useQuery({ queryKey: ['notice-template', templateId], queryFn: () => api.getNoticeTemplate(templateId!), enabled: !!templateId });
  const previous = useQuery({ queryKey: ['service-notice', fromId], queryFn: () => api.getServiceNotice(fromId!), enabled: !!fromId });
  const { data: users = [] } = useQuery({ queryKey: ['users', 'all', ''], queryFn: () => api.getUsers(undefined, 'all') });
  const refs = useRecipientRefs();
  const suggestions = useMemo(() => cleanAddresses(users.map((u) => ({ email: u.email, name: u.name })), []), [users]);

  const [subject, setSubject] = useState('');
  const [content, setContent] = useState<NoticeContent | null>(null);
  const [to, setTo] = useState<Recipient[]>([]);
  const [cc, setCc] = useState<Recipient[]>([]);
  const [bcc, setBcc] = useState<Recipient[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [files, setFiles] = useState<NoticeAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Fill the form once from what it starts from.
  const source = fromId ? previous.data : templateId ? template.data : null;
  const loading = (!!fromId && previous.isLoading) || (!!templateId && template.isLoading);
  useEffect(() => {
    if (content || loading) return;
    if (!source) {
      setContent(blankNotice());
      return;
    }
    setSubject(source.subject);
    setContent(source.content);
    if (previous.data && source === previous.data) {
      // The same people again: those picked one by one now, groups and organizations once they have loaded.
      const own = (list: EmailAddress[]) => list.filter((a) => !a.via).map(({ email, name }) => ({ email, name }));
      setTo(own(previous.data.to));
      setCc(own(previous.data.cc));
      setBcc(own(previous.data.bcc));
      setShowCc(previous.data.cc.length > 0);
      // An update usually still needs the same files; they can be removed.
      setFiles(previous.data.attachments);
    }
  }, [content, loading, source, previous.data]);

  const groupsAdded = useRef(false);
  useEffect(() => {
    const groups = previous.data?.groups;
    if (!groups || groupsAdded.current || !refs.length || !content) return;
    groupsAdded.current = true;
    const resolve = (list: RecipientRefPayload[]) => list
      .map((r) => refs.find((x) => x.type === r.type && x.id === r.id))
      .filter((r): r is RecipientRef => !!r);
    setTo((v) => [...v, ...resolve(groups.to)]);
    setCc((v) => [...v, ...resolve(groups.cc)]);
    setBcc((v) => [...v, ...resolve(groups.bcc)]);
    if (groups.cc.length) setShowCc(true);
  }, [previous.data, refs, content]);

  const people = (list: Recipient[]) => list.filter((r): r is EmailAddress => !isRef(r));
  const picked = (list: Recipient[]) => list.filter(isRef).map(({ type, id }) => ({ type, id }));
  const ccList = showCc ? cc : [];
  const everyone = useMemo(() => {
    const all = [...to, ...ccList, ...bcc].flatMap((r) => (isRef(r) ? r.recipients : [r]));
    return new Set(all.map((a) => a.email.toLowerCase())).size;
  }, [to, ccList, bcc]);

  const send = useMutation({
    mutationFn: () => api.sendServiceNotice({
      templateId: previous.data?.template?.id ?? templateId ?? undefined,
      subject,
      content: content!,
      to: people(to),
      cc: people(ccList),
      bcc: people(bcc),
      toGroups: picked(to),
      ccGroups: picked(ccList),
      bccGroups: picked(bcc),
      attachmentIds: files.map((f) => f.id),
    }),
    onSuccess: (notice) => {
      queryClient.invalidateQueries({ queryKey: ['service-notices'] });
      if (notice.status === 'FAILED') toast(`Saved but not sent: ${notice.error ?? 'the mail server refused it'}`, 'error');
      else toast(`Notice sent to ${notice.recipientCount} ${notice.recipientCount === 1 ? 'recipient' : 'recipients'}`);
      navigate(`/notices/${notice.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const test = useMutation({
    mutationFn: () => api.sendTestServiceNotice({ subject, content: content!, attachmentIds: files.map((f) => f.id) }),
    onSuccess: (r) => toast(`Test sent to ${r.to}`),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (loading || !content) return <Spinner />;
  if ((fromId && previous.error) || (templateId && template.error)) {
    return <EmptyState title={errorMessage(previous.error ?? template.error)} action={<Link to="/notices" className="btn btn-default">Back to notices</Link>} />;
  }

  const canSend = !!subject.trim() && everyone > 0 && !send.isPending && !uploading;
  const submit = async () => {
    const ok = await confirm({
      title: `Send this notice to ${everyone} ${everyone === 1 ? 'person' : 'people'}?`,
      message: `“${subject.trim()}” goes out by email straight away${files.length ? `, with ${files.length} ${files.length === 1 ? 'attachment' : 'attachments'}` : ''}.`,
      confirmLabel: 'Send',
    });
    if (ok) send.mutate();
  };

  const heading = previous.data ? `Update: ${previous.data.subject}` : template.data ? template.data.name : 'New notice';

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        breadcrumbs={<Link to="/notices" className="link">Service notices</Link>}
        title={heading}
        actions={(
          <>
            <button type="button" className="btn btn-default" disabled={!subject.trim() || test.isPending || uploading} onClick={() => test.mutate()} title="Send it only to yourself, to see it in your mail client">
              {test.isPending ? 'Sending…' : 'Send test to me'}
            </button>
            <button type="button" className="btn btn-primary" disabled={!canSend} onClick={() => void submit()}>
              {send.isPending ? 'Sending…' : everyone ? `Send to ${everyone}` : 'Send'}
            </button>
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <div className="space-y-4 min-w-0">
          <div className="card p-4">
            <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-2 items-start">
              <label className="field-label pt-2.5 mb-0" htmlFor="notice-to">To</label>
              <div>
                <AddressInput id="notice-to" value={to} onChange={setTo} suggestions={suggestions} refs={refs} placeholder="Name, email, organization or group" />
                {!showCc && <button type="button" className="text-jira-blue hover:underline text-xs mt-1" onClick={() => setShowCc(true)}>Add Cc</button>}
              </div>
              {showCc && (
                <>
                  <label className="field-label pt-2.5 mb-0" htmlFor="notice-cc">Cc</label>
                  <AddressInput id="notice-cc" value={cc} onChange={setCc} suggestions={suggestions} refs={refs} />
                </>
              )}
              <label className="field-label pt-2.5 mb-0" htmlFor="notice-bcc">Bcc</label>
              <div>
                <AddressInput id="notice-bcc" value={bcc} onChange={setBcc} suggestions={suggestions} refs={refs} placeholder="Recipients who shouldn't see each other" />
                <p className="field-help">Put companies and groups in Bcc so recipients don't see each other's addresses.</p>
              </div>
              <label className="field-label pt-2.5 mb-0" htmlFor="notice-subject">Subject</label>
              <input id="notice-subject" className="input" maxLength={255} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          </div>
          <NoticeAttachments value={files} onChange={setFiles} onBusyChange={setUploading} />
          <NoticeEditor value={content} onChange={setContent} />
        </div>

        <div className="lg:sticky lg:top-20 min-w-0">
          <div className="section-title mb-2">Preview</div>
          <NoticePreview content={content} />
        </div>
      </div>
    </div>
  );
}
