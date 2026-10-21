import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, ProjectType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { AccessService } from '../access/access.service';
import { extractMentions, mentionKeys, Mentions, toPlainText } from '../common/rich-text';
import { NotificationSchemeService, SchemeEvent } from './notification-scheme.service';

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
  NotificationType.CREATED,
  NotificationType.DELETED,
];

/** "Direct" notifications are about the user personally rather than an issue they follow. */
export const DIRECT_TYPES: NotificationType[] = [NotificationType.ASSIGNED, NotificationType.MENTIONED, NotificationType.WATCHING];

const FIELD_NAMES: Record<string, string> = {
  summary: 'Summary', description: 'Description', priority: 'Priority', estimate: 'Estimate',
  remainingEstimate: 'Remaining estimate', blocked: 'Blocked', epicName: 'Epic name', assignee: 'Assignee',
  reporter: 'Reporter', sprint: 'Sprint', components: 'Components', labels: 'Labels',
  fixVersions: 'Fix versions', affectsVersions: 'Affects versions', link: 'Links', attachment: 'Attachments',
  project: 'Project (moved)',
};

interface IssueRef {
  id: string;
  key: string;
  summary: string;
  projectId: string;
}

type Recipients = Map<string, { type: NotificationType; detail?: string | null }>;

interface IssueWithPeople extends IssueRef {
  reporterId: string | null;
  assigneeId: string | null;
  watchers: { userId: string }[];
}

/** An event an action fired: the project's notification scheme says who is emailed about it. */
interface Fired {
  event: SchemeEvent;
  /** The notification given to people only the scheme brings in (e.g. project admins) */
  type: NotificationType;
  detail?: string | null;
  /** The people the event is about (mentioned, or added as a watcher) */
  concerned?: string[];
  /** On ISSUE_ASSIGNED the previous assignee counts as an assignee too */
  previousAssigneeId?: string | null;
}

