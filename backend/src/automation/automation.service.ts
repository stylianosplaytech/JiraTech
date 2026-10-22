import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AutomationRunStatus, Prisma, UserRole } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { MailerService } from '../mail/mailer.service';
import { SearchService } from '../search/search.service';
import { IssuesService } from '../issues/issues.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { isChatFormat } from '../webhooks/chat-format';
import { AuthUser } from '../common/auth-user';
import { issueRef } from '../common/issue-ref';
import { resolveProject } from '../common/project.util';
import { toPlainText } from '../common/rich-text';
import { IssueEvent, IssueEventsService } from '../events/issue-events.service';
import {
  Action, TriggerConfig, TriggerEvent, TRIGGER_EVENTS, describe, fill, parseActions, parseTrigger,
} from './automation-actions';
import { describeSchedule, nextRun } from './automation-schedule';
import { calendarDay, dueDateText } from '../common/due-date';

/** A rule's actions can trigger other rules, but only this many steps deep. */
const MAX_DEPTH = 3;
/** The same rule on the same issue more than this often within the window looks like a loop. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
/** Rules for every project (global admins), and per project (its admins). */
const MAX_RULES = 100;
const MAX_PER_PROJECT = 50;
const KEEP_RUN_DAYS = 30;
/** A scheduled rule acts on at most this many issues per run; the rest wait for the next one. */
const MAX_SCHEDULED_ISSUES = 100;
const TICK_SECONDS = 60;

/** Which rules are running the code below: set while a rule's actions run, so what they cause can be told apart from what people do. */
const chain = new AsyncLocalStorage<{ depth: number; rules: Set<string> }>();

export interface RuleInput {
  name: string;
  description?: string;
  /** A project key; empty or missing = every project */
  projectKey?: string | null;
  enabled?: boolean;
  event: string;
  trigger?: unknown;
  jql?: string | null;
  actions: unknown;
}

type RuleRow = Prisma.AutomationRuleGetPayload<{
  include: { project: { select: { id: true; key: true; name: true } }; createdBy: { select: { id: true; name: true; email: true; role: true } } };
}>;

/** What a run is about: an issue event, or (event "schedule") a timer with nobody acting. */
interface RunEvent {
  event: string;
  actorId: string | null;
}

export interface ActionResult {
  type: string;
  ok: boolean;
  detail: string;
}

