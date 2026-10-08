import { Injectable } from '@nestjs/common';
import { IssueType, Priority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PRIORITY_ORDER } from '../common/issue-rules';

export interface ScheduleResult {
  scheduled: ScheduledItem[];
  unscheduled: ScheduledItem[];
  unusedCapacity: Record<string, number>;
  criticalPaths: string[][];
  violatedConstraints: string[];
}

interface ScheduledItem {
  id: string;
  key: string;
  summary: string;
  type: IssueType;
  priority: Priority;
  estimate: number | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  componentIds: string[];
  dependencies: string[];
}

@Injectable()
export class SchedulingService {
  constructor(private prisma: PrismaService) {}

  async runSchedule(piId: string, teamCapacity: Record<string, number> = {}): Promise<ScheduleResult> {
    const pi = await this.prisma.programIncrement.findUniqueOrThrow({
      where: { id: piId },
      include: { sprints: { orderBy: { startDate: 'asc' } } },
    });

    const issues = await this.prisma.issue.findMany({
      where: { projectId: pi.projectId, piId },
      include: {
        components: true,
        linksFrom: { where: { type: 'DEPENDS_ON' } },
      },
    });

    const ordered = this.orderWorkItems(issues);
    const scheduled: ScheduledItem[] = [];
    const unscheduled: ScheduledItem[] = [];
    const capacity = { ...teamCapacity };
    const violatedConstraints: string[] = [];
    const piStart = pi.startDate;
    let dayOffset = 0;

    for (const issue of ordered) {
      const teamIds = issue.components.map((c) => c.componentId);
      const estimate = issue.estimate ?? 8;
      const depEnds = issue.linksFrom.map((l) => {
        const dep = scheduled.find((s) => s.id === l.targetId);
        return dep?.scheduledEnd ? new Date(dep.scheduledEnd).getTime() : 0;
      });
      const earliestStart = depEnds.length ? Math.max(...depEnds) : piStart.getTime();
      const startDay = Math.max(dayOffset, Math.ceil((earliestStart - piStart.getTime()) / 86400000));

      const team = teamIds[0] ?? 'default';
      const available = capacity[team] ?? 40;
      if (available < estimate) {
        unscheduled.push(this.toScheduledItem(issue));
        violatedConstraints.push(`${issue.key}: insufficient capacity for team ${team}`);
        continue;
      }

      capacity[team] = available - estimate;
      const start = new Date(piStart.getTime() + startDay * 86400000);
      const end = new Date(start.getTime() + estimate * 3600000);

      const item = { ...this.toScheduledItem(issue), scheduledStart: start, scheduledEnd: end };
      scheduled.push(item);

      await this.prisma.issue.update({
        where: { id: issue.id },
        data: { scheduledStart: start, scheduledEnd: end },
      });

      dayOffset = startDay + Math.ceil(estimate / 8);
    }

    const criticalPaths = this.computeCriticalPaths(scheduled, issues);

    return {
      scheduled,
      unscheduled,
      unusedCapacity: capacity,
      criticalPaths,
      violatedConstraints,
    };
  }

  async captureBaseline(piId: string, name: string, capturedBy?: string) {
    const issues = await this.prisma.issue.findMany({
      where: { piId },
      select: {
        id: true, key: true, summary: true, status: true, sprintId: true,
        scheduledStart: true, scheduledEnd: true, estimate: true, priority: true,
      },
    });
    return this.prisma.baseline.create({
      data: { name, piId, snapshot: issues, capturedBy },
    });
  }

  async getBaselines(piId: string) {
    return this.prisma.baseline.findMany({
      where: { piId },
      orderBy: { capturedAt: 'desc' },
    });
  }

  private orderWorkItems(issues: Array<{
    id: string; key: string; summary: string; type: IssueType; priority: Priority;
    estimate: number | null; rank: number | null; parentId: string | null;
    components: { componentId: string }[];
    linksFrom: { targetId: string }[];
  }>) {
    const priorityIdx = (p: Priority) => PRIORITY_ORDER.indexOf(p as typeof PRIORITY_ORDER[number]);

    return [...issues].sort((a, b) => {
      const pa = priorityIdx(a.priority);
      const pb = priorityIdx(b.priority);
      if (pa !== pb) return pa - pb;
      if (a.type === IssueType.DEFECT && b.type !== IssueType.DEFECT) return -1;
      if (b.type === IssueType.DEFECT && a.type !== IssueType.DEFECT) return 1;
      return (a.rank ?? 999) - (b.rank ?? 999);
    });
  }

  private toScheduledItem(issue: {
    id: string; key: string; summary: string; type: IssueType; priority: Priority;
    estimate: number | null; components: { componentId: string }[];
    linksFrom: { targetId: string }[];
  }): ScheduledItem {
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      type: issue.type,
      priority: issue.priority,
      estimate: issue.estimate,
      scheduledStart: null,
      scheduledEnd: null,
      componentIds: issue.components.map((c) => c.componentId),
      dependencies: issue.linksFrom.map((l) => l.targetId),
    };
  }

  private computeCriticalPaths(
    scheduled: ScheduledItem[],
    allIssues: { id: string; priority: Priority; parentId: string | null }[],
  ): string[][] {
    const highest = allIssues.filter((i) => i.priority === Priority.HIGHEST);
    const paths: string[][] = [];
    for (const item of highest) {
      const chain = scheduled.filter((s) => s.id === item.id || s.dependencies.includes(item.id));
      if (chain.length) paths.push(chain.map((s) => s.key));
    }
    return paths;
  }
}
