import { BadRequestException } from '@nestjs/common';
import { lookup as dnsLookup, LookupOptions } from 'dns';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { LookupFunction, isIP } from 'net';

/** Webhooks may call servers on the company network (e.g. an internal Slack bridge) only when this is switched on. */
const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === 'true';

/** Addresses a webhook must not reach: loopback, private networks, link-local (cloud metadata), multicast. */
export function isPrivateAddress(ip: string): boolean {
  const v6 = ip.toLowerCase();
  if (isIP(v6) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Checks an address typed in by an admin: http(s) only, no embedded credentials, and (usually) not an internal host. */
export function parseWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestException('Enter a full web address, e.g. https://example.com/hooks/jiratech');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequestException('The address must start with https:// (or http://)');
  if (url.username || url.password) throw new BadRequestException('Do not put a username or password in the address: requests are signed with the webhook secret');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate()) {
    if (host === 'localhost' || host.endsWith('.localhost')) throw new BadRequestException('Webhooks cannot call localhost');
    if (isIP(host) && isPrivateAddress(host)) throw new BadRequestException('Webhooks cannot call internal network addresses');
  }
  return url;
}

export interface PostResult {
  status: number;
  durationMs: number;
  /** The start of the answer (e.g. Slack says "invalid_payload" or "no_service"), to explain a refusal */
  body: string;
}

/**
 * POSTs a body and keeps only the start of the answer. Redirects are not followed, and the address is checked when the connection is
 * made (not only when the webhook was saved), so a name that later points at an internal server is refused too.
 */
export function postJson(url: URL, body: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
        lookup: ((hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
          dnsLookup(hostname, options, (err, address, family) => {
            if (err) return callback(err);
            // With `all` set (Node tries several addresses) this is a list, otherwise a single address.
            const found: { address: string }[] = Array.isArray(address) ? address : [{ address: address as string }];
            if (!allowPrivate() && found.some((a) => isPrivateAddress(a.address))) {
              return callback(new Error('Refused: the address points to an internal network'));
            }
            callback(null, address, family);
          });
        }) as unknown as LookupFunction,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { if (body.length < 300) body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, durationMs: Date.now() - started, body: body.slice(0, 300).trim() }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`No answer within ${timeoutMs / 1000} seconds`)));
    req.on('error', reject);
    req.end(body);
  });
}
