import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { RecipientGroupsModule } from '../recipient-groups/recipient-groups.module';
import { EmailTemplatesController, IssueEmailController } from './issue-email.controller';
import { IssueEmailService } from './issue-email.service';
import { EmailTemplatesService } from './email-templates.service';

/** Emails received and sent on service desk requests, and the templates agents write them from. */
@Module({
  imports: [IssuesModule, RecipientGroupsModule],
  controllers: [IssueEmailController, EmailTemplatesController],
  providers: [IssueEmailService, EmailTemplatesService],
  exports: [IssueEmailService],
})
export class IssueEmailModule {}
