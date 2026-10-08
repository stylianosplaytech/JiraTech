import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { resolveProject } from '../common/project.util';
import { AccessService, Permission } from './access.service';

/** Where the project for a route comes from. */
export type ProjectSource =
  | { from: 'context' } // X-Project-Key header / ?project= / default project
  | { from: 'projectParam'; param: string }
  | { from: 'issueParam'; param: string }
  | { from: 'versionParam'; param: string }
  | { from: 'componentParam'; param: string }
  | { from: 'piParam'; param: string }
  | { from: 'piBody'; field: string }
  | { from: 'issueBody'; field: string };

const ACCESS_KEY = 'projectAccess';

/**
 * Declares the project permission a route needs. Use together with
 * `@UseGuards(JwtAuthGuard, AccessGuard)` on the controller.
 */
export const RequireAccess = (permission: Permission, source: ProjectSource = { from: 'context' }) =>
  SetMetadata(ACCESS_KEY, { permission, source });

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private access: AccessService,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<{ permission: Permission; source: ProjectSource } | undefined>(ACCESS_KEY, ctx.getHandler());
    if (!rule) return true;
    const req = ctx.switchToHttp().getRequest();
    const projectId = await this.projectId(rule.source, req);
    req.projectRole = await this.access.require(req.user, projectId, rule.permission);
    req.projectId = projectId;
    return true;
  }

  private async projectId(source: ProjectSource, req: { params: Record<string, string>; body: Record<string, string>; query: Record<string, unknown>; headers: Record<string, unknown> }) {
    switch (source.from) {
      case 'context': {
        const key = req.query?.project ?? req.headers['x-project-key'];
        return (await resolveProject(this.prisma, typeof key === 'string' && key ? key : undefined)).id;
      }
      case 'projectParam': return this.access.projectOfKey(req.params[source.param]);
      case 'issueParam': return this.access.projectOfIssue(req.params[source.param]);
      case 'versionParam': return this.access.projectOfVersion(req.params[source.param]);
      case 'componentParam': return this.access.projectOfComponent(req.params[source.param]);
      case 'piParam': return this.access.projectOfPi(req.params[source.param]);
      case 'piBody': return this.access.projectOfPi(String(req.body?.[source.field] ?? ''));
      case 'issueBody': return this.access.projectOfIssue(String(req.body?.[source.field] ?? ''));
    }
  }
}
