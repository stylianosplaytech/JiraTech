import { useEffect, useState } from 'react';
import { api, type NoticeContent } from '../../api';
import EmailFrame from '../email/EmailFrame';
import { errorMessage } from '../ui';

/** The notice exactly as it will be emailed (the server renders it), refreshed shortly after each change. */
export default function NoticePreview({ content }: { content: NoticeContent }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      api.previewServiceNotice(content)
        .then((r) => { if (current) { setHtml(r.html); setError(null); } })
        .catch((e) => { if (current) setError(errorMessage(e)); });
    }, html === null ? 0 : 350);
    return () => { current = false; window.clearTimeout(timer); };
    // Only the content matters; the first preview is fetched straight away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  return (
    <div className="card overflow-hidden">
      {error && <p className="field-error px-3 pt-2">{error}</p>}
      {html === null ? <div className="h-64 animate-pulse bg-jira-gray" /> : <EmailFrame html={html} showQuoted />}
    </div>
  );
}
