/**
 * Sending through a Gmail account with Google's API, over HTTPS (port 443). For hosts that block SMTP ports, such as
 * Render's free instances. The account is connected once with OAuth ("Connect Gmail account"); Conductor keeps the
 * refresh token and swaps it for short-lived access tokens. Uses Node's built-in fetch: no extra packages.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
/** Send email as the account, and learn its address. Nothing else: Conductor can't read the mailbox through this. */
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'];

export interface GmailClient {
  clientId: string;
  clientSecret: string;
}

/** A Google error, in words an admin can act on. */
export class GmailError extends Error {}

/** Where Google sends the admin back after they approve, on the address they use Conductor at. */
export const redirectUri = (origin: string) => `${origin.replace(/\/+$/, '')}/api/mail-settings/google/callback`;

/** The Google page where the admin chooses the account and allows sending. `prompt=consent` makes Google return a refresh token. */
export function authUrl(client: GmailClient, redirect: string, state: string) {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/** Swaps the code Google sent back for a refresh token and the account's address. */
export async function exchangeCode(client: GmailClient, code: string, redirect: string) {
  const body = await tokenRequest({
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });
  if (!body.refresh_token) throw new GmailError('Google did not grant lasting access. Try connecting again.');
  if (!String(body.scope ?? '').includes('gmail.send')) {
    throw new GmailError('Sending email was not allowed. Connect again and tick "Send email on your behalf".');
  }
  const email = idTokenEmail(body.id_token);
  if (!email) throw new GmailError('Google did not say which account was connected. Try connecting again.');
  return { refreshToken: body.refresh_token as string, email };
}

/** A short-lived access token (about an hour). */
export async function accessToken(client: GmailClient, refreshToken: string) {
  const body = await tokenRequest({
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: 'refresh_token',
  });
  return { token: body.access_token as string, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
}

/** Sends a complete email (MIME, as built by nodemailer). Gmail sets the sender to the connected account. */
export async function send(token: string, raw: Buffer) {
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: raw.toString('base64url') }),
  });
  if (res.ok) return;
  const body = await res.json().catch(() => ({})) as { error?: { message?: string; status?: string } };
  const message = body.error?.message ?? res.statusText;
  if (res.status === 401) throw new GmailError(`Google refused the access token: ${message}`);
  if (res.status === 403 && /has not been used|is disabled/i.test(message)) {
    throw new GmailError('The Gmail API is not enabled in your Google Cloud project: enable it under APIs & Services → Library → Gmail API');
  }
  if (res.status === 403) throw new GmailError(`Google did not allow sending: ${message}`);
  if (res.status === 429) throw new GmailError(`Gmail's sending limit was reached: ${message}`);
  throw new GmailError(`Gmail could not send the email: ${message}`);
}

/** Tells Google to forget the authorization (best effort: it may already be revoked). */
export async function revoke(refreshToken: string) {
  await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: refreshToken })}`, { method: 'POST' }).catch(() => undefined);
}

async function tokenRequest(form: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
  } catch (e) {
    throw new GmailError(`Could not reach Google: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (res.ok) return body;
  switch (body.error) {
    case 'invalid_client':
      throw new GmailError('Google does not recognise the Client ID and secret: copy them again from Google Cloud → Credentials');
    case 'invalid_grant':
      throw new GmailError(form.grant_type === 'refresh_token'
        ? 'Google no longer accepts the saved authorization (it was revoked, the password changed, or the app is still in "Testing", where it lapses after 7 days). Connect the Gmail account again.'
        : 'The sign-in expired or was already used. Click "Connect Gmail account" again.');
    case 'redirect_uri_mismatch':
      throw new GmailError('The redirect URI is not registered in the Google Cloud OAuth client; add the one shown in Email settings');
    default:
      throw new GmailError(`Google refused the request: ${String(body.error_description ?? body.error ?? res.statusText)}`);
  }
}

/** The email in the ID token Google returned straight to us over HTTPS (so it needn't be signature-checked here). */
function idTokenEmail(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as { email?: string };
    return payload.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}
