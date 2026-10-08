import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectAccess, ProjectRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';

/** What someone can do in a project. NONE means they can't see it at all. */
export type EffectiveRole = 'NONE' | ProjectRole;
export type Permission = 'browse' | 'edit' | 'admin';

const RANK: Record<EffectiveRole, number> = { NONE: 0, VIEWER: 1, MEMBER: 2, ADMIN: 3 };
const NEEDS: Record<Permission, EffectiveRole> = { browse: 'VIEWER', edit: 'MEMBER', admin: 'ADMIN' };
const ACTION: Record<Permission, string> = {
  browse: 'view this project',
  edit: 'create or change issues in this project',
  admin: 'administer this project',
};

export interface ProjectPermissions {
  role: EffectiveRole;
  canBrowse: boolean;
  canComment: boolean;
  canEdit: boolean;
  canAdmin: boolean;
}

@Injectable()
export class AccessService {
  constructor(private prisma: PrismaService) {}

  /** Global admins and the project lead administer a project; otherwise membership, then the project default. */
  async role(user: AuthUser, projectId: string): Promise<EffectiveRole> {
    if (user.role === UserRole.ADMIN) return 'ADMIN';
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { leadId: true, defaultAccess: true, members: { where: { userId: user.id }, select: { role: true } } },
    });
    if (!project) return 'NONE';
    if (project.leadId === user.id) return 'ADMIN';
    if (project.members[0]) return project.members[0].role;
    return project.defaultAccess === ProjectAccess.NONE ? 'NONE' : project.defaultAccess;
  }

  async permissions(user: AuthUser, projectId: string): Promise<ProjectPermissions> {
    const role = await this.role(user, projectId);
    const at = (p: Permission) => RANK[role] >= RANK[NEEDS[p]];
    return { role, canBrowse: at('browse'), canComment: at('browse'), canEdit: at('edit'), canAdmin: at('admin') };
  }

  async can(user: AuthUser, projectId: string, permission: Permission) {
    return RANK[await this.role(user, projectId)] >= RANK[NEEDS[permission]];
  }

  /** Throws 404 when the user can't even see the project (so its existence isn't revealed), else 403. */
  async require(user: AuthUser, projectId: string, permission: Permission): Promise<EffectiveRole> {
    const role = await this.role(user, projectId);
    if (RANK[role] >= RANK[NEEDS[permission]]) return role;
    if (role === 'NONE') throw new NotFoundException('Not found');
    throw new ForbiddenException(`Your role in this project (${role.toLowerCase()}) doesn't allow you to ${ACTION[permission]}`);
  }

  /** Project ids the user can browse, or null when they can browse everything. */
  async browsableProjectIds(user: AuthUser): Promise<string[] | null> {
    if (user.role === UserRole.ADMIN) return null;
    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          { defaultAccess: { not: ProjectAccess.NONE } },
          { leadId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  /** Of these users, the ones who can see the project (used to avoid notifying people without access). */
  async filterBrowsers(projectId: string, userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const [project, users] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { leadId: true, defaultAccess: true, members: { select: { userId: true } } },
      }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true } }),
    ]);
    const memberIds = new Set(project.members.map((m) => m.userId));
    return new Set(users
      .filter((u) => u.role === UserRole.ADMIN || u.id === project.leadId || memberIds.has(u.id)
        || project.defaultAccess !== ProjectAccess.NONE)
      .map((u) => u.id));
  }

  // ─── Resolving the project behind a route parameter ────────────────────────

  async projectOfIssue(idOrKey: string): Promise<string> {
    const issue = await this.prisma.issue.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }] },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue.projectId;
  }

  async projectOfKey(key: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() }, select: { id: true } });
    if (!project) throw new NotFoundException(`Project ${key} not found`);
    return project.id;
  }

  async projectOfVersion(id: string) {
    const v = await this.prisma.version.findUnique({ where: { id }, select: { projectId: true } });
    if (!v) throw new NotFoundException('Version not found');
    return v.projectId;
  }

  async projectOfComponent(id: string) {
    const c = await this.prisma.component.findUnique({ where: { id }, select: { projectId: true } });
    if (!c) throw new NotFoundException('Component not found');
    return c.projectId;
  }

  async projectOfPi(id: string) {
    const pi = await this.prisma.programIncrement.findUnique({ where: { id }, select: { projectId: true } });
    if (!pi) throw new NotFoundException('Program increment not found');
    return pi.projectId;
  }
}
