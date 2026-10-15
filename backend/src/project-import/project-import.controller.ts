import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { AuthRequest } from '../common/auth-user';
import { ImportProjectDto, PreviewImportDto } from './project-import.dto';
import { ProjectImportService } from './project-import.service';

@Controller('project-import')
@UseGuards(JwtAuthGuard)
export class ProjectImportController {
  constructor(private service: ProjectImportService) {}

  /** What importing the file would create. Writes nothing. */
  @Post('preview')
  preview(@Body() dto: PreviewImportDto, @Request() req: AuthRequest) {
    return this.service.preview(dto, req.user);
  }

  @Post()
  import(@Body() dto: ImportProjectDto, @Request() req: AuthRequest) {
    return this.service.import(dto, req.user);
  }
}
