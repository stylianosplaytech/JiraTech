import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UserKind, UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth/guards';
import { AuthRequest } from '../common/auth-user';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll(@Query('search') search?: string, @Query('kind') kind?: UserKind) {
    return this.usersService.findAll(search, kind && ['staff', 'customers', 'all'].includes(kind) ? kind : 'staff');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateUserDto, @Request() req: AuthRequest) {
    return this.usersService.create(dto, req.user);
  }

  /** Emails a new welcome link to choose a password. */
  @Post(':id/invite')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  invite(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.usersService.invite(id, req.user);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }
}
