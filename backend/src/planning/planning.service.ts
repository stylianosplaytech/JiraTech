import { Injectable, NotFoundException } from '@nestjs/common';
import { IssueType, PiStatus, Priority, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePiDto, CreateSprintDto, WorkBreakdownDto } from './dto/planning.dto';

@Injectable()
export class PlanningService {
  constructor(private prisma: PrismaService) {}

  async getPis() {
    const project = await this.prisma.project.findFirstOrThrow({ where: { key: 'SPORTS' } });
    return this.prisma.programIncrement.findMany({
      where: { projectId: project.id },
      include: { sprints: true, _count: { select: { issues: true } } },
      orderBy: { startDate: 'desc' },
    });
  }

  async createPi(dto: CreatePiDto) {
    const project = await this.prisma.project.findFirstOrThrow({ where: { key: 'SPORTS' } });
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

    const created: Prisma.IssueGetPayload<object>[] = [];

    for (const story of dto.stories) {
      const lastNum = await this.getNextNumber(epic.projectId);
      const storyIssue = await this.prisma.issue.create({
        data: {
          key: `SPORTS-${lastNum}`,
          number: lastNum,
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
      created.push(storyIssue);

      for (const child of story.children ?? []) {
        const childNum = await this.getNextNumber(epic.projectId);
        const subIssue = await this.prisma.issue.create({
          data: {
            key: `SPORTS-${childNum}`,
            number: childNum,
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
        created.push(subIssue);
      }
    }

    return { epicId: epic.id, createdCount: created.length, issues: created };
  }

  private async getNextNumber(projectId: string): Promise<number> {
    const last = await this.prisma.issue.findFirst({
      where: { projectId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return (last?.number ?? 0) + 1;
  }
}
