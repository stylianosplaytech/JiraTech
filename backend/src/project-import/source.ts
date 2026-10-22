import { IssueStatus, IssueType, LinkType, Priority } from '@prisma/client';

/** A person named in an export. Exports differ in what they carry: a username, a display name, an email. */
export type Person = { name?: string; username?: string; email?: string };

export type SourceVersion = { name: string; released?: boolean; releaseDate?: Date | null };

/** One issue, read from a Jira export of either format. Everything the app can use is here; the user picks what to import. */
export type SourceIssue = {
  key: string;
  number: number;
  /** Jira's internal id, used by the CSV "Parent id" column */
  sourceId: string;
  parent: { key?: string; sourceId?: string } | null;
  /** The issue's epic (Epic Link), used as its parent when it has none */
  epicKey: string | null;
  typeName: string;
  summary: string;
  description: string | null;
  statusName: string;
  priorityName: string | null;
  created: Date | null;
  updated: Date | null;
  reporter: Person | null;
  assignee: Person | null;
  labels: string[];
  components: string[];
  fixVersions: SourceVersion[];
  affectsVersions: SourceVersion[];
  /** yyyy-mm-dd */
  dueDate: string | null;
  estimateHours: number | null;
  remainingHours: number | null;
  links: { type: string; outward: boolean; key: string }[];
  comments: { author: Person | null; body: string; created: Date | null }[];
  worklogs: { author: Person | null; seconds: number; comment: string | null; started: Date | null }[];
  /** Columns the app has no field for, by column id → text */
  custom: Record<string, string>;
};

export type ColumnGroup = 'Core' | 'People' | 'Planning' | 'Content' | 'Relationships' | 'Other fields';

export type SourceColumn = {
  id: string;
  label: string;
  group: ColumnGroup;
  /** Issues with a value in this column */
  count: number;
  sample: string | null;
  required?: boolean;
  /** Where the value goes in this app */
  target: string;
};

export type SourceStatus = { name: string; count: number; category: IssueStatus };

export type ParsedSource = {
  format: 'csv' | 'json';
  prefix: string;
  issues: SourceIssue[];
  columns: SourceColumn[];
  statuses: SourceStatus[];
  warnings: string[];
};

// ─── Mappings ────────────────────────────────────────────────────────────────

/** Jira issue type → this app's issue type. "Epic Story"/"Epic Bug" are children of epics at Playtech. */
const TYPE_MAP: Record<string, IssueType> = {
  epic: IssueType.EPIC,
  story: IssueType.STORY,
  'epic story': IssueType.STORY,
  bug: IssueType.DEFECT,
  'epic bug': IssueType.DEFECT,
  defect: IssueType.DEFECT,
  task: IssueType.TASK,
  'sub-task': IssueType.SUB_TASK,
  subtask: IssueType.SUB_TASK,
};

export function mapType(name: string): IssueType | null {
  return TYPE_MAP[name.trim().toLowerCase()] ?? null;
}

const PRIORITY_MAP: Record<string, Priority> = {
  highest: Priority.HIGHEST, blocker: Priority.HIGHEST, critical: Priority.HIGHEST,
  high: Priority.HIGH, major: Priority.HIGH,
  medium: Priority.MEDIUM,
  low: Priority.LOW, minor: Priority.LOW,
  lowest: Priority.LOWEST, trivial: Priority.LOWEST,
};

