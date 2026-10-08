import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ComponentType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProject } from '../common/project.util';
import { AuthUser } from '../common/auth-user';
import { CreateComponentDto } from './dto/component.dto';

@Injectable()
export class ComponentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(type?: ComponentType, includeArchived = false, projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    return this.prisma.component.findMany({
      where: {
        projectId: project.id,
        ...(type && { type }),
        ...(!includeArchived && { archived: false }),
      },
      include: { lead: { select: { id: true, name: true, email: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateComponentDto, user: AuthUser, projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    if (user.role !== UserRole.ADMIN && user.id !== project.leadId) {
      throw new ForbiddenException('Only admins or the project lead can create components');
    }
    // ASSETID / @team naming is a SPORTS convention; other projects name components freely.
    if (project.strictHierarchy) this.validateNaming(dto.name, dto.type);
    return this.prisma.component.create({
      data: { ...dto, projectId: project.id },
      include: { lead: { select: { id: true, name: true, email: true } } },
    });
  }

  async archive(id: string, user: AuthUser) {
    const component = await this.prisma.component.findUniqueOrThrow({ where: { id }, include: { project: true } });
    if (user.role !== UserRole.ADMIN && user.id !== component.project.leadId) {
      throw new ForbiddenException('Only admins or the project lead can archive components');
    }
    return this.prisma.component.update({ where: { id }, data: { archived: true } });
  }

  private validateNaming(name: string, type: ComponentType) {
    if (type === ComponentType.TEAM) {
      if (!name.startsWith('@')) {
        throw new BadRequestException('Team components must start with @');
      }
    } else if (type === ComponentType.SERVICE || type === ComponentType.RELEASE_TRAIN) {
      const match = /^[A-Z]{3,}\s+\([a-zA-Z]+\)$/.test(name);
      if (!match) {
        throw new BadRequestException('Service/Release Train components must follow ASSETID (serviceName) format');
      }
    }
  }
}
