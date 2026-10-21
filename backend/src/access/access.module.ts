import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { AccessGuard } from './access.guard';
import { AccessController } from './access.controller';

@Global()
@Module({
  controllers: [AccessController],
  providers: [AccessService, AccessGuard],
  exports: [AccessService, AccessGuard],
})
export class AccessModule {}
