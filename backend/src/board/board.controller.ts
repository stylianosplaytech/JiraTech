import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BoardService } from './board.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('board')
@UseGuards(JwtAuthGuard)
export class BoardController {
  constructor(private boardService: BoardService) {}

  @Get()
  getBoard(@Query('sprintId') sprintId?: string) {
    return this.boardService.getBoard(sprintId);
  }
}
