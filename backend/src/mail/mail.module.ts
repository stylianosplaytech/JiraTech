import { Global, Module } from '@nestjs/common';
import { RolesGuard } from '../auth/guards';
import { MailController } from './mail.controller';
import { MailerService } from './mailer.service';

/** Outgoing email, shared by notifications, invitations and every project. */
@Global()
@Module({
  controllers: [MailController],
  providers: [MailerService, RolesGuard],
  exports: [MailerService],
})
export class MailModule {}
