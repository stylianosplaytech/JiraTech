import { Controller, Get, UseGuards } from '@nestjs/common';
import { VersionsService } from './versions.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('versions')
@UseGuards(JwtAuthGuard)
export class VersionsController {
  constructor(private versionsService: VersionsService) {}

  @Get()
  findAll() {
    return this.versionsService.findAll();
  }
}
