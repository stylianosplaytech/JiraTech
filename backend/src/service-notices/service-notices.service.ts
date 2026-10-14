import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { EmailStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { MailerService } from '../mail/mailer.service';
import { RecipientGroupsService, RecipientRef } from '../recipient-groups/recipient-groups.service';
import { Address, formatAddress, parseAddresses } from '../issue-email/email-html';
import { dedupe, describe } from '../issue-email/issue-email.service';
import { NoticeTemplateDto, SendNoticeDto } from './dto';
import { STARTER_TEMPLATES, normalizeContent, parseContent } from './notice-content';
import { renderNoticeHtml, renderNoticeText } from './notice-html';

const TEMPLATE_INCLUDE = { createdBy: { select: { id: true, name: true } } } satisfies Prisma.NoticeTemplateInclude;
const NOTICE_INCLUDE = {
  sentBy: { select: { id: true, name: true } },
  template: { select: { id: true, name: true } },
} satisfies Prisma.ServiceNoticeInclude;

type TemplateRow = Prisma.NoticeTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;
type NoticeRow = Prisma.ServiceNoticeGetPayload<{ include: typeof NOTICE_INCLUDE }>;

/** How many sent notices the history lists. */
const HISTORY = 200;

/**
 * Service notices: maintenance reminders, incident notifications and the like, emailed to customers, organizations
 * and recipient groups from a template whose every text can be changed before sending. Staff send them; global
 * admins manage the templates.
 */
@Injectable()
export class ServiceNoticesService implements OnModuleInit {
  private readonly logger = new Logger(ServiceNoticesService.name);

  constructor(private prisma: PrismaService, private mailer: MailerService, private recipientGroups: RecipientGroupsService) {}

  /** A new installation gets the starter templates (once: deleting them all later doesn't bring them back). */
  async onModuleInit() {
    const [templates, notices] = await Promise.all([this.prisma.noticeTemplate.count(), this.prisma.serviceNotice.count()]);
    if (templates || notices) return;
    for (const t of STARTER_TEMPLATES) {
      await this.prisma.noticeTemplate.create({ data: { name: t.name, description: t.description, subject: t.subject, content: JSON.stringify(t.content) } });
    }
    this.logger.log(`Added ${STARTER_TEMPLATES.length} starter service notice templates`);
  }

  // ─── Templates ─────────────────────────────────────────────────────────────

  async templates() {
    const rows = await this.prisma.noticeTemplate.findMany({ include: TEMPLATE_INCLUDE, orderBy: { name: 'asc' } });
    return rows.map(serializeTemplate);
  }

  async template(id: string) {
    return serializeTemplate(await this.findTemplate(id));
  }

  async createTemplate(user: AuthUser, dto: NoticeTemplateDto) {
    requireAdmin(user);
    const row = await this.unique(dto.name, () => this.prisma.noticeTemplate.create({
      data: { ...templateFields(dto), createdById: user.id },
      include: TEMPLATE_INCLUDE,
    }));
    return serializeTemplate(row);
  }

  async updateTemplate(user: AuthUser, id: string, dto: NoticeTemplateDto) {
    requireAdmin(user);
    await this.findTemplate(id);
    const row = await this.unique(dto.name, () => this.prisma.noticeTemplate.update({ where: { id }, data: templateFields(dto), include: TEMPLATE_INCLUDE }));
    return serializeTemplate(row);
  }

  async removeTemplate(user: AuthUser, id: string) {
    requireAdmin(user);
    await this.findTemplate(id);
    // Notices already sent from it keep their content.
    await this.prisma.noticeTemplate.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Notices ───────────────────────────────────────────────────────────────

  /** Exactly what the email will look like. */
  preview(raw: Record<string, unknown>) {
    return { html: renderNoticeHtml(normalizeContent(raw)) };
  }

  async list() {
    const rows = await this.prisma.serviceNotice.findMany({ include: NOTICE_INCLUDE, orderBy: { createdAt: 'desc' }, take: HISTORY });
    return rows.map((n) => {
      const { html: _html, content: _content, ...rest } = serializeNotice(n);
      return rest;
    });
  }

  async get(id: string) {
    return serializeNotice(await this.findNotice(id));
  }

  async send(user: AuthUser, dto: SendNoticeDto) {
    const content = normalizeContent(dto.content);
    const subject = dto.subject.replace(/\s+/g, ' ').trim();
    if (!subject) throw new BadRequestException('Give the notice a subject');
    const html = renderNoticeHtml(content);
    const text = renderNoticeText(content);

    if (dto.test) {
      const error = await this.mailer.sendReporting({ to: formatAddress({ email: user.email, name: user.name }), subject: `[Test] ${subject}`, html, text });
      if (error) throw new BadRequestException(error);
      return { test: true, to: user.email };
    }

    const template = dto.templateId ? await this.prisma.noticeTemplate.findUnique({ where: { id: dto.templateId }, select: { id: true } }) : null;
    // Groups and organizations become their members now; someone also picked on their own keeps that (they come first).
    const [toGroups, ccGroups, bccGroups] = await Promise.all([dto.toGroups, dto.ccGroups, dto.bccGroups]
      .map((refs) => (refs?.length ? this.recipientGroups.expand(refs) : Promise.resolve([] as Address[]))));
    const to = dedupe([...(dto.to ?? []), ...toGroups]);
    const cc = dedupe([...(dto.cc ?? []), ...ccGroups], to);
    const bcc = dedupe([...(dto.bcc ?? []), ...bccGroups], [...to, ...cc]);
    if (!to.length && !cc.length && !bcc.length) {
      const picked = [dto.toGroups, dto.ccGroups, dto.bccGroups].some((g) => g?.length);
      throw new BadRequestException(picked ? 'Nobody is in the groups or organizations you picked' : 'Add at least one recipient');
    }
    const groups = { to: refs(dto.toGroups), cc: refs(dto.ccGroups), bcc: refs(dto.bccGroups) };

    const notice = await this.prisma.serviceNotice.create({
      data: {
        templateId: template?.id ?? null,
        subject,
        content: JSON.stringify(content),
        html,
        text,
        to: JSON.stringify(to),
        cc: JSON.stringify(cc),
        bcc: JSON.stringify(bcc),
        groups: JSON.stringify(groups),
        sentById: user.id,
      },
      include: NOTICE_INCLUDE,
    });
    return this.deliver(notice);
  }

  async retry(id: string) {
    const notice = await this.findNotice(id);
    if (notice.status !== EmailStatus.FAILED) throw new BadRequestException('Only notices that could not be sent can be sent again');
    return this.deliver(notice);
  }

  private async deliver(notice: NoticeRow) {
    const to = parseAddresses(notice.to);
    const error = await this.mailer.sendReporting({
      // Sent only to Bcc, it still needs a To: our own address, as mail clients do for "undisclosed recipients".
      to: to.length ? to.map(formatAddress).join(', ') : this.mailer.fromAddress(),
      cc: parseAddresses(notice.cc).map(formatAddress),
      bcc: parseAddresses(notice.bcc).map(formatAddress),
      subject: notice.subject,
      html: notice.html,
      text: notice.text,
    });
    const saved = await this.prisma.serviceNotice.update({
      where: { id: notice.id },
      data: { status: error ? EmailStatus.FAILED : EmailStatus.SENT, error },
      include: NOTICE_INCLUDE,
    });
    return serializeNotice(saved);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async findTemplate(id: string) {
    const row = await this.prisma.noticeTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
    if (!row) throw new NotFoundException('Template not found');
    return row;
  }

  private async findNotice(id: string) {
    const row = await this.prisma.serviceNotice.findUnique({ where: { id }, include: NOTICE_INCLUDE });
    if (!row) throw new NotFoundException('Notice not found');
    return row;
  }

  private async unique<T>(name: string, fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A template called ${name.trim()} already exists`);
      }
      throw e;
    }
  }
}

function requireAdmin(user: AuthUser) {
  if (user.role !== UserRole.ADMIN) throw new ForbiddenException('Only administrators can manage service notice templates');
}

function templateFields(dto: NoticeTemplateDto) {
  const name = dto.name.trim();
  if (!name) throw new BadRequestException('Give the template a name');
  return {
    name,
    description: dto.description?.trim() || null,
    subject: dto.subject.replace(/\s+/g, ' ').trim(),
    content: JSON.stringify(normalizeContent(dto.content)),
  };
}

const refs = (list?: RecipientRef[]) => (list ?? []).map(({ type, id }) => ({ type, id }));

function parseGroups(json: string): { to: RecipientRef[]; cc: RecipientRef[]; bcc: RecipientRef[] } {
  try {
    const g = JSON.parse(json || '{}');
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((r) => r && (r.type === 'group' || r.type === 'organization') && typeof r.id === 'string') : []);
    return { to: list(g.to), cc: list(g.cc), bcc: list(g.bcc) };
  } catch {
    return { to: [], cc: [], bcc: [] };
  }
}

function serializeTemplate(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    subject: t.subject,
    content: parseContent(t.content),
    createdBy: t.createdBy,
    updatedAt: t.updatedAt,
  };
}

function serializeNotice(n: NoticeRow) {
  const to = parseAddresses(n.to);
  const cc = parseAddresses(n.cc);
  const bcc = parseAddresses(n.bcc);
  return {
    id: n.id,
    subject: n.subject,
    template: n.template,
    content: parseContent(n.content),
    html: n.html,
    to,
    cc,
    bcc,
    groups: parseGroups(n.groups),
    /** "Acme (12), Erin": who it went to, in a few words */
    summary: describe([...to, ...cc, ...bcc]),
    recipientCount: to.length + cc.length + bcc.length,
    status: n.status,
    error: n.error,
    sentBy: n.sentBy,
    createdAt: n.createdAt,
  };
}
