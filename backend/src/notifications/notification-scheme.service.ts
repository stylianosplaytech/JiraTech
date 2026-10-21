import { BadRequestException, Injectable } from '@nestjs/common';
import { ProjectRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Issue events that can send an email. */
export const SCHEME_EVENTS = [
  'ISSUE_CREATED', 'ISSUE_UPDATED', 'ISSUE_ASSIGNED', 'STATUS_CHANGED',
  'COMMENTED', 'MENTIONED', 'WATCHER_ADDED', 'ISSUE_DELETED',
] as const;
export type SchemeEvent = (typeof SCHEME_EVENTS)[number];

/**
 * Who an event can email. CONCERNED is the person the event is about (the one mentioned or added as a watcher).
 * On ISSUE_ASSIGNED, ASSIGNEE means both the new and the previous assignee.
 */
export const SCHEME_RECIPIENTS = ['CONCERNED', 'REPORTER', 'ASSIGNEE', 'WATCHERS', 'PROJECT_ADMINS'] as const;
export type SchemeRecipient = (typeof SCHEME_RECIPIENTS)[number];

export type NotificationScheme = Record<SchemeEvent, SchemeRecipient[]>;

const ABOUT_ISSUE: SchemeRecipient[] = ['REPORTER', 'ASSIGNEE', 'WATCHERS', 'PROJECT_ADMINS'];

/** The recipients that make sense for each event. */
export const APPLICABLE: NotificationScheme = {
  ISSUE_CREATED: ABOUT_ISSUE,
  ISSUE_UPDATED: ABOUT_ISSUE,
  ISSUE_ASSIGNED: ABOUT_ISSUE,
  STATUS_CHANGED: ABOUT_ISSUE,
  COMMENTED: ABOUT_ISSUE,
  MENTIONED: ['CONCERNED'],
  WATCHER_ADDED: ['CONCERNED'],
  ISSUE_DELETED: ABOUT_ISSUE,
};

/** What Conductor did before the scheme could be configured. */
export const DEFAULT_SCHEME: NotificationScheme = {
  ISSUE_CREATED: ['ASSIGNEE', 'WATCHERS'],
  ISSUE_UPDATED: ['REPORTER', 'ASSIGNEE', 'WATCHERS'],
  ISSUE_ASSIGNED: ['REPORTER', 'ASSIGNEE', 'WATCHERS'],
  STATUS_CHANGED: ['REPORTER', 'ASSIGNEE', 'WATCHERS'],
  COMMENTED: ['REPORTER', 'ASSIGNEE', 'WATCHERS'],
  MENTIONED: ['CONCERNED'],
  WATCHER_ADDED: ['CONCERNED'],
  ISSUE_DELETED: ['REPORTER', 'ASSIGNEE', 'WATCHERS'],
};

/** Keeps known events and the recipients that apply to them; missing events take the fallback. */
function normalize(raw: unknown, fallback: NotificationScheme): NotificationScheme {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as NotificationScheme;
  for (const event of SCHEME_EVENTS) {
    const value = input[event];
    out[event] = Array.isArray(value)
      ? APPLICABLE[event].filter((r) => value.includes(r))
      : [...fallback[event]];
  }
  return out;
}

function parse(json: string | null | undefined, fallback: NotificationScheme): NotificationScheme | null {
  if (!json) return null;
  try {
    return normalize(JSON.parse(json), fallback);
  } catch {
    return null;
  }
}

/** Rejects unknown events and recipients instead of silently dropping them. */
function validate(scheme: Record<string, unknown>): NotificationScheme {
  for (const [event, recipients] of Object.entries(scheme)) {
    if (!SCHEME_EVENTS.includes(event as SchemeEvent)) throw new BadRequestException(`Unknown event: ${event}`);
    if (!Array.isArray(recipients)) throw new BadRequestException(`${event} must be a list of recipients`);
    for (const r of recipients) {
      if (!APPLICABLE[event as SchemeEvent].includes(r as SchemeRecipient)) {
        throw new BadRequestException(`${String(r)} can't be emailed about ${event}`);
      }
    }
  }
  return normalize(scheme, DEFAULT_SCHEME);
}

/** Who is emailed about issue events: a global scheme (admins) that each project can override (its admins). */
@Injectable()
export class NotificationSchemeService {
  constructor(private prisma: PrismaService) {}

  async getGlobal() {
    const s = await this.prisma.mailSettings.findUnique({ where: { id: 'default' }, select: { notificationScheme: true } });
    const scheme = parse(s?.notificationScheme, DEFAULT_SCHEME);
    return { scheme: scheme ?? DEFAULT_SCHEME, isDefault: !scheme, defaults: DEFAULT_SCHEME };
  }

  /** `scheme: null` goes back to the built-in defaults. */
  async saveGlobal(scheme: Record<string, unknown> | null) {
    const notificationScheme = scheme ? JSON.stringify(validate(scheme)) : null;
    await this.prisma.mailSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', notificationScheme },
      update: { notificationScheme },
    });
    return this.getGlobal();
  }

  async getProject(key: string) {
    const [project, global] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { key }, select: { notificationScheme: true } }),
      this.getGlobal(),
    ]);
    const own = parse(project.notificationScheme, global.scheme);
    return { scheme: own ?? global.scheme, inherited: !own, global: global.scheme };
  }

  /** `scheme: null` makes the project use the global scheme again. */
  async saveProject(key: string, scheme: Record<string, unknown> | null) {
    await this.prisma.project.update({
      where: { key },
      data: { notificationScheme: scheme ? JSON.stringify(validate(scheme)) : null },
    });
    return this.getProject(key);
  }

  /** The scheme in force for a project's issues. */
  async effective(projectId: string): Promise<NotificationScheme> {
    const [project, global] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { notificationScheme: true } }),
      this.getGlobal(),
    ]);
    return parse(project?.notificationScheme, global.scheme) ?? global.scheme;
  }

  /** The project's lead and the members with the Administrator role. */
  async projectAdmins(projectId: string): Promise<string[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { leadId: true, members: { where: { role: ProjectRole.ADMIN }, select: { userId: true } } },
    });
    if (!project) return [];
    return [...new Set([...(project.leadId ? [project.leadId] : []), ...project.members.map((m) => m.userId)])];
  }
}
