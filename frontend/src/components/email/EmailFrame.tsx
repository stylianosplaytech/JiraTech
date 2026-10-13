import { useEffect, useRef, useState } from 'react';

/** Where mail clients put the earlier message below a reply (Gmail, Apple Mail, Outlook and our own). */
const QUOTE_SELECTORS = '.jt-quote, .gmail_quote, blockquote[type="cite"], #divRplyFwdMsg, #divRplyFwdMsg ~ *, #appendonsend ~ *, .moz-cite-prefix';
const HAS_QUOTE = /class="[^"]*\b(jt-quote|gmail_quote|moz-cite-prefix)\b|<blockquote[^>]*type="cite"|id="(divRplyFwdMsg|appendonsend)"/i;

export const hasQuotedText = (html: string) => HAS_QUOTE.test(html);

/**
 * An email's HTML (already sanitized by the server) in a sandboxed frame: its styles can't leak into the page, no
 * script can run, and links open in a new tab. The frame grows to fit the email.
 */
export default function EmailFrame({ html, showQuoted }: { html: string; showQuoted: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);

  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    html,body{margin:0;padding:0;background:transparent}
    body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#172B4D;overflow-wrap:anywhere}
    img{max-width:100%;height:auto}
    table{max-width:100%}
    a{color:#0052CC}
    p{margin:0 0 .6em}
    blockquote{margin:0 0 0 .8ex;border-left:2px solid #DFE1E6;padding-left:1ex;color:#5E6C84}
    ${showQuoted ? '' : `${QUOTE_SELECTORS}{display:none!important}`}
  </style></head><body>${html}</body></html>`;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    let observer: ResizeObserver | null = null;
    const fit = () => {
      const body = frame.contentDocument?.body;
      if (body) setHeight(Math.max(20, Math.ceil(body.scrollHeight)));
    };
    const onLoad = () => {
      fit();
      const body = frame.contentDocument?.body;
      if (body && 'ResizeObserver' in window) {
        observer = new ResizeObserver(fit);
        observer.observe(body);
      }
    };
    frame.addEventListener('load', onLoad);
    return () => { frame.removeEventListener('load', onLoad); observer?.disconnect(); };
  }, [doc]);

  return (
    <iframe
      ref={ref}
      title="Email"
      srcDoc={doc}
      // Same origin only so the page can measure it; without allow-scripts nothing in it can run.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="w-full border-0 block"
      style={{ height }}
    />
  );
}
