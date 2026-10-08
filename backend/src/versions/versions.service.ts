import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProject } from '../common/project.util';
import { AuthUser } from '../common/auth-user';

@Injectable()
export class VersionsService {
  constructor(private prisma: PrismaService) {}

  async findAll(projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    return this.prisma.version.findMany({
      where: { projectId: project.id },
      include: { _count: { select: { issueVersions: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(
    projectKey: string | undefined,
    data: { name: string; description?: string; releaseDate?: string },
    user: AuthUser,
  ) {
    const project = await resolveProject(this.prisma, projectKey);
    const existing = await this.prisma.version.findUnique({
      where: { projectId_name: { projectId: project.id, name: data.name } },
    });
    if (existing) throw new ConflictException(`Version ${data.name} already exists`);
    return this.prisma.version.create({
      data: {
        projectId: project.id,
        name: data.name,
        description: data.description,
        releaseDate: data.releaseDate ? new Date(data.releaseDate) : undefined,
      },
    });
  }

  async update(
    id: string,
    data: { name?: string; description?: string; releaseDate?: string; released?: boolean },
    user: AuthUser,
  ) {
    const version = await this.prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    return this.prisma.version.update({
      where: { id },
      data: {
        ...data,
        releaseDate: data.releaseDate ? new Date(data.releaseDate) : undefined,
      },
    });
  }
}
