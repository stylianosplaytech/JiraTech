import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProject } from '../common/project.util';

@Injectable()
export class LabelsService {
  constructor(private prisma: PrismaService) {}

  async findAll(projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    return this.prisma.label.findMany({
      where: { projectId: project.id },
      orderBy: { name: 'asc' },
    });
  }

  async create(name: string, projectKey?: string) {
    const project = await resolveProject(this.prisma, projectKey);
    return this.prisma.label.upsert({
      where: { projectId_name: { projectId: project.id, name } },
      update: {},
      create: { name, projectId: project.id },
    });
  }
}
