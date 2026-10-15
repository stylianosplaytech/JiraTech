import { Module } from '@nestjs/common';
import { ProjectImportController } from './project-import.controller';
import { ProjectImportService } from './project-import.service';

@Module({
  controllers: [ProjectImportController],
  providers: [ProjectImportService],
})
export class ProjectImportModule {}
