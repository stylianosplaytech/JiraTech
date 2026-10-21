import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmailDirection, EmailStatus, Prisma, ProjectType, UserRole } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../common/auth-user';
import { contains } from '../common/text-match';
import { sanitizeRich, toPlainText } from '../common/rich-text';
import { issueRef } from '../common/issue-ref';
import { IssuesService } from '../issues/issues.service';
import { MailerService } from '../mail/mailer.service';
import { RecipientGroupsService } from '../recipient-groups/recipient-groups.service';
import { CATEGORY_NAMES } from '../workflow/workflow.service';
import { SendEmailDto } from './dto';
import {
  Address, bareMessageId, escapeHtml, formatAddress, parseAddresses, quoteBlock, subjectWithKey,
} from './email-html';

/** What the email channel read from an email that belongs to a request. */
export interface InboundEmail {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  fromEmail: string;
  fromName: string | null;
  to: Address[];
  cc: Address[];
  replyTo: string | null;
  subject: string;
  /** Already sanitized */
  html: string;
  text: string;
}

/** Gmail's limit for a whole message; SMTP servers are often lower. */
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
/** Kept on a reply's References header (the oldest are dropped, as mail clients do). */
const MAX_REFERENCES = 20;

const EMAIL_INCLUDE = {
  sentBy: { select: { id: true, name: true } },
  attachments: { include: { attachment: { select: { id: true, filename: true, mimeType: true, size: true } } } },
} satisfies Prisma.IssueEmailInclude;

type EmailRow = Prisma.IssueEmailGetPayload<{ include: typeof EMAIL_INCLUDE }>;

/**
 * Emails on service desk requests: the ones customers send (recorded by the email channel) and the ones agents write
 * from a request (reply, reply all, forward or a new email). Each is also a comment, so the portal, SLAs and search
 * see it as one; the email adds who it went to and the threading headers that bring the answer back.
 */
