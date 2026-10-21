import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, LoginOnlyGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { ApiTokensService } from './api-tokens.service';
import { CreateApiTokenDto } from './api-tokens.dto';

/** /api-tokens — people manage their own tokens. A token can't manage tokens (a leaked one couldn't mint others). */
@Controller('api-tokens')
@UseGuards(JwtAuthGuard, LoginOnlyGuard)
export class ApiTokensController {
  constructor(private tokens: ApiTokensService) {}

  @Get()
  list(@Request() req: { user: AuthUser }) {
    return this.tokens.list(req.user.id);
  }

  @Post()
  create(@Request() req: { user: AuthUser }, @Body() dto: CreateApiTokenDto) {
    return this.tokens.create(req.user.id, dto);
  }

  @Delete(':id')
  revoke(@Request() req: { user: AuthUser }, @Param('id') id: string) {
    return this.tokens.revoke(req.user.id, id);
  }
}
