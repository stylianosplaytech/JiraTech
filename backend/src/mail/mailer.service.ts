import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MailSettings, MailTransport } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { open, seal } from '../common/secret-box';
import { MailSettingsDto } from './mail-settings.dto';
import * as gmail from './gmail';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where replies go, e.g. the service desk's own address so they come back as comments */
  replyTo?: string;
  /** Emails written on a request: everyone else it goes to (`to` may then list several addresses, comma-separated) */
  cc?: string[];
  bcc?: string[];
  /** Threading headers, with angle brackets */
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  /** `path` is a file or a data: URI; `cid` shows it inside the HTML (<img src="cid:…">) */
  attachments?: { filename: string; path: string; contentType?: string; cid?: string }[];
  /** Shown instead of the usual sender name (the address stays the one email is sent from) */
  fromName?: string;
}

interface Smtp {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
}

interface Gmail extends gmail.GmailClient {
  refreshToken: string;
  account: string;
}

/**
 * Where outgoing email is configured: Email settings (an SMTP server, or a Gmail account through Google's API),
 * the GMAIL_* or SMTP_* environment variables, or none of them (files in mail-outbox).
 */
export type MailSource = 'gmail' | 'settings' | 'gmail-environment' | 'environment' | 'outbox';

const DEFAULT_FROM_NAME = 'Conductor';
const DEFAULT_FROM_ADDRESS = 'no-reply@conductor.local';
/** How long an admin has to finish the Google sign-in. */
const CONNECT_MINUTES = 10;

