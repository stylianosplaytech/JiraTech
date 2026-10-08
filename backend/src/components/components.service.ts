import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ComponentType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComponentDto } from './dto/component.dto';

@Injectable()
export class ComponentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(type?: ComponentType, includeArchived = false) {
    const project = await this.prisma.project.findFirstOrThrow({ where: { key: 'SPORTS' } });
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

  async create(dto: CreateComponentDto, userRole: UserRole) {
    if (userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can create components');
    }
    this.validateNaming(dto.name, dto.type);
    const project = await this.prisma.project.findFirstOrThrow({ where: { key: 'SPORTS' } });
    return this.prisma.component.create({
      data: { ...dto, projectId: project.id },
      include: { lead: { select: { id: true, name: true, email: true } } },
    });
  }

  async archive(id: string, userRole: UserRole) {
    if (userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can archive components');
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
