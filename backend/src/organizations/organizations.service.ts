import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ORGANIZATION_INCLUDE = {
  members: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: 'asc' as const } } },
  portals: { include: { portal: { select: { id: true, slug: true, name: true, project: { select: { key: true, name: true } } } } } },
  _count: { select: { issues: true } },
} satisfies Prisma.OrganizationInclude;

/**
 * Customer organizations (companies). Membership decides which portals a customer can use and which
 * requests they see, so only global admins manage it; service desk admins just link organizations to their portals.
 */
@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.organization.findMany({ include: ORGANIZATION_INCLUDE, orderBy: { name: 'asc' } });
  }

  async create(name: string) {
    return this.unique(name, () => this.prisma.organization.create({ data: { name: name.trim() }, include: ORGANIZATION_INCLUDE }));
  }

  async rename(id: string, name: string) {
    await this.byId(id);
    return this.unique(name, () => this.prisma.organization.update({ where: { id }, data: { name: name.trim() }, include: ORGANIZATION_INCLUDE }));
  }

  /** Requests shared with it become private to their reporter and participants again. */
  async remove(id: string) {
    await this.byId(id);
    await this.prisma.organization.delete({ where: { id } });
    return { deleted: true };
  }

  async addMember(id: string, userId: string) {
    await this.byId(id);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.CUSTOMER) throw new BadRequestException('Only customer accounts can belong to an organization');
    await this.prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: id, userId } },
      create: { organizationId: id, userId },
      update: {},
    });
    return this.prisma.organization.findUniqueOrThrow({ where: { id }, include: ORGANIZATION_INCLUDE });
  }

  async removeMember(id: string, userId: string) {
    await this.byId(id);
    await this.prisma.organizationMember.deleteMany({ where: { organizationId: id, userId } });
    return this.prisma.organization.findUniqueOrThrow({ where: { id }, include: ORGANIZATION_INCLUDE });
  }

  private async byId(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  private async unique<T>(name: string, fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`An organization called ${name.trim()} already exists`);
      }
      throw e;
    }
  }
}
