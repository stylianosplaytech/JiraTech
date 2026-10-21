import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/guards';
import { InvitationsService } from './invitations.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, InvitationsService, RolesGuard],
  exports: [UsersService, InvitationsService],
})
export class UsersModule {}
