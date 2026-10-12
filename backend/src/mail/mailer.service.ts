import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MailSettings } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { open, seal } from '../common/secret-box';
import { MailSettingsDto } from './mail-settings.dto';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where replies go, e.g. the service desk's own address so they come back as comments */
  replyTo?: string;
}

interface Smtp {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
}

/** Where outgoing email is configured: Email settings in the app, the SMTP_* environment variables, or neither (files). */
export type MailSource = 'settings' | 'environment' | 'outbox';

const DEFAULT_FROM_NAME = 'JiraTech';
const DEFAULT_FROM_ADDRESS = 'no-reply@jiratech.local';

/**
 * Sends every email the application sends, for all projects. The SMTP server is set by an admin under Email settings;
 * without one, the SMTP_* environment variables are used, and without those (local development) each message is
 * written as an .eml file to backend/mail-outbox so it can be opened in any mail client.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private readonly outboxDir = path.resolve(__dirname, '../../mail-outbox');
  private readonly preview: Transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  private settings: MailSettings | null = null;
  private transport: Transporter | null = null;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
    const source = this.source();
    this.logger.log(source === 'outbox'
      ? `No SMTP server set: emails are written to ${this.outboxDir}`
      : `Email via SMTP ${this.smtp()!.host} (${source === 'settings' ? 'Email settings' : 'SMTP_HOST'})`);
  }

  // ─── Settings (global admins) ──────────────────────────────────────────────

  /** As the browser sees them: never the password. */
  async getSettings() {
    const s = this.settings;
    return {
      smtpHost: s?.smtpHost ?? null,
      smtpPort: s?.smtpPort ?? 587,
      smtpSecure: s?.smtpSecure ?? false,
      smtpUser: s?.smtpUser ?? null,
      hasPassword: !!s?.smtpPassword,
      fromName: s?.fromName ?? null,
      fromAddress: s?.fromAddress ?? null,
      appUrl: s?.appUrl ?? null,
      /** What is in use right now, and the values it falls back to */
      source: this.source(),
      from: this.from(),
      effectiveAppUrl: this.appUrl(),
      environment: { smtpHost: process.env.SMTP_HOST || null, mailFrom: process.env.MAIL_FROM || null, appUrl: process.env.APP_URL || null },
    };
  }

  async saveSettings(dto: MailSettingsDto) {
    const clear = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
    const data = {
      smtpHost: clear(dto.smtpHost),
      smtpPort: dto.smtpPort,
      smtpSecure: dto.smtpSecure,
      smtpUser: clear(dto.smtpUser),
      smtpPassword: dto.smtpPassword === undefined ? undefined : dto.smtpPassword ? seal(dto.smtpPassword) : null,
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
      subject: '[JiraTech] Test email',
      text: `This is a test email from JiraTech.\n\nIf you can read this, outgoing email works. Links in emails point to ${this.appUrl()}.`,
      html: `<p>This is a test email from JiraTech.</p><p>If you can read this, outgoing email works. Links in emails point to <a href="${this.appUrl()}">${this.appUrl()}</a>.</p>`,
    };
    try {
      await this.deliver(message);
    } catch (e) {
      throw new BadRequestException(friendlyError(e, this.smtp()));
    }
    return { sent: true, source: this.source(), file: this.source() === 'outbox' ? this.outboxDir : null };
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  /** Never throws: a mail failure must not break the action that triggered it. */
  async send(message: MailMessage): Promise<boolean> {
    try {
      await this.deliver(message);
      return true;
    } catch (e) {
      this.logger.warn(`Could not send email to ${message.to}: ${friendlyError(e, this.smtp())}`);
      return false;
    }
  }

  /** The address people open JiraTech at, without a trailing slash: for links in emails. */
  appUrl() {
    return (this.settings?.appUrl || process.env.APP_URL || 'http://localhost:5172').replace(/\/+$/, '');
  }

  /** The bare address emails are sent from (so incoming mail from it can be recognised as our own). */
  fromAddress() {
    if (this.settings?.fromAddress) return this.settings.fromAddress;
    const env = process.env.MAIL_FROM;
    return (env ? (/<([^>]+)>/.exec(env)?.[1] ?? env) : DEFAULT_FROM_ADDRESS).trim().toLowerCase();
  }

  private from() {
    if (this.settings?.fromAddress) return `"${(this.settings.fromName || DEFAULT_FROM_NAME).replace(/"/g, '')}" <${this.settings.fromAddress}>`;
    return process.env.MAIL_FROM ?? `${DEFAULT_FROM_NAME} <${DEFAULT_FROM_ADDRESS}>`;
  }

  private async deliver(message: MailMessage) {
    const mail = { from: this.from(), ...message };
    if (this.transport) {
      await this.transport.sendMail(mail);
      return;
    }
    const info = await this.preview.sendMail(mail);
    fs.mkdirSync(this.outboxDir, { recursive: true });
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(this.outboxDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeTo}.eml`);
    fs.writeFileSync(file, info.message as Buffer);
  }

  private source(): MailSource {
    if (this.settings?.smtpHost) return 'settings';
    return process.env.SMTP_HOST ? 'environment' : 'outbox';
  }

  /** The SMTP server in use: the app's settings first, then the environment. */
  private smtp(): Smtp | null {
    const s = this.settings;
    if (s?.smtpHost) {
      return { host: s.smtpHost, port: s.smtpPort, secure: s.smtpSecure, user: s.smtpUser, pass: s.smtpPassword ? open(s.smtpPassword) : null };
    }
    if (process.env.SMTP_HOST) {
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

/** SMTP errors in words an admin can act on. */
function friendlyError(e: unknown, smtp: Smtp | null): string {
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
