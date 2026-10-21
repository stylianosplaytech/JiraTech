import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, WebhookDeliveryStatus } from '@prisma/client';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../common/auth-user';
import { open, seal } from '../common/secret-box';
import { toPlainText } from '../common/rich-text';
import { resolveProject } from '../common/project.util';
import { SearchService } from '../search/search.service';
import { IssueChange, IssueEventsService } from '../events/issue-events.service';
import { WEBHOOK_FORMATS, WebhookFormat, chatBody, isChatFormat } from './chat-format';
import { PING_EVENT, WEBHOOK_EVENTS, WebhookEvent } from './webhook-events';
import { parseWebhookUrl, postJson } from './webhook-network';

/** Waits before the 2nd, 3rd… attempt: a delivery is tried 6 times over about 8 hours. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** A webhook that failed this many attempts in a row is switched off. */
const DISABLE_AFTER_FAILURES = 30;
const WORKER_SECONDS = 15;
const KEEP_DAYS = 14;
/** Webhooks for every project (global admins), and per project (its admins). */
const MAX_WEBHOOKS = 50;
const MAX_PER_PROJECT = 20;

export interface WebhookInput {
  name: string;
  url: string;
  events: string[];
  /** A project key; empty or missing = every project */
  projectKey?: string | null;
  active?: boolean;
  /** JSON (default), SLACK or TEAMS */
  format?: string;
  /** Only issues matching this JQL are sent */
  jql?: string | null;
}

type WebhookRow = Prisma.WebhookGetPayload<{ include: { project: { select: { id: true; key: true; name: true } } } }>;

function parseEvents(json: string): WebhookEvent[] {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? WEBHOOK_EVENTS.filter((e) => list.includes(e)) : [];
  } catch {
    return [];
  }
}

