import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
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
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.project.findMany({
      include: { lead: LEAD_SELECT, _count: { select: { issues: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(key: string) {
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

    const byStatus = await this.prisma.issue.groupBy({
      by: ['status'],
      where: { projectId: project.id },
      _count: true,
    });
    return { ...project, issueCountsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])) };
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

    return this.prisma.project.create({
      data: {
        key,
        name: dto.name,
        description: dto.description,
        leadId: dto.leadId ?? user.id,
        strictHierarchy: dto.strictHierarchy ?? false,
      },
      include: { lead: LEAD_SELECT, _count: { select: { issues: true } } },
    });
  }

  async update(key: string, dto: UpdateProjectDto, user: AuthUser) {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project) throw new NotFoundException(`Project ${key} not found`);
    if (user.role !== UserRole.ADMIN && project.leadId !== user.id) {
      throw new ForbiddenException('Only the project lead or an admin can edit project settings');
    }
    if (dto.leadId) await this.assertUser(dto.leadId);

    return this.prisma.project.update({
      where: { id: project.id },
      data: dto,
      include: { lead: LEAD_SELECT, _count: { select: { issues: true } } },
    });
  }

  private async assertUser(id: string) {
    if (!(await this.prisma.user.findUnique({ where: { id } }))) {
      throw new NotFoundException('Project lead not found');
    }
  }
}
