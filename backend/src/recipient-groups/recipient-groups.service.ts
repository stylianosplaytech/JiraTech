import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { Address, parseAddresses } from '../issue-email/email-html';
import { RecipientGroupDto } from './dto';

const GROUP_INCLUDE = {
  users: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: 'asc' as const } } },
  organizations: {
    include: {
      organization: {
        select: { id: true, name: true, members: { select: { user: { select: { email: true, name: true } } } } },
      },
    },
    orderBy: { organization: { name: 'asc' as const } },
  },
} satisfies Prisma.RecipientGroupInclude;

type GroupRow = Prisma.RecipientGroupGetPayload<{ include: typeof GROUP_INCLUDE }>;

/** Where an email recipient came from when it was picked as a whole: a recipient group or an organization. */
export interface RecipientRef {
  type: 'group' | 'organization';
  id: string;
}

/**
 * Recipient groups: named lists of people, organizations and plain addresses that agents can address an email to in
 * one go. Everyone on staff can see and use them; only global admins change them.
 */
@Injectable()
export class RecipientGroupsService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: AuthUser) {
    if (user.role === UserRole.CUSTOMER) throw new ForbiddenException('Only agents use recipient groups');
    const groups = await this.prisma.recipientGroup.findMany({ include: GROUP_INCLUDE, orderBy: { name: 'asc' } });
    return groups.map(serialize);
  }

  async create(dto: RecipientGroupDto) {
    const data = await this.fields(dto);
    const group = await this.unique(dto.name, () => this.prisma.recipientGroup.create({
      data: {
        name: data.name,
        description: data.description,
        addresses: data.addresses,
        users: { create: data.userIds.map((userId) => ({ userId })) },
        organizations: { create: data.organizationIds.map((organizationId) => ({ organizationId })) },
      },
      include: GROUP_INCLUDE,
    }));
    return serialize(group);
  }

  async update(id: string, dto: RecipientGroupDto) {
    await this.byId(id);
    const data = await this.fields(dto);
    const group = await this.unique(dto.name, () => this.prisma.recipientGroup.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        addresses: data.addresses,
        users: { deleteMany: {}, create: data.userIds.map((userId) => ({ userId })) },
        organizations: { deleteMany: {}, create: data.organizationIds.map((organizationId) => ({ organizationId })) },
      },
      include: GROUP_INCLUDE,
    }));
    return serialize(group);
  }

  async remove(id: string) {
    await this.byId(id);
    await this.prisma.recipientGroup.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * The addresses behind groups and organizations picked as a whole, as they are now (an organization's current
   * members), each labelled with where it came from.
   */
  async expand(refs: RecipientRef[]): Promise<Address[]> {
    const out: Address[] = [];
    const groupIds = refs.filter((r) => r.type === 'group').map((r) => r.id);
    const orgIds = refs.filter((r) => r.type === 'organization').map((r) => r.id);
    const [groups, orgs] = await Promise.all([
      this.prisma.recipientGroup.findMany({ where: { id: { in: groupIds } }, include: GROUP_INCLUDE }),
      this.prisma.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true, members: { select: { user: { select: { email: true, name: true } } } } },
      }),
    ]);
    if (groups.length !== groupIds.length || orgs.length !== orgIds.length) {
      throw new BadRequestException('A recipient group or organization you picked no longer exists');
    }
    // Keep the order they were picked in.
    for (const ref of refs) {
      if (ref.type === 'group') {
        const g = groups.find((x) => x.id === ref.id)!;
        out.push(...recipientsOf(g).map((a) => ({ ...a, via: g.name })));
      } else {
        const o = orgs.find((x) => x.id === ref.id)!;
        out.push(...o.members.map((m) => ({ email: m.user.email, name: m.user.name, via: o.name })));
      }
    }
    return out;
  }

  private async fields(dto: RecipientGroupDto) {
    const userIds = [...new Set(dto.userIds ?? [])];
    const organizationIds = [...new Set(dto.organizationIds ?? [])];
    const [users, orgs] = await Promise.all([
      this.prisma.user.count({ where: { id: { in: userIds } } }),
      this.prisma.organization.count({ where: { id: { in: organizationIds } } }),
    ]);
    if (users !== userIds.length) throw new BadRequestException('Some of the people no longer exist');
    if (orgs !== organizationIds.length) throw new BadRequestException('Some of the organizations no longer exist');
    const seen = new Set<string>();
    const addresses = (dto.addresses ?? [])
      .map((a) => ({ email: a.email.trim().toLowerCase(), name: a.name?.trim() || null }))
      .filter((a) => !seen.has(a.email) && seen.add(a.email));
    if (!userIds.length && !organizationIds.length && !addresses.length) {
      throw new BadRequestException('Add at least one person, organization or address');
    }
    return {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      addresses: JSON.stringify(addresses),
      userIds,
      organizationIds,
    };
  }

  private async byId(id: string) {
    const group = await this.prisma.recipientGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Recipient group not found');
    return group;
  }

  private async unique<T>(name: string, fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A recipient group called ${name.trim()} already exists`);
      }
      throw e;
    }
  }
}

/** Everyone a group reaches, each address once. */
function recipientsOf(g: GroupRow): Address[] {
  const seen = new Set<string>();
  const all: Address[] = [
    ...g.users.map((u) => ({ email: u.user.email, name: u.user.name })),
    ...g.organizations.flatMap((o) => o.organization.members.map((m) => ({ email: m.user.email, name: m.user.name }))),
    ...parseAddresses(g.addresses),
  ];
  return all.filter((a) => {
    const key = a.email.toLowerCase();
    return !seen.has(key) && seen.add(key);
  });
}

function serialize(g: GroupRow) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    users: g.users.map((u) => u.user),
    organizations: g.organizations.map((o) => ({ id: o.organization.id, name: o.organization.name, memberCount: o.organization.members.length })),
    addresses: parseAddresses(g.addresses),
    /** Everyone it reaches right now */
    recipients: recipientsOf(g),
    updatedAt: g.updatedAt,
  };
}
