import { Body, Controller, Delete, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import type { AuthRequest } from '../common/auth-user';
import { RecipientGroupsService } from './recipient-groups.service';
import { RecipientGroupDto } from './dto';

/** Staff can list recipient groups (to address emails); only global admins change them. */
@Controller('recipient-groups')
@UseGuards(JwtAuthGuard)
export class RecipientGroupsController {
  constructor(private groups: RecipientGroupsService) {}

  @Get()
  findAll(@Request() req: AuthRequest) {
    return this.groups.findAll(req.user);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() dto: RecipientGroupDto) {
    return this.groups.create(dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: RecipientGroupDto) {
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.groups.remove(id);
  }
}
