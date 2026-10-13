import sanitizeHtml from 'sanitize-html';

export interface Address {
  email: string;
  name?: string | null;
}

/** HTML received by email can be as large as a newsletter; past this only the text version is kept. */
const MAX_HTML = 2 * 1024 * 1024;

/**
 * Received emails keep their layout (tables, inline styles, embedded images), unlike comments. Scripts, forms and
 * anything active are dropped; the browser also shows the result in a sandboxed frame that can't run scripts.
 */
const EMAIL_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'abbr', 'address', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col',
    'colgroup', 'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
    'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'tt', 'u', 'ul', 'wbr',
  ],
  allowedAttributes: {
    '*': ['style', 'class', 'id', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'dir', 'title', 'lang', 'border',
      'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'type', 'face', 'size'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt'],
    ol: ['start'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // mailparser turns embedded (cid:) images into data: URIs.
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
};

export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html || html.length > MAX_HTML) return '';
  return sanitizeHtml(html, EMAIL_OPTIONS).trim();
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A plain-text email as HTML, keeping its line breaks and making links clickable. */
export function textToHtml(text: string) {
  const escaped = escapeHtml(text.replace(/\r\n/g, '\n').trim());
  const linked = escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`);
  return `<div style="white-space:pre-wrap">${linked}</div>`;
}

export function formatAddress(a: Address) {
  return a.name ? `"${a.name.replace(/["\\\r\n]/g, '')}" <${a.email}>` : a.email;
}

export function parseAddresses(json: string | null | undefined): Address[] {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.filter((a) => a && typeof a.email === 'string') : [];
  } catch {
    return [];
  }
}

/** Without the angle brackets, as stored. */
export function bareMessageId(id: string | null | undefined) {
  return (id ?? '').trim().replace(/^<|>$/g, '');
}

/** "Re: …" / "Fwd: …" on the subject, once. */
export function prefixSubject(prefix: 'Re' | 'Fwd', subject: string) {
  const s = subject.trim();
  const already = prefix === 'Re' ? /^re:/i : /^(fwd?|fw):/i;
  return already.test(s) ? s : `${prefix}: ${s}`;
}

/** The subject carries the request's key, so a reply finds its way back even when a mail client drops the headers. */
export function subjectWithKey(subject: string, key: string) {
  const s = subject.replace(/\s+/g, ' ').trim();
  if (new RegExp(`(?:^|[^A-Za-z0-9])${key}(?![0-9])`, 'i').test(s)) return s;
  const prefix = /^((re|fwd?|fw|aw|sv):\s*)+/i.exec(s)?.[0] ?? '';
  return `${prefix}[${key}] ${s.slice(prefix.length)}`.trim();
}

/** The earlier email below a reply or forward, the way mail clients quote it. */
export function quoteBlock(
  mode: 'reply' | 'forward',
  original: { fromEmail: string; fromName: string | null; createdAt: Date; subject: string; html: string; to: Address[]; cc: Address[] },
) {
  const from = escapeHtml(formatAddress({ email: original.fromEmail, name: original.fromName }));
  const when = original.createdAt.toUTCString();
  if (mode === 'forward') {
    const list = (l: Address[]) => escapeHtml(l.map(formatAddress).join(', '));
    return `<div class="jt-quote"><br>---------- Forwarded message ---------<br>From: ${from}<br>Date: ${when}<br>`
      + `Subject: ${escapeHtml(original.subject)}<br>To: ${list(original.to)}<br>${original.cc.length ? `Cc: ${list(original.cc)}<br>` : ''}<br>`
      + `${original.html}</div>`;
  }
  return `<div class="jt-quote"><br>On ${when}, ${from} wrote:<br>`
    + `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${original.html}</blockquote></div>`;
}