const parseJson = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function present(r: RuleRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    project: r.project,
    enabled: r.enabled,
    event: r.event as TriggerEvent,
    trigger: parseJson<TriggerConfig>(r.triggerConfig, {}),
    jql: r.jql,
    actions: parseJson<Action[]>(r.actions, []),
    disabledReason: r.disabledReason,
    runCount: r.runCount,
    lastRunAt: r.lastRunAt,
    nextRunAt: r.nextRunAt,
    createdBy: r.createdBy ? { id: r.createdBy.id, name: r.createdBy.name } : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationService.name);
  /** rule id + issue id → when it ran lately, for the loop guard */
  private readonly recent = new Map<string, number[]>();
  private lastPurge = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private mailer: MailerService,
    private search: SearchService,
    private issues: IssuesService,
    private events: IssueEventsService,
    private webhooks: WebhooksService,
  ) {}

  onModuleInit() {
    this.events.subscribe((event) => void this.handle(event));
    if (process.env.AUTOMATION_SCHEDULER === 'false') {
      this.logger.log('AUTOMATION_SCHEDULER=false: scheduled rules are not run by this process');
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Managing rules (global admins) ────────────────────────────────────────

  private readonly include = {
    project: { select: { id: true, key: true, name: true } },
    createdBy: { select: { id: true, name: true, email: true, role: true } },
  } as const;

  async list(user: AuthUser) {
    const ids = await this.access.adminProjectIds(user);
    const rules = await this.prisma.automationRule.findMany({
      where: ids === null ? {} : { projectId: { in: ids } },
      include: this.include,
      orderBy: { createdAt: 'asc' },
    });
    return rules.map(present);
  }

  async create(input: RuleInput, user: AuthUser) {
    const data = await this.validate(input, user);
    const cap = data.projectId ? MAX_PER_PROJECT : MAX_RULES;
    if ((await this.prisma.automationRule.count({ where: { projectId: data.projectId } })) >= cap) {
      throw new BadRequestException(`${data.projectId ? 'A project' : 'Everything that applies to every project'} can have up to ${cap} rules`);
    }
    const rule = await this.prisma.automationRule.create({ data: { ...data, createdById: user.id }, include: this.include });
    return present(rule);
  }

  /** Saving a rule makes the person saving it its author: it runs with their access from now on. */
  async update(id: string, input: RuleInput, user: AuthUser) {
    await this.find(id, user);
    const data = await this.validate(input, user);
    const rule = await this.prisma.automationRule.update({
      where: { id },
      data: { ...data, createdById: user.id, ...(data.enabled ? { disabledReason: null } : {}) },
      include: this.include,
    });
    return present(rule);
  }

  async remove(id: string, user: AuthUser) {
    await this.find(id, user);
    await this.prisma.automationRule.delete({ where: { id } });
    return { deleted: true };
  }

  async runs(id: string, user: AuthUser, limit = 50) {
    await this.find(id, user);
    const rows = await this.prisma.automationRun.findMany({
      where: { ruleId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((r) => ({ ...r, results: parseJson<ActionResult[]>(r.results, []) }));
  }

  /**
   * What the rule would do to this issue, without doing it. A scheduled rule can be tested without an issue: it then
   * lists the issues it would act on.
   */
  async test(id: string, user: AuthUser, issueKey?: string) {
    const rule = present(await this.find(id, user));
    if (!issueKey?.trim()) {
      if (rule.event === 'schedule') return this.previewSchedule(rule);
      throw new BadRequestException('Enter an issue key');
    }
    const issue = await this.prisma.issue.findFirst({ where: issueRef(issueKey.trim()), select: { id: true, key: true, projectId: true } });
    if (!issue) throw new NotFoundException(`Issue ${issueKey} not found`);
    const author = await this.author(id);
    let conditionMet = true;
    let conditionError: string | null = null;
    if (rule.jql && author) {
      try {
        conditionMet = await this.search.matches(rule.jql, issue.id, author);
      } catch (e) {
        conditionMet = false;
        conditionError = this.message(e);
      }
    }
    const inScope = !rule.project || rule.project.id === issue.projectId;
    return {
      issueKey: issue.key,
      inScope,
      conditionMet,
      conditionError,
      wouldRun: inScope && conditionMet,
      matching: null,
      actions: await this.previewActions(rule.actions, issue.id),
    };
  }

  private async previewActions(actions: Action[], issueId: string | null) {
    const values = issueId ? await this.values(issueId, null) : {};
    const names = await this.userNames(actions);
    return actions.map((a) => ({
      type: a.type,
      summary: describe(a, (uid) => names.get(uid) ?? uid),
      text: a.type === 'comment' || a.type === 'email' ? fill(a.body, values) : null,
    }));
  }

  private async previewSchedule(rule: ReturnType<typeof present>) {
    const author = await this.author(rule.id);
    if (!author) throw new BadRequestException('This rule has no author any more: open and save it first');
    let issues: { id: string; key: string }[];
    try {
      issues = await this.search.findMatching(rule.jql ?? '', author, MAX_SCHEDULED_ISSUES + 1, rule.project?.id);
    } catch (e) {
      throw new BadRequestException(this.message(e));
    }
    return {
      issueKey: null,
      inScope: true,
      conditionMet: issues.length > 0,
      conditionError: null,
      wouldRun: issues.length > 0,
      schedule: describeSchedule(rule.trigger),
      nextRunAt: rule.nextRunAt,
      matching: { keys: issues.slice(0, 20).map((i) => i.key), total: Math.min(issues.length, MAX_SCHEDULED_ISSUES), more: issues.length > MAX_SCHEDULED_ISSUES },
      actions: await this.previewActions(rule.actions, issues[0]?.id ?? null),
    };
  }

  /** A rule the user may manage; anything else (including other projects') is "not found". */
  private async find(id: string, user: AuthUser) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id }, include: this.include });
    if (!rule || !(await this.access.canManage(user, rule.projectId))) throw new NotFoundException('Rule not found');
    return rule;
  }

  private async author(ruleId: string): Promise<AuthUser | null> {
    const rule = await this.prisma.automationRule.findUnique({ where: { id: ruleId }, select: { createdBy: { select: { id: true, email: true, name: true, role: true } } } });
    return rule?.createdBy ?? null;
  }

  /** Names for the ids actions mention (people to assign to, chat webhooks), for describing them. */
  private async userNames(actions: Action[]) {
    const ids = actions.flatMap((a) => (a.type === 'assign' && !['unassigned', 'reporter', 'lead'].includes(a.to) ? [a.to] : []));
    const hooks = actions.flatMap((a) => (a.type === 'chat' ? [a.webhookId] : []));
    const [users, webhooks] = await Promise.all([
      ids.length ? this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [],
      hooks.length ? this.prisma.webhook.findMany({ where: { id: { in: hooks } }, select: { id: true, name: true } }) : [],
    ]);
    return new Map([...users, ...webhooks].map((x) => [x.id, x.name]));
  }

  private async validate(input: RuleInput, user: AuthUser) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Give the rule a name');
    const { event, config } = parseTrigger(input.event, input.trigger);
    const actions = parseActions(input.actions);
    for (const a of actions) {
      if (a.type === 'assign' && !['unassigned', 'reporter', 'lead'].includes(a.to)) {
        if (!(await this.prisma.user.findUnique({ where: { id: a.to }, select: { id: true } }))) throw new BadRequestException('The person to assign to does not exist');
      }
      if (a.type === 'chat') {
        // Only a channel the saver may manage: a project administrator can't speak into someone else's.
        const hook = await this.prisma.webhook.findUnique({ where: { id: a.webhookId }, select: { format: true, projectId: true } });
        if (!hook || !(await this.access.canManage(user, hook.projectId))) throw new BadRequestException('Choose a chat webhook you are allowed to use');
        if (!isChatFormat(hook.format)) throw new BadRequestException('That webhook sends JSON, not a Slack or Teams message: set its format to Slack or Teams first');
      }
    }
    const jql = input.jql?.trim() || null;
    if (event === 'schedule' && !jql) throw new BadRequestException('A scheduled rule needs a condition (JQL) that chooses the issues it acts on');
    if (jql) this.search.validate(jql, user);
    const projectId = input.projectKey?.trim() ? (await resolveProject(this.prisma, input.projectKey)).id : null;
    await this.access.requireManage(user, projectId);
    if (user.role !== UserRole.ADMIN) await this.requireKnownRecipients(actions);
    const enabled = input.enabled ?? true;
    return {
      name: name.slice(0, 120),
      description: input.description?.trim().slice(0, 500) || null,
      projectId,
      enabled,
      event,
      triggerConfig: JSON.stringify(config),
      jql,
      actions: JSON.stringify(actions),
      nextRunAt: event === 'schedule' && enabled ? nextRun(config, new Date()) : null,
    };
  }

  /**
   * Project admins may email people who have a Conductor account, not any address: a rule must not become a way to send
   * mail to outsiders. (Global admins may.)
   */
  private async requireKnownRecipients(actions: Action[]) {
    for (const a of actions) {
      if (a.type !== 'email') continue;
      const external = a.to.filter((t) => t.includes('@'));
      if (!external.length) continue;
      const known = await this.prisma.user.findMany({ where: { email: { in: [...external, ...external.map((e) => e.toLowerCase())] } }, select: { email: true } });
      const have = new Set(known.map((u) => u.email.toLowerCase()));
      const unknown = external.find((e) => !have.has(e.toLowerCase()));
      if (unknown) throw new BadRequestException(`${unknown} has no Conductor account. Project administrators can email the assignee, reporter, project lead and people with an account; a global administrator can email other addresses.`);
    }
  }

  // ─── Running rules ─────────────────────────────────────────────────────────

  /** Starts every rule that this event triggers. Never throws: a broken rule must not disturb what people are doing. */
  private async handle(event: IssueEvent) {
    try {
      if (!(TRIGGER_EVENTS as readonly string[]).includes(event.event)) return;
      const issue = await this.prisma.issue.findUnique({ where: { id: event.issueId }, select: { id: true, key: true, projectId: true } });
      if (!issue) return;
      const rules = await this.prisma.automationRule.findMany({
        where: { enabled: true, event: event.event, OR: [{ projectId: null }, { projectId: issue.projectId }] },
        include: this.include,
      });
      for (const rule of rules) {
        if (!this.triggerMatches(rule, event)) continue;
        await this.run(rule, issue, event);
      }
      await this.purge();
    } catch (err) {
      this.logger.warn(`Automation for ${event.event} on issue ${event.issueId}: ${this.message(err)}`);
    }
  }

  private triggerMatches(rule: RuleRow, event: IssueEvent) {
    const config = parseJson<TriggerConfig>(rule.triggerConfig, {});
    if (rule.event === 'issue.updated' && config.fields?.length) {
      return !!event.changes?.some((c) => config.fields!.includes(c.field));
    }
    if (rule.event === 'issue.transitioned' && config.toStatus) {
      const moved = event.changes?.find((c) => c.field === 'status');
      return moved?.to?.toLowerCase() === config.toStatus.toLowerCase();
    }
    return true;
  }

  /** Records that a rule's trigger matched (and what came of it). */
  private log(ruleId: string, event: string, issueKey: string, status: AutomationRunStatus, message: string | null, results: ActionResult[] = []) {
    return this.prisma.$transaction([
      this.prisma.automationRun.create({ data: { ruleId, event, issueKey, status, message, results: JSON.stringify(results) } }),
      this.prisma.automationRule.update({ where: { id: ruleId }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } }),
    ]);
  }

  private switchOffOrphan(ruleId: string) {
    return this.prisma.automationRule.update({
      where: { id: ruleId },
      data: { enabled: false, nextRunAt: null, disabledReason: 'Switched off: the person who wrote it no longer exists. Open and save it to take it over.' },
    });
  }

  /** `checkCondition: false` when the issue was chosen by the rule's own query (scheduled rules). */
  private async run(rule: RuleRow, issue: { id: string; key: string; projectId: string }, event: RunEvent, opts: { checkCondition?: boolean } = {}) {
    const author = rule.createdBy;
    if (!author) {
      await this.switchOffOrphan(rule.id);
      return;
    }
    const record = (status: AutomationRunStatus, message: string | null, results: ActionResult[] = []) =>
      this.log(rule.id, event.event, issue.key, status, message, results);

    if (rule.jql && opts.checkCondition !== false) {
      try {
        if (!(await this.search.matches(rule.jql, issue.id, author))) return;
      } catch (err) {
        await record('FAILED', `The condition could not be checked: ${this.message(err)}`);
        return;
      }
    }

    const context = chain.getStore();
    const depth = context?.depth ?? 0;
    if (context?.rules.has(rule.id) || depth >= MAX_DEPTH) {
      await record('SKIPPED', 'Stopped to avoid a loop: this change was caused by automation rules.');
      return;
    }
    const key = `${rule.id}:${issue.id}`;
    const now = Date.now();
    const times = (this.recent.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (times.length >= RATE_LIMIT) {
      // Say so once per window, not for every further trigger.
      if (times.length === RATE_LIMIT) await record('SKIPPED', `Stopped to avoid a loop: it ran ${RATE_LIMIT} times on ${issue.key} within a minute.`);
      this.recent.set(key, [...times, now]);
      return;
    }
    this.recent.set(key, [...times, now]);

    const results: ActionResult[] = [];
    const next = { depth: depth + 1, rules: new Set([...(context?.rules ?? []), rule.id]) };
    await chain.run(next, async () => {
      const actions = parseJson<Action[]>(rule.actions, []);
      for (const action of actions) {
        try {
          results.push({ type: action.type, ok: true, detail: await this.perform(action, issue, event, author) });
        } catch (err) {
          results.push({ type: action.type, ok: false, detail: this.message(err) });
          break;
        }
      }
    });
    const failed = results.find((r) => !r.ok);
    await record(failed ? 'FAILED' : 'SUCCESS', failed ? `${failed.type}: ${failed.detail}` : null, results);
  }

  private async perform(action: Action, issue: { id: string; key: string; projectId: string }, event: RunEvent, author: AuthUser): Promise<string> {
    // Emailing or posting a message doesn't change the issue, so it doesn't need the right to edit it.
    if (action.type !== 'email' && action.type !== 'chat') await this.access.require(author, issue.projectId, 'edit');
    const current = await this.prisma.issue.findUniqueOrThrow({
      where: { id: issue.id },
      select: {
        assigneeId: true, reporterId: true, priority: true, dueDate: true, status: true, workflowStatus: { select: { name: true } },
        project: { select: { leadId: true } }, labels: { select: { labelId: true } },
      },
    });

    switch (action.type) {
      case 'assign': {
        const target = action.to === 'unassigned' ? null
          : action.to === 'reporter' ? current.reporterId
          : action.to === 'lead' ? current.project.leadId
          : action.to;
        if (action.to !== 'unassigned' && !target) throw new Error(`There is no ${action.to === 'lead' ? 'project lead' : 'reporter'} to assign to`);
        if (target === current.assigneeId) return 'Already assigned that way';
        await this.issues.update(issue.id, { assigneeId: target ?? '' }, author.id);
        return target ? 'Assigned' : 'Unassigned';
      }
      case 'set_priority':
        if (current.priority === action.priority) return `Priority is already ${action.priority}`;
        await this.issues.update(issue.id, { priority: action.priority }, author.id);
        return `Priority set to ${action.priority}`;
      case 'set_due_date': {
        const due = action.days === null ? null : calendarDay(new Date(Date.now() + action.days * 86_400_000));
        if (dueDateText(due) === dueDateText(current.dueDate)) return due ? `Due date is already ${dueDateText(due)}` : 'There is no due date to clear';
        await this.issues.update(issue.id, { dueDate: dueDateText(due) ?? '' }, author.id);
        return due ? `Due date set to ${dueDateText(due)}` : 'Due date cleared';
      }
      case 'transition': {
        const want = action.status.toLowerCase();
        if (current.workflowStatus?.name.toLowerCase() === want || current.status.toLowerCase() === want) return `Already in ${action.status}`;
        await this.issues.transition(issue.id, { status: action.status, resolution: action.resolution ?? 'COMPLETED' }, author.id);
        return `Moved to ${action.status}`;
      }
      case 'comment': {
        const body = fill(action.body, await this.values(issue.id, event.actorId));
        await this.issues.addComment(issue.id, author, body, { internal: action.internal });
        return action.internal ? 'Internal note added' : 'Comment added';
      }
      case 'add_label': {
        const label = await this.prisma.label.upsert({
          where: { projectId_name: { projectId: issue.projectId, name: action.label } },
          update: {},
          create: { name: action.label, projectId: issue.projectId },
        });
        if (current.labels.some((l) => l.labelId === label.id)) return `Already labelled ${action.label}`;
        await this.issues.update(issue.id, { labelIds: [...current.labels.map((l) => l.labelId), label.id] }, author.id);
        return `Labelled ${action.label}`;
      }
      case 'email':
        return this.email(action, issue, current, await this.values(issue.id, event.actorId));
      case 'chat': {
        const name = await this.webhooks.postMessage(action.webhookId, author, fill(action.message, await this.values(issue.id, event.actorId)), issue.id);
        return `Message queued for ${name}`;
      }
    }
  }

  private async email(
    action: Extract<Action, { type: 'email' }>,
    issue: { id: string; key: string },
    current: { assigneeId: string | null; reporterId: string | null; project: { leadId: string | null } },
    values: Record<string, string>,
  ) {
    const ids = { assignee: current.assigneeId, reporter: current.reporterId, lead: current.project.leadId };
    const roles = action.to.flatMap((t) => (t in ids ? [ids[t as keyof typeof ids]] : [])).filter((x): x is string => !!x);
    const people = roles.length ? await this.prisma.user.findMany({ where: { id: { in: roles } }, select: { email: true } }) : [];
    const addresses = [...new Set([...people.map((p) => p.email), ...action.to.filter((t) => t.includes('@'))])];
    if (!addresses.length) return 'Nobody to email (no one is in those roles)';

    const subject = fill(action.subject, values).replace(/[\r\n]+/g, ' ');
    const body = fill(action.body, values);
    const html = `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p><p><a href="${escapeHtml(values['issue.url'])}">${escapeHtml(issue.key)}</a></p>`;
    const text = `${body}\n\n${values['issue.url']}`;
    let failed = 0;
    for (const to of addresses) if (!(await this.mailer.send({ to, subject, text, html }))) failed++;
    if (failed) throw new Error(`${failed} of ${addresses.length} emails could not be sent`);
    return `Emailed ${addresses.length} ${addresses.length === 1 ? 'address' : 'addresses'}`;
  }

  /** The {{placeholders}} for an issue as it is now. */
  private async values(issueId: string, actorId: string | null): Promise<Record<string, string>> {
    const [issue, actor] = await Promise.all([
      this.prisma.issue.findUniqueOrThrow({
        where: { id: issueId },
        select: {
          key: true, summary: true, priority: true, dueDate: true, status: true, workflowStatus: { select: { name: true } },
          assignee: { select: { name: true } }, reporter: { select: { name: true } }, project: { select: { key: true, name: true } },
        },
      }),
      actorId ? this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null,
    ]);
    return {
      'issue.key': issue.key,
      'issue.summary': toPlainText(issue.summary),
      'issue.status': issue.workflowStatus?.name ?? issue.status,
      'issue.priority': issue.priority,
      'issue.dueDate': dueDateText(issue.dueDate) ?? 'none',
      'issue.assignee': issue.assignee?.name ?? 'Unassigned',
      'issue.reporter': issue.reporter?.name ?? 'Unknown',
      'issue.url': `${this.mailer.appUrl()}/browse/${issue.key}`,
      'project.key': issue.project.key,
      'project.name': issue.project.name,
      'actor.name': actor?.name ?? 'Automation',
    };
  }

  /** Runs the scheduled rules that are due. */
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.prisma.automationRule.findMany({
        where: { enabled: true, event: 'schedule', nextRunAt: { lte: new Date() } },
        include: this.include,
      });
      for (const rule of due) {
        const config = parseJson<TriggerConfig>(rule.triggerConfig, {});
        // Claim this run first, so a slow previous tick or another process never runs it as well. A server that was
        // down runs a missed schedule once when it is back, not once for every missed time.
        const { count } = await this.prisma.automationRule.updateMany({
          where: { id: rule.id, nextRunAt: rule.nextRunAt },
          data: { nextRunAt: nextRun(config, new Date()), lastRunAt: new Date() },
        });
        if (count) await this.runScheduled(rule);
      }
      await this.purge();
    } catch (err) {
      this.logger.warn(`Scheduled automation: ${this.message(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Runs a scheduled rule's actions on the issues its condition matches (as the author sees them). */
  private async runScheduled(rule: RuleRow) {
    const author = rule.createdBy;
    if (!author) {
      await this.switchOffOrphan(rule.id);
      return;
    }
    let issues: { id: string; key: string; projectId: string }[];
    try {
      issues = await this.search.findMatching(rule.jql ?? '', author, MAX_SCHEDULED_ISSUES + 1, rule.projectId ?? undefined);
    } catch (err) {
      await this.log(rule.id, 'schedule', '—', 'FAILED', `The condition could not be checked: ${this.message(err)}`);
      return;
    }
    if (issues.length > MAX_SCHEDULED_ISSUES) {
      await this.log(rule.id, 'schedule', '—', 'SKIPPED', `The condition matches more than ${MAX_SCHEDULED_ISSUES} issues: the first ${MAX_SCHEDULED_ISSUES} were handled this time. Narrow the condition.`);
    }
    for (const issue of issues.slice(0, MAX_SCHEDULED_ISSUES)) {
      await this.run(rule, issue, { event: 'schedule', actorId: null }, { checkCondition: false });
    }
  }

  private async purge() {
    if (Date.now() - this.lastPurge < 3_600_000) return;
    this.lastPurge = Date.now();
    await this.prisma.automationRun.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_RUN_DAYS * 86_400_000) } } });
    const cutoff = Date.now() - RATE_WINDOW_MS;
    for (const [k, times] of this.recent) if (times.every((t) => t < cutoff)) this.recent.delete(k);
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
