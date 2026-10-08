import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getSportsProject } from '../common/project.util';

@Injectable()
export class VersionsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const project = await getSportsProject(this.prisma);
    return this.prisma.version.findMany({
      where: { projectId: project.id },
      orderBy: { name: 'asc' },
    });
  }
}
