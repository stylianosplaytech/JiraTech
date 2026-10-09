import { BadRequestException, Injectable } from '@nestjs/common';
import { IssueStatus, IssueType, Priority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProject } from '../common/project.util';

/** Broad buckets used where the report groups many issue types together. */
export type TypeGroup = 'EPIC' | 'STORY' | 'BUG' | 'TASK' | 'OTHER';

const TYPE_GROUPS: Record<IssueType, TypeGroup> = {
  EPIC: 'EPIC', FEATURE_EPIC: 'EPIC', BAU_EPIC: 'EPIC', RELEASE_EPIC: 'EPIC',
  STORY: 'STORY',
  DEFECT: 'BUG', BUG_FIX: 'BUG',
  TASK: 'TASK', SUB_TASK: 'TASK',
  RELEASE_CANDIDATE: 'OTHER', ANALYSIS: 'OTHER', CODE: 'OTHER', CODE_REVIEW: 'OTHER',
  ARCH_REVIEW: 'OTHER', CODE_MERGE: 'OTHER', DOCUMENTATION: 'OTHER', TEST_CASE: 'OTHER',
  TEST_RUN: 'OTHER', DEPLOYMENT: 'OTHER', CONFIGURATION: 'OTHER',
};

const PRIORITY_ORDER: Priority[] = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];
const TIMELINE_GROUPS: TypeGroup[] = ['BUG', 'STORY', 'EPIC'];
const TOP_ASSIGNEES = 14;
const TOP_LONGEST = 10;
const DAY = 86_400_000;

const count = <K extends string>(items: K[]) => {
  const out: Partial<Record<K, number>> = {};
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return out;
};

