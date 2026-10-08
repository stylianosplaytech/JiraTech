import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { AuthRequest } from '../common/auth-user';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':key')
  findOne(@Param('key') key: string) {
    return this.projectsService.findOne(key);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @Request() req: AuthRequest) {
    return this.projectsService.create(dto, req.user);
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateProjectDto, @Request() req: AuthRequest) {
    return this.projectsService.update(key, dto, req.user);
  }
}
