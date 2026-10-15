import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ComponentType, CustomFieldType, IssueResolution, IssueStatus, IssueType, Prisma, ProjectAccess, ProjectRole, ProjectType, UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { AuthUser } from '../common/auth-user';
import { sanitizeRich } from '../common/rich-text';
import { ImportProjectDto, PreviewImportDto } from './project-import.dto';
import { readCsvSource } from './jira-csv';
import { readJsonSource } from './jira-json';
import { collectLinks, personName, resolveParents, resolvePeople } from './relations';
import { CUSTOM_PREFIX, ParsedSource, SourceIssue, SourceVersion, mapPriority, mapType } from './source';
import { wikiToHtml } from './wiki';

const CHUNK = 400;

type Tx = Prisma.TransactionClient;

async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let at = 0; at < rows.length; at += CHUNK) await write(rows.slice(at, at + CHUNK));
}

/** Descriptions and comments are wiki markup in Jira and sanitised HTML here. */
const richText = (wiki: string) => sanitizeRich(wikiToHtml(wiki));

@Injectable()
export class ProjectImportService {
  constructor(private prisma: PrismaService, private workflow: WorkflowService) {}

  async preview(file: { buffer: Buffer }, optionsJson: string | undefined, user: AuthUser) {
    this.assertAdmin(user);
    const opts = await this.options(PreviewImportDto, optionsJson);
    const data = this.read(file.buffer, opts.utcOffsetMinutes);
    const [exists, users] = await Promise.all([
      this.prisma.project.findUnique({ where: { key: data.prefix }, select: { id: true } }),
      this.users(),
    ]);
    const numbers = data.issues.map((i) => i.number);
    const parents = resolveParents(data.issues);
    const links = collectLinks(data.issues);
    const people = resolvePeople(data.issues, users);
    const byType: Record<string, number> = {};
    for (const i of data.issues) {
      const t = mapType(i.typeName) ?? IssueType.TASK;
      byType[t] = (byType[t] ?? 0) + 1;
    }
    return {
      format: data.format,
      suggestedKey: data.prefix,
      keyTaken: !!exists,
      issues: data.issues.length,
      firstNumber: Math.min(...numbers),
      lastNumber: Math.max(...numbers),
      byType,
      statuses: data.statuses,
      columns: data.columns,
      parents: { linked: parents.linked, outsideExport: parents.outsideExport },
      links: { kept: links.kept, outsideExport: links.outsideExport, byType: links.byType },
      people: { total: people.total, matched: people.matched, unmatched: people.unmatched.slice(0, 50) },
      warnings: data.warnings,
    };
  }