const parseDate = (value: string | undefined, name: string) => {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`'${name}' must be a date (YYYY-MM-DD)`);
  return d;
};

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Everything the Reports pages show for one project. The period selects issues by
   * creation date; "closed per month" covers the 12 months ending at `to` for the
   * whole project, since it measures throughput rather than the period's issues.
   */
  async getReport(projectKey?: string, fromParam?: string, toParam?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    const now = new Date();
    const toDay = parseDate(toParam, 'to') ?? now;
    // Include the whole of the end day.
    const to = new Date(Date.UTC(toDay.getUTCFullYear(), toDay.getUTCMonth(), toDay.getUTCDate(), 23, 59, 59, 999));
    const from = parseDate(fromParam, 'from')
      ?? new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), 1));
    if (from > to) throw new BadRequestException("'from' must be on or before 'to'");
    const monthsStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));

    const [statuses, issues, closedInWindow] = await Promise.all([
      this.prisma.workflowStatus.findMany({
        where: { projectId: project.id },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, category: true },
      }),
      this.prisma.issue.findMany({
        where: { projectId: project.id, createdAt: { gte: from, lte: to } },
        select: {
          id: true, key: true, summary: true, type: true, status: true, priority: true,
          createdAt: true, updatedAt: true,
          workflowStatus: { select: { name: true } },
          assignee: { select: { id: true, name: true } },
          parent: { select: { key: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.issue.findMany({
        where: { projectId: project.id, status: IssueStatus.CLOSED, updatedAt: { gte: monthsStart } },
        select: { id: true, type: true, updatedAt: true },
      }),
    ]);

    // When each closed issue was closed: its last move into a done status, else its last update.
    const closedNames = statuses.filter((s) => s.category === IssueStatus.CLOSED).map((s) => s.name);
    const closedIds = closedInWindow.map((i) => i.id);
    const closures = closedIds.length && closedNames.length
      ? await this.prisma.issueHistory.findMany({
          where: { issueId: { in: closedIds }, field: 'status', toValue: { in: closedNames } },
          select: { issueId: true, createdAt: true },
        })
      : [];
    const closedAt = new Map<string, Date>();
    for (const c of closures) {
      const prev = closedAt.get(c.issueId);
      if (!prev || c.createdAt > prev) closedAt.set(c.issueId, c.createdAt);
    }

    const statusName = (i: (typeof issues)[number]) => i.workflowStatus?.name ?? i.status;
    const open = issues.filter((i) => i.status !== IssueStatus.CLOSED);
    const closed = issues.filter((i) => i.status === IssueStatus.CLOSED);
    const total = issues.length;

    // Issue status, in workflow order; statuses no longer in the workflow go last.
    const statusCounts = count(issues.map(statusName));
    const byStatus = [
      ...statuses.map((s) => ({ name: s.name, category: s.category, count: statusCounts[s.name] ?? 0 })),
      ...Object.entries(statusCounts)
        .filter(([name]) => !statuses.some((s) => s.name === name))
        .map(([name, n]) => ({ name, category: name as IssueStatus, count: n! })),
    ].filter((s) => s.count > 0);

    const byType = Object.entries(count(issues.map((i) => i.type)))
      .map(([type, n]) => ({ type, count: n! }))
      .sort((a, b) => b.count - a.count);
    const priorityCounts = count(issues.map((i) => i.priority));
    const byPriority = PRIORITY_ORDER.map((p) => ({ priority: p, count: priorityCounts[p] ?? 0 })).filter((p) => p.count);
    const pendingCounts = count(open.map((i) => i.type));
    const pendingByType = Object.entries(pendingCounts)
      .map(([type, n]) => ({ type, count: n! }))
      .sort((a, b) => b.count - a.count);

    // Closed by the assignee the issue had when closed (its current assignee).
    const assigneeCounts = new Map<string, { name: string; count: number }>();
    let unassignedClosed = 0;
    for (const i of closed) {
      if (!i.assignee) { unassignedClosed++; continue; }
      const entry = assigneeCounts.get(i.assignee.id) ?? { name: i.assignee.name, count: 0 };
      entry.count++;
      assigneeCounts.set(i.assignee.id, entry);
    }
    const closedByAssignee = [...assigneeCounts.values()].sort((a, b) => b.count - a.count).slice(0, TOP_ASSIGNEES);

    // Closed per month, split by type group.
    const months = Array.from({ length: 12 }, (_, n) => {
      const d = new Date(Date.UTC(monthsStart.getUTCFullYear(), monthsStart.getUTCMonth() + n, 1));
      return { month: d.toISOString().slice(0, 7), EPIC: 0, STORY: 0, BUG: 0, TASK: 0, OTHER: 0, total: 0 };
    });
    for (const i of closedInWindow) {
      const when = closedAt.get(i.id) ?? i.updatedAt;
      const m = months.find((x) => x.month === when.toISOString().slice(0, 7));
      if (!m || when > to) continue;
      m[TYPE_GROUPS[i.type]]++;
      m.total++;
    }

    const toRow = (i: (typeof issues)[number]) => ({
      key: i.key,
      summary: i.summary,
      type: i.type,
      typeGroup: TYPE_GROUPS[i.type],
      priority: i.priority,
      status: i.status,
      statusName: statusName(i),
      createdAt: i.createdAt,
      assignee: i.assignee?.name ?? null,
      parentKey: i.parent?.key ?? null,
      ageDays: Math.max(0, Math.floor((to.getTime() - i.createdAt.getTime()) / DAY)),
    });

    const longestOpen = TIMELINE_GROUPS.map((group) => ({
      group,
      issues: open.filter((i) => TYPE_GROUPS[i.type] === group).slice(0, TOP_LONGEST).map(toRow),
    }));

    const priorityRank = (p: Priority) => PRIORITY_ORDER.indexOf(p);
    const openRows = open
      .map(toRow)
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || +a.createdAt - +b.createdAt);
    const openPriorityCounts = count(open.map((i) => i.priority));

    const doing = issues.some((i) => i.status === IssueStatus.DOING);
    return {
      project: { key: project.key, name: project.name },
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      generatedAt: now,
      summary: {
        total,
        open: open.length,
        closed: closed.length,
        percentComplete: total ? Math.round((closed.length / total) * 100) : 0,
        overallStatus: !total ? 'No issues' : !open.length ? 'Done' : doing || closed.length ? 'In Progress' : 'Not Started',
      },
      byStatus,
      byType,
      byPriority,
      pendingByType,
      closedByAssignee,
      unassignedClosed,
      closedPerMonth: months,
      longestOpen,
      openByPriority: PRIORITY_ORDER.map((p) => ({ priority: p, count: openPriorityCounts[p] ?? 0 })).filter((p) => p.count),
      openIssues: openRows,
    };
  }
}
