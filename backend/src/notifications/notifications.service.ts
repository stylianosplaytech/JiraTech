import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';
import { AccessService } from '../access/access.service';

const STATUS_NAMES: Record<string, string> = {
  BACKLOG: 'Backlog', TO_DO: 'To Do', DOING: 'In Progress', CLOSED: 'Closed',
};

// When one event concerns a user in several ways, they get the most specific notification.
const PRECEDENCE: NotificationType[] = [
  NotificationType.ASSIGNED,
  NotificationType.MENTIONED,
  NotificationType.WATCHING,
  NotificationType.STATUS_CHANGED,
  NotificationType.COMMENTED,
  NotificationType.UPDATED,
  NotificationType.DELETED,
];

/** "Direct" notifications are about the user personally rather than an issue they follow. */
export const DIRECT_TYPES: NotificationType[] = [NotificationType.ASSIGNED, NotificationType.MENTIONED, NotificationType.WATCHING];

const FIELD_NAMES: Record<string, string> = {
  summary: 'Summary', description: 'Description', priority: 'Priority', estimate: 'Estimate',
  remainingEstimate: 'Remaining estimate', blocked: 'Blocked', epicName: 'Epic name', assignee: 'Assignee',
  reporter: 'Reporter', sprint: 'Sprint', components: 'Components', labels: 'Labels',
  fixVersions: 'Fix versions', affectsVersions: 'Affects versions', link: 'Links', attachment: 'Attachments',
};

interface IssueRef {
  id: string;
  key: string;
  summary: string;
  projectId: string;
}

type Recipients = Map<string, { type: NotificationType; detail?: string | null }>;

