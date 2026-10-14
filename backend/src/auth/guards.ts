import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ApiTokenAccess, UserRole } from '@prisma/client';
import { ApiTokensService, TOKEN_PREFIX } from '../api-tokens/api-tokens.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

const ALLOW_CUSTOMERS_KEY = 'allowCustomers';
/** Lets service desk customers use a route (or a whole controller). Everything else is closed to them. */
export const AllowCustomers = () => SetMetadata(ALLOW_CUSTOMERS_KEY, true);

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Logged-in users (JWT) and API tokens (jt_…) both get through; either way `req.user` is the person acting. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // ModuleRef rather than a constructor dependency: this guard is used in nearly every module.
  constructor(private reflector: Reflector, private moduleRef: ModuleRef) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers?.authorization ?? '')?.[1];
    if (bearer?.startsWith(TOKEN_PREFIX)) {
      const auth = await this.moduleRef.get(ApiTokensService, { strict: false }).authenticate(bearer);
      if (!auth) throw new UnauthorizedException('Invalid, expired or revoked API token');
      if (auth.token.access === ApiTokenAccess.READ && !READ_ONLY_METHODS.has(req.method)) {
        throw new ForbiddenException('This API token is read-only');
      }
      req.user = auth.user;
      req.apiToken = auth.token;
    } else if (!(await super.canActivate(context))) {
      return false;
    }
    const { user } = req;
    // Customers only get the help center: deny by default so new agent routes stay closed to them.
    if (user?.role === UserRole.CUSTOMER) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_CUSTOMERS_KEY, [context.getHandler(), context.getClass()]);
      if (!allowed) throw new ForbiddenException('Customers can only use the help center');
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user?.role);
  }
}

/** Closes a route to API tokens: it needs a person who logged in (managing tokens and webhooks, where a leaked token would do harm). */
@Injectable()
export class LoginOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest().apiToken) throw new ForbiddenException('This needs you to be logged in: API tokens cannot do it');
    return true;
  }
}
