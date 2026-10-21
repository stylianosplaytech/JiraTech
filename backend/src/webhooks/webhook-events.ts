/** The events a webhook can subscribe to. */
export const WEBHOOK_EVENTS = [
  'issue.created',
  'issue.updated',
  'issue.assigned',
  'issue.transitioned',
  'issue.deleted',
  'comment.created',
  'comment.updated',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Sent by "Send test"; not something a webhook subscribes to. */
export const PING_EVENT = 'ping';

export const EVENT_LABELS: Record<WebhookEvent, string> = {
  'issue.created': 'An issue is created',
  'issue.updated': 'An issue is edited (any field)',
  'issue.assigned': 'An issue is assigned or reassigned',
  'issue.transitioned': 'An issue moves to another status',
  'issue.deleted': 'An issue is deleted',
  'comment.created': 'A comment is added',
  'comment.updated': 'A comment is edited',
};
