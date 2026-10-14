import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InboundStatus, IssueStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { AccessService } from '../access/access.service';
import { IssuesService } from '../issues/issues.service';
import { AuthUser } from '../common/auth-user';
import { resolveProject } from '../common/project.util';
import { toPlainText } from '../common/rich-text';
import {
  DEFAULT_CONFIG, InboundConfig, asText, escapeHtml, lookup, parseConfig, priorityFromWord, render, textToHtml,
} from './inbound-config';

/** Every incoming webhook address ends in a token that starts with this. */
const TOKEN_PREFIX = 'jth_';
const MAX_HOOKS = 50;
const MAX_PER_PROJECT = 20;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const KEEP_DAYS = 14;
const STORED_PAYLOAD_CHARS = 20_000;
const PAYLOAD_IN_ISSUE_CHARS = 4000;

export interface InboundInput {
  name: string;
  projectKey: string;
  enabled?: boolean;
}

type HookRow = Prisma.InboundWebhookGetPayload<{
  include: { project: { select: { id: true; key: true; name: true } }; createdBy: { select: { id: true; name: true; email: true; role: true } } };
}>;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function parseConfigJson(json: string): InboundConfig {
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(json) as Partial<InboundConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function present(h: HookRow) {
  return {
    id: h.id,
    name: h.name,
    project: h.project,
    enabled: h.enabled,
    tokenPrefix: h.tokenPrefix,
    config: parseConfigJson(h.config),
    receivedCount: h.receivedCount,
    lastReceivedAt: h.lastReceivedAt,
    createdBy: h.createdBy ? { id: h.createdBy.id, name: h.createdBy.name } : null,
    createdAt: h.createdAt,
  };
}

/** What a payload would do, worked out before anything is changed. */
interface Plan {
  action: 'create' | 'comment' | 'resolve' | 'ignore';
  summary: string;
  description: string;
  priority: string;
  dedupeKey: string | null;
  existing: { id: string; key: string } | null;
}

@Injectable()
export class InboundWebhooksService {
  private readonly logger = new Logger(InboundWebhooksService.name);
  private readonly recent = new Map<string, number[]>();
  private lastPurge = 0;

  constructor(private prisma: PrismaService, private mailer: MailerService, private issues: IssuesService, private access: AccessService) {}

  private readonly include = {
    project: { select: { id: true, key: true, name: true } },
    createdBy: { select: { id: true, name: true, email: true, role: true } },
  } as const;

  // ─── Managing incoming webhooks (project admins for their projects; global admins for all) ─────

  async list(user: AuthUser) {
    const ids = await this.access.adminProjectIds(user);
    const rows = await this.prisma.inboundWebhook.findMany({
      where: ids === null ? {} : { projectId: { in: ids } },
      include: this.include,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(present);
  }

  async create(input: InboundInput, user: AuthUser) {
    const data = await this.validate(input, user);
    if ((await this.prisma.inboundWebhook.count({ where: { projectId: data.projectId } })) >= MAX_PER_PROJECT || (await this.prisma.inboundWebhook.count()) >= MAX_HOOKS) {
      throw new BadRequestException(`A project can have up to ${MAX_PER_PROJECT} incoming webhooks (and ${MAX_HOOKS} in all)`);
    }
    const token = this.newToken();
    const row = await this.prisma.inboundWebhook.create({
      data: { ...data, ...this.tokenFields(token), createdById: user.id },
      include: this.include,
    });
    // The only time the address can be shown (rotate it for a new one).
    return { ...present(row), url: this.url(token) };
  }

  /** Saving makes the person saving it the author: issues are created as them from now on. */
  async update(id: string, input: InboundInput, user: AuthUser) {
    await this.find(id, user);
    const data = await this.validate(input, user);
    return present(await this.prisma.inboundWebhook.update({ where: { id }, data: { ...data, createdById: user.id }, include: this.include }));
  }

  async remove(id: string, user: AuthUser) {
    await this.find(id, user);
    await this.prisma.inboundWebhook.delete({ where: { id } });
    return { deleted: true };
  }

  async rotateToken(id: string, user: AuthUser) {
    await this.find(id, user);
    const token = this.newToken();
    const row = await this.prisma.inboundWebhook.update({ where: { id }, data: this.tokenFields(token), include: this.include });
    return { ...present(row), url: this.url(token) };
  }

  async deliveries(id: string, user: AuthUser, limit = 50) {
    await this.find(id, user);
    return this.prisma.inboundDelivery.findMany({
      where: { hookId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  /** What a sample payload would do, without doing it. */
  async test(id: string, user: AuthUser, payload: unknown) {
    const hook = await this.find(id, user);
    const body = this.asObject(payload);
    const config = parseConfigJson(hook.config);
    const plan = await this.plan(hook, config, body);
    const assignee = config.assigneeId ? await this.prisma.user.findUnique({ where: { id: config.assigneeId }, select: { name: true } }) : null;
    return {
      action: plan.action,
      issueType: config.issueType,
      summary: plan.summary,
      description: plan.description,
      priority: plan.priority,
      labels: config.labels,
      assignee: assignee?.name ?? null,
      dedupeKey: plan.dedupeKey,
      existingKey: plan.existing?.key ?? null,
    };
  }

  /** A webhook the user may manage; anything else (including other projects') is "not found". */
  private async find(id: string, user: AuthUser) {
    const hook = await this.prisma.inboundWebhook.findUnique({ where: { id }, include: this.include });
    if (!hook || !(await this.access.canManage(user, hook.projectId))) throw new NotFoundException('Incoming webhook not found');
    return hook;
  }

  private newToken() {
    return TOKEN_PREFIX + randomBytes(24).toString('base64url');
  }

  private tokenFields(token: string) {
    return { tokenHash: hash(token), tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 4) };
  }

  private url(token: string) {
    return `${this.mailer.appUrl()}/api/hooks/${token}`;
  }

  private async validate(input: InboundInput, user: AuthUser) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Give the webhook a name');
    if (!input.projectKey?.trim()) throw new BadRequestException('Choose the project the issues go in');
    const project = await resolveProject(this.prisma, input.projectKey);
    await this.access.requireManage(user, project.id);
    const config = parseConfig(input as unknown as Record<string, unknown>);
    if (config.assigneeId && !(await this.prisma.user.findUnique({ where: { id: config.assigneeId }, select: { id: true } }))) {
      throw new BadRequestException('The person to assign to does not exist');
    }
    return { name: name.slice(0, 120), projectId: project.id, enabled: input.enabled ?? true, config: JSON.stringify(config) };
  }

  // ─── Receiving ─────────────────────────────────────────────────────────────

  /** Handles a request to the public address. Anything wrong with the token answers the same "not found". */
  async receive(token: string, body: unknown) {
    const hook = await this.prisma.inboundWebhook.findUnique({ where: { tokenHash: hash(token ?? '') }, include: this.include });
    if (!hook || !hook.enabled) throw new NotFoundException('Not found');

    const now = Date.now();
    const times = (this.recent.get(hook.id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (times.length >= RATE_LIMIT) throw new HttpException(`Too many requests: up to ${RATE_LIMIT} a minute`, HttpStatus.TOO_MANY_REQUESTS);
    this.recent.set(hook.id, [...times, now]);

    const record = async (status: InboundStatus, message: string | null, issueKey: string | null, dedupeKey: string | null) => {
      await this.prisma.$transaction([
        this.prisma.inboundDelivery.create({
          data: { hookId: hook.id, status, message, issueKey, dedupeKey, payload: JSON.stringify(body ?? null).slice(0, STORED_PAYLOAD_CHARS) },
        }),
        this.prisma.inboundWebhook.update({ where: { id: hook.id }, data: { receivedCount: { increment: 1 }, lastReceivedAt: new Date() } }),
      ]);
      void this.purge();
    };

    let plan: Plan | null = null;
    try {
      const payload = this.asObject(body);
      const author = hook.createdBy;
      if (!author) {
        await this.prisma.inboundWebhook.update({ where: { id: hook.id }, data: { enabled: false } });
        throw new BadRequestException('The person who set this webhook up no longer exists: open and save it in JiraTech to switch it back on');
      }
      const config = parseConfigJson(hook.config);
      plan = await this.plan(hook, config, payload);

      const outcome = await this.execute(hook, config, plan, payload, author);
      await record(outcome.status, outcome.message, outcome.issueKey, plan.dedupeKey);
      return { result: outcome.status.toLowerCase(), issueKey: outcome.issueKey };
    } catch (err) {
      const message = this.message(err);
      await record('FAILED', message, plan?.existing?.key ?? null, plan?.dedupeKey ?? null).catch(() => undefined);
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Incoming webhook "${hook.name}" failed: ${message}`);
      throw new BadRequestException(message);
    }
  }

  private async execute(hook: HookRow, config: InboundConfig, plan: Plan, payload: Record<string, unknown>, author: AuthUser) {
    const source = `<p><em>Received by the incoming webhook ${escapeHtml(hook.name)}.</em></p>`;
    const body = (extra: string) => textToHtml(plan.description) + extra + source;
    const payloadBlock = config.includePayload
      ? `<p><strong>Payload</strong></p><pre><code>${escapeHtml(JSON.stringify(payload, null, 2).slice(0, PAYLOAD_IN_ISSUE_CHARS))}</code></pre>`
      : '';

    switch (plan.action) {
      case 'ignore':
        return { status: InboundStatus.IGNORED, message: 'Resolved, but there is no open issue for this alert', issueKey: null };
      case 'comment':
        await this.issues.addComment(plan.existing!.id, author, textToHtml(plan.description || 'Received again.') + payloadBlock + source);
        return { status: InboundStatus.COMMENTED, message: null, issueKey: plan.existing!.key };
      case 'resolve':
        await this.issues.transition(plan.existing!.id, { status: IssueStatus.CLOSED, resolution: 'COMPLETED' }, author.id);
        await this.issues.addComment(plan.existing!.id, author, textToHtml(plan.description || 'Resolved.') + source);
        return { status: InboundStatus.RESOLVED, message: null, issueKey: plan.existing!.key };
      case 'create': {
        const labelIds: string[] = [];
        if (config.labels.length) {
          for (const name of config.labels) {
            const label = await this.prisma.label.upsert({ where: { projectId_name: { projectId: hook.projectId, name } }, update: {}, create: { name, projectId: hook.projectId } });
            labelIds.push(label.id);
          }
        }
        const issue = await this.issues.create(
          {
            type: config.issueType,
            summary: plan.summary,
            description: body(payloadBlock),
            priority: plan.priority as never,
            assigneeId: config.assigneeId ?? undefined,
            labelIds: labelIds.length ? labelIds : undefined,
            projectKey: hook.project.key,
          },
          author,
        );
        if (plan.dedupeKey) {
          await this.prisma.inboundLink.upsert({
            where: { hookId_dedupeKey: { hookId: hook.id, dedupeKey: plan.dedupeKey } },
            update: { issueId: issue.id },
            create: { hookId: hook.id, dedupeKey: plan.dedupeKey, issueId: issue.id },
          });
        }
        return { status: InboundStatus.CREATED, message: null, issueKey: issue.key };
      }
    }
  }

  /** Works out what a payload means for this webhook. Changes nothing. */
  private async plan(hook: HookRow, config: InboundConfig, payload: Record<string, unknown>): Promise<Plan> {
    const summary = (render(config.summary, payload).replace(/\s+/g, ' ').trim() || `Message from ${hook.name}`).slice(0, 200).padEnd(3, '.');
    const description = render(config.description, payload).trim();
    const priority = (config.priorityFrom ? priorityFromWord(render(config.priorityFrom, payload)) : null) ?? config.priority;
    const dedupeKey = config.dedupe ? render(config.dedupe, payload).trim() || null : null;
    const resolving = !!config.resolveWhen && !!dedupeKey
      && asText(lookup(payload, config.resolveWhen.path)).toLowerCase() === config.resolveWhen.equals.toLowerCase();

    let existing: Plan['existing'] = null;
    if (dedupeKey) {
      const link = await this.prisma.inboundLink.findUnique({ where: { hookId_dedupeKey: { hookId: hook.id, dedupeKey } } });
      const issue = link ? await this.prisma.issue.findUnique({ where: { id: link.issueId }, select: { id: true, key: true, status: true } }) : null;
      if (issue && issue.status !== IssueStatus.CLOSED) existing = { id: issue.id, key: issue.key };
    }
    const action = resolving ? (existing ? 'resolve' : 'ignore') : existing ? 'comment' : 'create';
    return { action, summary, description, priority, dedupeKey, existing };
  }

  private asObject(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Send a JSON object');
    return body as Record<string, unknown>;
  }

  private async purge() {
    if (Date.now() - this.lastPurge < 3_600_000) return;
    this.lastPurge = Date.now();
    try {
      await this.prisma.inboundDelivery.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
      const cutoff = Date.now() - RATE_WINDOW_MS;
      for (const [id, times] of this.recent) if (times.every((t) => t < cutoff)) this.recent.delete(id);
    } catch (err) {
      this.logger.warn(`Could not tidy incoming webhook log: ${this.message(err)}`);
    }
  }

  private message(err: unknown) {
    if (err && typeof err === 'object' && 'getResponse' in err) {
      const response = (err as { getResponse(): unknown }).getResponse();
      const m = typeof response === 'object' && response ? (response as { message?: unknown }).message : response;
      return Array.isArray(m) ? m.join(', ') : String(m);
    }
    return err instanceof Error ? err.message : String(err);
  }
}
