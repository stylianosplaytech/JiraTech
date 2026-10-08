import { Injectable } from '@nestjs/common';
import { IssueStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProject } from '../common/project.util';
import { WorkflowService } from '../workflow/workflow.service';

const DONE_DAYS = 14;

@Injectable()
export class BoardService {
  constructor(private prisma: PrismaService, private workflow: WorkflowService) {}

  /** Columns follow the project's workflow; Done columns show the last ${DONE_DAYS} days. */
  async getBoard(sprintId?: string, projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    await this.workflow.ensure(this.prisma, project.id);
    const statuses = await this.workflow.statuses(project.id);
    const since = new Date(Date.now() - DONE_DAYS * 86_400_000);
    const issues = await this.prisma.issue.findMany({
      where: {
        projectId: project.id,
        ...(sprintId ? { sprintId } : { OR: [{ status: { not: IssueStatus.CLOSED } }, { updatedAt: { gte: since } }] }),
      },
      include: {
        assignee: { select: { id: true, name: true } },
        components: { include: { component: true } },
        parent: { select: { id: true, key: true, summary: true } },
        workflowStatus: { select: { id: true, name: true, category: true } },
      },
      orderBy: [{ rank: 'asc' }, { priority: 'asc' }],
    });
    return {
      columns: statuses.map((s) => ({
        statusId: s.id,
        name: s.name,
        status: s.category,
        issues: issues.filter((i) => i.statusId === s.id || (!i.statusId && i.status === s.category && statuses.find((x) => x.category === i.status)?.id === s.id)),
      })),
    };
  }
}
