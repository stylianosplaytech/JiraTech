import { Module } from '@nestjs/common';
import { RecipientGroupsModule } from '../recipient-groups/recipient-groups.module';
import { NoticeTemplatesController, ServiceNoticesController } from './service-notices.controller';
import { ServiceNoticesService } from './service-notices.service';

/** Maintenance reminders, incident notifications and other notices emailed from templates. */
@Module({
  imports: [RecipientGroupsModule],
  controllers: [NoticeTemplatesController, ServiceNoticesController],
  providers: [ServiceNoticesService],
})
export class ServiceNoticesModule {}
