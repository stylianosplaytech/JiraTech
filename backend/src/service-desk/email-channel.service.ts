import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { EmailChannel, EmailOutcome, Portal, Prisma, ProjectType, UserRole } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../common/auth-user';
import { contains } from '../common/text-match';
import { open, seal } from '../common/secret-box';
import { IssuesService } from '../issues/issues.service';
import { PortalsService } from './portals.service';
import { MailerService } from '../mail/mailer.service';
import { EmailChannelDto, TestEmailDto } from './dto/service-desk.dto';
import { envChannels, envPassword, envPrefix } from './email-channel-env';

/** How often enabled mailboxes are read (MAIL_POLL_SECONDS, at least 15). MAIL_POLLING=false turns reading off. */
const POLL_SECONDS = Math.max(15, Number(process.env.MAIL_POLL_SECONDS) || 60);
const POLLING = process.env.MAIL_POLLING !== 'false';
/** Emails handled per mailbox check; the rest wait for the next one. */
const MAX_PER_CHECK = 50;
/** Same limit as attachments uploaded in the app. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_DESCRIPTION = 32000;

/** An email, whether read from the mailbox or made up with "Send a test email". */
interface IncomingMail {
  messageId: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string;
  text: string;
  attachments: { filename: string; contentType: string; content: Buffer }[];
  /** Out-of-office replies, bounces, mailing lists: answering them could start a mail loop. */
  automatic: boolean;
}

export interface EmailResult {
  outcome: EmailOutcome;
  detail: string | null;
  issueKey: string | null;
}

type Channel = EmailChannel & { project: { id: string; key: string; type: ProjectType } };

/** Thrown to stop handling an email that is deliberately skipped. */
class Ignored extends Error {}

/**
 * A service desk's email channel: each project can have its own address. Its mailbox is read over IMAP every
 * minute; a new email raises a request through the sender's portal, and a reply whose subject carries an existing
 * request's key (as every notification does) is added to that request as a comment.
 */
