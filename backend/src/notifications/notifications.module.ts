import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { MailerService } from './mailer.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, MailerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
