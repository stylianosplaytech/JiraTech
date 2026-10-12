import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

const ALLOW_CUSTOMERS_KEY = 'allowCustomers';
/** Lets service desk customers use a route (or a whole controller). Everything else is closed to them. */
export const AllowCustomers = () => SetMetadata(ALLOW_CUSTOMERS_KEY, true);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await super.canActivate(context))) return false;
    const { user } = context.switchToHttp().getRequest();
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
