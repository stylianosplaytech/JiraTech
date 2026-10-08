import { Injectable } from '@nestjs/common';
import { IssueStatus, RagStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProject } from '../common/project.util';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(piId?: string, projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    const where = { projectId: project.id, ...(piId && { piId }) };

    const [byStatus, byRag, blocked, atRisk, recentEscalations] = await Promise.all([
      this.prisma.issue.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.issue.groupBy({ by: ['ragStatus'], where, _count: true }),
      this.prisma.issue.findMany({
        where: { ...where, blocked: true, status: { not: IssueStatus.CLOSED } },
        select: { id: true, key: true, summary: true, assignee: { select: { name: true } } },
      }),
      this.prisma.issue.findMany({
        where: { ...where, ragStatus: { in: [RagStatus.RED, RagStatus.AMBER] }, status: { not: IssueStatus.CLOSED } },
        select: { id: true, key: true, summary: true, ragStatus: true, scheduledEnd: true },
        orderBy: { ragStatus: 'asc' },
      }),
      this.prisma.escalationEvent.findMany({
        where: { issue: { projectId: project.id } },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          issue: { select: { key: true, summary: true } },
          user: { select: { name: true } },
        },
      }),
    ]);

    const total = byStatus.reduce((sum, s) => sum + s._count, 0);
    const closed = byStatus.find((s) => s.status === IssueStatus.CLOSED)?._count ?? 0;

    return {
      summary: {
        total,
        closed,
        inProgress: byStatus.find((s) => s.status === IssueStatus.DOING)?._count ?? 0,
        completionRate: total ? Math.round((closed / total) * 100) : 0,
      },
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byRag: Object.fromEntries(byRag.map((r) => [r.ragStatus, r._count])),
      blocked,
      atRisk,
      recentEscalations,
    };
  }

  async updateRag(issueId: string, ragStatus: RagStatus) {
    return this.prisma.issue.update({
      where: { id: issueId },
      data: { ragStatus },
      select: { id: true, key: true, ragStatus: true },
    });
  }
}
