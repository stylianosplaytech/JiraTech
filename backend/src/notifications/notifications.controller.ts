import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards';
import { AuthRequest } from '../common/auth-user';
import { NotificationsService } from './notifications.service';

class PreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(
    @Request() req: AuthRequest,
    @Query('scope') scope?: 'all' | 'direct',
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.list(req.user.id, {
      scope,
      unreadOnly: unread === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('unread-count')
  unreadCount(@Request() req: AuthRequest) {
    return this.notifications.unreadCount(req.user.id);
  }

  @Get('preferences')
  preferences(@Request() req: AuthRequest) {
    return this.notifications.getPreferences(req.user.id);
  }

  @Patch('preferences')
  setPreferences(@Request() req: AuthRequest, @Body() dto: PreferencesDto) {
    return this.notifications.setPreferences(req.user.id, dto);
  }

  @Post('read-all')
  readAll(@Request() req: AuthRequest) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Post('issue/:issueId/read')
  readIssue(@Request() req: AuthRequest, @Param('issueId') issueId: string) {
    return this.notifications.markIssueRead(req.user.id, issueId);
  }

  @Post(':id/read')
  read(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.notifications.setRead(req.user.id, id, true);
  }

  @Post(':id/unread')
  unread(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.notifications.setRead(req.user.id, id, false);
  }
}