  async import(file: { buffer: Buffer }, optionsJson: string | undefined, user: AuthUser) {
    this.assertAdmin(user);
    const dto = await this.options(ImportProjectDto, optionsJson);
    const data = this.read(file.buffer, dto.utcOffsetMinutes);
    if (await this.prisma.project.findUnique({ where: { key: dto.key }, select: { id: true } })) {
      throw new ConflictException(`A project with key ${dto.key} already exists`);
    }
    const known = new Set(data.columns.map((c) => c.id));
    const unknown = dto.columns.filter((c) => !known.has(c));
    if (unknown.length) throw new BadRequestException(`Unknown column(s): ${unknown.slice(0, 5).join(', ')}`);
    const on = new Set([...dto.columns, 'key', 'summary']);

    const categories = new Map<string, IssueStatus>();
    for (const s of data.statuses) {
      const chosen = dto.statusCategories?.[s.name];
      if (chosen !== undefined && !Object.values(IssueStatus).includes(chosen as IssueStatus)) {
        throw new BadRequestException(`"${chosen}" isn't a status category`);
      }
      categories.set(s.name, (chosen as IssueStatus | undefined) ?? s.category);
    }

    const { issues } = data;
    // New keys are PROJECT-<number from the file>, so old references keep resolving.
    const newKey = (i: SourceIssue) => `${dto.key}-${i.number}`;
    const idOf = new Map(issues.map((i) => [i.key, randomUUID()]));
    const users = await this.users();
    const people = resolvePeople(issues, users);

    const parentOf = on.has('parent') ? resolveParents(issues).parentOf : new Map<string, string>();
    const byKey = new Map(issues.map((i) => [i.key, i]));
    // Parents must exist before their children (foreign keys), so insert level by level. The cap stops a cycle.
    const level = (i: SourceIssue) => {
      let n = 0;
      for (let p = parentOf.get(i.key); p && n < 50; p = parentOf.get(p)) n++;
      return n;
    };
    const levels = new Map(issues.map((i) => [i.key, level(i)]));
    const ordered = [...issues].sort((a, b) => levels.get(a.key)! - levels.get(b.key)!);
    // Anything still nested 50 deep is a cycle in the file: import those without a parent.
    const parentId = (i: SourceIssue) => {
      const p = parentOf.get(i.key);
      return p && levels.get(i.key)! < 50 && byKey.has(p) ? idOf.get(p)! : null;
    };

    const lastNumber = Math.max(...issues.map((i) => i.number));
    const customCols = data.columns.filter((c) => c.id.startsWith(CUSTOM_PREFIX) && on.has(c.id));
    const links = on.has('links') ? collectLinks(issues).links : [];
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
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
      const projectId = project.id;

      // Statuses: one per status in the file, with any move allowed until an admin tightens the workflow.
      // Without the status column everything starts in the standard workflow's first status.
      const statusIds = new Map<string, string>();
      let initial: { id: string; category: IssueStatus } | null = null;
      if (on.has('status')) {
        for (const [position, s] of data.statuses.entries()) {
          const created = await tx.workflowStatus.create({ data: { projectId, name: s.name, category: categories.get(s.name)!, position } });
          statusIds.set(s.name, created.id);
        }
        const ids = [...statusIds.values()];
        await tx.workflowTransition.createMany({
          data: ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => ({ projectId, fromStatusId: from, toStatusId: to }))),
        });
      } else {
        initial = await this.workflow.initialStatus(tx, projectId);
      }

      // Things issues are tagged with.
      const labelId = on.has('labels') ? await this.createLabels(tx, projectId, issues) : new Map<string, string>();
      const componentId = on.has('components') ? await this.createComponents(tx, projectId, issues) : new Map<string, string>();
      const versionId = await this.createVersions(tx, projectId, issues, on);
      const fields = await this.createCustomFields(tx, projectId, customCols, dto.columnNames);

      await inChunks(ordered, (chunk) => tx.issue.createMany({
        data: chunk.map((i) => {
          const category = initial ? initial.category : categories.get(i.statusName)!;
          const created = on.has('created') ? i.created ?? now : now;
          return {
            id: idOf.get(i.key)!,
            key: newKey(i),
            number: i.number,
            type: on.has('type') ? mapType(i.typeName) ?? IssueType.TASK : IssueType.TASK,
            summary: i.summary,
            description: on.has('description') && i.description ? richText(i.description) : null,
            epicName: on.has('type') && mapType(i.typeName) === IssueType.EPIC ? i.summary.slice(0, 255) : undefined,
            priority: on.has('priority') ? mapPriority(i.priorityName) : undefined,
            status: category,
            statusId: initial ? initial.id : statusIds.get(i.statusName)!,
            resolution: category === IssueStatus.CLOSED ? IssueResolution.COMPLETED : null,
            estimate: on.has('estimate') ? i.estimateHours : null,
            remainingEstimate: on.has('remaining') ? i.remainingHours : null,
            projectId,
            parentId: parentId(i),
            reporterId: on.has('reporter') ? people.userFor(i.reporter)?.id ?? null : null,
            assigneeId: on.has('assignee') ? people.userFor(i.assignee)?.id ?? null : null,
            createdAt: created,
            // Without an "Updated" column the last change is unknown.
            updatedAt: on.has('updated') ? i.updated ?? created : created,
          };
        }),
      }));

      await inChunks(ordered, (chunk) => tx.issueHistory.createMany({
        data: chunk.map((i) => ({
          issueId: idOf.get(i.key)!,
          userId: user.id,
          field: 'created',
          toValue: i.key === newKey(i) ? i.key : `${newKey(i)} (was ${i.key})`,
          createdAt: on.has('created') ? i.created ?? now : now,
        })),
      }));

      if (labelId.size) {
        await inChunks(ordered.flatMap((i) => [...new Set(i.labels)].map((l) => ({ issueId: idOf.get(i.key)!, labelId: labelId.get(l)! }))), (c) => tx.issueLabel.createMany({ data: c }));
      }
      if (componentId.size) {
        await inChunks(ordered.flatMap((i) => [...new Set(i.components)].map((c) => ({ issueId: idOf.get(i.key)!, componentId: componentId.get(c)! }))), (c) => tx.issueComponent.createMany({ data: c }));
      }
      if (versionId.size) {
        const rows = ordered.flatMap((i) => [
          ...(on.has('fixVersions') ? [...new Set(i.fixVersions.map((v) => v.name))].map((n) => ({ issueId: idOf.get(i.key)!, versionId: versionId.get(n)!, isFix: true })) : []),
          ...(on.has('affectsVersions') ? [...new Set(i.affectsVersions.map((v) => v.name))].map((n) => ({ issueId: idOf.get(i.key)!, versionId: versionId.get(n)!, isFix: false })) : []),
        ]);
        await inChunks(rows, (c) => tx.issueVersion.createMany({ data: c }));
      }
      if (fields.size) {
        const rows = ordered.flatMap((i) => [...fields].flatMap(([colId, fieldId]) => (i.custom[colId.slice(CUSTOM_PREFIX.length)] ? [{ issueId: idOf.get(i.key)!, fieldId, value: i.custom[colId.slice(CUSTOM_PREFIX.length)] }] : [])));
        await inChunks(rows, (c) => tx.customFieldValue.createMany({ data: c }));
      }

      // Comments and work logs belong to someone: their user when we know them, otherwise whoever imports, with the real author noted.
      const comments = on.has('comments') ? ordered.flatMap((i) => i.comments.map((c) => {
        const author = people.userFor(c.author);
        const when = c.created ?? i.created ?? now;
        const note = !author && c.author ? `<p><em>Originally written by ${escape(personName(c.author))} on ${when.toISOString().slice(0, 10)}</em></p>` : '';
        return {
          issueId: idOf.get(i.key)!, authorId: author?.id ?? user.id, body: note + (richText(c.body) ?? ''),
          createdAt: when, updatedAt: when,
        };
      })) : [];
      await inChunks(comments, (c) => tx.comment.createMany({ data: c }));

      const worklogs = on.has('worklogs') ? ordered.flatMap((i) => i.worklogs.map((w) => {
        const author = people.userFor(w.author);
        return {
          issueId: idOf.get(i.key)!, userId: author?.id ?? user.id, timeSpentMinutes: Math.max(1, Math.round(w.seconds / 60)),
          comment: !author && w.author ? `${personName(w.author)}${w.comment ? `: ${w.comment}` : ''}` : w.comment,
          createdAt: w.started ?? i.created ?? now,
        };
      })) : [];
      await inChunks(worklogs, (c) => tx.workLog.createMany({ data: c }));

      await inChunks(links, (c) => tx.issueLink.createMany({
        data: c.map((l) => ({ type: l.type, sourceId: idOf.get(l.sourceKey)!, targetId: idOf.get(l.targetKey)! })),
      }));

      return {
        key: project.key,
        name: project.name,
        issues: issues.length,
        parentsLinked: issues.filter((i) => parentId(i)).length,
        links: links.length,
        comments: comments.length,
        worklogs: worklogs.length,
        customFields: fields.size,
        statuses: on.has('status') ? data.statuses.length : 4,
      };
    }, { timeout: 15 * 60_000, maxWait: 30_000 });
    return result;
  }

  // ─── Pieces of the import ──────────────────────────────────────────────────

  private async createLabels(tx: Tx, projectId: string, issues: SourceIssue[]) {
    const names = [...new Set(issues.flatMap((i) => i.labels))];
    await tx.label.createMany({ data: names.map((name) => ({ projectId, name })) });
    return new Map((await tx.label.findMany({ where: { projectId } })).map((l) => [l.name, l.id]));
  }

  private async createComponents(tx: Tx, projectId: string, issues: SourceIssue[]) {
    const names = [...new Set(issues.flatMap((i) => i.components))];
    await tx.component.createMany({ data: names.map((name) => ({ projectId, name, type: ComponentType.SERVICE })) });
    return new Map((await tx.component.findMany({ where: { projectId } })).map((c) => [c.name, c.id]));
  }

  private async createVersions(tx: Tx, projectId: string, issues: SourceIssue[], on: Set<string>) {
    const byName = new Map<string, SourceVersion>();
    for (const i of issues) {
      for (const v of [...(on.has('fixVersions') ? i.fixVersions : []), ...(on.has('affectsVersions') ? i.affectsVersions : [])]) {
        const known = byName.get(v.name);
        byName.set(v.name, { name: v.name, released: known?.released || v.released, releaseDate: known?.releaseDate ?? v.releaseDate });
      }
    }
    await tx.version.createMany({
      data: [...byName.values()].map((v) => ({ projectId, name: v.name, released: !!v.released, releaseDate: v.releaseDate ?? null })),
    });
    return new Map((await tx.version.findMany({ where: { projectId } })).map((v) => [v.name, v.id]));
  }

  /** Columns with no field of their own become text custom fields on the project. */
  private async createCustomFields(tx: Tx, projectId: string, columns: { id: string; label: string }[], names?: Record<string, string>) {
    const used = new Set<string>();
    const ids = new Map<string, string>();
    for (const [order, col] of columns.entries()) {
      const name = (names?.[col.id] ?? col.label).trim().slice(0, 80) || col.label;
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
      let key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
      used.add(key);
      const field = await tx.customFieldDefinition.create({ data: { projectId, key, name, type: CustomFieldType.TEXT, order } });
      ids.set(col.id, field.id);
    }
    return ids;
  }

  // ─── Reading ───────────────────────────────────────────────────────────────

  private read(buffer: Buffer, utcOffsetMinutes?: number): ParsedSource {
    const text = buffer.toString('utf8');
    const trimmed = text.replace(/^﻿/, '').trimStart();
    try {
      return trimmed.startsWith('[') || trimmed.startsWith('{') ? readJsonSource(text) : readCsvSource(text, utcOffsetMinutes ?? 0);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private async options<T extends object>(cls: new () => T, json: string | undefined): Promise<T> {
    let raw: unknown = {};
    if (json) {
      try { raw = JSON.parse(json); } catch { throw new BadRequestException('"options" must be JSON'); }
    }
    const dto = plainToInstance(cls, raw);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length) throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
    return dto;
  }

  /** Staff only: customers aren't people the export's reporters or assignees can be. */
  private users() {
    return this.prisma.user.findMany({ where: { role: { not: UserRole.CUSTOMER } }, select: { id: true, email: true, name: true } });
  }

  private assertAdmin(user: AuthUser) {
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('Only administrators can import projects');
  }
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
