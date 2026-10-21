/**
 * Demo data for the newer features: dashboards and gadgets, API tokens, webhooks, automation rules, incoming
 * webhooks, email templates and notifications. Called by seed-demo.ts; every row is skipped when one with the same
 * name already exists, so it is safe to re-run.
 */
import {
  ApiTokenAccess, AutomationRunStatus, GadgetType, InboundStatus, IssueType, NotificationType, Priority,
  WebhookDeliveryStatus, type PrismaClient, type User,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { seal } from '../src/common/secret-box';
import { nextRun } from '../src/automation/automation-schedule';
import { DEFAULT_CONFIG, type InboundConfig } from '../src/inbound-webhooks/inbound-config';
import type { TriggerConfig } from '../src/automation/automation-actions';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86_400_000 - hours * 3_600_000);

export async function seedFeatures(
  prisma: PrismaClient,
  p: { admin: User; maria: User; elena: User; andreas: User; sofia: User },
) {
  const { admin, maria, elena, andreas, sofia } = p;
  const pay = await prisma.project.findUniqueOrThrow({ where: { key: 'PAY' } });
  const help = await prisma.project.findUniqueOrThrow({ where: { key: 'HELP' } });
  const sports = await prisma.project.findUniqueOrThrow({ where: { key: 'SPORTS' } });

  // Dashboards: every gadget type and chart style, built on saved filters.
  const filterId = async (name: string) => (await prisma.savedFilter.findFirstOrThrow({ where: { name } })).id;
  if (!(await prisma.dashboard.findFirst({ where: { ownerId: admin.id, name: 'Delivery overview' } }))) {
    const openWork = await filterId('My open work');
    const blockers = await filterId('Release blockers');
    const week = await filterId('Created this week');
    const gadgets: { type: GadgetType; title: string; filterId: string; config: object; wide?: boolean }[] = [
      { type: GadgetType.FILTER_COUNT, title: 'Release blockers', filterId: blockers, config: {} },
      { type: GadgetType.FILTER_RESULTS, title: 'My open work', filterId: openWork, config: { maxRows: 8 }, wide: true },
      { type: GadgetType.BREAKDOWN, title: 'Open work by status', filterId: openWork, config: { groupBy: 'status', chart: 'bars' } },
      { type: GadgetType.BREAKDOWN, title: 'Blockers by priority', filterId: blockers, config: { groupBy: 'priority', chart: 'donut' } },
      { type: GadgetType.BREAKDOWN, title: 'Blockers by project', filterId: blockers, config: { groupBy: 'project', chart: 'pie' } },
      { type: GadgetType.TREND, title: 'New issues per day', filterId: week, config: { days: 14, bucket: 'day' } },
      { type: GadgetType.CREATED_VS_RESOLVED, title: 'Created vs resolved', filterId: week, config: { days: 30, bucket: 'week', chart: 'line' }, wide: true },
    ];
    await prisma.dashboard.create({
      data: {
        name: 'Delivery overview', description: 'Release blockers, open work and how fast issues come and go', ownerId: admin.id, shared: true,
        gadgets: { create: gadgets.map((g, position) => ({ ...g, config: JSON.stringify(g.config), position, wide: g.wide ?? false })) },
      },
    });
  }
  if (!(await prisma.dashboard.findFirst({ where: { ownerId: elena.id, name: 'PAY team' } }))) {
    const payFilter = await filterId('PAY blocked or at risk');
    await prisma.dashboard.create({
      data: {
        name: 'PAY team', description: 'Private to Elena', ownerId: elena.id, shared: false,
        gadgets: {
          create: [
            { type: GadgetType.FILTER_COUNT, title: 'Blocked or at risk', filterId: payFilter, config: '{}', position: 0 },
            { type: GadgetType.BREAKDOWN, title: 'By assignee', filterId: payFilter, config: JSON.stringify({ groupBy: 'assignee', chart: 'bars' }), position: 1 },
          ],
        },
      },
    });
  }

  // API tokens. The secrets are random and thrown away: create a real one under Account → API tokens to try the API.
  const tokens: [User, string, ApiTokenAccess, Date | null][] = [
    [admin, 'Reporting script (read only)', ApiTokenAccess.READ, ago(-90)],
    [admin, 'CI pipeline', ApiTokenAccess.WRITE, null],
    [maria, 'Release notes generator', ApiTokenAccess.READ, ago(-30)],
  ];
  for (const [user, name, access, expiresAt] of tokens) {
    if (await prisma.apiToken.findFirst({ where: { userId: user.id, name } })) continue;
    const token = `jt_${randomBytes(32).toString('base64url')}`;
    await prisma.apiToken.create({
      data: { userId: user.id, name, access, expiresAt, tokenHash: sha256(token), prefix: token.slice(0, 8), lastUsedAt: ago(1, 3) },
    });
  }

  // Webhooks: JSON, Slack and Teams (the example addresses go nowhere), and one that was switched off after failing.
  const hooks = [
    { name: 'Release dashboard feed', url: 'https://example.com/hooks/conductor', events: ['issue.created', 'issue.transitioned', 'issue.deleted'], format: 'JSON', projectId: null as string | null },
    { name: 'PAY alerts in Slack', url: 'https://hooks.slack.com/services/T000/B000/example', events: ['issue.created', 'comment.created'], format: 'SLACK', projectId: pay.id, jql: 'priority in (Highest, High)' },
    { name: 'IT desk in Teams', url: 'https://example.webhook.office.com/webhookb2/example', events: ['issue.created', 'issue.assigned'], format: 'TEAMS', projectId: help.id },
    { name: 'Old audit export', url: 'https://example.com/hooks/audit', events: ['issue.updated'], format: 'JSON', projectId: null as string | null, off: true },
  ];
  const hookIds = new Map<string, string>();
  for (const h of hooks) {
    const found = await prisma.webhook.findFirst({ where: { name: h.name } });
    if (found) {
      hookIds.set(h.name, found.id);
      continue;
    }
    const row = await prisma.webhook.create({
      data: {
        name: h.name, url: h.url, events: JSON.stringify(h.events), format: h.format, projectId: h.projectId, jql: h.jql ?? null,
        active: !h.off, failureCount: h.off ? 5 : 0, disabledReason: h.off ? 'Switched off after 5 failed deliveries in a row' : null,
        secret: seal(`whsec_${randomBytes(24).toString('base64url')}`), createdById: admin.id,
      },
    });
    hookIds.set(h.name, row.id);
    await prisma.webhookDelivery.create({
      data: {
        webhookId: row.id, event: h.events[0], payload: JSON.stringify({ event: h.events[0], id: randomUUID(), demo: true }),
        status: h.off ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.SUCCESS, attempts: h.off ? 5 : 1,
        responseStatus: h.off ? 500 : 200, error: h.off ? 'HTTP 500' : null, durationMs: 120, deliveredAt: h.off ? null : ago(1),
      },
    });
  }

  // Automation rules: one for every kind of trigger, and a switched-off one.
  const slackId = hookIds.get('PAY alerts in Slack');
  const rules: { name: string; description: string; projectId: string | null; event: string; triggerConfig: object; jql?: string; actions: object[]; off?: boolean }[] = [
    {
      name: 'Escalate Highest issues to the lead', description: 'A new Highest-priority issue goes to the project lead and is announced in chat',
      projectId: pay.id, event: 'issue.created', triggerConfig: {}, jql: 'priority = Highest',
      actions: [
        { type: 'assign', to: 'lead' }, { type: 'add_label', label: 'escalated' },
        ...(slackId ? [{ type: 'chat', webhookId: slackId, message: 'Highest priority issue raised' }] : []),
      ],
    },
    {
      name: 'Tell the customer when resolved', description: 'Posts a comment when a help request is closed', projectId: help.id,
      event: 'issue.transitioned', triggerConfig: { toStatus: 'Closed' },
      actions: [{ type: 'comment', body: 'This request is now resolved. Reply here if it comes back.', internal: false }],
    },
    {
      name: 'Tell the lead when priority changes', description: 'Looks at priority edits only', projectId: sports.id,
      event: 'issue.updated', triggerConfig: { fields: ['priority'] },
      actions: [{ type: 'email', to: ['lead'], subject: 'Priority changed', body: 'An issue changed priority.' }],
    },
    {
      name: 'Flag customer replies', description: 'Labels a request when someone comments on it', projectId: help.id,
      event: 'comment.created', triggerConfig: {}, actions: [{ type: 'add_label', label: 'customer-replied' }],
    },
    {
      name: 'Nudge stale in-progress work', description: 'Every morning, emails the assignee of work stuck in progress for two weeks', projectId: null,
      event: 'schedule', triggerConfig: { frequency: 'daily', time: '08:00' }, jql: 'status = DOING AND updated <= -14d',
      actions: [{ type: 'email', to: ['assignee'], subject: 'Is this still in progress?', body: 'It has not changed for two weeks. Please update it.' }],
    },
    {
      name: 'Note on assignment (paused)', description: 'An example of a rule that is switched off', projectId: help.id, off: true,
      event: 'issue.assigned', triggerConfig: {}, actions: [{ type: 'comment', body: 'Assigned.', internal: true }],
    },
  ];
  const someIssue = await prisma.issue.findFirst({ where: { projectId: pay.id }, orderBy: { createdAt: 'desc' } });
  for (const r of rules) {
    if (await prisma.automationRule.findFirst({ where: { name: r.name } })) continue;
    const on = !r.off;
    const rule = await prisma.automationRule.create({
      data: {
        name: r.name, description: r.description, projectId: r.projectId, enabled: on, event: r.event,
        triggerConfig: JSON.stringify(r.triggerConfig), jql: r.jql ?? null, actions: JSON.stringify(r.actions),
        runCount: on ? 1 : 0, lastRunAt: on ? ago(1) : null,
        nextRunAt: on && r.event === 'schedule' ? nextRun(r.triggerConfig as TriggerConfig, new Date()) : null,
        createdById: admin.id,
      },
    });
    if (on && someIssue) {
      await prisma.automationRun.create({
        data: {
          ruleId: rule.id, event: r.event, issueKey: someIssue.key, status: AutomationRunStatus.SUCCESS, message: 'Demo run',
          results: JSON.stringify((r.actions as { type: string }[]).map((a) => ({ type: a.type, ok: true, detail: 'Done' }))),
        },
      });
    }
  }

  // Incoming webhooks: an alerting tool that opens and closes issues, and a plain CI hook.
  const inbound: { name: string; projectId: string; config: InboundConfig }[] = [
    {
      name: 'Grafana alerts', projectId: pay.id,
      config: {
        ...DEFAULT_CONFIG, issueType: IssueType.DEFECT, priority: Priority.HIGH, priorityFrom: '{{alerts.0.labels.severity}}',
        summary: '{{alerts.0.labels.alertname}} on {{alerts.0.labels.instance}}', description: '{{alerts.0.annotations.summary}}',
        labels: ['alert'], assigneeId: andreas.id, dedupe: '{{alerts.0.fingerprint}}',
        resolveWhen: { path: 'status', equals: 'resolved' },
      },
    },
    {
      name: 'CI build failures', projectId: sports.id,
      config: { ...DEFAULT_CONFIG, issueType: IssueType.TASK, summary: 'Build failed: {{pipeline}} #{{build}}', description: '{{message}}', labels: ['ci'], assigneeId: sofia.id },
    },
  ];
  for (const h of inbound) {
    if (await prisma.inboundWebhook.findFirst({ where: { name: h.name } })) continue;
    const token = `jth_${randomBytes(24).toString('base64url')}`;
    const hook = await prisma.inboundWebhook.create({
      data: {
        name: h.name, projectId: h.projectId, config: JSON.stringify(h.config), tokenHash: sha256(token), tokenPrefix: token.slice(0, 8),
        receivedCount: 1, lastReceivedAt: ago(0, 6), createdById: admin.id,
      },
    });
    await prisma.inboundDelivery.create({
      data: { hookId: hook.id, status: InboundStatus.IGNORED, message: 'Demo delivery', payload: JSON.stringify({ title: 'Demo', message: 'Example payload' }), createdAt: ago(0, 6) },
    });
  }

  // Email templates for replying from the service desk: one for every project, two for HELP.
  const templates: { projectId: string | null; name: string; subject?: string; body: string }[] = [
    { projectId: null, name: 'Acknowledge request', subject: 'We got your request {{issue.key}}', body: '<p>Hi {{customer.firstName}},</p><p>Thanks for getting in touch. We have logged <strong>{{issue.key}}</strong> ({{issue.summary}}) and will update you soon.</p><p>{{agent.name}}</p>' },
    { projectId: help.id, name: 'Ask for more details', body: '<p>Hi {{customer.firstName}},</p><p>Could you tell us which operating system you use and send a screenshot of the problem? Then we can fix it faster.</p><p>Thanks,<br>{{agent.firstName}}</p>' },
    { projectId: help.id, name: 'Resolved', subject: '{{issue.key}} is resolved', body: '<p>Hi {{customer.firstName}},</p><p>We have resolved <strong>{{issue.summary}}</strong>. Reply to this email if it happens again.</p><p>{{agent.name}}</p>' },
  ];
  for (const t of templates) {
    if (await prisma.emailTemplate.findFirst({ where: { name: t.name, projectId: t.projectId } })) continue;
    await prisma.emailTemplate.create({ data: { ...t, createdById: admin.id } });
  }

  // A few notifications so the bell is not empty.
  if (!(await prisma.notification.count({ where: { userId: admin.id } }))) {
    const issues = await prisma.issue.findMany({ take: 3, orderBy: { createdAt: 'desc' } });
    const kinds = [NotificationType.ASSIGNED, NotificationType.COMMENTED, NotificationType.STATUS_CHANGED];
    for (const [i, issue] of issues.entries()) {
      await prisma.notification.create({
        data: {
          userId: admin.id, actorId: elena.id, issueId: issue.id, issueKey: issue.key, issueSummary: issue.summary, type: kinds[i],
          detail: kinds[i] === NotificationType.STATUS_CHANGED ? 'To Do → In Progress' : null, readAt: i === 2 ? ago(0, 1) : null,
        },
      });
    }
  }
}
