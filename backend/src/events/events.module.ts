import { Global, Module } from '@nestjs/common';
import { IssueEventsService } from './issue-events.service';

@Global()
@Module({
  providers: [IssueEventsService],
  exports: [IssueEventsService],
})
export class EventsModule {}
