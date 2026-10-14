import { BadRequestException } from '@nestjs/common';
import { Priority } from '@prisma/client';

/** The events a rule can start from. */
export const TRIGGER_EVENTS = [
  'issue.created',
  'issue.updated',
  'issue.assigned',
  'issue.transitioned',
  'comment.created',
] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  'issue.created': 'An issue is created',
  'issue.updated': 'An issue is edited',
  'issue.assigned': 'An issue is assigned or reassigned',
  'issue.transitioned': 'An issue moves to another status',
  'comment.created': 'A comment is added',
};

/** Fields an "issue is edited" trigger can be limited to (the names issue changes carry). */
export const EDITABLE_FIELDS = [
  'summary', 'description', 'priority', 'estimate', 'remainingEstimate', 'blocked', 'epicName', 'assignee',
  'reporter', 'sprint', 'components', 'labels', 'fixVersions', 'affectsVersions', 'project',
] as const;

export interface TriggerConfig {
  /** issue.updated: only when one of these fields changed */
  fields?: string[];
  /** issue.transitioned: only when the issue moved to this status (name) */
  toStatus?: string;
}

export type Action =
  /** `to`: "unassigned", "reporter", "lead" (the project lead) or a user id */
  | { type: 'assign'; to: string }
  | { type: 'set_priority'; priority: Priority }
  /** `status`: a status name, or a category (TO_DO, DOING, CLOSED) */
  | { type: 'transition'; status: string; resolution?: string }
  | { type: 'comment'; body: string; internal?: boolean }
  | { type: 'add_label'; label: string }
  /** `to`: "assignee", "reporter", "lead", or email addresses */
  | { type: 'email'; to: string[]; subject: string; body: string };

export const ACTION_TYPES = ['assign', 'set_priority', 'transition', 'comment', 'add_label', 'email'] as const;
export const MAX_ACTIONS = 10;

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const ROLE_RECIPIENTS = ['assignee', 'reporter', 'lead'];

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Checks what an admin sent and keeps only the fields each action knows. */
export function parseActions(raw: unknown): Action[] {
  if (!Array.isArray(raw) || !raw.length) throw new BadRequestException('Add at least one action');
  if (raw.length > MAX_ACTIONS) throw new BadRequestException(`A rule can have up to ${MAX_ACTIONS} actions`);
  return raw.map((a, i): Action => {
    const n = i + 1;
    const input = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    switch (input.type) {
      case 'assign': {
        const to = text(input.to, 64);
        if (!to) throw new BadRequestException(`Action ${n}: choose who to assign to`);
        return { type: 'assign', to };
      }
      case 'set_priority':
        if (!Object.values(Priority).includes(input.priority as Priority)) throw new BadRequestException(`Action ${n}: choose a priority`);
        return { type: 'set_priority', priority: input.priority as Priority };
      case 'transition': {
        const status = text(input.status, 80);
        if (!status) throw new BadRequestException(`Action ${n}: choose a status`);
        const resolution = text(input.resolution, 40);
        return { type: 'transition', status, ...(resolution ? { resolution } : {}) };
      }
      case 'comment': {
        const body = text(input.body, 5000);
        if (!body) throw new BadRequestException(`Action ${n}: write the comment`);
        return { type: 'comment', body, internal: input.internal === true };
      }
      case 'add_label': {
        const label = text(input.label, 60);
        if (!label || /\s/.test(label)) throw new BadRequestException(`Action ${n}: a label is one word, without spaces`);
        return { type: 'add_label', label };
      }
      case 'email': {
        const to = (Array.isArray(input.to) ? input.to : []).map((x) => text(x, 200)).filter(Boolean);
        if (!to.length) throw new BadRequestException(`Action ${n}: choose who to email`);
        const bad = to.find((x) => !ROLE_RECIPIENTS.includes(x) && !EMAIL.test(x));
        if (bad) throw new BadRequestException(`Action ${n}: "${bad}" is not an email address`);
        const subject = text(input.subject, 200);
        const body = text(input.body, 5000);
        if (!subject || !body) throw new BadRequestException(`Action ${n}: the email needs a subject and a message`);
        return { type: 'email', to: [...new Set(to)], subject, body };
      }
      default:
        throw new BadRequestException(`Action ${n}: unknown action`);
    }
  });
}

export function parseTrigger(event: string, raw: unknown): { event: TriggerEvent; config: TriggerConfig } {
  if (!(TRIGGER_EVENTS as readonly string[]).includes(event)) throw new BadRequestException('Choose what starts the rule');
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const config: TriggerConfig = {};
  if (event === 'issue.updated' && Array.isArray(input.fields) && input.fields.length) {
    config.fields = EDITABLE_FIELDS.filter((f) => (input.fields as unknown[]).includes(f));
    if (!config.fields.length) throw new BadRequestException('Unknown field in the trigger');
  }
  if (event === 'issue.transitioned' && text(input.toStatus, 80)) config.toStatus = text(input.toStatus, 80);
  return { event: event as TriggerEvent, config };
}

/** {{issue.key}}-style placeholders; unknown ones are left as typed. */
export function fill(template: string, values: Record<string, string>, escape: (s: string) => string = (s) => s) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => (key in values ? escape(values[key]) : whole));
}

export const PLACEHOLDER_KEYS = [
  'issue.key', 'issue.summary', 'issue.status', 'issue.priority', 'issue.assignee', 'issue.reporter', 'issue.url',
  'project.key', 'project.name', 'actor.name',
] as const;

export function describe(action: Action, resolveUser: (id: string) => string): string {
  switch (action.type) {
    case 'assign':
      return `Assign to ${action.to === 'unassigned' ? 'nobody' : action.to === 'reporter' ? 'the reporter' : action.to === 'lead' ? 'the project lead' : resolveUser(action.to)}`;
    case 'set_priority': return `Set the priority to ${action.priority}`;
    case 'transition': return `Move to ${action.status}`;
    case 'comment': return `Add ${action.internal ? 'an internal note' : 'a comment'}`;
    case 'add_label': return `Add the label ${action.label}`;
    case 'email': return `Email ${action.to.join(', ')}`;
  }
}
