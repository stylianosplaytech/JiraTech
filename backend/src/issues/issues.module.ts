import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';

@Module({
  imports: [CustomFieldsModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
