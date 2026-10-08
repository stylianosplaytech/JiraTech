import sanitizeHtml from 'sanitize-html';

/**
 * Descriptions and comments are stored as HTML produced by the rich-text editor.
 * Everything is sanitised on the way in against this allow-list; older plain-text
 * content is left as is and rendered as text by the client.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 's', 'u', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'hr', 'a', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['data-type', 'data-id', 'data-label', 'class'],
    ol: ['start'],
  },
  allowedClasses: { span: ['mention'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
};

export function looksLikeHtml(value: string | null | undefined): boolean {
  return !!value && /^\s*<(p|h[1-3]|ul|ol|blockquote|pre|hr)[\s>]/i.test(value);
}

/** Sanitise editor HTML. Plain text passes through unchanged; empty documents become null. */
export function sanitizeRich(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!looksLikeHtml(value)) return value.trim() ? value : null;
  const clean = sanitizeHtml(value, OPTIONS).trim();
  return toPlainText(clean).trim() || /data-type="mention"/.test(clean) ? clean : null;
}

/** Text version for notifications, emails and excerpts. Mentions become "@Name". */
export function toPlainText(value: string | null | undefined): string {
  if (!value) return '';
  if (!looksLikeHtml(value)) return value;
  const text = sanitizeHtml(
    value
      .replace(/<\/p>\s*<\/li>/gi, '</li>')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-3]|li|blockquote|pre)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• '),
    { allowedTags: [], allowedAttributes: {} },
  );
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface Mentions {
  ids: string[];
  emails: string[];
}

/**
 * People mentioned in a description or comment: editor mentions carry the user id
 * (<span data-type="mention" data-id="…">); older plain text uses "@email".
 */
export function extractMentions(value: string | null | undefined): Mentions {
  if (!value) return { ids: [], emails: [] };
  const ids = [...value.matchAll(/data-type="mention"[^>]*data-id="([^"]+)"|data-id="([^"]+)"[^>]*data-type="mention"/g)]
    .map((m) => m[1] ?? m[2]);
  const emails = [...toPlainText(value).matchAll(/(?:^|[\s(])@([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g)].map((m) => m[1].toLowerCase());
  return { ids: [...new Set(ids)], emails: [...new Set(emails)] };
}

export function mentionKeys(m: Mentions): string[] {
  return [...m.ids.map((id) => `id:${id}`), ...m.emails.map((e) => `email:${e}`)];
}
