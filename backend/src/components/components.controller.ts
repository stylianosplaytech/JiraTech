import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ComponentType, UserRole } from '@prisma/client';
import { ComponentsService } from './components.service';
import { CreateComponentDto } from './dto/component.dto';
import { JwtAuthGuard } from '../auth/guards';

@Controller('components')
@UseGuards(JwtAuthGuard)
export class ComponentsController {
  constructor(private componentsService: ComponentsService) {}

  @Get()
  findAll(@Query('type') type?: ComponentType) {
    return this.componentsService.findAll(type);
  }

  @Post()
  create(@Body() dto: CreateComponentDto, @Request() req: { user: { role: UserRole } }) {
    return this.componentsService.create(dto, req.user.role);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string, @Request() req: { user: { role: UserRole } }) {
    return this.componentsService.archive(id, req.user.role);
  }
}
