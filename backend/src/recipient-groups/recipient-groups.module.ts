import { Module } from '@nestjs/common';
import { RecipientGroupsController } from './recipient-groups.controller';
import { RecipientGroupsService } from './recipient-groups.service';

/** Named lists of email recipients (people, organizations, addresses), used when writing emails on requests. */
@Module({
  controllers: [RecipientGroupsController],
  providers: [RecipientGroupsService],
  exports: [RecipientGroupsService],
})
export class RecipientGroupsModule {}
