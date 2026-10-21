/** Quote a value for use in JQL when it contains spaces or reserved characters. */
export function jqlValue(v: string): string {
  return /^[A-Za-z0-9_.@-]+$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((n) => n[0]!.toUpperCase()).join('');
}

export function humanize(value: string): string {
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Suggest a project key from a name: "Web Platform" → "WP", "Payments" → "PAY". */
export function suggestProjectKey(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const key = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join('').slice(0, 6);
  return /^[A-Z]/.test(key) ? key : `P${key}`.slice(0, 10);
}

/** How a due date (yyyy-mm-dd, or an ISO timestamp at midnight UTC) stands today: "Overdue by 3 days", "Due today", "Due in 5 days". */
export function dueStatus(due: string): { label: string; overdue: boolean; soon: boolean } {
  const day = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 86_400_000;
  const [y, m, d] = due.slice(0, 10).split('-').map(Number);
  const now = new Date();
  const days = day(y, m - 1, d) - day(now.getFullYear(), now.getMonth(), now.getDate());
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  if (days < 0) return { label: `Overdue by ${plural(-days)}`, overdue: true, soon: false };
  if (days === 0) return { label: 'Due today', overdue: false, soon: true };
  if (days === 1) return { label: 'Due tomorrow', overdue: false, soon: true };
  return { label: `Due in ${plural(days)}`, overdue: false, soon: days <= 7 };
}

/** A due date for display, such as "Fri, 23 Oct 2026". */
export function formatDueDate(due: string): string {
  const [y, m, d] = due.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
