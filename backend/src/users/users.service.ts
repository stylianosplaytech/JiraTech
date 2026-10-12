import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { contains } from '../common/text-match';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type UserKind = 'staff' | 'customers' | 'all';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        role: dto.role,
      },
      select: USER_SELECT,
    });
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
    } = {
      email: dto.email,
      name: dto.name,
      role: dto.role,
    };

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
  }
}
