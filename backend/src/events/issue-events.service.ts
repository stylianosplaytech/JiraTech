import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type IssueEventName =
  | 'issue.created' | 'issue.updated' | 'issue.assigned' | 'issue.transitioned' | 'issue.deleted'
  | 'comment.created' | 'comment.updated';

export interface IssueChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** Something that happened to an issue, after it was committed. */
export interface IssueEvent {
  event: IssueEventName;
  issueId: string;
  actorId: string | null;
  changes?: IssueChange[];
  commentId?: string;
}

/**
 * A small in-process bus for what happens to issues, so webhooks and automation rules can react without the services
 * that change issues knowing about either. Listeners run in the emitter's async context, and must not throw.
 */
@Injectable()
export class IssueEventsService {
  private readonly emitter = new EventEmitter();

  emit(event: IssueEvent) {
    this.emitter.emit('issue', event);
  }

  subscribe(listener: (event: IssueEvent) => void) {
    this.emitter.on('issue', listener);
  }
}
