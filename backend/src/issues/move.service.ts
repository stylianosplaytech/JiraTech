import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IssueResolution, IssueStatus, IssueType, Prisma, ProjectType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { AccessService } from '../access/access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WorkflowService } from '../workflow/workflow.service';
import { EPIC_TYPES, isValidParentChild } from '../common/issue-rules';
import { issueRef } from '../common/issue-ref';
import { nextIssueKey, resolveProject } from '../common/project.util';
import { slaOnStatusChange } from '../common/sla';
import { IssuesService } from './issues.service';

type Tx = Prisma.TransactionClient;

export interface MoveRequest {
  projectKey: string;
  /** Status for the issue itself in the target workflow; its sub-tasks are matched automatically. */
  statusId?: string;
  /** New parent in the target project; omit or null for none. */
  parentId?: string | null;
  /** Service desks: request type in the target project. */
  requestTypeId?: string | null;
}

const MOVING_INCLUDE = {
  workflowStatus: true,
  components: { include: { component: true } },
  versions: { include: { version: true } },
  labels: { include: { label: true } },
  customFieldValues: { include: { field: true } },
  requestType: { select: { name: true } },
  sprint: { select: { name: true } },
  pi: { select: { name: true } },
  parent: { select: { id: true, key: true } },
} satisfies Prisma.IssueInclude;

type Moving = Prisma.IssueGetPayload<{ include: typeof MOVING_INCLUDE }>;

/**
 * Moves an issue, with all its sub-tasks, to another project, as Jira's "Move" does. Each issue gets the target
 * project's next key (the old key keeps working), a status of the target workflow, and the target's components,
 * versions, labels and custom fields of the same name; what has no match there, and sprint / PI, are dropped.
 */
