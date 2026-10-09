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

const STATUS_ORDER = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];
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

interface SortRow {
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

function compareRows(a: SortRow, b: SortRow, sorts: JqlSort[]): number {
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
