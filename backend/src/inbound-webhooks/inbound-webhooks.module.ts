import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { HooksController, InboundWebhooksController } from './inbound-webhooks.controller';
import { InboundWebhooksService } from './inbound-webhooks.service';

@Module({
  imports: [IssuesModule],
  controllers: [InboundWebhooksController, HooksController],
  providers: [InboundWebhooksService],
})
export class InboundWebhooksModule {}