@Injectable()
export class MoveService {
  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private workflow: WorkflowService,
    private notifications: NotificationsService,
    private webhooks: WebhooksService,
    private issues: IssuesService,
  ) {}

  /** What moving would do, so the user can choose the status, parent and request type first. */
  async preview(idOrKey: string, projectKey: string, user: AuthUser) {
    const { root, all, target, statuses, requestTypes } = await this.plan(idOrKey, projectKey, user);
    const lookups = await this.targetLookups(this.prisma, target.id);
    const dropped = { components: new Set<string>(), versions: new Set<string>(), customFields: new Set<string>(), sprints: new Set<string>(), pis: new Set<string>() };
    for (const issue of all) {
      issue.components.filter((c) => !lookups.components.has(c.component.name)).forEach((c) => dropped.components.add(c.component.name));
      issue.versions.filter((v) => !lookups.versions.has(v.version.name)).forEach((v) => dropped.versions.add(v.version.name));
      issue.customFieldValues.filter((v) => !mapCustomValue(v, lookups.fields)).forEach((v) => dropped.customFields.add(v.field.name));
      if (issue.sprint) dropped.sprints.add(issue.sprint.name);
      if (issue.pi) dropped.pis.add(issue.pi.name);
    }
    return {
      key: root.key,
      target: { key: target.key, name: target.name, type: target.type, strictHierarchy: target.strictHierarchy },
      statuses: statuses.map((s) => ({ id: s.id, name: s.name, category: s.category })),
      suggestedStatusId: matchStatus(root.workflowStatus, root.status, statuses).id,
      // Without a parent, only epics may sit at the top of a project with strict hierarchy.
      parentRequired: target.strictHierarchy && !EPIC_TYPES.includes(root.type),
      currentParent: root.parent,
      requestTypes: requestTypes.map((r) => ({ id: r.id, name: r.name })),
      suggestedRequestTypeId: matchRequestType(root, requestTypes)?.id ?? null,
      subtasks: all.slice(1).map((i) => ({ id: i.id, key: i.key, summary: i.summary })),
      dropped: Object.fromEntries(Object.entries(dropped).map(([k, v]) => [k, [...v].sort()])),
    };
  }

  async move(idOrKey: string, req: MoveRequest, user: AuthUser, opts: { notify?: boolean } = {}) {
    const { root, all, source, target, statuses, requestTypes } = await this.plan(idOrKey, req.projectKey, user);

    const rootStatus = req.statusId ? statuses.find((s) => s.id === req.statusId) : matchStatus(root.workflowStatus, root.status, statuses);
    if (!rootStatus) throw new BadRequestException(`That status isn't part of ${target.key}'s workflow`);

    let parent: { id: string; key: string; type: IssueType } | null = null;
    if (req.parentId) {
      parent = await this.prisma.issue.findFirst({ where: { AND: [issueRef(req.parentId), { projectId: target.id }] }, select: { id: true, key: true, type: true } });
      if (!parent) throw new BadRequestException(`The new parent must be an issue in ${target.key}`);
    }
    if ((parent || target.strictHierarchy) && !isValidParentChild(root.type, parent?.type ?? null)) {
      throw new BadRequestException(parent
        ? `${typeName(root.type)} issues can't be placed under ${typeName(parent.type)} issues`
        : `In ${target.key}, ${typeName(root.type)} issues need a parent: choose one`);
    }

    let rootRequestType: { id: string; name: string } | null = null;
    if (target.type === ProjectType.SERVICE_DESK) {
      rootRequestType = req.requestTypeId ? requestTypes.find((r) => r.id === req.requestTypeId) ?? null : matchRequestType(root, requestTypes);
      if (req.requestTypeId && !rootRequestType) throw new BadRequestException(`That request type isn't part of ${target.key}`);
    }

    const moved = await this.prisma.$transaction(async (tx) => {
      // Never hand an old key out again: make sure the source counter is past every number it gave out.
      const { _max } = await tx.issue.aggregate({ where: { projectId: source.id }, _max: { number: true } });
      await tx.project.updateMany({ where: { id: source.id, issueCounter: { lt: _max.number ?? 0 } }, data: { issueCounter: _max.number ?? 0 } });

      const lookups = await this.targetLookups(tx, target.id);
      const linkedOrgs = new Set((await tx.projectOrganization.findMany({ where: { projectId: target.id }, select: { organizationId: true } })).map((o) => o.organizationId));
      const moved: { id: string; assigneeId: string | null; from: string; to: string }[] = [];

      for (const issue of all) {
        const isRoot = issue.id === root.id;
        const { key, number } = await nextIssueKey(tx, target.id);
        const status = isRoot ? rootStatus : matchStatus(issue.workflowStatus, issue.status, statuses);
        const closing = status.category === IssueStatus.CLOSED;
        const resolution = closing ? (issue.resolution ?? IssueResolution.COMPLETED) : null;
        const serviceDesk = target.type === ProjectType.SERVICE_DESK;
        const requestType = serviceDesk ? (isRoot ? rootRequestType : matchRequestType(issue, requestTypes)) : null;

        const components = issue.components.flatMap((c) => lookups.components.get(c.component.name) ?? []);
        const versions = issue.versions.flatMap((v) => {
          const id = lookups.versions.get(v.version.name);
          return id ? [{ versionId: id, isFix: v.isFix }] : [];
        });
        const labelIds: string[] = [];
        for (const l of issue.labels) labelIds.push(await lookups.label(l.label.name));
        const values = issue.customFieldValues.flatMap((v) => mapCustomValue(v, lookups.fields) ?? []);

        await tx.issueComponent.deleteMany({ where: { issueId: issue.id } });
        await tx.issueVersion.deleteMany({ where: { issueId: issue.id } });
        await tx.issueLabel.deleteMany({ where: { issueId: issue.id } });
        await tx.customFieldValue.deleteMany({ where: { issueId: issue.id } });
        if (components.length) await tx.issueComponent.createMany({ data: components.map((componentId) => ({ issueId: issue.id, componentId })) });
        if (versions.length) await tx.issueVersion.createMany({ data: versions.map((v) => ({ issueId: issue.id, ...v })) });
        if (labelIds.length) await tx.issueLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ issueId: issue.id, labelId })) });
        if (values.length) await tx.customFieldValue.createMany({ data: values.map((v) => ({ issueId: issue.id, ...v })) });

        await tx.issue.update({
          where: { id: issue.id },
          data: {
            key,
            number,
            projectId: target.id,
            statusId: status.id,
            status: status.category,
            resolution,
            ...slaOnStatusChange(issue, status),
            // Children keep their parent, which moves with them.
            ...(isRoot ? { parentId: parent?.id ?? null } : {}),
            sprintId: null,
            piId: null,
            rank: null,
            requestTypeId: requestType?.id ?? null,
            organizationId: serviceDesk && issue.organizationId && linkedOrgs.has(issue.organizationId) ? issue.organizationId : null,
            portalId: null,
            source: serviceDesk ? issue.source : null,
          },
        });
        await tx.issueKeyAlias.create({ data: { key: issue.key, issueId: issue.id } });
        await tx.notification.updateMany({ where: { issueId: issue.id }, data: { issueKey: key } });

        const names = (xs: string[]) => (xs.length ? [...xs].sort().join(', ') : null);
        const changes: { field: string; from: string | null; to: string | null }[] = [
          { field: 'project', from: source.name, to: target.name },
          { field: 'key', from: issue.key, to: key },
          { field: 'status', from: issue.workflowStatus?.name ?? null, to: status.name },
          { field: 'resolution', from: issue.resolution, to: resolution },
          { field: 'parent', from: issue.parent?.key ?? null, to: isRoot ? parent?.key ?? null : issue.parent?.key ?? null },
          { field: 'requestType', from: issue.requestType?.name ?? null, to: requestType?.name ?? null },
          { field: 'sprint', from: issue.sprint?.name ?? null, to: null },
          { field: 'components', from: names(issue.components.map((c) => c.component.name)), to: names(issue.components.filter((c) => lookups.components.has(c.component.name)).map((c) => c.component.name)) },
          { field: 'fixVersions', from: names(issue.versions.filter((v) => v.isFix).map((v) => v.version.name)), to: names(issue.versions.filter((v) => v.isFix && lookups.versions.has(v.version.name)).map((v) => v.version.name)) },
          { field: 'affectsVersions', from: names(issue.versions.filter((v) => !v.isFix).map((v) => v.version.name)), to: names(issue.versions.filter((v) => !v.isFix && lookups.versions.has(v.version.name)).map((v) => v.version.name)) },
        ];
        await tx.issueHistory.createMany({
          data: changes.filter((c) => c.from !== c.to).map((c) => ({ issueId: issue.id, userId: user.id, field: c.field, fromValue: c.from, toValue: c.to })),
        });
        moved.push({ id: issue.id, assigneeId: issue.assigneeId, from: source.name, to: target.name });
      }
      return moved;
    }, { timeout: 30_000 });

    if (opts.notify !== false) {
      for (const m of moved) {
        await this.notifications.issueUpdated(m.id, user.id, { fields: ['project'], previousAssigneeId: m.assigneeId, previousDescription: null });
      }
    }
    for (const m of moved) {
      await this.webhooks.issueEvent('issue.updated', m.id, user.id, { changes: [{ field: 'project', from: m.from, to: m.to }] });
    }
    return this.issues.findOne(root.id);
  }

  /** Loads the issue with its sub-tasks (all levels) and checks the user may take them out of here and into the target. */
  private async plan(idOrKey: string, projectKey: string, user: AuthUser) {
    const root = await this.prisma.issue.findFirst({ where: issueRef(idOrKey), include: MOVING_INCLUDE });
    if (!root) throw new NotFoundException('Issue not found');
    const target = await resolveProject(this.prisma, projectKey);
    if (target.id === root.projectId) throw new BadRequestException(`${root.key} is already in ${target.key}`);
    await this.access.require(user, root.projectId, 'edit');
    await this.access.require(user, target.id, 'edit');
    const source = await this.prisma.project.findUniqueOrThrow({ where: { id: root.projectId } });

    const all: Moving[] = [root];
    for (let level = [root.id]; level.length;) {
      const children = await this.prisma.issue.findMany({ where: { parentId: { in: level } }, include: MOVING_INCLUDE, orderBy: { number: 'asc' } });
      all.push(...children);
      level = children.map((c) => c.id);
    }

    await this.workflow.ensure(this.prisma, target.id);
    const statuses = await this.workflow.statuses(target.id);
    const requestTypes = target.type === ProjectType.SERVICE_DESK
      ? await this.prisma.requestType.findMany({ where: { projectId: target.id }, orderBy: { position: 'asc' }, select: { id: true, name: true, issueType: true } })
      : [];
    return { root, all, source, target, statuses, requestTypes };
  }

  /** The target project's components, versions and custom fields by name, and its labels (created when missing). */
  private async targetLookups(db: Tx | PrismaService, projectId: string) {
    const [components, versions, fields, labels] = await Promise.all([
      db.component.findMany({ where: { projectId, archived: false }, select: { id: true, name: true } }),
      db.version.findMany({ where: { projectId }, select: { id: true, name: true } }),
      db.customFieldDefinition.findMany({ where: { projectId } }),
      db.label.findMany({ where: { projectId }, select: { id: true, name: true } }),
    ]);
    const labelIds = new Map(labels.map((l) => [l.name, l.id]));
    return {
      components: new Map(components.map((c) => [c.name, c.id])),
      versions: new Map(versions.map((v) => [v.name, v.id])),
      fields: new Map(fields.map((f) => [f.key, f])),
      label: async (name: string) => {
        const existing = labelIds.get(name);
        if (existing) return existing;
        const created = await db.label.create({ data: { projectId, name } });
        labelIds.set(name, created.id);
        return created.id;
      },
    };
  }
}

