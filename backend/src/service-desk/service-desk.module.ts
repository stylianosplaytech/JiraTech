import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { PortalController, ServiceDeskController } from './service-desk.controller';
import { ServiceDeskService } from './service-desk.service';

@Module({
  imports: [IssuesModule],
  controllers: [ServiceDeskController, PortalController],
  providers: [ServiceDeskService],
})
export class ServiceDeskModule {}
