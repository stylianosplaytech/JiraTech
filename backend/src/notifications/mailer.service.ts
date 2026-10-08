import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends email through SMTP when SMTP_HOST is set. Otherwise (local development) each
 * message is written as an .eml file to backend/mail-outbox so it can be opened in any mail client.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly from = process.env.MAIL_FROM ?? 'JiraTech <no-reply@jiratech.local>';
  private readonly outboxDir = path.resolve(__dirname, '../../mail-outbox');
  private readonly transport: Transporter | null;
  private readonly preview: Transporter;

  constructor() {
    this.transport = process.env.SMTP_HOST
      ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
      : null;
    this.preview = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    this.logger.log(this.transport
      ? `Email via SMTP ${process.env.SMTP_HOST}`
      : `SMTP_HOST not set: emails are written to ${this.outboxDir}`);
  }

  /** Never throws: a mail failure must not break the action that triggered it. */
  async send(message: MailMessage): Promise<boolean> {
    try {
      if (this.transport) {
        await this.transport.sendMail({ from: this.from, ...message });
      } else {
        const info = await this.preview.sendMail({ from: this.from, ...message });
        fs.mkdirSync(this.outboxDir, { recursive: true });
        const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, '_');
        const file = path.join(this.outboxDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeTo}.eml`);
        fs.writeFileSync(file, info.message as Buffer);
      }
      return true;
    } catch (e) {
      this.logger.warn(`Could not send email to ${message.to}: ${(e as Error).message}`);
      return false;
    }
  }
}
