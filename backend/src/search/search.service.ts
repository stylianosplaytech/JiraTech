import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { PRIORITY_ORDER } from '../common/issue-rules';
import { compileJql, JqlError, JqlSort } from './jql';
import { AccessService } from '../access/access.service';
import { contains } from '../common/text-match';
import { calendarDay } from '../common/due-date';

export const SEARCH_INCLUDE = {
  workflowStatus: { select: { id: true, name: true, category: true } },
  project: { select: { id: true, key: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
  parent: { select: { id: true, key: true, summary: true, type: true } },
  labels: { include: { label: true } },
  components: { include: { component: true } },
  _count: { select: { comments: true, children: true } },
} satisfies Prisma.IssueInclude;

/** Fields every issue has exactly one value of. */
export const SINGLE_FIELDS = ['status', 'priority', 'type', 'assignee', 'reporter', 'project'] as const;
export type SingleField = (typeof SINGLE_FIELDS)[number];
/** Fields an issue can have several values of (or none): an issue is counted under each of its values. */
export const MULTI_FIELDS = ['label', 'component', 'fixVersion'] as const;
export type MultiField = (typeof MULTI_FIELDS)[number];
export const BREAKDOWN_FIELDS = [...SINGLE_FIELDS, ...MULTI_FIELDS] as const;
export type BreakdownField = (typeof BREAKDOWN_FIELDS)[number];
export const isMultiField = (f: string): f is MultiField => (MULTI_FIELDS as readonly string[]).includes(f);

const STATUS_ORDER =['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];
// Above this many matches, priority/status sorting (done in memory) is truncated.
const MEMORY_SORT_LIMIT = 5000;

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService, private access: AccessService) {}

  /** Restrict a query to projects the user is allowed to browse. */
  private async visible(user: AuthUser, where: Prisma.IssueWhereInput): Promise<Prisma.IssueWhereInput> {
    const ids = await this.access.browsableProjectIds(user);
    return ids === null ? where : { AND: [where, { projectId: { in: ids } }] };
  }

  async search(jql: string, user: AuthUser, startAt = 0, maxResults = 50) {
    const compiled = this.compile(jql, user);
    const take = Math.min(Math.max(maxResults, 1), 200);
    const skip = Math.max(startAt, 0);
    const where = await this.visible(user, compiled.where);
    const total = await this.prisma.issue.count({ where });

    let issues;
    if (compiled.orderBy.some((s) => s.field === 'priority' || s.field === 'status')) {
      // SQLite stores enums as text, so rank priority/status in memory.
      const rows = await this.prisma.issue.findMany({
        where,
        select: {
          id: true, key: true, number: true, summary: true, type: true, priority: true, status: true,
          createdAt: true, updatedAt: true, assignee: { select: { name: true } },
        },
        take: MEMORY_SORT_LIMIT,
      });
      rows.sort((a, b) => compareRows(a, b, compiled.orderBy));
      const pageIds = rows.slice(skip, skip + take).map((r) => r.id);
      const page = await this.prisma.issue.findMany({ where: { id: { in: pageIds } }, include: SEARCH_INCLUDE });
      const byId = new Map(page.map((i) => [i.id, i]));
      issues = pageIds.map((id) => byId.get(id)!).filter(Boolean);
    } else {
      issues = await this.prisma.issue.findMany({
        where,
        include: SEARCH_INCLUDE,
        orderBy: compiled.orderBy.flatMap(toPrismaOrder),
        skip,
        take,
      });
    }

    return { jql, startAt: skip, maxResults: take, total, issues };
  }

  /** Validate a JQL string without running it. */
  validate(jql: string, user: AuthUser) {
    this.compile(jql, user);
    return { valid: true };
  }

  /** Whether one issue matches a JQL query (ordering and who may browse the issue are not considered). */
  async matches(jql: string, issueId: string, user: AuthUser) {
    const compiled = this.compile(jql, user);
    return (await this.prisma.issue.count({ where: { AND: [compiled.where, { id: issueId }] } })) > 0;
  }

  /** Up to `take` issues matching a JQL query that the user can browse, oldest first (for scheduled automation). */
  async findMatching(jql: string, user: AuthUser, take: number, projectId?: string) {
    const compiled = this.compile(jql, user);
    const where = await this.visible(user, projectId ? { AND: [compiled.where, { projectId }] } : compiled.where);
    return this.prisma.issue.findMany({ where, select: { id: true, key: true, projectId: true }, orderBy: { createdAt: 'asc' }, take });
  }

  /** How many issues a JQL query finds (the user's browsable projects only). */
  async count(jql: string, user: AuthUser) {
    const where = await this.visible(user, this.compile(jql, user).where);
    return this.prisma.issue.count({ where });
  }

  /** The issues a JQL query finds, counted by one field, largest group first. */
  async countBy(jql: string, field: BreakdownField, user: AuthUser) {
    const where = await this.visible(user, this.compile(jql, user).where);
    if (isMultiField(field)) return this.countByMulti(where, field);
    const column = ({ assignee: 'assigneeId', reporter: 'reporterId', project: 'projectId' } as const)[field as 'assignee'] ?? field;
    const rows = await this.prisma.issue.groupBy({ by: [column], where, _count: true });
    const valueOf = (r: object) => (r as Record<string, string | null>)[column];
    const ids = rows.flatMap((r) => valueOf(r) ?? []);
    const names = new Map<string, string>();
    if (field === 'assignee' || field === 'reporter') {
      for (const u of await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.set(u.id, u.name);
    } else if (field === 'project') {
      for (const p of await this.prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.set(p.id, p.name);
    }
    const groups = rows
      .map((r) => {
        const value = valueOf(r);
        const named = field === 'assignee' || field === 'reporter' || field === 'project';
        const label = named ? (value ? names.get(value) ?? 'Unknown' : field === 'assignee' ? 'Unassigned' : 'None') : value ?? 'None';
        return { key: value ?? '', label, count: r._count };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return { total: groups.reduce((n, g) => n + g.count, 0), groups };
  }

  /**
   * Issues counted under each label, component or fix version they have, largest first, with the issues that have
   * none last. `total` is the number of issues, so an issue with two labels counts once there and in both groups.
   */
  private async countByMulti(where: Prisma.IssueWhereInput, field: MultiField) {
    const inIssues = { issue: where };
    const none: Prisma.IssueWhereInput =
      field === 'label' ? { labels: { none: {} } } : field === 'component' ? { components: { none: {} } } : { versions: { none: { isFix: true } } };
    const [total, unset, rows] = await Promise.all([
      this.prisma.issue.count({ where }),
      this.prisma.issue.count({ where: { AND: [where, none] } }),
      field === 'label'
        ? this.prisma.issueLabel.groupBy({ by: ['labelId'], where: inIssues, _count: true })
        : field === 'component'
          ? this.prisma.issueComponent.groupBy({ by: ['componentId'], where: inIssues, _count: true })
          : this.prisma.issueVersion.groupBy({ by: ['versionId'], where: { ...inIssues, isFix: true }, _count: true }),
    ]);
    const idOf = (r: object) => Object.values(r).find((v) => typeof v === 'string') as string;
    const ids = (rows as object[]).map(idOf);
    const named = field === 'label'
      ? await this.prisma.label.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : field === 'component'
        ? await this.prisma.component.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : await this.prisma.version.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const names = new Map(named.map((n) => [n.id, n.name]));
    const groups = (rows as (object & { _count: number })[])
      .map((r) => ({ key: idOf(r), label: names.get(idOf(r)) ?? 'Unknown', count: r._count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    if (unset) groups.push({ key: '', label: field === 'label' ? 'No label' : field === 'component' ? 'No component' : 'No fix version', count: unset });
    return { total, groups };
  }

  /** The issues a JQL query finds counted by two fields at once: rows by `field`, each split by `stack`. Largest row first. */
  async countByTwo(jql: string, field: SingleField, stack: SingleField, user: AuthUser) {
    const where = await this.visible(user, this.compile(jql, user).where);
    const columnOf = (f: SingleField) => ({ assignee: 'assigneeId', reporter: 'reporterId', project: 'projectId' } as const)[f as 'assignee'] ?? f;
    const rowCol = columnOf(field);
    const stackCol = columnOf(stack);
    const found = await this.prisma.issue.groupBy({ by: [rowCol, stackCol] as unknown as 'status'[], where, _count: true });
    const rows = found as unknown as (Record<string, string | null> & { _count: number })[];
    const ids = { user: new Set<string>(), project: new Set<string>() };
    for (const [f, col] of [[field, rowCol], [stack, stackCol]] as const) {
      for (const r of rows) {
        const v = r[col];
        if (v && (f === 'assignee' || f === 'reporter')) ids.user.add(v);
        else if (v && f === 'project') ids.project.add(v);
      }
    }
    const names = new Map<string, string>();
    for (const u of await this.prisma.user.findMany({ where: { id: { in: [...ids.user] } }, select: { id: true, name: true } })) names.set(u.id, u.name);
    for (const p of await this.prisma.project.findMany({ where: { id: { in: [...ids.project] } }, select: { id: true, name: true } })) names.set(p.id, p.name);
    const labelOf = (f: SingleField, value: string | null) => {
      const named = f === 'assignee' || f === 'reporter' || f === 'project';
      return named ? (value ? names.get(value) ?? 'Unknown' : f === 'assignee' ? 'Unassigned' : 'None') : value ?? 'None';
    };

    const stacks = new Map<string, { key: string; label: string; count: number }>();
    const grouped = new Map<string, { key: string; label: string; total: number; counts: Map<string, number> }>();
    for (const r of rows) {
      const rowKey = r[rowCol] ?? '';
      const stackKey = r[stackCol] ?? '';
      const s = stacks.get(stackKey) ?? { key: stackKey, label: labelOf(stack, r[stackCol]), count: 0 };
      s.count += r._count;
      stacks.set(stackKey, s);
      const g = grouped.get(rowKey) ?? { key: rowKey, label: labelOf(field, r[rowCol]), total: 0, counts: new Map() };
      g.total += r._count;
      g.counts.set(stackKey, (g.counts.get(stackKey) ?? 0) + r._count);
      grouped.set(rowKey, g);
    }
    const stackList = [...stacks.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const groups = [...grouped.values()]
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
      .map((g) => ({ key: g.key, label: g.label, total: g.total, counts: stackList.map((s) => g.counts.get(s.key) ?? 0) }));
    return {
      total: groups.reduce((n, g) => n + g.total, 0),
      stacks: stackList.map(({ key, label }) => ({ key, label })),
      groups,
    };
  }

  /** When the issues a JQL query finds were created and resolved, for those resolved since `since`. */
  async resolvedSince(jql: string, since: Date, user: AuthUser) {
    const compiled = this.compile(jql, user);
    const where = await this.visible(user, {
      AND: [compiled.where, { status: 'CLOSED' }, { OR: [{ resolvedAt: { gte: since } }, { resolvedAt: null, updatedAt: { gte: since } }] }],
    });
    const rows = await this.prisma.issue.findMany({ where, select: { createdAt: true, resolvedAt: true, updatedAt: true }, take: MEMORY_SORT_LIMIT * 10 });
    return rows.map((r) => ({ createdAt: r.createdAt, resolvedAt: r.resolvedAt ?? r.updatedAt }));
  }

  /** Unresolved issues a JQL query finds, the ones untouched for longest first. */
  async stale(jql: string, user: AuthUser, take: number) {
    const compiled = this.compile(jql, user);
    const where = await this.visible(user, { AND: [compiled.where, { status: { not: 'CLOSED' } }] });
    const [total, issues] = await Promise.all([
      this.prisma.issue.count({ where }),
      this.prisma.issue.findMany({ where, include: SEARCH_INCLUDE, orderBy: { updatedAt: 'asc' }, take }),
    ]);
    return { total, issues };
  }

  /**
   * Unresolved issues a JQL query finds that are overdue or fall due within `days` days (today included),
   * soonest first, with how many are overdue and how many are due in the window.
   */
  async dueSoon(jql: string, days: number, user: AuthUser, take: number) {
    const compiled = this.compile(jql, user);
    const today = calendarDay(new Date());
    const open = await this.visible(user, { AND: [compiled.where, { status: { not: 'CLOSED' } }] });
    const inWindow: Prisma.IssueWhereInput = { AND: [open, { dueDate: { lt: new Date(today.getTime() + days * 86_400_000) } }] };
    const [overdue, total, issues] = await Promise.all([
      this.prisma.issue.count({ where: { AND: [open, { dueDate: { lt: today } }] } }),
      this.prisma.issue.count({ where: inWindow }),
      this.prisma.issue.findMany({ where: inWindow, include: SEARCH_INCLUDE, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take }),
    ]);
    return { overdue, upcoming: total - overdue, issues };
  }

  /** The issues a JQL query finds, the most recently changed first. */
  async recentlyUpdated(jql: string, user: AuthUser, take: number) {
    const where = await this.visible(user, this.compile(jql, user).where);
    const [total, issues] = await Promise.all([
      this.prisma.issue.count({ where }),
      this.prisma.issue.findMany({ where, include: SEARCH_INCLUDE, orderBy: { updatedAt: 'desc' }, take }),
    ]);
    return { total, issues };
  }

  /** The closed issues a JQL query finds, the most recently resolved first. */
  async recentlyResolved(jql: string, user: AuthUser, take: number) {
    const where = await this.visible(user, { AND: [this.compile(jql, user).where, { status: 'CLOSED' }] });
    const [total, issues] = await Promise.all([
      this.prisma.issue.count({ where }),
      // Issues closed before resolution dates were recorded have none; they sort last, by when they were last updated.
      this.prisma.issue.findMany({ where, include: SEARCH_INCLUDE, orderBy: [{ resolvedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }], take }),
    ]);
    return { total, issues };
  }

  /** Unresolved issues a JQL query finds that have no assignee, the ones waiting longest first. */
  async unassigned(jql: string, user: AuthUser, take: number) {
    const where = await this.visible(user, { AND: [this.compile(jql, user).where, { status: { not: 'CLOSED' } }, { assigneeId: null }] });
    const [total, issues] = await Promise.all([
      this.prisma.issue.count({ where }),
      this.prisma.issue.findMany({ where, include: SEARCH_INCLUDE, orderBy: { createdAt: 'asc' }, take }),
    ]);
    return { total, issues };
  }

  /** When the unresolved issues a JQL query finds were created. */
  async openCreated(jql: string, user: AuthUser) {
    const where = await this.visible(user, { AND: [this.compile(jql, user).where, { status: { not: 'CLOSED' } }] });
    const rows = await this.prisma.issue.findMany({ where, select: { createdAt: true }, take: MEMORY_SORT_LIMIT * 10 });
    return rows.map((r) => r.createdAt);
  }

  /** Created and resolved dates of every issue a JQL query finds, to work out how many were open at a point in time. */
  async lifetimes(jql: string, user: AuthUser) {
    const where = await this.visible(user, this.compile(jql, user).where);
    const rows = await this.prisma.issue.findMany({ where, select: { createdAt: true, resolvedAt: true, updatedAt: true, status: true }, take: MEMORY_SORT_LIMIT * 10 });
    // Issues closed before resolution dates were recorded count as resolved when last updated.
    return rows.map((r) => ({ createdAt: r.createdAt, resolvedAt: r.resolvedAt ?? (r.status === 'CLOSED' ? r.updatedAt : null) }));
  }

  /** Created and resolved dates of the issues a JQL query finds that were created or resolved since `since`. */
  async createdAndResolvedSince(jql: string, since: Date, user: AuthUser) {
    const compiled = this.compile(jql, user);
    const where = await this.visible(user, {
      AND: [compiled.where, { OR: [{ createdAt: { gte: since } }, { resolvedAt: { gte: since } }, { status: 'CLOSED', updatedAt: { gte: since } }] }],
    });
    const rows = await this.prisma.issue.findMany({ where, select: { createdAt: true, resolvedAt: true, updatedAt: true, status: true }, take: MEMORY_SORT_LIMIT * 10 });
    // Issues closed before resolution dates were recorded count as resolved when last updated.
    return rows.map((r) => ({ createdAt: r.createdAt, resolvedAt: r.resolvedAt ?? (r.status === 'CLOSED' ? r.updatedAt : null) }));
  }

  /** When the issues a JQL query finds were created, for counting per day or week. */
  async createdSince(jql: string, since: Date, user: AuthUser) {
    const compiled = this.compile(jql, user);
    const where = await this.visible(user, { AND: [compiled.where, { createdAt: { gte: since } }] });
    const rows = await this.prisma.issue.findMany({ where, select: { createdAt: true }, take: MEMORY_SORT_LIMIT * 10 });
    return rows.map((r) => r.createdAt);
  }

  async quickSearch(q: string, user: AuthUser) {
    const term = q.trim();
    const ids = await this.access.browsableProjectIds(user);
    const inProjects = ids === null ? {} : { projectId: { in: ids } };
    if (!term) return { issues: [], projects: [] };
    const upper = term.toUpperCase();
    const [exact, issues, projects] = await Promise.all([
      /^[A-Z][A-Z0-9]+-\d+$/.test(upper)
        ? this.prisma.issue.findFirst({ where: { key: upper, ...inProjects }, include: SEARCH_INCLUDE })
        : null,
      this.prisma.issue.findMany({
        where: { ...inProjects, OR: [{ key: contains(upper) }, { summary: contains(term) }] },
        include: SEARCH_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      this.prisma.project.findMany({
        where: { ...(ids === null ? {} : { id: { in: ids } }), OR: [{ key: contains(upper) }, { name: contains(term) }] },
        select: { id: true, key: true, name: true },
        take: 5,
      }),
    ]);
    const merged = exact ? [exact, ...issues.filter((i) => i.id !== exact.id)] : issues;
    return { issues: merged.slice(0, 8), projects };
  }

  // ─── Saved filters ─────────────────────────────────────────────────────────

  listFilters(user: AuthUser) {
    return this.prisma.savedFilter.findMany({
      where: { OR: [{ ownerId: user.id }, { shared: true }] },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async getFilter(id: string, user: AuthUser) {
    const filter = await this.prisma.savedFilter.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true } } },
    });
    if (!filter || (filter.ownerId !== user.id && !filter.shared)) throw new NotFoundException('Filter not found');
    return filter;
  }

  createFilter(data: { name: string; jql: string; description?: string; shared?: boolean }, user: AuthUser) {
    this.compile(data.jql, user);
    return this.prisma.savedFilter.create({
      data: { ...data, shared: data.shared ?? false, ownerId: user.id },
      include: { owner: { select: { id: true, name: true } } },
    });
  }

  async updateFilter(
    id: string,
    data: { name?: string; jql?: string; description?: string; shared?: boolean },
    user: AuthUser,
  ) {
    await this.assertOwner(id, user);
    if (data.jql !== undefined) this.compile(data.jql, user);
    return this.prisma.savedFilter.update({
      where: { id },
      data,
      include: { owner: { select: { id: true, name: true } } },
    });
  }

  async deleteFilter(id: string, user: AuthUser) {
    await this.assertOwner(id, user);
    await this.prisma.savedFilter.delete({ where: { id } });
    return { deleted: true };
  }

  private async assertOwner(id: string, user: AuthUser) {
    const filter = await this.prisma.savedFilter.findUnique({ where: { id } });
    if (!filter) throw new NotFoundException('Filter not found');
    if (filter.ownerId !== user.id) throw new ForbiddenException('Only the owner can change this filter');
  }

  private compile(jql: string, user: AuthUser) {
    try {
      return compileJql(jql, { currentUserId: user.id });
    } catch (e) {
      if (e instanceof JqlError) throw new BadRequestException(`JQL error: ${e.message}`);
      throw e;
    }
  }
}

function toPrismaOrder(s: JqlSort): Prisma.IssueOrderByWithRelationInput[] {
  switch (s.field) {
    case 'created':
      return [{ createdAt: s.direction }];
    case 'updated':
      return [{ updatedAt: s.direction }];
    case 'key':
      return [{ project: { key: s.direction } }, { number: s.direction }];
    case 'summary':
      return [{ summary: s.direction }];
    case 'type':
      return [{ type: s.direction }];
    case 'assignee':
      return [{ assignee: { name: s.direction } }];
    default:
      return [];
  }
}

export interface SortRow {
  key: string;
  number: number;
  summary: string;
  type: string;
  priority: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  assignee: { name: string } | null;
}

export function compareRows(a: SortRow, b: SortRow, sorts: JqlSort[]): number {
  for (const s of sorts) {
    let cmp = 0;
    switch (s.field) {
      // Jira's "priority DESC" puts Highest first.
      case 'priority':
        cmp = PRIORITY_ORDER.indexOf(b.priority as never) - PRIORITY_ORDER.indexOf(a.priority as never);
        break;
      case 'status':
        cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        break;
      case 'created':
        cmp = a.createdAt.getTime() - b.createdAt.getTime();
        break;
      case 'updated':
        cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
        break;
      case 'key':
        cmp = a.key.split('-')[0].localeCompare(b.key.split('-')[0]) || a.number - b.number;
        break;
      case 'summary':
        cmp = a.summary.localeCompare(b.summary);
        break;
      case 'type':
        cmp = a.type.localeCompare(b.type);
        break;
      case 'assignee':
        cmp = (a.assignee?.name ?? '￿').localeCompare(b.assignee?.name ?? '￿');
        break;
    }
    if (cmp !== 0) return s.direction === 'asc' ? cmp : -cmp;
  }
  return b.createdAt.getTime() - a.createdAt.getTime();
}
