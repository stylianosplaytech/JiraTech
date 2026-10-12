import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { AuthUser } from '../common/auth-user';

/** How long a welcome link works. */
const LINK_DAYS = 7;
export const MIN_PASSWORD = 8;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * Welcome emails: a person added on the People page gets a one-time link to choose their own password.
 * Only a hash of the link's token is stored; a new link replaces any earlier one.
 */
@Injectable()
export class InvitationsService {
  constructor(private prisma: PrismaService, private mailer: MailerService) {}

  /** Emails a new set-password link. `sent` is false when the email couldn't be delivered. */
  async invite(userId: string, invitedBy: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction([
      this.prisma.passwordToken.deleteMany({ where: { userId } }),
      this.prisma.passwordToken.create({ data: { userId, tokenHash: hash(token), expiresAt } }),
    ]);

    const link = `${this.mailer.appUrl()}/set-password?token=${token}`;
    const customer = user.role === UserRole.CUSTOMER;
    const what = customer ? 'the JiraTech help center, where you can raise and follow support requests' : 'JiraTech';
    const sent = await this.mailer.send({
      to: user.email,
      subject: customer ? 'Welcome to the JiraTech help center' : 'Welcome to JiraTech',
      text: `Hi ${user.name},\n\n${invitedBy.name} has given you access to ${what}.\n\n`
        + `Choose your password to get started:\n${link}\n\n`
        + `You'll log in with this email address: ${user.email}\nThe link works for ${LINK_DAYS} days and only once. `
        + 'If it has expired, ask your administrator to send a new one.',
      html: welcomeHtml({ name: user.name, inviter: invitedBy.name, what, link, email: user.email }),
    });
    return { sent, expiresAt };
  }

  /** What the set-password page shows, or why the link doesn't work. */
  async lookup(token: string) {
    const record = await this.valid(token);
    return { name: record.user.name, email: record.user.email, customer: record.user.role === UserRole.CUSTOMER };
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

  private async valid(token: string) {
    const record = await this.prisma.passwordToken.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
    if (!record) throw new NotFoundException('This link is not valid or has already been used. Ask your administrator to send a new one.');
    if (record.expiresAt < new Date()) throw new BadRequestException('This link has expired. Ask your administrator to send a new one.');
    return record;
  }
}

function welcomeHtml(p: { name: string; inviter: string; what: string; link: string; email: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F4F5F7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#172B4D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:3px;border:1px solid #DFE1E6">
<tr><td style="padding:20px 24px;border-bottom:1px solid #DFE1E6;font-weight:600;color:#0052CC">JiraTech</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:18px;font-weight:600">Welcome, ${esc(p.name)}</p>
<p style="margin:0 0 16px;font-size:14px;line-height:20px">${esc(p.inviter)} has given you access to ${esc(p.what)}.</p>
<p style="margin:20px 0"><a href="${esc(p.link)}" style="display:inline-block;background:#0052CC;color:#fff;padding:10px 16px;border-radius:3px;text-decoration:none;font-size:14px;font-weight:500">Choose your password</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#42526E">You'll log in with <strong>${esc(p.email)}</strong>.</p>
<p style="margin:0;font-size:12px;color:#6B778C">Button not working? Paste this link into your browser:<br><a href="${esc(p.link)}" style="color:#0052CC;word-break:break-all">${esc(p.link)}</a></p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #DFE1E6;font-size:12px;color:#6B778C">The link works for ${LINK_DAYS} days and only once. If it has expired, ask your administrator to send a new one.</td></tr>
</table></td></tr></table></body></html>`;
}
