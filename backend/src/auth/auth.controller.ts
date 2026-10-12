import { Controller, Post, Body, Get, Param, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, SetPasswordDto } from './dto/login.dto';
import { InvitationsService } from '../users/invitations.service';
import { AllowCustomers, JwtAuthGuard } from './guards';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService, private invitations: InvitationsService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** The welcome link's person, so the set-password page can greet them (no login needed). */
  @Get('password-links/:token')
  passwordLink(@Param('token') token: string) {
    return this.invitations.lookup(token);
  }

  /** Choose a password with a welcome link; logs the person in. */
  @Post('set-password')
  async setPassword(@Body() dto: SetPasswordDto) {
    return this.authService.session(await this.invitations.setPassword(dto.token, dto.password));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowCustomers()
  me(@Request() req: { user: unknown }) {
    return req.user;
  }
}
