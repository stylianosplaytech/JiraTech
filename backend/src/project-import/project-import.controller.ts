import { BadRequestException, Body, Controller, Post, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiBodyOptions, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards';
import { AuthRequest } from '../common/auth-user';
import { ProjectImportService } from './project-import.service';

/** Jira exports run to tens of megabytes. The guard runs before the upload is read, so only signed-in users can send one. */
const MAX_EXPORT_BYTES = 300 * 1024 * 1024;
const UPLOAD = FileInterceptor('file', { limits: { fileSize: MAX_EXPORT_BYTES } });
const BODY: ApiBodyOptions = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' }, options: { type: 'string', description: 'JSON text of the options' } },
  },
};

type Upload = { originalname: string; buffer: Buffer } | undefined;

@Controller('project-import')
@UseGuards(JwtAuthGuard)
@ApiConsumes('multipart/form-data')
export class ProjectImportController {
  constructor(private service: ProjectImportService) {}

  /** The columns, statuses and counts importing the file would give. Writes nothing. */
  @Post('preview')
  @ApiBody(BODY)
  @UseInterceptors(UPLOAD)
  preview(@UploadedFile() file: Upload, @Body('options') options: string | undefined, @Request() req: AuthRequest) {
    return this.service.preview(this.need(file), options, req.user);
  }

  @Post()
  @ApiBody(BODY)
  @UseInterceptors(UPLOAD)
  import(@UploadedFile() file: Upload, @Body('options') options: string | undefined, @Request() req: AuthRequest) {
    return this.service.import(this.need(file), options, req.user);
  }

  private need(file: Upload) {
    if (!file) throw new BadRequestException('No file uploaded (expected form field "file")');
    return file;
  }
}
