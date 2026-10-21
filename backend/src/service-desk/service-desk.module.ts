import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { IssueEmailModule } from '../issue-email/issue-email.module';
import { CustomerPortalsController, PortalController, ServiceDeskController } from './service-desk.controller';
import { ServiceDeskService } from './service-desk.service';
import { PortalsService } from './portals.service';
import { EmailChannelService } from './email-channel.service';

@Module({
  imports: [IssuesModule, IssueEmailModule],
  controllers: [ServiceDeskController, PortalController, CustomerPortalsController],
  providers: [ServiceDeskService, PortalsService, EmailChannelService],
})
export class ServiceDeskModule {}
