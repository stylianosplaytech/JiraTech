import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { contains } from '../common/text-match';
import { AuthUser } from '../common/auth-user';
import { InvitationsService } from './invitations.service';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  invitePending: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type UserKind = 'staff' | 'customers' | 'all';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private invitations: InvitationsService) {}

  /** Staff by default: customers only appear when asked for (People page, service desk customer lists). */
  async findAll(search?: string, kind: UserKind = 'staff') {
    const where: Prisma.UserWhereInput = {};
    if (search) where.OR = [{ name: contains(search) }, { email: contains(search) }];
    if (kind === 'staff') where.role = { not: UserRole.CUSTOMER };
    if (kind === 'customers') where.role = UserRole.CUSTOMER;
    return this.prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Without a password, the person gets a welcome email to choose their own (until then nobody can log in as them).
   * `invitation` says whether that email went out.
   */
  async create(dto: CreateUserDto, admin: AuthUser) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');
    const invite = dto.sendInvite ?? true;
    if (!dto.password && !invite) throw new BadRequestException('Set a password or send a welcome email');

    const passwordHash = await bcrypt.hash(dto.password ?? randomBytes(24).toString('hex'), 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        role: dto.role,
        invitePending: !dto.password,
      },
      select: USER_SELECT,
    });
    return { ...user, invitation: invite ? await this.invitations.invite(user.id, admin) : null };
  }

  /** A new welcome link (also a way to let someone reset a forgotten password). */
  async invite(id: string, admin: AuthUser) {
    await this.findOne(id);
    return this.invitations.invite(id, admin);
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);

    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id } },
      });
      if (existing) throw new ConflictException('Email already in use');
    }

    const data: {
      email?: string;
      name?: string;
      role?: UserRole;
      passwordHash?: string;
      invitePending?: boolean;
    } = {
      email: dto.email,
      name: dto.name,
      role: dto.role,
    };

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
      data.invitePending = false;
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
  }
}
