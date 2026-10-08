import { Injectable } from '@nestjs/common';
import { IssueStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProject } from '../common/project.util';

@Injectable()
export class BoardService {
  constructor(private prisma: PrismaService) {}

  async getBoard(sprintId?: string, projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    const columns: IssueStatus[] = [IssueStatus.BACKLOG, IssueStatus.TO_DO, IssueStatus.DOING, IssueStatus.CLOSED];
    const where = {
      projectId: project.id,
      ...(sprintId ? { sprintId } : { status: { not: IssueStatus.CLOSED } }),
    };

    const issues = await this.prisma.issue.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true } },
        components: { include: { component: true } },
        parent: { select: { id: true, key: true, summary: true } },
      },
      orderBy: [{ rank: 'asc' }, { priority: 'asc' }],
    });

    return {
      columns: columns.map((status) => ({
        status,
        issues: issues.filter((i) => i.status === status),
      })),
    };
  }
}
