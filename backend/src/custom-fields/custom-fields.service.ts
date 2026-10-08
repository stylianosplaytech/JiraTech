import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomFieldType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getSportsProject } from '../common/project.util';

@Injectable()
export class CustomFieldsService {
  constructor(private prisma: PrismaService) {}

  async getDefinitions() {
    const project = await getSportsProject(this.prisma);
    return this.prisma.customFieldDefinition.findMany({
      where: { projectId: project.id },
      orderBy: { order: 'asc' },
    });
  }

  async createDefinition(
    data: {
      key: string;
      name: string;
      type: CustomFieldType;
      options?: string[];
      required?: boolean;
      order?: number;
    },
    role: UserRole,
  ) {
    if (role !== UserRole.ADMIN) throw new NotFoundException('Admin only');
    const project = await getSportsProject(this.prisma);
    return this.prisma.customFieldDefinition.create({
      data: {
        projectId: project.id,
        key: data.key,
        name: data.name,
        type: data.type,
        options: data.options ? JSON.stringify(data.options) : null,
        required: data.required ?? false,
        order: data.order ?? 0,
      },
    });
  }

  async setIssueValues(issueId: string, values: Record<string, string>) {
    const project = await getSportsProject(this.prisma);
    const definitions = await this.prisma.customFieldDefinition.findMany({
      where: { projectId: project.id },
    });
    const defByKey = new Map(definitions.map((d) => [d.key, d]));

    for (const [key, value] of Object.entries(values)) {
      const field = defByKey.get(key);
      if (!field) continue;
      await this.prisma.customFieldValue.upsert({
        where: { issueId_fieldId: { issueId, fieldId: field.id } },
        update: { value },
        create: { issueId, fieldId: field.id, value },
      });
    }
  }

  async incrementReopenCount(issueId: string) {
    const project = await getSportsProject(this.prisma);
    const field = await this.prisma.customFieldDefinition.findUnique({
      where: { projectId_key: { projectId: project.id, key: 'reopen_count' } },
    });
    if (!field) return;

    const existing = await this.prisma.customFieldValue.findUnique({
      where: { issueId_fieldId: { issueId, fieldId: field.id } },
    });
    const current = existing ? parseInt(existing.value, 10) || 0 : 0;
    await this.prisma.customFieldValue.upsert({
      where: { issueId_fieldId: { issueId, fieldId: field.id } },
      update: { value: String(current + 1) },
      create: { issueId, fieldId: field.id, value: '1' },
    });
  }
}
