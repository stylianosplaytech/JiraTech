import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { NotificationSchemeService } from './notification-scheme.service';
import { SchemeDto } from './notification-scheme.dto';

/** /notification-scheme — who is emailed about issue events in every project without its own scheme (global admins). */
@Controller('notification-scheme')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class NotificationSchemeController {
  constructor(private schemes: NotificationSchemeService) {}

  @Get()
  get() {
    return this.schemes.getGlobal();
  }

  @Put()
  save(@Body() dto: SchemeDto) {
    return this.schemes.saveGlobal(dto.scheme);
  }

  /** Back to the built-in defaults */
  @Delete()
  reset() {
    return this.schemes.saveGlobal(null);
  }
}

const PROJECT = { from: 'projectParam', param: 'key' } as const;

/** /projects/:key/notification-scheme — a project's own scheme (its admins); anyone in the project can see it. */
@Controller('projects/:key/notification-scheme')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ProjectNotificationSchemeController {
  constructor(private schemes: NotificationSchemeService) {}

  @Get()
  @RequireAccess('browse', PROJECT)
  get(@Param('key') key: string) {
    return this.schemes.getProject(key);
  }

  @Put()
  @RequireAccess('admin', PROJECT)
  save(@Param('key') key: string, @Body() dto: SchemeDto) {
    return this.schemes.saveProject(key, dto.scheme);
  }

  /** Use the global scheme again */
  @Delete()
  @RequireAccess('admin', PROJECT)
  reset(@Param('key') key: string) {
    return this.schemes.saveProject(key, null);
  }
}
