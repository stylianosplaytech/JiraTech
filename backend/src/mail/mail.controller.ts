import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { MailerService } from './mailer.service';
import { MailSettingsDto, TestMailDto } from './mail-settings.dto';

/** /mail-settings — outgoing email for the whole application (global admins). */
@Controller('mail-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class MailController {
  constructor(private mailer: MailerService) {}

  @Get()
  get() {
    return this.mailer.getSettings();
  }

  @Put()
  save(@Body() dto: MailSettingsDto) {
    return this.mailer.saveSettings(dto);
  }

  @Post('test')
  test(@Body() dto: TestMailDto) {
    return this.mailer.sendTest(dto.to);
  }
}