@Injectable()
export class EmailChannelService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailChannelService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Channels being read right now, so two checks never handle the same mailbox at once. */
  private readonly checking = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private issues: IssuesService,
    private portals: PortalsService,
    private mailer: MailerService,
  ) {}

  async onModuleInit() {
    await this.applyEnvironment();
    if (!POLLING) {
      this.logger.log('MAIL_POLLING=false: service desk mailboxes are not read');
      return;
    }
    this.timer = setInterval(() => void this.checkAll(), POLL_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Applies the EMAIL_<KEY>_* environment variables (see email-channel-env.ts) to their service desks, so mailboxes
   * defined there come back after a database reset. Desks whose variables were removed keep their settings but are
   * switched off and become editable in the app again.
   */
  private async applyEnvironment() {
    const defined = new Set<string>();
    for (const def of envChannels()) {
      defined.add(def.key);
      const p = envPrefix(def.key);
      if ('error' in def) {
        this.logger.warn(`${p}*: ${def.error}`);
        continue;
      }
      const project = await this.prisma.project.findUnique({ where: { key: def.key } });
      if (!project || project.type !== ProjectType.SERVICE_DESK) {
        this.logger.warn(`${p}*: there is no service desk with the key ${def.key}`);
        continue;
      }
      const portal = def.portal ? await this.prisma.portal.findFirst({ where: { projectId: project.id, slug: def.portal } }) : null;
      if (def.portal && !portal) this.logger.warn(`${p}PORTAL: ${def.key} has no portal linked as ${def.portal}; using its first portal`);
      const type = def.requestType ? await this.prisma.requestType.findFirst({ where: { projectId: project.id, name: def.requestType } }) : null;
      if (def.requestType && !type) this.logger.warn(`${p}REQUEST_TYPE: ${def.key} has no request type called ${def.requestType}; using the portal's first`);
      const data = {
        address: def.address,
        enabled: def.enabled,
        imapHost: def.imapHost,
        imapPort: def.imapPort,
        imapSecure: def.imapSecure,
        imapUser: def.imapUser,
        imapPassword: null,
        imapFolder: def.imapFolder,
        portalId: portal?.id ?? null,
        requestTypeId: type?.id ?? null,
        createCustomers: def.createCustomers,
        fromEnvironment: true,
      };
      try {
        await this.prisma.emailChannel.upsert({ where: { projectId: project.id }, create: { ...data, projectId: project.id }, update: data });
        this.logger.log(`${def.key}: ${def.address} set from ${p}*${def.enabled ? '' : ' (off)'}`);
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        this.logger.warn(`${p}ADDRESS: another service desk already uses ${def.address}`);
      }
    }
    const released = await this.prisma.emailChannel.updateMany({
      where: { fromEnvironment: true, project: { key: { notIn: [...defined] } } },
      data: { fromEnvironment: false, enabled: false },
    });
    if (released.count) this.logger.log(`${released.count} service desk mailbox(es) no longer set by environment variables: switched off`);
  }

  // ─── Configuration (agents read, project admins change) ────────────────────

  async get(key: string) {
    const project = await this.desk(key);
    const channel = await this.prisma.emailChannel.findUnique({ where: { projectId: project.id } });
    return { channel: channel ? view(channel, project.key) : null, polling: POLLING, pollSeconds: POLL_SECONDS };
  }

  async save(key: string, dto: EmailChannelDto) {
    const project = await this.desk(key);
    const existing = await this.prisma.emailChannel.findUnique({ where: { projectId: project.id } });
    if (existing?.fromEnvironment) throw setByEnvironment(project.key);
    const address = dto.address?.trim().toLowerCase();
    if (!existing && !address) throw new BadRequestException('Enter the email address customers write to');
    if (address && this.isSystemAddress(address)) {
      throw new BadRequestException('That is the address JiraTech sends notifications from; use a separate mailbox');
    }
    const portalId = dto.portalId === undefined ? undefined : dto.portalId || null;
    const requestTypeId = dto.requestTypeId === undefined ? undefined : dto.requestTypeId || null;
    if (portalId && !(await this.prisma.portal.findFirst({ where: { id: portalId, projectId: project.id } }))) {
      throw new BadRequestException('Choose one of this service desk\'s portals');
    }
    if (requestTypeId && !(await this.prisma.requestType.findFirst({ where: { id: requestTypeId, projectId: project.id } }))) {
      throw new BadRequestException('Choose one of this service desk\'s request types');
    }

    const data = {
      address,
      enabled: dto.enabled,
      imapHost: dto.imapHost === undefined ? undefined : dto.imapHost.trim() || null,
      imapPort: dto.imapPort,
      imapSecure: dto.imapSecure,
      imapUser: dto.imapUser === undefined ? undefined : dto.imapUser.trim() || null,
      imapPassword: dto.imapPassword === undefined ? undefined : dto.imapPassword ? seal(dto.imapPassword) : null,
      imapFolder: dto.imapFolder?.trim(),
      portalId,
      requestTypeId,
      createCustomers: dto.createCustomers,
    };
    const merged = { ...existing, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
    if (merged.enabled && !(merged.imapHost && merged.imapUser && merged.imapPassword)) {
      throw new BadRequestException('Fill in the mail server, user name and password before turning the channel on');
    }

    try {
      const channel = existing
        ? await this.prisma.emailChannel.update({ where: { id: existing.id }, data: { ...data, lastError: data.enabled === false ? null : undefined } })
        : await this.prisma.emailChannel.create({ data: { ...data, address: address!, projectId: project.id } });
      return view(channel, project.key);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Another service desk already uses ${address}`);
      }
      throw e;
    }
  }

  /** Received emails' log goes too; the requests they raised stay. */
  async remove(key: string) {
    const project = await this.desk(key);
    if ((await this.prisma.emailChannel.findUnique({ where: { projectId: project.id } }))?.fromEnvironment) throw setByEnvironment(project.key);
    await this.prisma.emailChannel.deleteMany({ where: { projectId: project.id } });
    return { deleted: true };
  }

  async messages(key: string) {
    const channel = await this.channelOf(key);
    return this.prisma.emailMessage.findMany({
      where: { channelId: channel.id },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
  }

  /** Logs in and opens the folder, without reading anything. */
  async testConnection(key: string) {
    const channel = await this.channelOf(key);
    const client = this.client(channel);
    try {
      await client.connect();
      // Opening the folder (rather than asking for its status) fails when it doesn't exist.
      const lock = await client.getMailboxLock(channel.imapFolder, { readOnly: true });
      try {
        const unseen = (await client.search({ seen: false }, { uid: true })) || [];
        return { ok: true, messages: client.mailbox ? client.mailbox.exists : 0, unseen: unseen.length };
      } finally {
        lock.release();
      }
    } catch (e) {
      throw new BadRequestException(friendlyError(e, channel));
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  /** Read the mailbox now rather than waiting for the next check. */
  async checkNow(key: string) {
    const channel = await this.channelOf(key);
    if (!ready(channel)) {
      throw new BadRequestException(channel.fromEnvironment
        ? `Set ${envPrefix(channel.project.key)}IMAP_HOST and ${envPrefix(channel.project.key)}IMAP_PASSWORD first`
        : 'Fill in the mail server, user name and password first');
    }
    try {
      return await this.check(channel);
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      throw new BadRequestException(friendlyError(e, channel));
    }
  }

  /** Handles a made-up email exactly as if it had arrived, so admins can try the channel without a mailbox. */
  async testEmail(key: string, dto: TestEmailDto) {
    const channel = await this.channelOf(key);
    const result = await this.receive(channel, {
      messageId: `test-${randomUUID()}`,
      fromEmail: dto.from.trim().toLowerCase(),
      fromName: dto.fromName?.trim() || null,
      subject: dto.subject,
      text: dto.body,
      attachments: [],
      automatic: false,
    }, true);
    return result!;
  }

  // ─── Reading mailboxes ─────────────────────────────────────────────────────

  private async checkAll() {
    const channels = await this.prisma.emailChannel.findMany({
      where: { enabled: true },
      include: { project: { select: { id: true, key: true, type: true } } },
    });
    for (const channel of channels) {
      if (channel.project.type !== ProjectType.SERVICE_DESK || !ready(channel) || this.checking.has(channel.id)) continue;
      try {
        await this.check(channel);
      } catch (e) {
        this.logger.warn(`${channel.address}: ${friendlyError(e, channel)}`);
      }
    }
  }

  /** Handles the folder's unread emails and marks them read. */
  private async check(channel: Channel) {
    if (this.checking.has(channel.id)) throw new ConflictException('The mailbox is being checked right now; try again in a moment');
    this.checking.add(channel.id);
    const tally = { received: 0, created: 0, commented: 0, ignored: 0, failed: 0 };
    const client = this.client(channel);
    try {
      await client.connect();
      const lock = await client.getMailboxLock(channel.imapFolder);
      try {
        const uids = (await client.search({ seen: false }, { uid: true })) || [];
        for (const uid of uids.slice(0, MAX_PER_CHECK)) {
          const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (message && message.source) {
            const result = await this.receive(channel, toIncoming(await simpleParser(message.source), message.source));
            if (result) {
              tally.received++;
              tally[({ CREATED: 'created', COMMENTED: 'commented', IGNORED: 'ignored', FAILED: 'failed' } as const)[result.outcome]]++;
            }
          }
          // Read, even when skipped or failed (the log says why), so it isn't handled again.
          await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
      await this.prisma.emailChannel.update({ where: { id: channel.id }, data: { lastCheckedAt: new Date(), lastError: null } });
      return tally;
    } catch (e) {
      await this.prisma.emailChannel.update({
        where: { id: channel.id },
        data: { lastCheckedAt: new Date(), lastError: friendlyError(e, channel) },
      }).catch(() => undefined);
      throw e;
    } finally {
      this.checking.delete(channel.id);
      await client.logout().catch(() => client.close());
    }
  }

  private client(channel: Channel) {
    const password = channel.fromEnvironment
      ? envPassword(channel.project.key)
      : channel.imapPassword ? open(channel.imapPassword) : null;
    if (!channel.fromEnvironment && channel.imapPassword && password === null) {
      throw new BadRequestException('The saved password can no longer be read (MAIL_SECRET or JWT_SECRET changed): enter it again');
    }
    const client = new ImapFlow({
      host: channel.imapHost ?? '',
      port: channel.imapPort,
      secure: channel.imapSecure,
      auth: { user: channel.imapUser ?? '', pass: password ?? '' },
      logger: false,
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
    // Without a listener, a dropped connection would crash the server.
    client.on('error', (e: Error) => this.logger.warn(`${channel.address}: ${e.message}`));
    return client;
  }

  // ─── Turning emails into requests ──────────────────────────────────────────

  /** Handles one email and logs it. Null when it was already handled (the same Message-ID came in before). */
  private async receive(channel: Channel, mail: IncomingMail, test = false): Promise<EmailResult | null> {
    const seen = await this.prisma.emailMessage.findUnique({ where: { channelId_messageId: { channelId: channel.id, messageId: mail.messageId } } });
    if (seen) return null;

    let result: EmailResult;
    try {
      result = await this.handle(channel, mail);
    } catch (e) {
      result = e instanceof Ignored
        ? { outcome: EmailOutcome.IGNORED, detail: e.message, issueKey: null }
        : { outcome: EmailOutcome.FAILED, detail: (e as Error).message, issueKey: null };
      if (!(e instanceof Ignored)) this.logger.warn(`${channel.address}: email "${mail.subject}" failed: ${(e as Error).message}`);
    }
    try {
      await this.prisma.emailMessage.create({
        data: {
          channelId: channel.id,
          messageId: mail.messageId,
          fromEmail: mail.fromEmail,
          fromName: mail.fromName,
          subject: mail.subject.slice(0, 500) || null,
          outcome: result.outcome,
          detail: result.detail?.slice(0, 1000) ?? null,
          issueKey: result.issueKey,
          test,
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return result;
  }

  private async handle(channel: Channel, mail: IncomingMail): Promise<EmailResult> {
    if (channel.project.type !== ProjectType.SERVICE_DESK) throw new Ignored('The project is no longer a service desk');
    const from = mail.fromEmail;
    if (!from) throw new Ignored('The email has no sender address');
    if (mail.automatic) throw new Ignored('Automatic reply, delivery report or mailing list email');
    if (this.isSystemAddress(from)) throw new Ignored('Sent by JiraTech itself');

    // A reply: the subject carries the key of one of this desk's requests, e.g. "Re: [JiraTech] (HELP-12) Printer jam".
    const match = new RegExp(`(?:^|[^A-Za-z0-9])(${escapeRegExp(channel.project.key)}-\\d+)(?![0-9])`, 'i').exec(mail.subject);
    if (match) {
      const issue = await this.prisma.issue.findUnique({ where: { key: match[1].toUpperCase() }, select: { key: true, projectId: true } });
      if (issue?.projectId === channel.projectId) return this.reply(issue.key, from, mail);
    }
    return this.raise(channel, from, mail);
  }

  private async reply(key: string, from: string, mail: IncomingMail): Promise<EmailResult> {
    const user = await this.findUser(from);
    if (!user) throw new Ignored(`${from} isn't a customer or agent of this service desk, so the reply to ${key} wasn't added`);
    const text = stripQuotedReply(mail.text);
    const saved = mail.attachments.filter(fits);
    if (!text && !saved.length) throw new Ignored(`Empty reply to ${key}`);
    try {
      await this.portals.comment(key, user, text || `Sent ${saved.length === 1 ? 'an attachment' : 'attachments'}: ${saved.map((a) => a.filename).join(', ')}`);
    } catch (e) {
      if (e instanceof NotFoundException) throw new Ignored(`${from} can't see ${key}, so their reply wasn't added`);
      throw e;
    }
    await this.attach(key, user.id, saved);
    return { outcome: EmailOutcome.COMMENTED, detail: skippedNote(mail.attachments), issueKey: key };
  }

  /**
   * A new request, raised through the sender's portal: the one serving their company if there is one, otherwise the
   * channel's default. Unknown senders become customers (when the channel allows it).
   */
  private async raise(channel: Channel, from: string, mail: IncomingMail): Promise<EmailResult> {
    const portals = await this.prisma.portal.findMany({ where: { projectId: channel.projectId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    if (!portals.length) throw new Error('This service desk has no portal');
    const fallback = portals.find((p) => p.id === channel.portalId) ?? portals[0];

    let user = await this.findUser(from);
    let portal: Portal | undefined;
    if (user) {
      if (user.role !== UserRole.CUSTOMER && !(await this.access.can(user, channel.projectId, 'browse'))) {
        throw new Ignored(`${from} is a staff member without access to this project`);
      }
      const usable: Portal[] = [];
      for (const p of portals) if (await this.portals.canUse(user, p)) usable.push(p);
      const theirs = usable.length > 1 ? await this.prisma.portalOrganization.findFirst({
        where: { portalId: { in: usable.map((p) => p.id) }, organization: { members: { some: { userId: user.id } } } },
        orderBy: { portal: { position: 'asc' } },
      }) : null;
      portal = usable.find((p) => p.id === theirs?.portalId) ?? usable.find((p) => p.id === fallback.id) ?? usable[0];
    }
    if (!portal || !user) {
      if (!channel.createCustomers) throw new Ignored(`${from} isn't a customer of this service desk`);
      user ??= await this.createCustomer(from, mail.fromName);
      portal = fallback;
      if (!portal.open) {
        await this.prisma.portalCustomer.upsert({
          where: { portalId_userId: { portalId: portal.id, userId: user.id } },
          create: { portalId: portal.id, userId: user.id },
          update: {},
        });
      }
    }

    const types = await this.portals.offeredTypes(portal);
    const type = types.find((t) => t.id === channel.requestTypeId) ?? types[0];
    if (!type) throw new Error(`${portal.name} offers no request types`);
    // Shared with the sender's organization, as on the portal by default.
    const organizationId = (await this.portals.shareOptions(portal.id, user.id))[0]?.id ?? null;

    const summary = mail.subject.replace(/\s+/g, ' ').trim().slice(0, 255) || `Email from ${mail.fromName || from}`;
    const description = mail.text.trim().slice(0, MAX_DESCRIPTION) || null;
    const issue = await this.issues.create(
      { type: type.issueType, summary, description: description ?? undefined, projectKey: channel.project.key },
      user,
      undefined,
      { requestTypeId: type.id, reporterId: user.id, organizationId, portalId: portal.id },
    );
    await this.attach(issue.key, user.id, mail.attachments.filter(fits));
    return { outcome: EmailOutcome.CREATED, detail: skippedNote(mail.attachments), issueKey: issue.key };
  }

  private async attach(key: string, userId: string, attachments: IncomingMail['attachments']) {
    for (const a of attachments) {
      await this.issues.addAttachment(key, userId, { originalname: a.filename, mimetype: a.contentType, size: a.content.length, buffer: a.content });
    }
  }

  /** Email addresses are matched ignoring case. */
  private async findUser(email: string): Promise<AuthUser | null> {
    const candidates = await this.prisma.user.findMany({
      where: { email: contains(email) },
      select: { id: true, email: true, name: true, role: true },
      take: 20,
    });
    return candidates.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  /** They can't log in until an admin sets a password on the People page; they still get email updates. */
  private async createCustomer(email: string, name: string | null): Promise<AuthUser> {
    try {
      return await this.prisma.user.create({
        data: {
          email,
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

  /** Mail from JiraTech's own addresses is never handled, so notifications can't loop back in. */
  private isSystemAddress(email: string) {
    return [this.mailer.fromAddress(), process.env.SMTP_USER?.toLowerCase()].includes(email.toLowerCase());
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async desk(key: string) {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project || project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException(`${key.toUpperCase()} is not a service desk`);
    return project;
  }

  private async channelOf(key: string) {
    const project = await this.desk(key);
    const channel = await this.prisma.emailChannel.findUnique({
      where: { projectId: project.id },
      include: { project: { select: { id: true, key: true, type: true } } },
    });
    if (!channel) throw new NotFoundException('Set up the service desk\'s email address first');
    return channel;
  }
}

/** The settings as the browser sees them: never the password. */
function view(c: EmailChannel, projectKey: string) {
  return {
    address: c.address,
    enabled: c.enabled,
    imapHost: c.imapHost,
    imapPort: c.imapPort,
    imapSecure: c.imapSecure,
    imapUser: c.imapUser,
    hasPassword: c.fromEnvironment ? !!envPassword(projectKey) : !!c.imapPassword,
    imapFolder: c.imapFolder,
    portalId: c.portalId,
    requestTypeId: c.requestTypeId,
    createCustomers: c.createCustomers,
    lastCheckedAt: c.lastCheckedAt,
    lastError: c.lastError,
    /** Set by environment variables with this prefix: read-only here */
    environmentPrefix: c.fromEnvironment ? envPrefix(projectKey) : null,
  };
}

/** Has everything needed to read the mailbox. */
function ready(c: Channel) {
  return !!(c.imapHost && c.imapUser && (c.fromEnvironment ? envPassword(c.project.key) : c.imapPassword));
}

function setByEnvironment(key: string) {
  return new BadRequestException(
    `${key}'s email is set by the ${envPrefix(key)}* environment variables. Change them where the server is hosted (e.g. Render → Environment); they apply when it restarts.`,
  );
}

function toIncoming(parsed: ParsedMail, source: Buffer): IncomingMail {
  const from = parsed.from?.value[0];
  const header = (name: string) => {
    const v = parsed.headers.get(name);
    return v === undefined ? '' : String(typeof v === 'object' && v && 'value' in v ? v.value : v).toLowerCase();
  };
  const sender = from?.address?.toLowerCase() ?? null;
  const automatic = (header('auto-submitted') !== '' && header('auto-submitted') !== 'no')
    || ['bulk', 'junk', 'list', 'auto_reply'].includes(header('precedence'))
    || parsed.headers.has('x-autoreply') || parsed.headers.has('x-autorespond') || parsed.headers.has('list-id')
    || /^(mailer-daemon|postmaster)@/.test(sender ?? '');
  return {
    messageId: parsed.messageId ?? createHash('sha256').update(source).digest('hex'),
    fromEmail: sender,
    fromName: from?.name || null,
    subject: parsed.subject ?? '',
    text: parsed.text ?? '',
    // Images embedded in the body (e.g. signature logos) aren't attachments.
    attachments: parsed.attachments
      .filter((a) => !a.related || a.contentDisposition === 'attachment')
      .map((a, i) => ({ filename: a.filename || `attachment-${i + 1}`, contentType: a.contentType || 'application/octet-stream', content: a.content })),
    automatic,
  };
}

const fits = (a: { content: Buffer }) => a.content.length <= MAX_ATTACHMENT_BYTES;

function skippedNote(attachments: { filename: string; content: Buffer }[]) {
  const skipped = attachments.filter((a) => !fits(a));
  return skipped.length ? `Attachments over 20 MB were left out: ${skipped.map((a) => a.filename).join(', ')}` : null;
}

/**
 * Just the new text of a reply: drops the quoted earlier message that mail clients append
 * ("On … wrote:", Outlook's "From: …" header block or "Original Message" line, and "> " lines).
 */
export function stripQuotedReply(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(line)) break;
    if (/^_{10,}$/.test(line)) break;
    if (/^on\b.+\bwrote:$/i.test(line) || (/^on\b/i.test(line) && /\bwrote:$/i.test(`${line} ${lines[i + 1]?.trim() ?? ''}`))) break;
    if (/^from:\s.+/i.test(line) && lines.slice(i + 1, i + 5).some((l) => /^(sent|date|to|subject):\s/i.test(l.trim()))) break;
    if (line.startsWith('>')) continue;
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** IMAP errors in words an admin can act on. */
function friendlyError(e: unknown, channel: EmailChannel): string {
  const err = e as Error & { code?: string; authenticationFailed?: boolean; responseText?: string; mailboxMissing?: boolean };
  if (err.authenticationFailed) return 'The mail server rejected the user name or password';
  switch (err.code) {
    case 'ENOTFOUND': case 'EAI_AGAIN': return `Mail server ${channel.imapHost} not found`;
    case 'ECONNREFUSED': return `${channel.imapHost} refused the connection on port ${channel.imapPort}`;
    case 'ETIMEDOUT': case 'ConnectionTimeout': case 'GreetingTimeout': return `No answer from ${channel.imapHost}:${channel.imapPort} (check the port and the TLS setting)`;
    case 'NoConnection': return `Could not connect to ${channel.imapHost}:${channel.imapPort}`;
    default: break;
  }
  if (err.mailboxMissing || /nonexistent|doesn't exist|not exist|(unknown|invalid|no such) (mailbox|folder)/i.test(err.responseText ?? '')) return `There is no folder called ${channel.imapFolder}`;
  return err.responseText || err.message || 'Could not read the mailbox';
}