/** Same status name first, then the first status of the same category, then the start of the workflow. */
function matchStatus<S extends { name: string; category: IssueStatus }>(current: { name: string } | null, category: IssueStatus, statuses: S[]): S {
  const name = current?.name.toLowerCase();
  return statuses.find((s) => s.name.toLowerCase() === name)
    ?? statuses.find((s) => s.category === category)
    ?? statuses[0];
}

/** Same request type name first, then the first one that creates this issue type. */
function matchRequestType<R extends { name: string; issueType: IssueType }>(issue: Pick<Moving, 'type' | 'requestType'>, types: R[]): R | null {
  const name = issue.requestType?.name.toLowerCase();
  return types.find((t) => t.name.toLowerCase() === name) ?? types.find((t) => t.issueType === issue.type) ?? null;
}

/** A custom field value carried over to the target's field with the same key and type (and option, for selects). */
function mapCustomValue(
  v: Moving['customFieldValues'][number],
  fields: Map<string, { id: string; type: string; options: string | null }>,
): { fieldId: string; value: string } | null {
  const field = fields.get(v.field.key);
  if (!field || field.type !== v.field.type) return null;
  if (field.type === 'SELECT' && field.options) {
    try {
      if (!(JSON.parse(field.options) as string[]).includes(v.value)) return null;
    } catch { /* unreadable options: keep the value */ }
  }
  return { fieldId: field.id, value: v.value };
}

function typeName(type: IssueType) {
  const name = type.toLowerCase().replace(/_/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
