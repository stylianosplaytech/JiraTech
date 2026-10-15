import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { IssueResolution, IssueStatus, IssueType, ProjectAccess, ProjectRole, ProjectType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { ImportProjectDto, PreviewImportDto } from './project-import.dto';
import { ImportedIssue, readJiraExport } from './jira-csv';

const CHUNK = 400;

@Injectable()
export class ProjectImportService {
  constructor(private prisma: PrismaService) {}

  async preview(dto: PreviewImportDto, user: AuthUser) {
    this.assertCreator(user);
    const data = this.read(dto);
    const exists = await this.prisma.project.findUnique({ where: { key: data.prefix }, select: { id: true } });
    const numbers = data.issues.map((i) => i.number);
    return {
      suggestedKey: data.prefix,
      keyTaken: !!exists,
      issues: data.issues.length,
      firstNumber: Math.min(...numbers),
      lastNumber: Math.max(...numbers),
      byType: data.byType,
      statuses: data.statuses,
      parents: data.parents,
      links: data.linkStats,
      warnings: data.warnings,
    };
  }

  async import(dto: ImportProjectDto, user: AuthUser) {
    this.assertCreator(user);
    const data = this.read(dto);
    if (await this.prisma.project.findUnique({ where: { key: dto.key }, select: { id: true } })) {
      throw new ConflictException(`A project with key ${dto.key} already exists`);
    }
    const categories = new Map<string, IssueStatus>();
    for (const s of data.statuses) {
      const chosen = dto.statusCategories?.[s.name];
      if (chosen !== undefined && !Object.values(IssueStatus).includes(chosen as IssueStatus)) {
        throw new BadRequestException(`"${chosen}" isn't a status category`);
      }
      categories.set(s.name, (chosen as IssueStatus | undefined) ?? s.category);
    }

    // New keys are PROJECT-<number from the file>, so old references keep resolving.
    const newKey = (i: ImportedIssue) => `${dto.key}-${i.number}`;
    const idOf = new Map(data.issues.map((i) => [i.key, randomUUID()]));
    const issueByKey = new Map(data.issues.map((i) => [i.key, i]));
    const keyBySourceId = new Map(data.issues.filter((i) => i.sourceId).map((i) => [i.sourceId, i.key]));
    const parentKey = (i: ImportedIssue) => {
      const p = i.parentSourceId ? keyBySourceId.get(i.parentSourceId) : undefined;
      return p && p !== i.key ? p : null;
    };

    // Parents must exist before their children (foreign keys), so insert level by level. The cap stops a cycle.
    const level = (i: ImportedIssue) => {
      let n = 0;
      for (let p = parentKey(i); p && n < 50; p = parentKey(issueByKey.get(p)!)) n++;
      return n;
    };
    const ordered = data.issues.map((i) => ({ i, level: level(i) })).sort((a, b) => a.level - b.level).map((x) => x.i);
    // Anything still nested 50 deep is a cycle in the file: import those without a parent.
    const hasParent = (i: ImportedIssue) => parentKey(i) !== null && level(i) < 50;

    const lastNumber = Math.max(...data.issues.map((i) => i.number));
    const statusNames = data.statuses.map((s) => s.name);

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          key: dto.key,
          name: dto.name,
          description: dto.description,
          leadId: user.id,
          type: ProjectType.SOFTWARE,
          strictHierarchy: false,
          defaultAccess: ProjectAccess.MEMBER,
          issueCounter: lastNumber,
          members: { create: [{ userId: user.id, role: ProjectRole.ADMIN }] },
        },
      });

      // One status per status in the file; any status can move to any other until an admin tightens the workflow.
      const statusIds = new Map<string, string>();
      for (const [position, name] of statusNames.entries()) {
        const s = await tx.workflowStatus.create({
          data: { projectId: created.id, name, category: categories.get(name)!, position },
        });
        statusIds.set(name, s.id);
      }
      const ids = [...statusIds.values()];
      await tx.workflowTransition.createMany({
        data: ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => ({ projectId: created.id, fromStatusId: from, toStatusId: to }))),
      });

      for (let at = 0; at < ordered.length; at += CHUNK) {
        await tx.issue.createMany({
          data: ordered.slice(at, at + CHUNK).map((i) => {
            const category = categories.get(i.statusName)!;
            return {
              id: idOf.get(i.key)!,
              key: newKey(i),
              number: i.number,
              type: i.type,
              summary: i.summary,
              epicName: i.type === IssueType.EPIC ? i.summary.slice(0, 255) : undefined,
              priority: i.priority,
              status: category,
              statusId: statusIds.get(i.statusName)!,
              resolution: category === IssueStatus.CLOSED ? IssueResolution.COMPLETED : null,
              projectId: created.id,
              parentId: hasParent(i) ? idOf.get(parentKey(i)!)! : null,
              createdAt: i.createdAt,
              // The export has no "Updated" column, so the last change is unknown.
              updatedAt: i.createdAt,
            };
          }),
        });
      }
      for (let at = 0; at < ordered.length; at += CHUNK) {
        await tx.issueHistory.createMany({
          data: ordered.slice(at, at + CHUNK).map((i) => ({
            issueId: idOf.get(i.key)!,
            userId: user.id,
            field: 'created',
            toValue: i.key === newKey(i) ? i.key : `${newKey(i)} (was ${i.key})`,
            createdAt: i.createdAt,
          })),
        });
      }
      for (let at = 0; at < data.links.length; at += CHUNK) {
        await tx.issueLink.createMany({
          data: data.links.slice(at, at + CHUNK).map((l) => ({ type: l.type, sourceId: idOf.get(l.sourceKey)!, targetId: idOf.get(l.targetKey)! })),
        });
      }
      return created;
    }, { timeout: 10 * 60_000, maxWait: 30_000 });

    return {
      key: project.key,
      name: project.name,
      issues: data.issues.length,
      links: data.links.length,
      parentsLinked: data.issues.filter(hasParent).length,
      statuses: statusNames.length,
    };
  }

  private read(dto: PreviewImportDto) {
    try {
      return readJiraExport(dto.csv, dto.utcOffsetMinutes ?? 0);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private assertCreator(user: AuthUser) {
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('Only administrators can import projects');
  }
}