/** What the API shows of a webhook: never its secret. */
function present(w: WebhookRow) {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    events: parseEvents(w.events),
    format: w.format as WebhookFormat,
    jql: w.jql,
    project: w.project,
    active: w.active,
    failureCount: w.failureCount,
    disabledReason: w.disabledReason,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastPurge = 0;
  /** Deliveries being sent right now, so the retry worker never sends one twice at once. */
  private readonly sending = new Set<string>();

  constructor(private prisma: PrismaService, private mailer: MailerService, private events: IssueEventsService, private access: AccessService, private search: SearchService) {}

  onModuleInit() {
    if (process.env.WEBHOOK_WORKER === 'false') {
      this.logger.log('WEBHOOK_WORKER=false: failed webhook deliveries are not retried by this process');
      return;
    }
    this.timer = setInterval(() => void this.tick(), WORKER_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Managing webhooks (global admins; project admins for their own projects) ─────

  private readonly include = { project: { select: { id: true, key: true, name: true } } } as const;

  async list(user: AuthUser) {
    const ids = await this.access.adminProjectIds(user);
    const rows = await this.prisma.webhook.findMany({
      where: ids === null ? {} : { projectId: { in: ids } },
      include: this.include,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(present);
  }

  async get(id: string, user: AuthUser) {
    return present(await this.find(id, user));
  }

  async create(input: WebhookInput, user: AuthUser) {
    const data = await this.validate(input, user);
    const cap = data.projectId ? MAX_PER_PROJECT : MAX_WEBHOOKS;
    if ((await this.prisma.webhook.count({ where: { projectId: data.projectId } })) >= cap) {
      throw new BadRequestException(`${data.projectId ? 'A project' : 'Everything that applies to every project'} can have up to ${cap} webhooks`);
    }
    const secret = newSecret();
    const row = await this.prisma.webhook.create({
      data: { ...data, secret: seal(secret), createdById: user.id },
      include: this.include,
    });
    // The only time the secret is shown (rotate it for a new one).
    return { ...present(row), secret };
  }

  async update(id: string, input: WebhookInput, user: AuthUser) {
    const before = await this.find(id, user);
    const data = await this.validate(input, user);
    const enabling = (input.active ?? before.active) && !before.active;
    const row = await this.prisma.webhook.update({
      where: { id },
      data: { ...data, ...(enabling ? { failureCount: 0, disabledReason: null } : {}) },
      include: this.include,
    });
    return present(row);
  }

  async remove(id: string, user: AuthUser) {
    await this.find(id, user);
    await this.prisma.webhook.delete({ where: { id } });
    return { deleted: true };
  }

  async rotateSecret(id: string, user: AuthUser) {
    await this.find(id, user);
    const secret = newSecret();
    const row = await this.prisma.webhook.update({ where: { id }, data: { secret: seal(secret) }, include: this.include });
    return { ...present(row), secret };
  }

  async deliveries(id: string, user: AuthUser, limit = 50) {
    await this.find(id, user);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map(({ payload, ...d }) => ({ ...d, payload: this.parsePayload(payload) }));
  }

  /** Sends a sample event right away so admins can check their endpoint. */
  async test(id: string, user: AuthUser) {
    const webhook = await this.find(id, user);
    const payload = JSON.stringify({
      id: randomUUID(),
      event: PING_EVENT,
      createdAt: new Date().toISOString(),
      message: `Test event from Conductor for the webhook "${webhook.name}"`,
    });
    const delivery = await this.prisma.webhookDelivery.create({
      data: { webhookId: id, event: PING_EVENT, payload, nextAttemptAt: new Date() },
    });
    return this.attemptAndShow(delivery.id);
  }

  /** Sends a delivery's event again (a fresh delivery with the same payload). */
  async redeliver(id: string, deliveryId: string, user: AuthUser) {
    await this.find(id, user);
    const old = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, webhookId: id } });
    if (!old) throw new NotFoundException('Delivery not found');
    const delivery = await this.prisma.webhookDelivery.create({
      data: { webhookId: id, event: old.event, payload: old.payload, nextAttemptAt: new Date() },
    });
    return this.attemptAndShow(delivery.id);
  }

  private async attemptAndShow(deliveryId: string) {
    await this.attempt(deliveryId, { manual: true });
    const row = await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    return { ...row, payload: this.parsePayload(row.payload) };
  }

  private parsePayload(json: string): unknown {
    try {
      return JSON.parse(json);
    } catch {
      return json;
    }
  }

  /** A webhook the user may manage; anything else (including other projects') is "not found". */
  private async find(id: string, user: AuthUser) {
    const row = await this.prisma.webhook.findUnique({ where: { id }, include: this.include });
    if (!row || !(await this.access.canManage(user, row.projectId))) throw new NotFoundException('Webhook not found');
    return row;
  }

  private async validate(input: WebhookInput, user: AuthUser) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Give the webhook a name');
    const url = parseWebhookUrl(input.url).toString();
    const format = (input.format ?? 'JSON') as WebhookFormat;
    if (!WEBHOOK_FORMATS.includes(format)) throw new BadRequestException(`Unknown format ${input.format}`);
    const events = WEBHOOK_EVENTS.filter((e) => input.events?.includes(e));
    // A chat webhook may have no events: then it only speaks when an automation rule posts to it.
    if (!events.length && !isChatFormat(format)) throw new BadRequestException('Choose at least one event');
    const unknown = (input.events ?? []).filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (unknown.length) throw new BadRequestException(`Unknown event: ${unknown.join(', ')}`);
    const projectId = input.projectKey?.trim() ? (await resolveProject(this.prisma, input.projectKey)).id : null;
    await this.access.requireManage(user, projectId);
    const jql = input.jql?.trim() || null;
    if (jql) this.search.validate(jql, user);
    return { name, url, events: JSON.stringify(events), format, jql, projectId, active: input.active ?? true };
  }

  // ─── Events (called by the services that change issues, after their changes are committed) ─────

  /**
   * An issue event: tells the rest of the app (automation rules), then queues the webhook deliveries with a payload built
   * from the issue as it is now. Never throws, so it can't fail the action.
   */
  async issueEvent(
    event: WebhookEvent,
    issueId: string,
    actorId: string | null,
    extra: { changes?: IssueChange[]; commentId?: string } = {},
  ) {
    this.events.emit({ event, issueId, actorId, ...extra });
    try {
      const issue = await this.prisma.issue.findUnique({ where: { id: issueId }, select: { projectId: true } });
      if (!issue) return;
      const targets = await this.targets(event, issue.projectId, issueId);
      if (!targets.length) return;
      await this.enqueue(targets, event, await this.payload(event, issueId, actorId, extra));
    } catch (err) {
      this.logger.warn(`Webhook event ${event} for issue ${issueId} was not queued: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** For deletions the issue is gone by the time the action is done, so describe it first with this. */
  async snapshot(issueId: string, actorId: string | null) {
    try {
      const issue = await this.prisma.issue.findUnique({ where: { id: issueId }, select: { projectId: true } });
      if (!issue) return null;
      // Who gets it is decided now: once the issue is gone a webhook's JQL filter can't be checked.
      const targets = await this.targets('issue.deleted', issue.projectId, issueId);
      if (!targets.length) return null;
      return { projectId: issue.projectId, targets, payload: await this.payload('issue.deleted', issueId, actorId, {}) };
    } catch (err) {
      this.logger.warn(`Webhook snapshot of issue ${issueId} failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async deleted(snapshot: { projectId: string; targets: string[]; payload: Record<string, unknown> } | null) {
    if (!snapshot) return;
    try {
      await this.enqueue(snapshot.targets, 'issue.deleted', snapshot.payload);
    } catch (err) {
      this.logger.warn(`Webhook event issue.deleted was not queued: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Active webhooks in this project (or in all projects) that want this event, and whose JQL filter (if any) the issue
   * matches: the filter is checked as the webhook's author, so it sees what they see.
   */
  private async targets(event: WebhookEvent, projectId: string, issueId: string) {
    const rows = await this.prisma.webhook.findMany({
      where: { active: true, OR: [{ projectId: null }, { projectId }] },
      select: { id: true, name: true, events: true, jql: true, createdBy: { select: { id: true, email: true, name: true, role: true } } },
    });
    const out: string[] = [];
    for (const w of rows.filter((r) => parseEvents(r.events).includes(event))) {
      if (!w.jql) {
        out.push(w.id);
        continue;
      }
      // Without an author the filter can't be checked: better quiet than sending what it was meant to hold back.
      if (!w.createdBy) continue;
      try {
        if (await this.search.matches(w.jql, issueId, w.createdBy)) out.push(w.id);
      } catch (err) {
        this.logger.warn(`Webhook "${w.name}": its filter could not be checked: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  }

  /**
   * A message from an automation rule for a chat webhook (Slack or Teams). The rule's author must be someone who may manage
   * that webhook, so a project administrator can't speak into a channel that isn't theirs. Delivery is queued like any other.
   */
  async postMessage(webhookId: string, author: AuthUser, text: string, issueId: string) {
    const hook = await this.prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!hook || !(await this.access.canManage(author, hook.projectId))) throw new Error('That chat webhook no longer exists, or you may not use it');
    if (!isChatFormat(hook.format)) throw new Error(`${hook.name} is not a Slack or Teams webhook`);
    if (!hook.active) throw new Error(`${hook.name} is switched off`);
    await this.enqueue([hook.id], 'automation.message', await this.payload('automation.message', issueId, author.id, { text }));
    return hook.name;
  }

  private async payload(event: string, issueId: string, actorId: string | null, extra: { changes?: IssueChange[]; commentId?: string; text?: string }) {
    const [issue, actor, comment] = await Promise.all([
      this.prisma.issue.findUniqueOrThrow({
        where: { id: issueId },
        include: {
          project: { select: { id: true, key: true, name: true } },
          workflowStatus: { select: { name: true, category: true } },
          assignee: { select: { id: true, name: true, email: true } },
          reporter: { select: { id: true, name: true, email: true } },
          parent: { select: { key: true } },
          sprint: { select: { name: true } },
          labels: { select: { label: { select: { name: true } } } },
          components: { select: { component: { select: { name: true } } } },
          versions: { select: { isFix: true, version: { select: { name: true } } } },
        },
      }),
      actorId ? this.prisma.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, email: true } }) : null,
      extra.commentId
        ? this.prisma.comment.findUnique({ where: { id: extra.commentId }, include: { author: { select: { id: true, name: true, email: true } } } })
        : null,
    ]);
    const body: Record<string, unknown> = {
      id: randomUUID(),
      event,
      createdAt: new Date().toISOString(),
      actor,
      project: issue.project,
      issue: {
        id: issue.id,
        key: issue.key,
        url: `${this.mailer.appUrl()}/browse/${issue.key}`,
        type: issue.type,
        summary: issue.summary,
        description: toPlainText(issue.description),
        status: issue.workflowStatus?.name ?? issue.status,
        statusCategory: issue.workflowStatus?.category ?? issue.status,
        resolution: issue.resolution,
        priority: issue.priority,
        blocked: issue.blocked,
        assignee: issue.assignee,
        reporter: issue.reporter,
        parentKey: issue.parent?.key ?? null,
        sprint: issue.sprint?.name ?? null,
        labels: issue.labels.map((l) => l.label.name),
        components: issue.components.map((c) => c.component.name),
        fixVersions: issue.versions.filter((v) => v.isFix).map((v) => v.version.name),
        affectsVersions: issue.versions.filter((v) => !v.isFix).map((v) => v.version.name),
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      },
    };
    if (extra.changes?.length) body.changes = extra.changes;
    if (extra.text) body.text = extra.text;
    if (comment) {
      body.comment = {
        id: comment.id,
        author: comment.author,
        body: toPlainText(comment.body),
        html: comment.body,
        internal: comment.internal,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      };
    }
    return body;
  }

  private async enqueue(webhookIds: string[], event: string, payload: Record<string, unknown>) {
    if (!webhookIds.length) return;
    const json = JSON.stringify(payload);
    const now = new Date();
    for (const webhookId of webhookIds) {
      const delivery = await this.prisma.webhookDelivery.create({ data: { webhookId, event, payload: json, nextAttemptAt: now } });
      // Sent in the background: the person who made the change isn't kept waiting for someone else's server.
      void this.attempt(delivery.id);
    }
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  /** One attempt at a delivery; records how it went and schedules the retry. Never throws. */
  private async attempt(deliveryId: string, opts: { manual?: boolean } = {}) {
    if (this.sending.has(deliveryId)) return;
    this.sending.add(deliveryId);
    try {
      const delivery = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
      if (!delivery || delivery.status !== WebhookDeliveryStatus.PENDING) return;
      const { webhook } = delivery;
      if (!webhook.active && !opts.manual) {
        await this.prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: { status: WebhookDeliveryStatus.FAILED, nextAttemptAt: null, error: 'The webhook is switched off' },
        });
        return;
      }

      const attempts = delivery.attempts + 1;
      let responseStatus: number | null = null;
      let durationMs: number | null = null;
      let error: string | null = null;
      try {
        const headers: Record<string, string> = {
          'User-Agent': 'Conductor-Webhooks/1',
          'X-Conductor-Event': delivery.event,
          'X-Conductor-Delivery': delivery.id,
        };
        let body = delivery.payload;
        if (isChatFormat(webhook.format)) {
          // Slack and Teams take a message, not a signed event.
          body = JSON.stringify(chatBody(webhook.format, this.parsePayload(delivery.payload)));
        } else {
          const secret = open(webhook.secret);
          if (!secret) throw new Error('The signing secret cannot be decrypted (the server secret changed): rotate the webhook secret');
          const timestamp = Math.floor(Date.now() / 1000).toString();
          headers['X-Conductor-Timestamp'] = timestamp;
          headers['X-Conductor-Signature'] = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
        }
        const result = await postJson(parseWebhookUrl(webhook.url), body, headers);
        responseStatus = result.status;
        durationMs = result.durationMs;
        if (result.status < 200 || result.status >= 300) {
          error = result.status >= 300 && result.status < 400
            ? `The server answered ${result.status} (redirects are not followed): use the final address`
            : `The server answered ${result.status}${result.body ? `: ${result.body}` : ''}`;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      if (!error) {
        await this.prisma.$transaction([
          this.prisma.webhookDelivery.update({
            where: { id: deliveryId },
            data: { status: WebhookDeliveryStatus.SUCCESS, attempts, responseStatus, durationMs, error: null, nextAttemptAt: null, deliveredAt: new Date() },
          }),
          this.prisma.webhook.update({ where: { id: webhook.id }, data: { failureCount: 0 } }),
        ]);
        return;
      }

      // A manual "Send test" is one try, not a retried delivery.
      const final = opts.manual || attempts >= MAX_ATTEMPTS;
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: final ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.PENDING,
          attempts, responseStatus, durationMs, error,
          nextAttemptAt: final ? null : new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]),
        },
      });
      const failures = webhook.failureCount + 1;
      const disable = failures >= DISABLE_AFTER_FAILURES && webhook.active;
      await this.prisma.webhook.update({
        where: { id: webhook.id },
        data: {
          failureCount: failures,
          ...(disable ? { active: false, disabledReason: `Switched off automatically after ${failures} failed attempts in a row. Last error: ${error}` } : {}),
        },
      });
      if (disable) this.logger.warn(`Webhook "${webhook.name}" switched off after ${failures} failed attempts`);
    } catch (err) {
      this.logger.warn(`Webhook delivery ${deliveryId} could not be recorded: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.sending.delete(deliveryId);
    }
  }

  /** Retries what is due (also picks up deliveries left pending by a restart), and tidies old log entries. */
  private async tick() {
    try {
      const due = await this.prisma.webhookDelivery.findMany({
        where: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: 25,
        select: { id: true },
      });
      await Promise.all(due.map((d) => this.attempt(d.id)));

      if (Date.now() - this.lastPurge > 3_600_000) {
        this.lastPurge = Date.now();
        await this.prisma.webhookDelivery.deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) }, status: { not: WebhookDeliveryStatus.PENDING } },
        });
      }
    } catch (err) {
      this.logger.warn(`Webhook worker: ${err instanceof Error ? err.message : err}`);
    }
  }
}
