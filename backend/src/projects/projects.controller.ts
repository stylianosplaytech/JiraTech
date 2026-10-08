import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { AuthRequest } from '../common/auth-user';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, SetMemberDto, UpdateProjectDto } from './dto/project.dto';

const PROJECT = { from: 'projectParam', param: 'key' } as const;

@Controller('projects')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  findAll(@Request() req: AuthRequest) {
    return this.projectsService.findAll(req.user);
  }

  @Get(':key')
  @RequireAccess('browse', PROJECT)
  findOne(@Param('key') key: string, @Request() req: AuthRequest) {
    return this.projectsService.findOne(key, req.user);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @Request() req: AuthRequest) {
    return this.projectsService.create(dto, req.user);
  }

  @Patch(':key')
  @RequireAccess('admin', PROJECT)
  update(@Param('key') key: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(key, dto);
  }

  @Get(':key/members')
  @RequireAccess('browse', PROJECT)
  members(@Param('key') key: string) {
    return this.projectsService.members(key);
  }

  @Put(':key/members/:userId')
  @RequireAccess('admin', PROJECT)
  setMember(@Param('key') key: string, @Param('userId') userId: string, @Body() dto: SetMemberDto) {
    return this.projectsService.setMember(key, userId, dto.role);
  }

  @Delete(':key/members/:userId')
  @RequireAccess('admin', PROJECT)
  removeMember(@Param('key') key: string, @Param('userId') userId: string) {
    return this.projectsService.removeMember(key, userId);
  }
}
