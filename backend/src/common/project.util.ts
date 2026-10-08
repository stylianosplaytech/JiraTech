import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function getSportsProject(prisma: PrismaService) {
  const project = await prisma.project.findFirst({ where: { key: 'SPORTS' } });
  if (!project) throw new NotFoundException('SPORTS project not found');
  return project;
}
