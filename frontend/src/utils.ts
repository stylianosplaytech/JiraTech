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
