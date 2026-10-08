import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BoardService } from './board.service';
import { JwtAuthGuard } from '../auth/guards';
import { ProjectKey } from '../common/project-key.decorator';

@Controller('board')
@UseGuards(JwtAuthGuard)
export class BoardController {
  constructor(private boardService: BoardService) {}

  @Get()
  getBoard(@Query('sprintId') sprintId?: string, @ProjectKey() projectKey?: string) {
    return this.boardService.getBoard(sprintId, projectKey);
  }
}
