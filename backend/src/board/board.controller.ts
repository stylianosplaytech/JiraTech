import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BoardService } from './board.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';

@Controller('board')
@UseGuards(JwtAuthGuard, AccessGuard)
export class BoardController {
  constructor(private boardService: BoardService) {}

  @Get()
  @RequireAccess('browse')
  getBoard(@Query('sprintId') sprintId?: string, @ProjectKey() projectKey?: string) {
    return this.boardService.getBoard(sprintId, projectKey);
  }
}
