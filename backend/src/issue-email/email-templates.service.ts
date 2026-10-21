import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../common/auth-user';
import { sanitizeRich } from '../common/rich-text';
import { EmailTemplateDto } from './dto';

const SELECT = {
  id: true, name: true, subject: true, body: true, projectId: true, updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

/**
 * Ready-made emails agents start from. Global templates are managed by admins and offered on every service desk;
 * a service desk's own templates are managed by its project admins.
 */
@Injectable()
export class EmailTemplatesService {
  constructor(private prisma: PrismaService, private access: AccessService) {}

  /**
   * `projectKey`: the templates offered there (global and its own). `scope` narrows it for the settings pages:
   * 'global' (no project needed) or 'project'.
   */
  async list(user: AuthUser, projectKey?: string, scope?: 'global' | 'project') {
    if (user.role === UserRole.CUSTOMER) throw new ForbiddenException('Only agents use email templates');
    const projectId = projectKey ? (await this.desk(projectKey)).id : null;
    if (projectId) await this.access.require(user, projectId, 'browse');
    if (!projectId && scope === 'project') throw new BadRequestException('Say which service desk');
    const where = scope === 'global' || !projectId
      ? { projectId: null }
      : scope === 'project' ? { projectId } : { OR: [{ projectId: null }, { projectId }] };
    return this.prisma.emailTemplate.findMany({ where, select: SELECT, orderBy: [{ name: 'asc' }] });
  }

  async create(user: AuthUser, dto: EmailTemplateDto) {
    const projectId = dto.projectKey ? (await this.desk(dto.projectKey)).id : null;
    await this.requireManage(user, projectId);
    return this.prisma.emailTemplate.create({
      data: { projectId, createdById: user.id, ...this.fields(dto) },
      select: SELECT,
    });
  }

  async update(user: AuthUser, id: string, dto: EmailTemplateDto) {
    const template = await this.find(id);
    await this.requireManage(user, template.projectId);
    return this.prisma.emailTemplate.update({ where: { id }, data: this.fields(dto), select: SELECT });
  }

  async remove(user: AuthUser, id: string) {
    const template = await this.find(id);
    await this.requireManage(user, template.projectId);
    await this.prisma.emailTemplate.delete({ where: { id } });
    return { deleted: true };
  }

  private fields(dto: EmailTemplateDto) {
    const body = sanitizeRich(dto.body);
    if (!body) throw new BadRequestException('Write the template\'s text');
    return { name: dto.name.trim(), subject: dto.subject?.trim() || null, body };
  }

  private async requireManage(user: AuthUser, projectId: string | null) {
    if (projectId) {
      await this.access.require(user, projectId, 'admin');
    } else if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can manage global email templates');
    }
  }

  private async find(id: string) {
    const template = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  private async desk(key: string) {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project || project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException(`${key.toUpperCase()} is not a service desk`);
    return project;
  }
}
