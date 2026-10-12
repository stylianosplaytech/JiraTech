import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { PortalController, ServiceDeskController } from './service-desk.controller';
import { ServiceDeskService } from './service-desk.service';
import { PortalsService } from './portals.service';
import { EmailChannelService } from './email-channel.service';

@Module({
  imports: [IssuesModule],
  controllers: [ServiceDeskController, PortalController],
  providers: [ServiceDeskService, PortalsService, EmailChannelService],
})
export class ServiceDeskModule {}
