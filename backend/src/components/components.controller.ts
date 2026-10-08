import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ComponentType } from '@prisma/client';
import { ComponentsService } from './components.service';
import { CreateComponentDto } from './dto/component.dto';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';
import { AuthRequest } from '../common/auth-user';

@Controller('components')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ComponentsController {
  constructor(private componentsService: ComponentsService) {}

  @Get()
  @RequireAccess('browse')
  findAll(@Query('type') type?: ComponentType, @ProjectKey() projectKey?: string) {
    return this.componentsService.findAll(type, false, projectKey);
  }

  @Post()
  @RequireAccess('admin')
  create(@Body() dto: CreateComponentDto, @ProjectKey() projectKey: string | undefined, @Request() req: AuthRequest) {
    return this.componentsService.create(dto, req.user, projectKey);
  }

  @Patch(':id/archive')
  @RequireAccess('admin', { from: 'componentParam', param: 'id' })
  archive(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.componentsService.archive(id, req.user);
  }
}
