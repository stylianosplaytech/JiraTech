import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { IssueType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nextIssueKey } from '../common/project.util';
import { WorkflowService } from '../workflow/workflow.service';

@Injectable()
export class ReleasesService {
  constructor(private prisma: PrismaService, private workflow: WorkflowService) {}

  async getCandidates(releaseEpicId: string) {
    const epic = await this.prisma.issue.findUnique({ where: { id: releaseEpicId } });
    if (!epic || epic.type !== IssueType.RELEASE_EPIC) {
      throw new BadRequestException('Invalid Release Epic');
    }
    return this.prisma.issue.findMany({
      where: { parentId: releaseEpicId, type: IssueType.RELEASE_CANDIDATE },
      include: { versions: { include: { version: true } }, children: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCandidate(releaseEpicId: string, summary: string, versionIds: string[], reporterId: string) {
    const epic = await this.prisma.issue.findUnique({ where: { id: releaseEpicId } });
    if (!epic || epic.type !== IssueType.RELEASE_EPIC) {
      throw new BadRequestException('Release Candidates must be under a Release Epic');
    }

    return this.prisma.$transaction(async (tx) => {
      const initial = await this.workflow.initialStatus(tx, epic.projectId);
      return tx.issue.create({
      data: {
        ...(await nextIssueKey(tx, epic.projectId)),
        statusId: initial.id,
        status: initial.category,
        type: IssueType.RELEASE_CANDIDATE,
        summary,
        parentId: releaseEpicId,
        projectId: epic.projectId,
        reporterId,
        versions: {
          create: versionIds.map((versionId) => ({ versionId, isFix: true })),
        },
      },
      include: { versions: { include: { version: true } } },
    });
    });
  }

  async signOffGoldenMaster(candidateId: string) {
    const candidate = await this.prisma.issue.findUnique({
      where: { id: candidateId },
      include: { versions: true, parent: true },
    });
    if (!candidate || candidate.type !== IssueType.RELEASE_CANDIDATE) {
      throw new NotFoundException('Release Candidate not found');
    }
    if (!candidate.parentId) throw new BadRequestException('Candidate has no parent Release Epic');

    for (const v of candidate.versions) {
      await this.prisma.issueVersion.upsert({
        where: {
          issueId_versionId_isFix: {
            issueId: candidate.parentId,
            versionId: v.versionId,
            isFix: true,
          },
        },
        create: { issueId: candidate.parentId, versionId: v.versionId, isFix: true },
        update: {},
      });
    }

    await this.prisma.issue.update({
      where: { id: candidateId },
      data: { status: 'CLOSED', resolution: 'COMPLETED', statusId: (await this.workflow.statusForCategory(this.prisma, candidate.projectId, 'CLOSED')).id },
    });

    return { message: 'Golden Master signed off', epicId: candidate.parentId };
  }

  async generateReleaseNotes(releaseEpicId: string) {
    const epic = await this.prisma.issue.findUnique({
      where: { id: releaseEpicId },
      include: { versions: { include: { version: true } } },
    });
    if (!epic) throw new NotFoundException('Release Epic not found');

    const fixVersionIds = epic.versions.map((v) => v.versionId);
    const delivered = await this.prisma.issue.findMany({
      where: {
        versions: { some: { versionId: { in: fixVersionIds }, isFix: true } },
        status: 'CLOSED',
        resolution: 'COMPLETED',
      },
      select: { key: true, type: true, summary: true },
    });

    return {
      release: epic.summary,
      epicName: epic.epicName,
      versions: epic.versions.map((v) => v.version.name),
      features: delivered.filter((i) => i.type === IssueType.STORY || i.type === IssueType.FEATURE_EPIC),
      bugFixes: delivered.filter((i) => i.type === IssueType.DEFECT || i.type === IssueType.BUG_FIX),
      totalItems: delivered.length,
    };
  }
}