export function mapPriority(raw: string | null): Priority {
  const p = (raw ?? '').trim().toLowerCase();
  // Variants such as "High (Urgent Job)": use the leading word.
  return PRIORITY_MAP[p] ?? PRIORITY_MAP[p.split(/[\s(]/)[0]] ?? Priority.MEDIUM;
}

/** Suggested category for a status, from its name. The user can change it. */
export function suggestCategory(name: string): IssueStatus {
  const n = name.trim().toLowerCase();
  if (/^(closed|done|resolved|complete[d]?|cancel+ed|rejected)$/.test(n)) return IssueStatus.CLOSED;
  if (/backlog/.test(n)) return IssueStatus.BACKLOG;
  if (/doing|progress|review|testing|\bqa\b|prep|reopened/.test(n)) return IssueStatus.DOING;
  return IssueStatus.TO_DO;
}

export function linkKind(linkName: string): LinkType {
  switch (linkName.trim().toLowerCase()) {
    case 'blocks': return LinkType.BLOCKS;
    case 'depends': case 'depends on': return LinkType.DEPENDS_ON;
    case 'parent': return LinkType.PARENT_LINK;
    default: return LinkType.RELATES_TO;
  }
}

const CATEGORY_ORDER: IssueStatus[] = [IssueStatus.BACKLOG, IssueStatus.TO_DO, IssueStatus.DOING, IssueStatus.CLOSED];

/** Distinct statuses with their issue counts, ordered like a workflow. `categoryOf` may know better than the name. */
export function collectStatuses(issues: SourceIssue[], categoryOf: (name: string) => IssueStatus | null): SourceStatus[] {
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i.statusName, (counts.get(i.statusName) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, category: categoryOf(name) ?? suggestCategory(name) }))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || b.count - a.count);
}

// ─── Columns ─────────────────────────────────────────────────────────────────

const short = (v: string) => (v.length > 80 ? `${v.slice(0, 80)}…` : v);
const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(', ');
/** The calendar day of a date given as yyyy-mm-dd (anything after it is ignored), or null if it isn't a real day. */
export function dayOf(raw: unknown): string | null {
  const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim()) : null;
  return m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCMonth() === +m[2] - 1 ? m.slice(1).join('-') : null;
}

export const personLabel = (p: Person | null) => (p ? p.name ?? p.username ?? p.email ?? '' : '');

type CoreDef = {
  id: string;
  label: string;
  group: ColumnGroup;
  target: string;
  required?: boolean;
  /** Text for the sample cell when the issue has a value, else null */
  value: (i: SourceIssue) => string | null;
};

const CORE: CoreDef[] = [
  { id: 'key', label: 'Issue key', group: 'Core', target: 'Issue key (numbers are kept)', required: true, value: (i) => i.key },
  { id: 'summary', label: 'Summary', group: 'Core', target: 'Summary', required: true, value: (i) => i.summary },
  { id: 'type', label: 'Issue type', group: 'Core', target: 'Issue type', value: (i) => i.typeName || null },
  { id: 'status', label: 'Status', group: 'Core', target: 'Workflow status', value: (i) => i.statusName || null },
  { id: 'priority', label: 'Priority', group: 'Core', target: 'Priority', value: (i) => i.priorityName },
  { id: 'created', label: 'Created', group: 'Core', target: 'Created date', value: (i) => i.created?.toISOString() ?? null },
  { id: 'updated', label: 'Updated', group: 'Core', target: 'Last updated', value: (i) => i.updated?.toISOString() ?? null },
  { id: 'parent', label: 'Parent / Epic link', group: 'Core', target: 'Parent issue', value: (i) => i.parent?.key ?? i.parent?.sourceId ?? i.epicKey },
  { id: 'description', label: 'Description', group: 'Content', target: 'Description', value: (i) => i.description },
  { id: 'comments', label: 'Comments', group: 'Content', target: 'Comments', value: (i) => (i.comments.length ? `${i.comments.length} comment(s)` : null) },
  { id: 'worklogs', label: 'Work logs', group: 'Content', target: 'Work log entries', value: (i) => (i.worklogs.length ? `${i.worklogs.length} entr${i.worklogs.length === 1 ? 'y' : 'ies'}` : null) },
  { id: 'reporter', label: 'Reporter', group: 'People', target: 'Reporter (matched to an existing user)', value: (i) => personLabel(i.reporter) || null },
  { id: 'assignee', label: 'Assignee', group: 'People', target: 'Assignee (matched to an existing user)', value: (i) => personLabel(i.assignee) || null },
  { id: 'labels', label: 'Labels', group: 'Planning', target: 'Labels', value: (i) => (i.labels.length ? i.labels.join(', ') : null) },
  { id: 'components', label: 'Components', group: 'Planning', target: 'Components', value: (i) => (i.components.length ? i.components.join(', ') : null) },
  { id: 'fixVersions', label: 'Fix versions', group: 'Planning', target: 'Fix versions', value: (i) => (i.fixVersions.length ? names(i.fixVersions) : null) },
  { id: 'affectsVersions', label: 'Affects versions', group: 'Planning', target: 'Affects versions', value: (i) => (i.affectsVersions.length ? names(i.affectsVersions) : null) },
  { id: 'dueDate', label: 'Due date', group: 'Planning', target: 'Due date', value: (i) => i.dueDate },
  { id: 'estimate', label: 'Original estimate', group: 'Planning', target: 'Estimate (hours)', value: (i) => (i.estimateHours != null ? `${i.estimateHours}h` : null) },
  { id: 'remaining', label: 'Remaining estimate', group: 'Planning', target: 'Remaining estimate (hours)', value: (i) => (i.remainingHours != null ? `${i.remainingHours}h` : null) },
  { id: 'links', label: 'Issue links', group: 'Relationships', target: 'Links between imported issues', value: (i) => (i.links.length ? `${i.links.length} link(s)` : null) },
];

