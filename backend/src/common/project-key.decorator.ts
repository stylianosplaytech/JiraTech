import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The project the client is working in: `?project=KEY` or the `X-Project-Key` header. */
export const ProjectKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  const value = req.query?.project ?? req.headers['x-project-key'];
  return typeof value === 'string' && value ? value : undefined;
});
