import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, LoginOnlyGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { EDITABLE_FIELDS, PLACEHOLDER_KEYS, TRIGGER_EVENTS, TRIGGER_LABELS } from './automation-actions';
import { AutomationService } from './automation.service';
import { RuleDto, TestDto } from './automation.dto';

type Req = { user: AuthUser };

/**
 * /automation — rules that react to issue events. Global administrators manage all of them; project administrators the ones of
 * their own projects (they can't make one for every project, or email addresses without a JiraTech account). Rules run with
 * the access of the person who last saved them. Needs a login: API tokens cannot manage rules.
 */
@Controller('automation')
@UseGuards(JwtAuthGuard, LoginOnlyGuard)
export class AutomationController {
  constructor(private automation: AutomationService) {}

  /** The rules the signed-in user may manage */
  @Get('rules')
  list(@Request() req: Req) {
    return this.automation.list(req.user);
  }

  /** What the rule editor offers: triggers, editable fields and placeholders */
  @Get('meta')
  meta() {
    return {
      triggers: TRIGGER_EVENTS.map((name) => ({ name, label: TRIGGER_LABELS[name] })),
      fields: EDITABLE_FIELDS,
      placeholders: PLACEHOLDER_KEYS,
    };
  }

  @Post('rules')
  create(@Request() req: Req, @Body() dto: RuleDto) {
    return this.automation.create(dto, req.user);
  }

  @Put('rules/:id')
  update(@Request() req: Req, @Param('id') id: string, @Body() dto: RuleDto) {
    return this.automation.update(id, dto, req.user);
  }

  @Delete('rules/:id')
  remove(@Request() req: Req, @Param('id') id: string) {
    return this.automation.remove(id, req.user);
  }

  /** Dry run: what the rule would do to an issue */
  @Post('rules/:id/test')
  test(@Request() req: Req, @Param('id') id: string, @Body() dto: TestDto) {
    return this.automation.test(id, req.user, dto.issueKey);
  }

  @Get('rules/:id/runs')
  runs(@Request() req: Req, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.automation.runs(id, req.user, limit ? Number(limit) || 50 : 50);
  }
}
