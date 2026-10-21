import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CustomFieldsService } from './custom-fields.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';
import { CreateCustomFieldDto } from './custom-fields.dto';

@Controller('custom-fields')
@UseGuards(JwtAuthGuard, AccessGuard)
export class CustomFieldsController {
  constructor(private customFieldsService: CustomFieldsService) {}

  @Get()
  @RequireAccess('browse')
  getDefinitions(@ProjectKey() projectKey?: string) {
    return this.customFieldsService.getDefinitions(projectKey);
  }

  @Post()
  @RequireAccess('admin')
  createDefinition(
    @Body() dto: CreateCustomFieldDto,
    @Request() req: { user: { role: UserRole } },
    @ProjectKey() projectKey?: string,
  ) {
    return this.customFieldsService.createDefinition(dto, req.user.role, projectKey);
  }
}
