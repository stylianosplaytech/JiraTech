import { BadRequestException } from '@nestjs/common';
import { IssueType, Priority } from '@prisma/client';

/** How a received payload becomes an issue. Templates use {{path.to.value}} on the JSON that was received. */
export interface InboundConfig {
  issueType: IssueType;
  /** Used when `priorityFrom` is empty or gives something unrecognised */
  priority: Priority;
  /** A template whose result (critical, warning, P1…) picks the priority */
  priorityFrom: string;
  summary: string;
  description: string;
  /** One-word labels added to every issue */
  labels: string[];
  assigneeId: string | null;
  /**
   * A template identifying the alert (e.g. {{alerts.0.fingerprint}}). While an issue for the same key is open, repeats
   * add a comment to it instead of raising another issue.
   */
  dedupe: string;
  /** When this value is found at this path, the open issue for the dedupe key is closed (needs a dedupe key) */
  resolveWhen: { path: string; equals: string } | null;
  /** Add the received JSON to the issue description */
  includePayload: boolean;
}

export const DEFAULT_CONFIG: InboundConfig = {
  issueType: IssueType.TASK,
  priority: Priority.MEDIUM,
  priorityFrom: '',
  summary: '{{title}}',
  description: '{{message}}',
  labels: [],
  assigneeId: null,
  dedupe: '',
  resolveWhen: null,
  includePayload: true,
};

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Checks what an admin sent and keeps only the fields the config knows. */
export function parseConfig(input: Record<string, unknown>): InboundConfig {
  const issueType = (input.issueType ?? DEFAULT_CONFIG.issueType) as IssueType;
  if (!Object.values(IssueType).includes(issueType)) throw new BadRequestException('Unknown issue type');
  const priority = (input.priority ?? DEFAULT_CONFIG.priority) as Priority;
  if (!Object.values(Priority).includes(priority)) throw new BadRequestException('Unknown priority');
  const labels = (Array.isArray(input.labels) ? input.labels : []).map((l) => text(l, 60)).filter(Boolean);
  if (labels.some((l) => /\s/.test(l))) throw new BadRequestException('A label is one word, without spaces');
  const dedupe = text(input.dedupe, 300);
  const resolvePath = text(input.resolvePath, 200);
  if (resolvePath && !dedupe) throw new BadRequestException('Closing issues needs an alert key (the "same alert" setting) to know which issue to close');
  return {
    issueType,
    priority,
    priorityFrom: text(input.priorityFrom, 300),
    summary: text(input.summary, 500) || DEFAULT_CONFIG.summary,
    description: text(input.description, 5000),
    labels: [...new Set(labels)],
    assigneeId: text(input.assigneeId, 64) || null,
    dedupe,
    resolveWhen: resolvePath ? { path: resolvePath, equals: text(input.resolveEquals, 200) } : null,
    includePayload: input.includePayload !== false,
  };
}

/** The value at a path like alerts.0.labels.name; undefined when there is none. */
export function lookup(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split('.').map((p) => p.trim()).filter(Boolean)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** How a value reads inside a template: text as is, numbers and booleans plainly, objects as JSON, nothing as "". */
export function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Replaces {{path}} with that part of the payload (nothing when it isn't there). */
export function render(template: string, payload: unknown): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, path: string) => asText(lookup(payload, path)));
}

const PRIORITY_WORDS: Record<string, Priority> = {
  highest: Priority.HIGHEST, critical: Priority.HIGHEST, crit: Priority.HIGHEST, fatal: Priority.HIGHEST, urgent: Priority.HIGHEST, blocker: Priority.HIGHEST, p0: Priority.HIGHEST, p1: Priority.HIGHEST, sev1: Priority.HIGHEST, '1': Priority.HIGHEST,
  high: Priority.HIGH, error: Priority.HIGH, major: Priority.HIGH, p2: Priority.HIGH, sev2: Priority.HIGH, '2': Priority.HIGH,
  medium: Priority.MEDIUM, warning: Priority.MEDIUM, warn: Priority.MEDIUM, normal: Priority.MEDIUM, p3: Priority.MEDIUM, sev3: Priority.MEDIUM, '3': Priority.MEDIUM,
  low: Priority.LOW, minor: Priority.LOW, info: Priority.LOW, p4: Priority.LOW, sev4: Priority.LOW, '4': Priority.LOW,
  lowest: Priority.LOWEST, trivial: Priority.LOWEST, debug: Priority.LOWEST, p5: Priority.LOWEST, sev5: Priority.LOWEST, '5': Priority.LOWEST,
};

/** critical, P1, warning… to a priority; null when the word isn't recognised. */
export function priorityFromWord(word: string): Priority | null {
  return PRIORITY_WORDS[word.trim().toLowerCase()] ?? null;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text as rich-text HTML: paragraphs and line breaks. */
export function textToHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