/** "@jane.doe@example.com" → ["jane.doe@example.com"] */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(/(?:^|[\s(])@([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g)].map((m) => m[1].toLowerCase());
}

function excerpt(text: string, max = 160) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

  constructor(private prisma: PrismaService, private mailer: MailerService, private access: AccessService) {}

  // ─── Events (called by IssuesService after its changes are committed) ──────

  async issueCreated(issueId: string, actorId: string) {
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      if (issue.assigneeId) {
        await this.watch(issue.id, issue.assigneeId);
        this.add(r, issue.assigneeId, NotificationType.ASSIGNED);
      }
      await this.addMentions(r, issue.id, extractMentions(issue.description), excerpt(issue.description ?? ''));
      await this.dispatch(issue, actorId, r);
    });
  }

  async issueUpdated(
    issueId: string,
    actorId: string,
    change: {
      fields: string[];
      previousAssigneeId: string | null;
      previousDescription: string | null;
    },
  ) {
    if (!change.fields.length) return;
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      const fieldList = change.fields.map((f) => FIELD_NAMES[f] ?? f).join(', ');

      for (const userId of this.audience(issue)) this.add(r, userId, NotificationType.UPDATED, fieldList);
      if (change.previousAssigneeId && change.previousAssigneeId !== issue.assigneeId) {
        this.add(r, change.previousAssigneeId, NotificationType.UPDATED, 'Assignee (you were unassigned)');
      }
      if (issue.assigneeId && issue.assigneeId !== change.previousAssigneeId) {
        await this.watch(issue.id, issue.assigneeId);
        this.add(r, issue.assigneeId, NotificationType.ASSIGNED);
      }
      if (change.fields.includes('description')) {
        const before = new Set(extractMentions(change.previousDescription));
        const added = extractMentions(issue.description).filter((e) => !before.has(e));
        await this.addMentions(r, issue.id, added, excerpt(issue.description ?? ''));
      }
      await this.dispatch(issue, actorId, r);
    });
  }

  async statusChanged(issueId: string, actorId: string, from: string, to: string) {
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      const detail = `${STATUS_NAMES[from] ?? from} → ${STATUS_NAMES[to] ?? to}`;
      for (const userId of this.audience(issue)) this.add(r, userId, NotificationType.STATUS_CHANGED, detail);
      await this.dispatch(issue, actorId, r);
    });
  }

  async commentAdded(issueId: string, actorId: string, body: string) {
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      const text = excerpt(body);
      for (const userId of this.audience(issue)) this.add(r, userId, NotificationType.COMMENTED, text);
      await this.addMentions(r, issue.id, extractMentions(body), text);
      await this.dispatch(issue, actorId, r);
    });
  }

  async commentEdited(issueId: string, actorId: string, before: string, after: string) {
    await this.safely(async () => {
      const previous = new Set(extractMentions(before));
      const added = extractMentions(after).filter((e) => !previous.has(e));
      if (!added.length) return;
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      await this.addMentions(r, issue.id, added, excerpt(after));
      await this.dispatch(issue, actorId, r);
    });
  }

  async watcherAdded(issueId: string, actorId: string, userId: string) {
    if (userId === actorId) return;
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      this.add(r, userId, NotificationType.WATCHING);
      await this.dispatch(issue, actorId, r);
    });
  }

  /** Call before deleting: notifications keep the key and summary after the issue is gone. */
  async issueDeleted(issueId: string, actorId: string) {
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      for (const userId of this.audience(issue)) this.add(r, userId, NotificationType.DELETED);
      await this.dispatch(issue, actorId, r);
    });
  }

  // ─── Reading ───────────────────────────────────────────────────────────────

  async list(userId: string, opts: { scope?: 'all' | 'direct'; unreadOnly?: boolean; limit?: number }) {
    const where: Prisma.NotificationWhereInput = { userId };
    if (opts.scope === 'direct') where.type = { in: DIRECT_TYPES };
    if (opts.unreadOnly) where.readAt = null;
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true } },
          issue: { select: { id: true, key: true, summary: true, type: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(opts.limit ?? 30, 1), 100),
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } }).then((unread) => ({ unread }));
  }

  async setRead(userId: string, id: string, read: boolean) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    await this.prisma.notification.update({ where: { id }, data: { readAt: read ? (n.readAt ?? new Date()) : null } });
    return this.unreadCount(userId);
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { unread: 0 };
  }

  /** Opening an issue counts as reading its notifications, as in Jira. */
  async markIssueRead(userId: string, issueId: string) {
    await this.prisma.notification.updateMany({ where: { userId, issueId, readAt: null }, data: { readAt: new Date() } });
    return this.unreadCount(userId);
  }

  async getPreferences(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailNotifications: true } });
    return user;
  }

  async setPreferences(userId: string, prefs: { emailNotifications?: boolean }) {
    return this.prisma.user.update({ where: { id: userId }, data: prefs, select: { emailNotifications: true } });
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async issueWithPeople(issueId: string) {
    return this.prisma.issue.findUniqueOrThrow({
      where: { id: issueId },
      include: { watchers: { select: { userId: true } } },
    });
  }

  /** Everyone following an issue: reporter, assignee and watchers. */
  private audience(issue: { reporterId: string | null; assigneeId: string | null; watchers: { userId: string }[] }) {
    const ids = new Set(issue.watchers.map((w) => w.userId));
    if (issue.reporterId) ids.add(issue.reporterId);
    if (issue.assigneeId) ids.add(issue.assigneeId);
    return ids;
  }

  /** Keeps the most specific notification per user; a later entry of the same type refines the detail. */
  private add(r: Recipients, userId: string, type: NotificationType, detail?: string | null) {
    const current = r.get(userId);
    if (!current || PRECEDENCE.indexOf(type) <= PRECEDENCE.indexOf(current.type)) {
      // A different type replaces the detail too ("assigned" shouldn't show the "updated fields" list).
      r.set(userId, { type, detail: type === current?.type ? (detail ?? current.detail) : (detail ?? null) });
    }
  }

  private async addMentions(r: Recipients, issueId: string, emails: string[], detail: string) {
    if (!emails.length) return;
    const users = await this.prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    for (const u of users) {
      await this.watch(issueId, u.id);
      this.add(r, u.id, NotificationType.MENTIONED, detail);
    }
  }

  private watch(issueId: string, userId: string) {
    return this.prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      create: { issueId, userId },
      update: {},
    });
  }

  private async dispatch(issue: IssueRef, actorId: string, recipients: Recipients) {
    recipients.delete(actorId); // never notify people about their own actions
    // People who lost access to the project (or never had it) aren't told about its issues.
    const allowed = await this.access.filterBrowsers(issue.projectId, [...recipients.keys()]);
    for (const userId of [...recipients.keys()]) if (!allowed.has(userId)) recipients.delete(userId);
    if (!recipients.size) return;

    const created = await this.prisma.$transaction(
      [...recipients.entries()].map(([userId, { type, detail }]) =>
        this.prisma.notification.create({
          data: { userId, actorId, issueId: issue.id, issueKey: issue.key, issueSummary: issue.summary, type, detail: detail ?? null },
        })),
    );
    // Email in the background so the user's request isn't slowed down by SMTP.
    void this.email(created.map((n) => n.id), actorId, issue);
  }

  private async email(ids: string[], actorId: string, issue: IssueRef) {
    const [notifications, actor] = await Promise.all([
      this.prisma.notification.findMany({
        where: { id: { in: ids }, user: { emailNotifications: true } },
        include: { user: { select: { email: true, name: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }),
    ]);
    const who = actor?.name ?? 'Someone';
    const url = `${this.appUrl}/browse/${issue.key}`;
    for (const n of notifications) {
      const line = this.sentence(n.type, who, issue.key);
      const ok = await this.mailer.send({
        to: n.user.email,
        subject: `[JiraTech] (${issue.key}) ${issue.summary}`,
        text: `${line}\n\n${issue.key}: ${issue.summary}\n${n.detail ? `\n${n.detail}\n` : ''}\nView the issue: ${url}\n\n`
          + 'You receive this because you are involved in this issue. Turn off email notifications from your profile menu.',
        html: this.html(line, issue, n.detail, url),
      });
      if (ok) await this.prisma.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
    }
  }

  sentence(type: NotificationType, who: string, key: string) {
    switch (type) {
      case NotificationType.ASSIGNED: return `${who} assigned ${key} to you`;
      case NotificationType.MENTIONED: return `${who} mentioned you on ${key}`;
      case NotificationType.COMMENTED: return `${who} commented on ${key}`;
      case NotificationType.STATUS_CHANGED: return `${who} changed the status of ${key}`;
      case NotificationType.UPDATED: return `${who} updated ${key}`;
      case NotificationType.WATCHING: return `${who} added you as a watcher of ${key}`;
      case NotificationType.DELETED: return `${who} deleted ${key}`;
    }
  }

  private html(line: string, issue: IssueRef, detail: string | null, url: string) {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    return `<!doctype html><html><body style="margin:0;background:#F4F5F7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#172B4D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:3px;border:1px solid #DFE1E6">
<tr><td style="padding:20px 24px;border-bottom:1px solid #DFE1E6;font-weight:600;color:#0052CC">JiraTech</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 16px;font-size:15px">${esc(line)}</p>
<p style="margin:0 0 8px;font-size:14px"><a href="${esc(url)}" style="color:#0052CC;text-decoration:none;font-weight:600">${esc(issue.key)}</a> ${esc(issue.summary)}</p>
${detail ? `<div style="margin:12px 0;padding:12px;background:#F4F5F7;border-radius:3px;font-size:14px;white-space:pre-wrap">${esc(detail)}</div>` : ''}
<p style="margin:20px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#0052CC;color:#fff;padding:8px 14px;border-radius:3px;text-decoration:none;font-size:14px;font-weight:500">View issue</a></p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #DFE1E6;font-size:12px;color:#6B778C">You receive this because you are involved in this issue. You can turn off email notifications from your profile menu in JiraTech.</td></tr>
</table></td></tr></table></body></html>`;
  }

  /** Notifications are a side effect: log failures instead of failing the user's action. */
  private async safely(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`Notification failed: ${(e as Error).message}`);
    }
  }
}
