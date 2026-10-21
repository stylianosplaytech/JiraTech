import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { SearchModule } from '../search/search.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  imports: [IssuesModule, SearchModule, WebhooksModule],
  controllers: [AutomationController],
  providers: [AutomationService],
})
export class AutomationModule {}
