import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { AccessService } from './access.service';

@Controller('access')
@UseGuards(JwtAuthGuard)
export class AccessController {
  constructor(private access: AccessService) {}

  /** The projects the signed-in user may set up webhooks and automation for (and whether that includes everything) */
  @Get('admin-scope')
  adminScope(@Request() req: { user: AuthUser }) {
    return this.access.manageScope(req.user);
  }
}
