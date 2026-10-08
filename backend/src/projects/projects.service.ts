import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectAccess, ProjectRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { AccessService } from '../access/access.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';

const PROJECT_CREATORS: UserRole[] = [
  UserRole.ADMIN,
  UserRole.PROJECT_MANAGER,
  UserRole.PROGRAM_MANAGER,
  UserRole.PRODUCT_MANAGER,
];

const LEAD_SELECT = { select: { id: true, name: true, email: true } };

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private access: AccessService) {}

  /** Projects the user can see, each with their role in it. */
  async findAll(user: AuthUser) {
    const ids = await this.access.browsableProjectIds(user);
    const projects = await this.prisma.project.findMany({
      where: ids === null ? {} : { id: { in: ids } },
      include: { lead: LEAD_SELECT, _count: { select: { issues: true, members: true } } },
      orderBy: { name: 'asc' },
    });
    return Promise.all(projects.map(async (p) => ({ ...p, myRole: await this.access.role(user, p.id) })));
  }

  async findOne(key: string, user: AuthUser) {
    const project = await this.prisma.project.findUnique({
      where: { key: key.toUpperCase() },
      include: {
        lead: LEAD_SELECT,
        components: { where: { archived: false }, include: { lead: LEAD_SELECT }, orderBy: { name: 'asc' } },
        versions: { orderBy: { name: 'asc' } },
        _count: { select: { issues: true } },
      },
    });
    if (!project) throw new NotFoundException(`Project ${key} not found`);

    const [byStatus, permissions] = await Promise.all([
      this.prisma.issue.groupBy({ by: ['status'], where: { projectId: project.id }, _count: true }),
      this.access.permissions(user, project.id),
    ]);
    return {
      ...project,
      permissions,
      issueCountsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    };
  }

  async create(dto: CreateProjectDto, user: AuthUser) {
    if (!PROJECT_CREATORS.includes(user.role)) {
      throw new ForbiddenException('Only admins and managers can create projects');
    }
    const key = dto.key.toUpperCase();
    if (await this.prisma.project.findUnique({ where: { key } })) {
      throw new ConflictException(`A project with key ${key} already exists`);
    }
    if (dto.leadId) await this.assertUser(dto.leadId);
    const leadId = dto.leadId ?? user.id;

    return this.prisma.project.create({
      data: {
        key,
        name: dto.name,
        description: dto.description,
        leadId,
        strictHierarchy: dto.strictHierarchy ?? false,
        defaultAccess: dto.defaultAccess ?? ProjectAccess.MEMBER,
        // The creator administers the project even if someone else is lead.
        members: { create: [...new Set([user.id, leadId])].map((userId) => ({ userId, role: ProjectRole.ADMIN })) },
      },
      include: { lead: LEAD_SELECT, _count: { select: { issues: true } } },
    });
  }

  /** Project admin only (enforced by the controller's access rule). */
  async update(key: string, dto: UpdateProjectDto) {
    const project = await this.byKey(key);
    if (dto.leadId) await this.assertUser(dto.leadId);
    return this.prisma.project.update({
      where: { id: project.id },
      data: dto,
      include: { lead: LEAD_SELECT, _count: { select: { issues: true } } },
    });
  }

  // ─── Members ───────────────────────────────────────────────────────────────

  async members(key: string) {
    const project = await this.byKey(key);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return { leadId: project.leadId, defaultAccess: project.defaultAccess, members };
  }

  async setMember(key: string, userId: string, role: ProjectRole) {
    const project = await this.byKey(key);
    await this.assertUser(userId);
    if (userId === project.leadId && role !== ProjectRole.ADMIN) {
      throw new BadRequestException('The project lead is always an administrator. Change the lead first.');
    }
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId } },
      create: { projectId: project.id, userId, role },
      update: { role },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
  }

  async removeMember(key: string, userId: string) {
    const project = await this.byKey(key);
    if (userId === project.leadId) {
      throw new BadRequestException('The project lead can\'t be removed. Change the lead first.');
    }
    await this.prisma.projectMember.deleteMany({ where: { projectId: project.id, userId } });
    return { removed: true };
  }

  private async byKey(key: string) {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project) throw new NotFoundException(`Project ${key} not found`);
    return project;
  }

  private async assertUser(id: string) {
    if (!(await this.prisma.user.findUnique({ where: { id } }))) {
      throw new NotFoundException('User not found');
    }
  }
}
