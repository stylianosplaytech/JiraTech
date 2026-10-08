import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { BulkService } from './bulk.service';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CustomFieldsModule, NotificationsModule],
  controllers: [IssuesController],
  providers: [IssuesService, BulkService],
  exports: [IssuesService],
})
export class IssuesModule {}