@Injectable()
export class IssueEmailService {
  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private issues: IssuesService,
    private mailer: MailerService,
    private recipientGroups: RecipientGroupsService,
  ) {}

  // ─── Reading ───────────────────────────────────────────────────────────────

  async list(idOrKey: string) {
    const issue = await this.issue(idOrKey);
    const [emails, channel, own] = await Promise.all([
      this.prisma.issueEmail.findMany({ where: { issueId: issue.id }, include: EMAIL_INCLUDE, orderBy: { createdAt: 'asc' } }),
      this.prisma.emailChannel.findUnique({ where: { projectId: issue.projectId }, select: { address: true, enabled: true } }),
      this.ownAddresses(),
    ]);
    return {
      emails: emails.map(serialize),
      /** Left out of "Reply all": replies would only come back to the request */
      ownAddresses: own,
      /** Replies come back to the request only through an enabled email channel */
      channelAddress: channel?.enabled ? channel.address : null,
    };
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  async send(idOrKey: string, user: AuthUser, dto: SendEmailDto) {
    const issue = await this.issue(idOrKey);
    if (user.role === UserRole.CUSTOMER) throw new ForbiddenException('Only agents can send emails from a request');
    // Groups and organizations become their members now; someone also picked on their own keeps that (they come first).
    const [toGroups, ccGroups, bccGroups] = await Promise.all([dto.toGroups, dto.ccGroups, dto.bccGroups]
      .map((refs) => (refs?.length ? this.recipientGroups.expand(refs) : Promise.resolve([] as Address[]))));
    const to = dedupe([...dto.to, ...toGroups]);
    const cc = dedupe([...(dto.cc ?? []), ...ccGroups], to);
    const bcc = dedupe([...(dto.bcc ?? []), ...bccGroups], [...to, ...cc]);
    if (!to.length) throw new BadRequestException(dto.toGroups?.length ? 'Nobody is in the groups or organizations in To' : 'Add at least one recipient');

    const original = dto.replyToId
      ? await this.prisma.issueEmail.findFirst({ where: { id: dto.replyToId, issueId: issue.id } })
      : null;
    if (dto.replyToId && !original) throw new NotFoundException('The email you are replying to is no longer on this request');
    const forward = dto.mode === 'forward';

    const body = sanitizeRich(dto.html) ?? '';
    if (!body && !(forward && original)) throw new BadRequestException('Write the email before sending it');
    const quote = original && (dto.includeQuote || forward)
      ? quoteBlock(forward ? 'forward' : 'reply', { ...original, to: parseAddresses(original.to), cc: parseAddresses(original.cc) })
      : '';
    const subject = subjectWithKey(dto.subject.trim() || issue.summary, issue.key);

    const attachmentIds = [...new Set(dto.attachmentIds ?? [])];
    const attachments = attachmentIds.length
      ? await this.prisma.attachment.findMany({ where: { id: { in: attachmentIds }, issueId: issue.id } })
      : [];
    if (attachments.length !== attachmentIds.length) throw new BadRequestException('Some of the files are no longer on this request');
    if (attachments.reduce((n, a) => n + a.size, 0) > MAX_ATTACHMENTS_BYTES) {
      throw new BadRequestException('The files add up to more than 25 MB, more than most mail servers accept');
    }

    const channel = await this.prisma.emailChannel.findUnique({ where: { projectId: issue.projectId } });
    const recipients = [...to, ...cc, ...bcc].map((a) => a.email);
    const internal = !!dto.internal;
    const summaryLine = `${forward ? 'Forwarded' : 'Emailed'} to ${describe(to)}`;
    // The comment is what the portal and SLAs see; agents see the email in its place.
    const comment = await this.issues.addComment(issue.id, user, body || `<p>${escapeHtml(summaryLine)}</p>`, { internal, emailed: recipients });

    const messageId = `${randomUUID()}@${this.mailer.fromAddress().split('@')[1] || 'conductor.local'}`;
    const references = original
      ? [...(original.references?.split(/\s+/).filter(Boolean) ?? []), original.messageId].slice(-MAX_REFERENCES)
      : [];
    const email = await this.prisma.issueEmail.create({
      data: {
        issueId: issue.id,
        commentId: comment.id,
        direction: EmailDirection.OUTBOUND,
        messageId,
        inReplyTo: original?.messageId ?? null,
        references: references.join(' ') || null,
        fromEmail: this.mailer.fromAddress(),
        fromName: this.senderName(user, issue.project.name),
        to: JSON.stringify(to),
        cc: JSON.stringify(cc),
        bcc: JSON.stringify(bcc),
        replyTo: channel?.enabled ? channel.address : null,
        subject,
        html: body + quote,
        text: this.textVersion(body, original, forward, !!quote),
        sentById: user.id,
        attachments: { create: attachments.map((a) => ({ attachmentId: a.id })) },
      },
      include: EMAIL_INCLUDE,
    });

    // Whoever it went to can follow the request and answer it, as when they write in themselves. A supplier an
    // internal email was forwarded to stays out of it, and so does everyone reached through a group or organization.
    if (!internal) await this.addParticipants(issue.id, [...to, ...cc].filter((a) => !a.via), { createCustomers: !!channel?.createCustomers });
    return this.deliver(email);
  }

  /** Sends a failed email again, exactly as it was written. */
  async retry(idOrKey: string, emailId: string, user: AuthUser) {
    const issue = await this.issue(idOrKey);
    if (user.role === UserRole.CUSTOMER) throw new ForbiddenException('Only agents can send emails from a request');
    const email = await this.prisma.issueEmail.findFirst({ where: { id: emailId, issueId: issue.id }, include: EMAIL_INCLUDE });
    if (!email) throw new NotFoundException('Email not found');
    if (email.direction !== EmailDirection.OUTBOUND || email.status !== EmailStatus.FAILED) {
      throw new BadRequestException('Only emails that could not be sent can be sent again');
    }
    return this.deliver(email);
  }

  private async deliver(email: EmailRow) {
    const files = await this.prisma.attachment.findMany({ where: { id: { in: email.attachments.map((a) => a.attachmentId) } } });
    const error = await this.mailer.sendReporting({
      to: parseAddresses(email.to).map(formatAddress).join(', '),
      cc: parseAddresses(email.cc).map(formatAddress),
      bcc: parseAddresses(email.bcc).map(formatAddress),
      subject: email.subject,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45">${email.html}</div>`,
      text: email.text,
      replyTo: email.replyTo ?? undefined,
      fromName: email.fromName ?? undefined,
      messageId: `<${email.messageId}>`,
      inReplyTo: email.inReplyTo ? `<${email.inReplyTo}>` : undefined,
      references: email.references ? email.references.split(' ').map((r) => `<${r}>`) : undefined,
      attachments: files.map((f) => ({ filename: f.filename, path: f.storagePath, contentType: f.mimeType })),
    });
    const saved = await this.prisma.issueEmail.update({
      where: { id: email.id },
      data: { status: error ? EmailStatus.FAILED : EmailStatus.SENT, error },
      include: EMAIL_INCLUDE,
    });
    return serialize(saved);
  }

  /** "Anna Smith (IT Help Desk)": the customer sees who answered, from the address email is sent from. */
  private senderName(user: AuthUser, projectName: string) {
    return `${user.name} (${projectName})`.slice(0, 120);
  }

  private textVersion(body: string, original: { fromEmail: string; fromName: string | null; createdAt: Date; subject: string; text: string } | null, forward: boolean, quoted: boolean) {
    const text = toPlainText(body);
    if (!original || !quoted) return text;
    const from = formatAddress({ email: original.fromEmail, name: original.fromName });
    if (forward) {
      return `${text}\n\n---------- Forwarded message ---------\nFrom: ${from}\nDate: ${original.createdAt.toUTCString()}\nSubject: ${original.subject}\n\n${original.text}`;
    }
    const lines = original.text.replace(/\r\n/g, '\n').split('\n').map((l) => `> ${l}`).join('\n');
    return `${text}\n\nOn ${original.createdAt.toUTCString()}, ${from} wrote:\n${lines}`;
  }

  // ─── Received emails (called by the email channel) ─────────────────────────

  /** The request an email answers, found through its In-Reply-To / References headers. */
  async threadOf(projectId: string, mail: Pick<InboundEmail, 'inReplyTo' | 'references'>) {
    const ids = [mail.inReplyTo, ...mail.references].map(bareMessageId).filter(Boolean);
    if (!ids.length) return null;
    const found = await this.prisma.issueEmail.findFirst({
      where: { messageId: { in: ids }, issue: { projectId } },
      orderBy: { createdAt: 'desc' },
      select: { issue: { select: { key: true } } },
    });
    return found?.issue.key ?? null;
  }

  async recordInbound(issueKey: string, commentId: string | null, mail: InboundEmail, attachmentIds: string[]) {
    const issue = await this.issue(issueKey);
    await this.prisma.issueEmail.create({
      data: {
        issueId: issue.id,
        commentId,
        direction: EmailDirection.INBOUND,
        messageId: bareMessageId(mail.messageId),
        inReplyTo: bareMessageId(mail.inReplyTo) || null,
        references: mail.references.map(bareMessageId).filter(Boolean).slice(-MAX_REFERENCES).join(' ') || null,
        fromEmail: mail.fromEmail,
        fromName: mail.fromName,
        to: JSON.stringify(mail.to),
        cc: JSON.stringify(mail.cc),
        replyTo: mail.replyTo,
        subject: mail.subject.slice(0, 500),
        html: mail.html,
        text: mail.text,
        attachments: { create: attachmentIds.map((attachmentId) => ({ attachmentId })) },
      },
    });
  }

  /**
   * The people an email went to (other than the service desk itself) become participants of the request: customers
   * see it on the portal and get its updates, agents watch it. Unknown addresses get a customer account when
   * `createCustomers` (the channel's setting), and people removed from the request's portal are left out.
   */
  async addParticipants(idOrKey: string, addresses: Address[], opts: { createCustomers: boolean }) {
    const own = new Set(await this.ownAddresses());
    const wanted = dedupe(addresses).filter((a) => !own.has(a.email));
    if (!wanted.length) return;
    const issue = await this.prisma.issue.findFirstOrThrow({
      where: issueRef(idOrKey),
      select: { id: true, projectId: true, portalId: true },
    });
    for (const a of wanted) {
      let user = await this.findUser(a.email);
      if (!user) {
        if (!opts.createCustomers) continue;
        user = await this.createCustomer(a.email, a.name ?? null);
      }
      if (user.role !== UserRole.CUSTOMER && !(await this.access.can(user, issue.projectId, 'browse'))) continue;
      if (issue.portalId && await this.prisma.portalExclusion.findUnique({ where: { portalId_userId: { portalId: issue.portalId, userId: user.id } } })) continue;
      await this.prisma.issueWatcher.upsert({
        where: { issueId_userId: { issueId: issue.id, userId: user.id } },
        create: { issueId: issue.id, userId: user.id },
        update: {},
      });
    }
  }

  /** Addresses that are Conductor itself: where email is sent from, and every service desk's channel. */
  async ownAddresses() {
    const channels = await this.prisma.emailChannel.findMany({ select: { address: true } });
    return [...new Set([this.mailer.fromAddress(), process.env.SMTP_USER, ...channels.map((c) => c.address)]
      .filter((a): a is string => !!a)
      .map((a) => a.trim().toLowerCase()))];
  }

  /** Email addresses are matched ignoring case. */
  async findUser(email: string): Promise<AuthUser | null> {
    const candidates = await this.prisma.user.findMany({
      where: { email: contains(email) },
      select: { id: true, email: true, name: true, role: true },
      take: 20,
    });
    return candidates.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  /** They can't log in until an admin sets a password on the People page; they still get email updates. */
  async createCustomer(email: string, name: string | null): Promise<AuthUser> {
    try {
      return await this.prisma.user.create({
        data: {
          email: email.toLowerCase(),
          name: name?.trim().slice(0, 100) || email.split('@')[0],
          role: UserRole.CUSTOMER,
          passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10),
        },
        select: { id: true, email: true, name: true, role: true },
      });
    } catch (e) {
      // Created at the same moment by another email from them.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return (await this.findUser(email))!;
      throw e;
    }
  }

  // ─── Templates ─────────────────────────────────────────────────────────────

  /** A template with its {{placeholders}} filled in for this request and recipient. */
  async renderTemplate(idOrKey: string, user: AuthUser, templateId: string, toEmail?: string) {
    const issue = await this.issue(idOrKey);
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id: templateId, OR: [{ projectId: null }, { projectId: issue.projectId }] },
    });
    if (!template) throw new NotFoundException('Template not found');
    const recipient = toEmail ? await this.findUser(toEmail) : null;
    const customer = recipient ?? issue.reporter;
    const link = `${this.mailer.appUrl()}/portal/requests/${issue.key}`;
    const values: Record<string, string> = {
      'customer.name': customer?.name ?? toEmail ?? '',
      'customer.firstName': firstName(customer?.name ?? toEmail?.split('@')[0] ?? ''),
      'customer.email': customer?.email ?? toEmail ?? '',
      'agent.name': user.name,
      'agent.firstName': firstName(user.name),
      'agent.email': user.email,
      'issue.key': issue.key,
      'issue.summary': issue.summary,
      'issue.status': issue.workflowStatus?.name ?? CATEGORY_NAMES[issue.status],
      'issue.priority': issue.priority.charAt(0) + issue.priority.slice(1).toLowerCase(),
      'issue.assignee': issue.assignee?.name ?? 'Unassigned',
      'request.type': issue.requestType?.name ?? '',
      'request.link': link,
      'project.name': issue.project.name,
    };
    const fill = (s: string, html: boolean) => s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) => {
      if (!(name in values)) return whole;
      if (!html) return values[name];
      return name === 'request.link'
        ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(link)}</a>`
        : escapeHtml(values[name]);
    });
    return { subject: template.subject ? fill(template.subject, false) : null, html: fill(template.body, true) };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async issue(idOrKey: string) {
    const issue = await this.prisma.issue.findFirst({
      where: issueRef(idOrKey),
      include: {
        project: { select: { id: true, name: true, type: true } },
        reporter: { select: { id: true, name: true, email: true } },
        assignee: { select: { name: true } },
        workflowStatus: { select: { name: true } },
        requestType: { select: { name: true } },
      },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    if (issue.project.type !== ProjectType.SERVICE_DESK) throw new BadRequestException('Emails are only available on service desk requests');
    return issue;
  }
}

/** Lower-cased, each address once, leaving out any already in `except`. */
export function dedupe(list: Address[], except: Address[] = []): Address[] {
  const seen = new Set(except.map((a) => a.email.toLowerCase()));
  const out: Address[] = [];
  for (const a of list) {
    const email = a.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: a.name?.trim() || null, ...(a.via ? { via: a.via } : {}) });
  }
  return out;
}

/** "Erin, All customers (12)": people by name, groups and organizations by theirs. */
export function describe(list: Address[]) {
  const parts: string[] = [];
  const groups = new Map<string, number>();
  for (const a of list) {
    if (a.via) groups.set(a.via, (groups.get(a.via) ?? 0) + 1);
    else parts.push(a.name || a.email);
  }
  return [...parts, ...[...groups].map(([name, n]) => `${name} (${n})`)].join(', ');
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

function serialize(e: EmailRow) {
  return {
    id: e.id,
    commentId: e.commentId,
    direction: e.direction,
    fromEmail: e.fromEmail,
    fromName: e.fromName,
    to: parseAddresses(e.to),
    cc: parseAddresses(e.cc),
    bcc: parseAddresses(e.bcc),
    replyTo: e.replyTo,
    subject: e.subject,
    html: e.html,
    status: e.status,
    error: e.error,
    createdAt: e.createdAt,
    sentBy: e.sentBy,
    attachments: e.attachments.map((a) => a.attachment),
  };
}
