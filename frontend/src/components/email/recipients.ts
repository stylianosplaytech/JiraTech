import type { EmailAddress, EmailMode, IssueEmail } from '../../api';

/** A recipient group or organization picked as a whole; it is sent to everyone in it at the time. */
export interface RecipientRef {
  type: 'group' | 'organization';
  id: string;
  name: string;
  /** Who it reaches now (shown on the chip) */
  recipients: EmailAddress[];
}

export type Recipient = EmailAddress | RecipientRef;

export const isRef = (r: Recipient): r is RecipientRef => 'type' in r;

/** "Erin, All customers (12)": people by name, groups and organizations by theirs. */
export function describeAddresses(list: EmailAddress[]) {
  const parts: string[] = [];
  const groups = new Map<string, number>();
  for (const a of list) {
    if (a.via) groups.set(a.via, (groups.get(a.via) ?? 0) + 1);
    else parts.push(a.name || a.email);
  }
  return [...parts, ...[...groups].map(([name, n]) => `${name} (${n})`)].join(', ');
}

/** Each address once (ignoring case), leaving out JiraTech's own and any in `except`. */
export function cleanAddresses(list: EmailAddress[], own: string[], except: EmailAddress[] = []): EmailAddress[] {
  const seen = new Set([...own, ...except.map((a) => a.email)].map((e) => e.toLowerCase()));
  const out: EmailAddress[] = [];
  for (const a of list) {
    const email = a.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: a.name ?? null, ...(a.via ? { via: a.via } : {}) });
  }
  return out;
}

/**
 * Who a reply goes to. Replying to a customer's email answers them (or their Reply-To); replying to one we sent goes
 * to the same people again. Reply all adds everyone else it went to, except the service desk itself.
 */
export function replyRecipients(email: IssueEmail, mode: 'reply' | 'replyAll', own: string[]) {
  const sender: EmailAddress = email.replyTo ? { email: email.replyTo } : { email: email.fromEmail, name: email.fromName };
  const first = email.direction === 'INBOUND' ? [sender] : email.to;
  if (mode === 'reply') return { to: cleanAddresses(first, own), cc: [] as EmailAddress[] };
  const to = cleanAddresses(email.direction === 'INBOUND' ? [...first, ...email.to] : first, own);
  return { to, cc: cleanAddresses(email.cc, own, to) };
}

/** Reply all is only worth offering when it reaches more people than Reply. */
export function canReplyAll(email: IssueEmail, own: string[]) {
  const one = replyRecipients(email, 'reply', own);
  const all = replyRecipients(email, 'replyAll', own);
  return all.to.length + all.cc.length > one.to.length + one.cc.length;
}

function prefix(p: 'Re' | 'Fwd', subject: string) {
  const s = subject.trim();
  return (p === 'Re' ? /^re:/i : /^(fwd?|fw):/i).test(s) ? s : `${p}: ${s}`;
}

/** Same rule as the server: the subject carries the request's key, so answers find their way back. */
export function subjectWithKey(subject: string, key: string) {
  const s = subject.replace(/\s+/g, ' ').trim();
  if (new RegExp(`(?:^|[^A-Za-z0-9])${key}(?![0-9])`, 'i').test(s)) return s;
  const pre = /^((re|fwd?|fw|aw|sv):\s*)+/i.exec(s)?.[0] ?? '';
  return `${pre}[${key}] ${s.slice(pre.length)}`.trim();
}

export function defaultSubject(mode: EmailMode, issue: { key: string; summary: string }, original?: IssueEmail | null) {
  if (original && mode !== 'new') return subjectWithKey(prefix(mode === 'forward' ? 'Fwd' : 'Re', original.subject || issue.summary), issue.key);
  return subjectWithKey(issue.summary, issue.key);
}

export const formatAddress = (a: EmailAddress) => (a.name ? `${a.name} <${a.email}>` : a.email);

export const isEmail = (s: string) => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s.trim());

/** "Anna <anna@x.com>", "anna@x.com" → an address, or null. */
export function parseAddress(raw: string): EmailAddress | null {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  const email = (m ? m[2] : raw).trim().toLowerCase();
  if (!isEmail(email)) return null;
  return { email, name: m?.[1].trim() || null };
}
