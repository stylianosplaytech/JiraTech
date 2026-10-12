import { Body, Controller, Get, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { MailerService } from './mailer.service';
import { GoogleStartDto, MailSettingsDto, TestMailDto } from './mail-settings.dto';

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

  /** "Connect Gmail account": where to send the admin to sign in with Google. */
  @Post('google/start')
  googleStart(@Body() dto: GoogleStartDto) {
    return this.mailer.googleStart(dto.origin);
  }

  @Post('google/disconnect')
  googleDisconnect() {
    return this.mailer.googleDisconnect();
  }
}

/**
 * Google sends the admin's browser back here after "Connect Gmail account", without the app's login token.
 * It's safe to leave open: it only completes a sign-in an admin started (the one-time `state` must match).
 */
@Controller('mail-settings/google')
export class GoogleCallbackController {
  constructor(private mailer: MailerService) {}

  @Get('callback')
  async callback(@Query() query: { code?: string; state?: string; error?: string }, @Res() res: Response) {
    res.redirect(await this.mailer.googleCallback({ code: query.code, state: query.state, error: query.error }));
  }
}
