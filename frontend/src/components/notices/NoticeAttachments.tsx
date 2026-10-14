import { useRef, useState } from 'react';
import { api, type NoticeAttachment } from '../../api';
import { PaperclipIcon, XIcon } from '../Icons';
import { errorMessage, useToast } from '../ui';

/** Each file, and all of them together: what the server accepts. */
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Opens a notice's file in a new tab (the download needs the login token, so it goes through a blob). */
export async function openNoticeFile(file: NoticeAttachment, onError: (message: string) => void) {
  const token = localStorage.getItem('token');
  const res = await fetch(api.getNoticeFileUrl(file.id), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { onError('Could not open the file (it may have been deleted)'); return; }
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}

/** The files a notice is sent with: upload (or drop) several, open or remove them before sending. */
export default function NoticeAttachments({ value, onChange, onBusyChange }: {
  value: NoticeAttachment[];
  onChange: (v: NoticeAttachment[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const total = value.reduce((n, f) => n + f.size, 0);

  const upload = async (list: File[]) => {
    const tooBig = list.filter((f) => f.size > MAX_FILE);
    if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(', ')}: over 20 MB, too large to email`, 'error');
    let room = MAX_TOTAL - total;
    const fit = list.filter((f) => f.size <= MAX_FILE).filter((f) => {
      if (f.size > room) { toast(`${f.name}: the attachments would add up to more than 25 MB`, 'error'); return false; }
      room -= f.size;
      return true;
    });
    if (!fit.length) return;
    setUploading((n) => n + fit.length);
    onBusyChange?.(true);
    const added: NoticeAttachment[] = [];
    for (const f of fit) {
      try {
        added.push(await api.uploadNoticeFile(f));
      } catch (e) {
        toast(`${f.name}: ${errorMessage(e)}`, 'error');
      }
    }
    setUploading((n) => n - fit.length);
    onBusyChange?.(false);
    if (added.length) onChange([...value, ...added]);
  };

  const remove = (file: NoticeAttachment) => {
    onChange(value.filter((f) => f.id !== file.id));
    // Deleted unless an earlier notice was sent with it (then it stays there).
    api.deleteNoticeFile(file.id).catch(() => undefined);
  };

  return (
    <div
      className={`card p-4 ${dragging ? 'border-jira-blue bg-jira-blue-light/40' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const list = [...e.dataTransfer.files];
        if (list.length) void upload(list);
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="card-title flex-1">Attachments</span>
        {value.length > 0 && <span className="text-xs text-jira-muted">{formatSize(total)} of 25 MB</span>}
        <button type="button" className="btn btn-default btn-sm" disabled={uploading > 0} onClick={() => fileRef.current?.click()}>
          <PaperclipIcon size={14} /> {uploading ? 'Uploading…' : 'Add files'}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) void upload(list); }}
        />
      </div>
      {value.length === 0 && !uploading ? (
        <p className="text-xs text-jira-muted">Drop files here or use Add files. They go with the email; up to 20 MB each, 25 MB in all.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {value.map((f) => (
            <li key={f.id} className="inline-flex items-center gap-1.5 rounded-[3px] bg-jira-gray-hover px-2 py-1 text-xs max-w-full">
              <PaperclipIcon size={12} className="shrink-0 text-jira-subtle" />
              <button type="button" className="truncate hover:underline" title={`Open ${f.filename}`} onClick={() => void openNoticeFile(f, (m) => toast(m, 'error'))}>
                {f.filename}
              </button>
              <span className="text-jira-muted shrink-0">{formatSize(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.filename}`} className="opacity-70 hover:opacity-100" onClick={() => remove(f)}>
                <XIcon size={12} />
              </button>
            </li>
          ))}
          {uploading > 0 && <li className="text-xs text-jira-muted px-2 py-1">Uploading {uploading} {uploading === 1 ? 'file' : 'files'}…</li>}
        </ul>
      )}
    </div>
  );
}
