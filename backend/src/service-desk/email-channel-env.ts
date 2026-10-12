/**
 * Service desk mailboxes defined by environment variables, so they survive a database reset (e.g. on a host
 * whose free database expires). One set per project key, e.g. for HELP:
 *
 *   EMAIL_HELP_ADDRESS        the address customers write to (required; turns the rest on)
 *   EMAIL_HELP_IMAP_HOST      e.g. imap.gmail.com
 *   EMAIL_HELP_IMAP_PASSWORD  (Gmail: an app password)
 *   EMAIL_HELP_IMAP_USER      default: the address
 *   EMAIL_HELP_IMAP_PORT      default: 993
 *   EMAIL_HELP_IMAP_SECURE    default: true (SSL/TLS); false for STARTTLS
 *   EMAIL_HELP_IMAP_FOLDER    default: INBOX
 *   EMAIL_HELP_PORTAL         default portal's link name, e.g. acme (default: the first portal)
 *   EMAIL_HELP_REQUEST_TYPE   request type name (default: the portal's first)
 *   EMAIL_HELP_ACCEPT_ANYONE  default: true
 *   EMAIL_HELP_ENABLED        default: true once the server and password are set
 */
export interface EnvChannel {
  key: string;
  address: string;
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapFolder: string;
  portal: string | null;
  requestType: string | null;
  createCustomers: boolean;
  enabled: boolean;
}

const ADDRESS = /^EMAIL_([A-Z0-9]+)_ADDRESS$/;

export const envPrefix = (key: string) => `EMAIL_${key.toUpperCase()}_`;

export function envPassword(key: string): string | null {
  return process.env[`${envPrefix(key)}IMAP_PASSWORD`] || null;
}

/** Every project with EMAIL_<KEY>_ADDRESS set: its settings, or what's wrong with them. */
export function envChannels(env: NodeJS.ProcessEnv = process.env): (EnvChannel | { key: string; error: string })[] {
  const out: (EnvChannel | { key: string; error: string })[] = [];
  for (const name of Object.keys(env)) {
    const key = ADDRESS.exec(name)?.[1];
    if (!key) continue;
    const p = envPrefix(key);
    const get = (field: string) => env[p + field]?.trim() || null;
    try {
      const address = get('ADDRESS')!.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error(`${p}ADDRESS is not an email address`);
      const imapHost = get('IMAP_HOST');
      const port = get('IMAP_PORT');
      const imapPort = port === null ? 993 : Number(port);
      if (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65535) throw new Error(`${p}IMAP_PORT must be a port number`);
      const complete = !!(imapHost && env[`${p}IMAP_PASSWORD`]);
      const enabled = flag(get('ENABLED'), `${p}ENABLED`, complete);
      if (enabled && !complete) throw new Error(`${p}IMAP_HOST and ${p}IMAP_PASSWORD are needed to turn it on`);
      out.push({
        key,
        address,
        imapHost,
        imapPort,
        imapSecure: flag(get('IMAP_SECURE'), `${p}IMAP_SECURE`, true),
        imapUser: get('IMAP_USER') ?? address,
        imapFolder: get('IMAP_FOLDER') ?? 'INBOX',
        portal: get('PORTAL')?.toLowerCase() ?? null,
        requestType: get('REQUEST_TYPE'),
        createCustomers: flag(get('ACCEPT_ANYONE'), `${p}ACCEPT_ANYONE`, true),
        enabled,
      });
    } catch (e) {
      out.push({ key, error: (e as Error).message });
    }
  }
  return out;
}

function flag(value: string | null, name: string, fallback: boolean) {
  if (value === null) return fallback;
  if (/^(true|yes|1|on)$/i.test(value)) return true;
  if (/^(false|no|0|off)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false`);
}