export const CORE_IDS = CORE.map((c) => c.id);
export const CUSTOM_PREFIX = 'cf:';

/** The list of columns for the import screen: the app's own fields, then every other column as a custom field. */
export function buildColumns(issues: SourceIssue[], customLabels: Map<string, string>): SourceColumn[] {
  const columns: SourceColumn[] = CORE.map((def) => {
    let count = 0;
    let sample: string | null = null;
    for (const i of issues) {
      const v = def.value(i);
      if (v) { count++; sample ??= short(v); }
    }
    return { id: def.id, label: def.label, group: def.group, target: def.target, required: def.required, count, sample };
  });
  for (const [id, label] of customLabels) {
    let count = 0;
    let sample: string | null = null;
    for (const i of issues) {
      const v = i.custom[id];
      if (v) { count++; sample ??= short(v.replace(/\s+/g, ' ')); }
    }
    columns.push({ id: CUSTOM_PREFIX + id, label, group: 'Other fields', target: 'Custom field (text)', count, sample });
  }
  return columns;
}

/** Text for a custom field value that may be a string, number, option, user, version or a list of those. */
export function customText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(customText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['value', 'displayName', 'name', 'key']) {
      if (typeof o[k] === 'string' && o[k]) return o[k] as string;
    }
    // Nested option ("parent / child")
    if (o.child && typeof o.child === 'object') return customText(o.child);
  }
  return '';
}

export const keyRe = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

/** Keep only issues of the most common project prefix, and turn them into numbered issues. Reports what was left out. */
export function dominantPrefix(keys: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const k of keys) {
    const m = keyRe.exec(k.trim());
    if (m) counts.set(m[1].toUpperCase(), (counts.get(m[1].toUpperCase()) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Warnings shared by both readers, after the issues are read. */
export function checkIssues(issues: SourceIssue[], prefix: string, left: { otherProjects: number; duplicateKeys: number; noSummary: number }, unknownTypes: Set<string>, badDates: number) {
  const warnings: string[] = [];
  if (left.otherProjects) warnings.push(`${left.otherProjects} row(s) belong to other projects than ${prefix} and are left out.`);
  if (left.duplicateKeys) warnings.push(`${left.duplicateKeys} duplicate issue key(s) were ignored.`);
  if (left.noSummary) warnings.push(`${left.noSummary} row(s) without a summary were left out.`);
  if (unknownTypes.size) warnings.push(`Issue type(s) ${[...unknownTypes].map((t) => `"${t}"`).join(', ')} aren't known and are imported as Task.`);
  if (badDates) warnings.push(`${badDates} issue(s) have a created date that couldn't be read and get today's date.`);
  if (!issues.length) warnings.push('No issues could be read from the file.');
  return warnings;
}