/**
 * Sends every email the application sends, for all projects. An admin sets it up under Email settings: an SMTP
 * server, or a Gmail account sent through Google's API over HTTPS (for hosts that block SMTP ports, like Render's
 * free instances). Without either, the GMAIL_* or SMTP_* environment variables are used, and without those (local
 * development) each message is written as an .eml file to backend/mail-outbox so it can be opened in any mail client.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private readonly outboxDir = path.resolve(__dirname, '../../mail-outbox');
  private readonly preview: Transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  private settings: MailSettings | null = null;
  private transport: Transporter | null = null;
  private gmailToken: { token: string; expiresAt: number } | null = null;
  /** Google sign-ins in progress: state → where Google sends the admin back. */
  private readonly connecting = new Map<string, { redirect: string; expires: number }>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
    const source = this.source();
    this.logger.log({
      gmail: `Email via the Gmail account ${this.gmail()?.account} (Email settings)`,
      'gmail-environment': `Email via the Gmail account ${this.gmail()?.account} (GMAIL_*)`,
      settings: `Email via SMTP ${this.smtp()?.host} (Email settings)`,
      environment: `Email via SMTP ${this.smtp()?.host} (SMTP_HOST)`,
      outbox: `No mail server set: emails are written to ${this.outboxDir}`,
    }[source]);
  }

  // ─── Settings (global admins) ──────────────────────────────────────────────

  /** As the browser sees them: never a password, secret or token. */
  async getSettings() {
    const s = this.settings;
    return {
      transport: s?.transport ?? MailTransport.SMTP,
      smtpHost: s?.smtpHost ?? null,
      smtpPort: s?.smtpPort ?? 587,
      smtpSecure: s?.smtpSecure ?? false,
      smtpUser: s?.smtpUser ?? null,
      hasPassword: !!s?.smtpPassword,
      gmailClientId: s?.gmailClientId ?? null,
      hasGmailSecret: !!s?.gmailClientSecret,
      /** The connected Gmail account, if any */
      gmailAccount: s?.gmailRefreshToken ? s.gmailAccount : null,
      fromName: s?.fromName ?? null,
      fromAddress: s?.fromAddress ?? null,
      appUrl: s?.appUrl ?? null,
      /** What is in use right now, and the values it falls back to */
      source: this.source(),
      from: this.from(),
      effectiveAppUrl: this.appUrl(),
      environment: {
        smtpHost: process.env.SMTP_HOST || null,
        gmailUser: envGmail()?.account ?? null,
        mailFrom: process.env.MAIL_FROM || null,
        appUrl: process.env.APP_URL || null,
      },
    };
  }

  async saveSettings(dto: MailSettingsDto) {
    const clear = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
    const clientId = clear(dto.gmailClientId);
    // A connection belongs to the OAuth client it was made with.
    const newClient = clientId !== undefined && clientId !== (this.settings?.gmailClientId ?? null);
    if (newClient) await this.forgetGmail();
    const data = {
      transport: dto.transport,
      smtpHost: clear(dto.smtpHost),
      smtpPort: dto.smtpPort,
      smtpSecure: dto.smtpSecure,
      smtpUser: clear(dto.smtpUser),
      smtpPassword: dto.smtpPassword === undefined ? undefined : dto.smtpPassword ? seal(dto.smtpPassword) : null,
      gmailClientId: clientId,
      gmailClientSecret: dto.gmailClientSecret === undefined ? undefined : dto.gmailClientSecret.trim() ? seal(dto.gmailClientSecret.trim()) : null,
      fromName: clear(dto.fromName),
      fromAddress: clear(dto.fromAddress?.toLowerCase()),
      appUrl: dto.appUrl === undefined ? undefined : dto.appUrl.trim().replace(/\/+$/, '') || null,
    };
    await this.prisma.mailSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    await this.reload();
    return this.getSettings();
  }

  /** Sends a test email with the current settings, reporting the server's error rather than swallowing it. */
  async sendTest(to: string) {
    const message = {
      to,
      subject: '[Conductor] Test email',
      text: `This is a test email from Conductor.\n\nIf you can read this, outgoing email works. Links in emails point to ${this.appUrl()}.`,
      html: `<p>This is a test email from Conductor.</p><p>If you can read this, outgoing email works. Links in emails point to <a href="${this.appUrl()}">${this.appUrl()}</a>.</p>`,
    };
    try {
      await this.deliver(message);
    } catch (e) {
      throw new BadRequestException(friendlyError(e, this.smtp()));
    }
    return { sent: true, source: this.source(), file: this.source() === 'outbox' ? this.outboxDir : null };
  }

  // ─── Connecting a Gmail account (global admins) ────────────────────────────

  /**
   * Starts "Connect Gmail account": the Google page to send the admin to. `origin` is the address the admin uses
   * Conductor at; Google sends them back there, so it must match a redirect URI registered in Google Cloud.
   */
  googleStart(origin: string) {
    const client = this.gmailClient();
    if (!client) throw new BadRequestException('Save the Client ID and Client secret from Google Cloud first');
    const now = Date.now();
    for (const [state, c] of this.connecting) if (c.expires < now) this.connecting.delete(state);
    const state = randomBytes(24).toString('base64url');
    const redirect = gmail.redirectUri(origin);
    this.connecting.set(state, { redirect, expires: now + CONNECT_MINUTES * 60 * 1000 });
    return { url: gmail.authUrl(client, redirect, state), redirectUri: redirect };
  }

  /** Google sends the admin back here; returns where to send their browser next (Email settings, with the outcome). */
  async googleCallback(query: { code?: string; state?: string; error?: string }) {
    const pending = query.state ? this.connecting.get(query.state) : undefined;
    if (query.state) this.connecting.delete(query.state);
    const origin = pending?.redirect.replace(/\/api\/mail-settings\/google\/callback$/, '') ?? this.appUrl();
    const back = (params: Record<string, string>) => `${origin}/settings/email?${new URLSearchParams(params)}`;
    if (!pending || pending.expires < Date.now()) {
      return back({ gmail: 'error', message: 'The Google sign-in took too long or was started elsewhere. Click "Connect Gmail account" again.' });
    }
    if (query.error || !query.code) {
      return back({ gmail: 'error', message: query.error === 'access_denied' ? 'The Google sign-in was cancelled.' : `Google: ${query.error ?? 'no authorization code'}` });
    }
    const client = this.gmailClient();
    if (!client) return back({ gmail: 'error', message: 'The Client ID or secret was removed while signing in.' });
    try {
      const { refreshToken, email } = await gmail.exchangeCode(client, query.code, pending.redirect);
      const previous = this.settings?.gmailRefreshToken ? open(this.settings.gmailRefreshToken) : null;
      await this.prisma.mailSettings.update({
        where: { id: 'default' },
        data: { gmailRefreshToken: seal(refreshToken), gmailAccount: email, transport: MailTransport.GMAIL },
      });
      if (previous && previous !== refreshToken) await gmail.revoke(previous);
      await this.reload();
      this.logger.log(`Gmail account ${email} connected: email is now sent through it`);
      return back({ gmail: 'connected' });
    } catch (e) {
      return back({ gmail: 'error', message: (e as Error).message });
    }
  }

  /** Stops sending through the Gmail account and asks Google to revoke Conductor's access to it. */
  async googleDisconnect() {
    await this.forgetGmail();
    await this.prisma.mailSettings.updateMany({ data: { transport: MailTransport.SMTP } });
    await this.reload();
    return this.getSettings();
  }

  private async forgetGmail() {
    const token = this.settings?.gmailRefreshToken ? open(this.settings.gmailRefreshToken) : null;
    if (token) await gmail.revoke(token);
    await this.prisma.mailSettings.updateMany({ data: { gmailRefreshToken: null, gmailAccount: null } });
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  /** Never throws: a mail failure must not break the action that triggered it. */
  async send(message: MailMessage): Promise<boolean> {
    return (await this.sendReporting(message)) === null;
  }

  /** Like send, but says why it failed (null when it was sent), for emails an agent writes and may retry. */
  async sendReporting(message: MailMessage): Promise<string | null> {
    try {
      await this.deliver(message);
      return null;
    } catch (e) {
      const error = friendlyError(e, this.smtp());
      this.logger.warn(`Could not send email to ${message.to}: ${error}`);
      return error;
    }
  }

  /** The address people open Conductor at, without a trailing slash: for links in emails. */
  appUrl() {
    return (this.settings?.appUrl || process.env.APP_URL || 'http://localhost:5172').replace(/\/+$/, '');
  }

  /** The bare address emails are sent from (so incoming mail from it can be recognised as our own). */
  fromAddress() {
    const g = this.gmail();
    if (g) return g.account;
    if (this.settings?.fromAddress) return this.settings.fromAddress;
    const env = process.env.MAIL_FROM;
    return (env ? (/<([^>]+)>/.exec(env)?.[1] ?? env) : DEFAULT_FROM_ADDRESS).trim().toLowerCase();
  }

  private from() {
    const name = (this.settings?.fromName || /^\s*"?([^"<]+?)"?\s*</.exec(process.env.MAIL_FROM ?? '')?.[1] || DEFAULT_FROM_NAME).replace(/"/g, '');
    // Gmail sends from the connected account whatever the message says, so say so.
    const g = this.gmail();
    if (g) return `"${name}" <${g.account}>`;
    if (this.settings?.fromAddress) return `"${name}" <${this.settings.fromAddress}>`;
    return process.env.MAIL_FROM ?? `${DEFAULT_FROM_NAME} <${DEFAULT_FROM_ADDRESS}>`;
  }

  private async deliver(message: MailMessage) {
    const { fromName, ...rest } = message;
    const mail = { from: fromName ? `"${fromName.replace(/["\\\r\n]/g, '')}" <${this.fromAddress()}>` : this.from(), ...rest };
    const g = this.gmail();
    if (g) {
      const { message: raw } = await this.preview.sendMail(mail);
      await gmail.send(await this.gmailAccessToken(g), raw as Buffer);
      return;
    }
    if (this.transport) {
      await this.transport.sendMail(mail);
      return;
    }
    const info = await this.preview.sendMail(mail);
    fs.mkdirSync(this.outboxDir, { recursive: true });
    const safeTo = message.to.split(',')[0].trim().replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(this.outboxDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeTo}.eml`);
    fs.writeFileSync(file, info.message as Buffer);
  }

  /** A cached access token, renewed a minute before it runs out. */
  private async gmailAccessToken(g: Gmail) {
    if (!this.gmailToken || this.gmailToken.expiresAt < Date.now() + 60_000) {
      this.gmailToken = await gmail.accessToken(g, g.refreshToken);
    }
    return this.gmailToken.token;
  }

  private source(): MailSource {
    const s = this.settings;
    if (s?.transport === MailTransport.GMAIL && this.settingsGmail()) return 'gmail';
    if (s?.transport !== MailTransport.GMAIL && s?.smtpHost) return 'settings';
    if (envGmail()) return 'gmail-environment';
    return process.env.SMTP_HOST ? 'environment' : 'outbox';
  }

  /** The Gmail account email goes through, if that's what is in use. */
  private gmail(): Gmail | null {
    const source = this.source();
    if (source === 'gmail') return this.settingsGmail();
    if (source === 'gmail-environment') return envGmail();
    return null;
  }

  private gmailClient(): gmail.GmailClient | null {
    const s = this.settings;
    if (!s?.gmailClientId || !s.gmailClientSecret) return null;
    const clientSecret = open(s.gmailClientSecret);
    if (clientSecret === null) throw new BadRequestException('The saved Client secret can no longer be read (MAIL_SECRET or JWT_SECRET changed): enter it again');
    return { clientId: s.gmailClientId, clientSecret };
  }

  private settingsGmail(): Gmail | null {
    const s = this.settings;
    if (!s?.gmailClientId || !s.gmailClientSecret || !s.gmailRefreshToken || !s.gmailAccount) return null;
    const clientSecret = open(s.gmailClientSecret);
    const refreshToken = open(s.gmailRefreshToken);
    if (clientSecret === null || refreshToken === null) return null;
    return { clientId: s.gmailClientId, clientSecret, refreshToken, account: s.gmailAccount };
  }

  /** The SMTP server in use, if that's what is in use: the app's settings first, then the environment. */
  private smtp(): Smtp | null {
    const source = this.source();
    const s = this.settings;
    if (source === 'settings' && s?.smtpHost) {
      return { host: s.smtpHost, port: s.smtpPort, secure: s.smtpSecure, user: s.smtpUser, pass: s.smtpPassword ? open(s.smtpPassword) : null };
    }
    if (source === 'environment' && process.env.SMTP_HOST) {
      return {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || null,
        pass: process.env.SMTP_PASS ?? null,
      };
    }
    return null;
  }

  private async reload() {
    this.settings = await this.prisma.mailSettings.findUnique({ where: { id: 'default' } });
    this.gmailToken = null;
    this.transport?.close();
    const smtp = this.smtp();
    this.transport = smtp
      ? nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
        connectionTimeout: 20_000,
        greetingTimeout: 15_000,
      })
      : null;
  }
}

/**
 * A Gmail account set by environment variables (survives a database reset): GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 * GMAIL_REFRESH_TOKEN and GMAIL_USER (the account's address).
 */
function envGmail(): Gmail | null {
  const { GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret, GMAIL_REFRESH_TOKEN: refreshToken, GMAIL_USER: account } = process.env;
  if (!clientId || !clientSecret || !refreshToken || !account) return null;
  return { clientId, clientSecret, refreshToken, account: account.trim().toLowerCase() };
}

/** SMTP and Gmail errors in words an admin can act on. */
function friendlyError(e: unknown, smtp: Smtp | null): string {
  if (e instanceof gmail.GmailError) return e.message;
  const err = e as Error & { code?: string; responseCode?: number; response?: string };
  const where = smtp ? `${smtp.host}:${smtp.port}` : 'the mail server';
  if (smtp?.user && smtp.pass === null) return 'The saved SMTP password can no longer be read (MAIL_SECRET or JWT_SECRET changed): enter it again';
  switch (err.code) {
    case 'EAUTH': return 'The mail server rejected the user name or password';
    case 'ENOTFOUND': case 'EDNS': case 'EAI_AGAIN': return `Mail server ${smtp?.host} not found`;
    case 'ECONNREFUSED': return `${where} refused the connection`;
    case 'ETIMEDOUT': case 'ECONNECTION': case 'ESOCKET':
      return `Could not talk to ${where} (check the port and the TLS setting)${err.message ? `: ${err.message}` : ''}`;
    default: break;
  }
  if (err.responseCode && err.response) return `The mail server refused the email: ${err.response}`;
  return err.message || 'Could not send the email';
}
