import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { AuthUser } from '../common/auth-user';
import { contains } from '../common/text-match';

/** How long a welcome link works. */
const WELCOME_DAYS = 7;
/** How long a "forgot password" link works. */
const RESET_MINUTES = 60;
/** A person can ask for a new reset link at most this often. */
const RESET_COOLDOWN_SECONDS = 60;
export const MIN_PASSWORD = 8;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * One-time links to choose a password: the welcome email a person added on the People page gets, and the
 * "forgot password" email anyone can ask for from the login page. Only a hash of the link's token is stored;
 * a new link replaces any earlier one.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(private prisma: PrismaService, private mailer: MailerService) {}

  /** Emails a new welcome link. `sent` is false when the email couldn't be delivered. */
  async invite(userId: string, invitedBy: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const { link, expiresAt } = await this.newLink(user.id, WELCOME_DAYS * 24 * 60);
    const customer = user.role === UserRole.CUSTOMER;
    const what = customer ? 'the Conductor help center, where you can raise and follow support requests' : 'Conductor';
    const expiry = `The link works for ${WELCOME_DAYS} days and only once. If it has expired, ask your administrator to send a new one.`;
    const sent = await this.mailer.send({
      to: user.email,
      subject: customer ? 'Welcome to the Conductor help center' : 'Welcome to Conductor',
      text: `Hi ${user.name},\n\n${invitedBy.name} has given you access to ${what}.\n\n`
        + `Choose your password to get started:\n${link}\n\n`
        + `You'll log in with this email address: ${user.email}\n${expiry}`,
      html: linkEmail({
        title: `Welcome, ${user.name}`,
        intro: `${invitedBy.name} has given you access to ${what}.`,
        button: 'Choose your password',
        link,
        email: user.email,
        footer: expiry,
      }),
    });
    return { sent, expiresAt };
  }

  /**
   * "Forgot password": emails a link to choose a new one, at most once a minute per person. Returns straight away
   * and the same way whether or not the address has an account, so the answer (and how long it takes) doesn't tell.
   */
  forgotPassword(email: string) {
    this.sendReset(email).catch((e) => this.logger.error(`Password reset failed: ${(e as Error).message}`));
  }

  private async sendReset(email: string) {
    const address = email.trim().toLowerCase();
    const user = (await this.prisma.user.findMany({ where: { email: contains(address) }, take: 20 }))
      .find((u) => u.email.toLowerCase() === address);
    if (!user) return;
    const recent = await this.prisma.passwordToken.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_SECONDS * 1000) } },
    });
    if (recent) return;

    const { link } = await this.newLink(user.id, RESET_MINUTES);
    const expiry = `The link works for ${RESET_MINUTES} minutes and only once. If you didn't ask for it, ignore this email: your password stays the same.`;
    const sent = await this.mailer.send({
      to: user.email,
      subject: 'Reset your Conductor password',
      text: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset the password for ${user.email}.\n\n`
        + `Choose a new password:\n${link}\n\n${expiry}`,
      html: linkEmail({
        title: 'Reset your password',
        intro: `Hi ${user.name}, someone (hopefully you) asked to reset the password for your Conductor account.`,
        button: 'Choose a new password',
        link,
        email: user.email,
        footer: expiry,
      }),
    });
    if (!sent) this.logger.warn(`Password reset email to ${user.email} could not be sent`);
  }

  /** What the set-password page shows, or why the link doesn't work. */
  async lookup(token: string) {
    const record = await this.valid(token);
    return {
      name: record.user.name,
      email: record.user.email,
      customer: record.user.role === UserRole.CUSTOMER,
      /** Still to choose their first password (a welcome link) rather than resetting one */
      welcome: record.user.invitePending,
    };
  }

  /** Sets the password and uses up the link; returns the user so they can be logged in straight away. */
  async setPassword(token: string, password: string) {
    if (password.length < MIN_PASSWORD) throw new BadRequestException(`Use at least ${MIN_PASSWORD} characters`);
    const record = await this.valid(token);
    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, invitePending: false },
        select: { id: true, email: true, name: true, role: true },
      }),
      this.prisma.passwordToken.deleteMany({ where: { userId: record.userId } }),
    ]);
    return user;
  }

  /** A fresh link for this person, replacing any earlier one. */
  private async newLink(userId: string, minutes: number) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    await this.prisma.$transaction([
      this.prisma.passwordToken.deleteMany({ where: { userId } }),
      this.prisma.passwordToken.create({ data: { userId, tokenHash: hash(token), expiresAt } }),
    ]);
    return { link: `${this.mailer.appUrl()}/set-password?token=${token}`, expiresAt };
  }

  private async valid(token: string) {
    const record = await this.prisma.passwordToken.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
    const again = 'Use "Forgot password?" on the login page to get a new one, or ask your administrator.';
    if (!record) throw new NotFoundException(`This link is not valid or has already been used. ${again}`);
    if (record.expiresAt < new Date()) throw new BadRequestException(`This link has expired. ${again}`);
    return record;
  }
}

function linkEmail(p: { title: string; intro: string; button: string; link: string; email: string; footer: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F4F5F7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#172B4D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:3px;border:1px solid #DFE1E6">
<tr><td style="padding:20px 24px;border-bottom:1px solid #DFE1E6;font-weight:600;color:#0052CC">Conductor</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:18px;font-weight:600">${esc(p.title)}</p>
<p style="margin:0 0 16px;font-size:14px;line-height:20px">${esc(p.intro)}</p>
<p style="margin:20px 0"><a href="${esc(p.link)}" style="display:inline-block;background:#0052CC;color:#fff;padding:10px 16px;border-radius:3px;text-decoration:none;font-size:14px;font-weight:500">${esc(p.button)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#42526E">You log in with <strong>${esc(p.email)}</strong>.</p>
<p style="margin:0;font-size:12px;color:#6B778C">Button not working? Paste this link into your browser:<br><a href="${esc(p.link)}" style="color:#0052CC;word-break:break-all">${esc(p.link)}</a></p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #DFE1E6;font-size:12px;color:#6B778C">${esc(p.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}
