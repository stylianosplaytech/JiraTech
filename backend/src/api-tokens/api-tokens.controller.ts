import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiTokenAccess } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard, LoginOnlyGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { ApiTokensService } from './api-tokens.service';

class CreateApiTokenDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsEnum(ApiTokenAccess)
  access!: ApiTokenAccess;

  /** Days until it stops working; leave out for a token that doesn't expire */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}

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
