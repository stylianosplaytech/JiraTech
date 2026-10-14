import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { OrganizationsService } from './organizations.service';
import { OrganizationDto } from './organizations.dto';

/** Staff can list organizations; only global admins change them. */
@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private organizations: OrganizationsService) {}

  @Get()
  findAll() {
    return this.organizations.findAll();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() dto: OrganizationDto) {
    return this.organizations.create(dto.name);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  rename(@Param('id') id: string, @Body() dto: OrganizationDto) {
    return this.organizations.rename(id, dto.name);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.organizations.remove(id);
  }

  @Put(':id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  addMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.organizations.addMember(id, userId);
  }

  @Delete(':id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.organizations.removeMember(id, userId);
  }
}
