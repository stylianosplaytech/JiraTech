import { Injectable, NotFoundException } from '@nestjs/common';
import { IssueType, PiStatus, Priority, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nextIssueKey, resolveProject } from '../common/project.util';
import { CreatePiDto, CreateSprintDto, WorkBreakdownDto } from './dto/planning.dto';

@Injectable()
export class PlanningService {
  constructor(private prisma: PrismaService) {}

  async getPis(projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    return this.prisma.programIncrement.findMany({
      where: { projectId: project.id },
      include: { sprints: true, _count: { select: { issues: true } } },
      orderBy: { startDate: 'desc' },
    });
  }

  async createPi(dto: CreatePiDto, projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    return this.prisma.programIncrement.create({
      data: {
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        projectId: project.id,
        status: PiStatus.PLANNING,
      },
    });
  }

  async createSprint(dto: CreateSprintDto) {
    return this.prisma.sprint.create({
      data: {
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        piId: dto.piId,
        teamId: dto.teamId,
      },
    });
  }

  async workBreakdown(dto: WorkBreakdownDto, reporterId: string) {
    const epic = await this.prisma.issue.findUnique({ where: { id: dto.epicId } });
    if (!epic) throw new NotFoundException('Epic not found');

    // One transaction: the whole breakdown is created, or none of it.
    const created = await this.prisma.$transaction(async (tx) => {
      const issues: Prisma.IssueGetPayload<object>[] = [];
      for (const story of dto.stories) {
        const storyIssue = await tx.issue.create({
          data: {
            ...(await nextIssueKey(tx, epic.projectId)),
            type: IssueType.STORY,
            summary: story.summary,
            priority: (story.priority as Priority) ?? Priority.MEDIUM,
            parentId: epic.id,
            projectId: epic.projectId,
            piId: epic.piId,
            reporterId,
            components: story.componentIds?.length
              ? { create: story.componentIds.map((componentId) => ({ componentId })) }
              : undefined,
          },
        });
        issues.push(storyIssue);

        for (const child of story.children ?? []) {
          const subIssue = await tx.issue.create({
            data: {
              ...(await nextIssueKey(tx, epic.projectId)),
              type: child.type as IssueType,
              summary: child.summary,
              parentId: storyIssue.id,
              projectId: epic.projectId,
              piId: epic.piId,
              reporterId,
              components: child.componentIds?.length
                ? { create: child.componentIds.map((componentId) => ({ componentId })) }
                : undefined,
            },
          });
          issues.push(subIssue);
        }
      }
      return issues;
    });

    return { epicId: epic.id, createdCount: created.length, issues: created };
  }
}
