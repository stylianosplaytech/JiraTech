import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSchemeController, ProjectNotificationSchemeController } from './notification-scheme.controller';
import { NotificationSchemeService } from './notification-scheme.service';

@Module({
  controllers: [NotificationsController, NotificationSchemeController, ProjectNotificationSchemeController],
  providers: [NotificationsService, NotificationSchemeService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