function excerpt(text: string, max = 160) {
  const flat = toPlainText(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Mentions present in `after` but not in `before` (so edits only notify newly mentioned people). */
function newMentions(before: string | null | undefined, after: string | null | undefined): Mentions {
  const old = new Set(mentionKeys(extractMentions(before)));
  const now = extractMentions(after);
  return {
    ids: now.ids.filter((id) => !old.has(`id:${id}`)),
    emails: now.emails.filter((e) => !old.has(`email:${e}`)),
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private access: AccessService,
    private schemes: NotificationSchemeService,
  ) {}

  // ─── Events (called by IssuesService after its changes are committed) ──────

  async issueCreated(issueId: string, actorId: string) {
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      const fired: Fired[] = [{ event: 'ISSUE_CREATED', type: NotificationType.CREATED }];
      if (issue.assigneeId) {
        await this.watch(issue.id, issue.assigneeId);
        this.add(r, issue.assigneeId, NotificationType.ASSIGNED);
        fired.push({ event: 'ISSUE_ASSIGNED', type: NotificationType.CREATED });
      }
      fired.push(...await this.addMentions(r, issue.id, extractMentions(issue.description), excerpt(issue.description ?? '')));
      await this.dispatch(issue, actorId, r, fired);
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
      const fired: Fired[] = [];
      const others = change.fields.filter((f) => f !== 'assignee');
      if (others.length) {
        fired.push({ event: 'ISSUE_UPDATED', type: NotificationType.UPDATED, detail: others.map((f) => FIELD_NAMES[f] ?? f).join(', ') });
      }
      if (change.previousAssigneeId !== issue.assigneeId) {
        fired.push({
          event: 'ISSUE_ASSIGNED', type: NotificationType.UPDATED, detail: FIELD_NAMES.assignee, previousAssigneeId: change.previousAssigneeId,
        });
      }

      for (const userId of this.audience(issue)) this.add(r, userId, NotificationType.UPDATED, fieldList);
      if (change.previousAssigneeId && change.previousAssigneeId !== issue.assigneeId) {
        this.add(r, change.previousAssigneeId, NotificationType.UPDATED, 'Assignee (you were unassigned)');
      }
      if (issue.assigneeId && issue.assigneeId !== change.previousAssigneeId) {
        await this.watch(issue.id, issue.assigneeId);
        this.add(r, issue.assigneeId, NotificationType.ASSIGNED);
      }
      if (change.fields.includes('description')) {
        const added = newMentions(change.previousDescription, issue.description);
        fired.push(...await this.addMentions(r, issue.id, added, excerpt(issue.description ?? '')));
      }
      await this.dispatch(issue, actorId, r, fired);
    });
  }

  async statusChanged(issueId: string, actorId: string, from: string, to: string) {
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      const detail = `${STATUS_NAMES[from] ?? from} → ${STATUS_NAMES[to] ?? to}`;
      for (const userId of this.audience(issue)) this.add(r, userId, NotificationType.STATUS_CHANGED, detail);
      await this.dispatch(issue, actorId, r, [{ event: 'STATUS_CHANGED', type: NotificationType.STATUS_CHANGED, detail }]);
    });
  }

  /** `emailed`: addresses that got the comment as a real email (sent or received), so aren't emailed about it again. */
  async commentAdded(issueId: string, actorId: string, body: string, emailed: string[] = []) {
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      const text = excerpt(body);
      for (const userId of this.audience(issue)) this.add(r, userId, NotificationType.COMMENTED, text);
      const fired: Fired[] = [{ event: 'COMMENTED', type: NotificationType.COMMENTED, detail: text }];
      fired.push(...await this.addMentions(r, issue.id, extractMentions(body), text));
      await this.dispatch(issue, actorId, r, fired, emailed);
    });
  }

  async commentEdited(issueId: string, actorId: string, before: string, after: string) {
    await this.safely(async () => {
      const added = newMentions(before, after);
      if (!added.ids.length && !added.emails.length) return;
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      await this.dispatch(issue, actorId, r, await this.addMentions(r, issue.id, added, excerpt(after)));
    });
  }

  async watcherAdded(issueId: string, actorId: string, userId: string) {
    if (userId === actorId) return;
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      this.add(r, userId, NotificationType.WATCHING);
      await this.dispatch(issue, actorId, r, [{ event: 'WATCHER_ADDED', type: NotificationType.WATCHING, concerned: [userId] }]);
    });
  }

  /** Call before deleting: notifications keep the key and summary after the issue is gone. */
  async issueDeleted(issueId: string, actorId: string) {
    await this.safely(async () => {
      const issue = await this.issueWithPeople(issueId);
      const r: Recipients = new Map();
      for (const userId of this.audience(issue)) this.add(r, userId, NotificationType.DELETED);
      await this.dispatch(issue, actorId, r, [{ event: 'ISSUE_DELETED', type: NotificationType.DELETED }]);
    });
  }

  // ─── Service desk customers: public activity only, linking to the portal ──

  /** A public reply on a request. Internal notes never reach this. */
  async requestCommented(issueId: string, actorId: string, body: string, emailed: string[] = []) {
    await this.safely(() => this.toCustomers(issueId, actorId, NotificationType.COMMENTED, excerpt(body), emailed));
  }

  async requestStatusChanged(issueId: string, actorId: string, to: string) {
    await this.safely(() => this.toCustomers(issueId, actorId, NotificationType.STATUS_CHANGED, `Status: ${to}`));
  }

  /** The customers on a request (its reporter and participants), other than the actor. */
  private async toCustomers(issueId: string, actorId: string, type: NotificationType, detail: string, emailed: string[] = []) {
    const issue = await this.prisma.issue.findUniqueOrThrow({
      where: { id: issueId },
      include: {
        project: { select: { type: true } },
        reporter: { select: { id: true, role: true } },
        watchers: { select: { user: { select: { id: true, role: true } } } },
      },
    });
    if (issue.project.type !== ProjectType.SERVICE_DESK) return;
    const people = [issue.reporter, ...issue.watchers.map((w) => w.user)];
    const ids = new Set(people.filter((u) => u?.role === UserRole.CUSTOMER).map((u) => u!.id));
    ids.delete(actorId);
    if (!ids.size) return;
    const created = await this.prisma.$transaction([...ids].map((userId) =>
      this.prisma.notification.create({
        data: { userId, actorId, issueId: issue.id, issueKey: issue.key, issueSummary: issue.summary, type, detail },
      })));
    void this.email(created.map((n) => n.id), actorId, issue, true, emailed);
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

  /** Notifies the people mentioned, and returns the MENTIONED event for emailing them (none if nobody was). */
  private async addMentions(r: Recipients, issueId: string, mentions: Mentions, detail: string): Promise<Fired[]> {
    if (!mentions.ids.length && !mentions.emails.length) return [];
    // Mentions never pull customers into a request (they aren't told about internal activity anyway).
    const users = await this.prisma.user.findMany({
      where: { OR: [{ id: { in: mentions.ids } }, { email: { in: mentions.emails } }], role: { not: UserRole.CUSTOMER } },
      select: { id: true },
    });
    for (const u of users) {
      await this.watch(issueId, u.id);
      this.add(r, u.id, NotificationType.MENTIONED, detail);
    }
    return users.length ? [{ event: 'MENTIONED', type: NotificationType.MENTIONED, detail, concerned: users.map((u) => u.id) }] : [];
  }

  private watch(issueId: string, userId: string) {
    return this.prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      create: { issueId, userId },
      update: {},
    });
  }

  private async dispatch(issue: IssueWithPeople, actorId: string, recipients: Recipients, fired: Fired[], emailed: string[] = []) {
    const emailTo = await this.emailTargets(issue, recipients, fired);
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
    void this.email(created.map((n) => n.id), actorId, issue, false, emailed, emailTo);
  }

  /**
   * Who the project's notification scheme emails about these events. Everyone involved still gets the in-app
   * notification; people only the scheme brings in (e.g. project admins) get one too, so the email has something behind it.
   */
  private async emailTargets(issue: IssueWithPeople, r: Recipients, fired: Fired[]) {
    const to = new Set<string>();
    if (!fired.length) return to;
    const scheme = await this.schemes.effective(issue.projectId);
    let admins: string[] | undefined;
    for (const f of fired) {
      for (const recipient of scheme[f.event]) {
        let ids: (string | null | undefined)[];
        switch (recipient) {
          case 'CONCERNED': ids = f.concerned ?? []; break;
          case 'REPORTER': ids = [issue.reporterId]; break;
          case 'ASSIGNEE': ids = [issue.assigneeId, f.previousAssigneeId]; break;
          case 'WATCHERS': ids = issue.watchers.map((w) => w.userId); break;
          case 'PROJECT_ADMINS': ids = admins ??= await this.schemes.projectAdmins(issue.projectId); break;
        }
        for (const id of ids) {
          if (!id) continue;
          to.add(id);
          if (!r.has(id)) this.add(r, id, f.type, f.detail);
        }
      }
    }
    return to;
  }

  /** `portal`: the recipients are service desk customers, so link to their request in the help center. */
  /** `only`: the users to email (the notification scheme's choice); everyone when omitted. */
  private async email(ids: string[], actorId: string, issue: IssueRef, portal = false, emailed: string[] = [], only?: Set<string>) {
    const [notifications, actor, channel] = await Promise.all([
      this.prisma.notification.findMany({
        where: { id: { in: ids }, user: { emailNotifications: true }, ...(only ? { userId: { in: [...only] } } : {}) },
        include: { user: { select: { email: true, name: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }),
      // Customers reply to the service desk's own address; the reply is added to the request (the key is in the subject).
      portal ? this.prisma.emailChannel.findFirst({ where: { projectId: issue.projectId, enabled: true }, select: { address: true } }) : null,
    ]);
    const skip = new Set(emailed.map((e) => e.toLowerCase()));
    const who = actor?.name ?? 'Someone';
    const appUrl = this.mailer.appUrl();
    const url = portal ? `${appUrl}/portal/requests/${issue.key}` : `${appUrl}/browse/${issue.key}`;
    const noun = portal ? 'request' : 'issue';
    const reason = portal ? 'you raised or were added to this request' : 'you are involved in this issue';
    const replyHint = channel ? 'Reply to this email to add a comment to the request.' : null;
    for (const n of notifications.filter((x) => !skip.has(x.user.email.toLowerCase()))) {
      const line = this.sentence(n.type, who, issue.key);
      const ok = await this.mailer.send({
        to: n.user.email,
        subject: `[Conductor] (${issue.key}) ${issue.summary}`,
        text: `${line}\n\n${issue.key}: ${issue.summary}\n${n.detail ? `\n${n.detail}\n` : ''}\nView the ${noun}: ${url}\n\n`
          + `${replyHint ? `${replyHint}\n\n` : ''}You receive this because ${reason}. Turn off email notifications from your profile menu.`,
        html: this.html(line, issue, n.detail, url, noun, reason, replyHint),
        replyTo: channel?.address,
      });
      if (ok) await this.prisma.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
    }
  }

  sentence(type: NotificationType, who: string, key: string) {
    switch (type) {
      case NotificationType.CREATED: return `${who} created ${key}`;
      case NotificationType.ASSIGNED: return `${who} assigned ${key} to you`;
      case NotificationType.MENTIONED: return `${who} mentioned you on ${key}`;
      case NotificationType.COMMENTED: return `${who} commented on ${key}`;
      case NotificationType.STATUS_CHANGED: return `${who} changed the status of ${key}`;
      case NotificationType.UPDATED: return `${who} updated ${key}`;
      case NotificationType.WATCHING: return `${who} added you as a watcher of ${key}`;
      case NotificationType.DELETED: return `${who} deleted ${key}`;
    }
  }

  private html(
    line: string, issue: IssueRef, detail: string | null, url: string, noun = 'issue', reason = 'you are involved in this issue', replyHint: string | null = null,
  ) {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    return `<!doctype html><html><body style="margin:0;background:#F4F5F7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#172B4D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:3px;border:1px solid #DFE1E6">
<tr><td style="padding:20px 24px;border-bottom:1px solid #DFE1E6;font-weight:600;color:#0052CC">Conductor</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 16px;font-size:15px">${esc(line)}</p>
<p style="margin:0 0 8px;font-size:14px"><a href="${esc(url)}" style="color:#0052CC;text-decoration:none;font-weight:600">${esc(issue.key)}</a> ${esc(issue.summary)}</p>
${detail ? `<div style="margin:12px 0;padding:12px;background:#F4F5F7;border-radius:3px;font-size:14px;white-space:pre-wrap">${esc(detail)}</div>` : ''}
<p style="margin:20px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#0052CC;color:#fff;padding:8px 14px;border-radius:3px;text-decoration:none;font-size:14px;font-weight:500">View ${noun}</a></p>
${replyHint ? `<p style="margin:16px 0 0;font-size:13px;color:#6B778C">${esc(replyHint)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #DFE1E6;font-size:12px;color:#6B778C">You receive this because ${esc(reason)}. You can turn off email notifications from your profile menu in Conductor.</td></tr>
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
