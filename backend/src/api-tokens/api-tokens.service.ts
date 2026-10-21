import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApiTokenAccess, UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Every token starts with this, which is how the auth guard tells it from a login (JWT) token. */
export const TOKEN_PREFIX = 'jt_';
const MAX_ACTIVE_TOKENS = 25;
/** lastUsedAt is only rewritten when it's older than this, so busy integrations don't write on every request. */
const TOUCH_MS = 60_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const PUBLIC = {
  id: true, name: true, prefix: true, access: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true,
} as const;

/** The user an API token acts as, plus the token itself (so the guard can enforce its access). */
export interface TokenAuth {
  user: { id: string; email: string; name: string; role: UserRole };
  token: { id: string; access: ApiTokenAccess };
}

@Injectable()
export class ApiTokensService {
  constructor(private prisma: PrismaService) {}

  /** The owner's tokens, newest first; revoked ones are left out. */
  list(userId: string) {
    return this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      select: PUBLIC,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, input: { name: string; access: ApiTokenAccess; expiresInDays?: number | null }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Give the token a name');
    const active = await this.prisma.apiToken.count({ where: { userId, revokedAt: null } });
    if (active >= MAX_ACTIVE_TOKENS) {
      throw new BadRequestException(`You can have up to ${MAX_ACTIVE_TOKENS} API tokens; revoke one you no longer use first`);
    }
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    const created = await this.prisma.apiToken.create({
      data: { userId, name, access: input.access, expiresAt, tokenHash: hash(token), prefix: token.slice(0, TOKEN_PREFIX.length + 5) },
      select: PUBLIC,
    });
    // The only time the token is ever shown.
    return { ...created, token };
  }

  async revoke(userId: string, id: string) {
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new NotFoundException('Token not found');
    return { revoked: true };
  }

  /** Null when the token is unknown, revoked or expired, or its owner can't use the API. */
  async authenticate(raw: string): Promise<TokenAuth | null> {
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hash(raw) },
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
    if (row.user.role === UserRole.CUSTOMER) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_MS) {
      void this.prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { user: row.user, token: { id: row.id, access: row.access } };
  }
}
