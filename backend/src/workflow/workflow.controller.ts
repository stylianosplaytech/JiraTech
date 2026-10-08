import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { IssueStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { WorkflowService } from './workflow.service';

class StatusDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(IssueStatus)
  category!: IssueStatus;
}

class UpdateStatusDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(IssueStatus)
  category?: IssueStatus;
}

class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  statusIds!: string[];
}

class TransitionPairDto {
  @IsString()
  fromStatusId!: string;

  @IsString()
  toStatusId!: string;
}

class TransitionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransitionPairDto)
  transitions!: TransitionPairDto[];
}

const PROJECT = { from: 'projectParam', param: 'key' } as const;

/** /projects/:key/workflow — reading needs browse access, changes need project admin. */
@Controller('projects/:key/workflow')
@UseGuards(JwtAuthGuard, AccessGuard)
export class WorkflowController {
  constructor(private workflow: WorkflowService) {}

  @Get()
  @RequireAccess('browse', PROJECT)
  get(@Request() req: { projectId: string }) {
    return this.workflow.workflow(req.projectId);
  }

  @Post('statuses')
  @RequireAccess('admin', PROJECT)
  addStatus(@Request() req: { projectId: string }, @Body() dto: StatusDto) {
    return this.workflow.addStatus(req.projectId, dto.name, dto.category);
  }

  @Patch('statuses/:statusId')
  @RequireAccess('admin', PROJECT)
  updateStatus(@Request() req: { projectId: string }, @Param('statusId') statusId: string, @Body() dto: UpdateStatusDto) {
    return this.workflow.updateStatus(req.projectId, statusId, dto);
  }

  @Delete('statuses/:statusId')
  @RequireAccess('admin', PROJECT)
  deleteStatus(@Request() req: { projectId: string }, @Param('statusId') statusId: string, @Query('moveTo') moveTo?: string) {
    return this.workflow.deleteStatus(req.projectId, statusId, moveTo);
  }

  @Put('order')
  @RequireAccess('admin', PROJECT)
  reorder(@Request() req: { projectId: string }, @Body() dto: ReorderDto) {
    return this.workflow.reorder(req.projectId, dto.statusIds);
  }

  @Put('transitions')
  @RequireAccess('admin', PROJECT)
  setTransitions(@Request() req: { projectId: string }, @Body() dto: TransitionsDto) {
    return this.workflow.setTransitions(req.projectId, dto.transitions);
  }
}
