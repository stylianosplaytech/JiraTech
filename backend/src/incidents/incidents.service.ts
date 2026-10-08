import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { EscalationAction, IssueType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';

@Injectable()
export class IncidentsService {
  constructor(
    private prisma: PrismaService,
    private customFieldsService: CustomFieldsService,
  ) {}

  async escalate(issueId: string, userId: string, action: EscalationAction, toTeam?: string, note?: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: { components: { include: { component: true } } },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    if (issue.type !== IssueType.DEFECT && issue.type !== IssueType.TASK) {
      throw new BadRequestException('Only Defects and Tasks can be escalated');
    }

    const fromTeam = issue.components.find((c) => c.component.name.startsWith('@'))?.component.name;

    if (action === EscalationAction.ESCALATE && toTeam) {
      const team = await this.prisma.component.findFirst({ where: { name: toTeam } });
      if (!team) throw new BadRequestException(`Team component ${toTeam} not found`);
      await this.prisma.issueComponent.create({ data: { issueId, componentId: team.id } });
    }

    if (action === EscalationAction.DE_ESCALATE && toTeam) {
      const team = await this.prisma.component.findFirst({ where: { name: toTeam } });
      if (team) {
        await this.prisma.issueComponent.deleteMany({ where: { issueId, componentId: team.id } });
      }
    }

    if (action === EscalationAction.REFUSE && fromTeam) {
      const team = await this.prisma.component.findFirst({ where: { name: fromTeam } });
      if (team) {
        await this.prisma.issueComponent.deleteMany({ where: { issueId, componentId: team.id } });
      }
    }

    if (action === EscalationAction.REJECT) {
      await this.prisma.issue.update({
        where: { id: issueId },
        data: { status: 'CLOSED', resolution: 'REJECTED' },
      });
    }

    if (action === EscalationAction.REOPEN) {
      await this.prisma.issue.update({
        where: { id: issueId },
        data: { status: 'DOING', resolution: null },
      });
      await this.customFieldsService.incrementReopenCount(issueId);
    }

    const event = await this.prisma.escalationEvent.create({
      data: { issueId, userId, action, fromTeam, toTeam, note },
    });

    return { event, issue: await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: { components: { include: { component: true } }, escalations: true },
    }) };
  }

  async getEscalationHistory(issueId: string) {
    return this.prisma.escalationEvent.findMany({
      where: { issueId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
