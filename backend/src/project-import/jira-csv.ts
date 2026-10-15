import { IssueStatus, IssueType, LinkType, Priority } from '@prisma/client';

/** Parse RFC 4180 CSV (quoted fields, doubled quotes, embedded newlines) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

export type ImportedIssue = {
  key: string;
  number: number;
  /** Jira's internal id, only used to resolve the "Parent id" column */
  sourceId: string;
  parentSourceId: string | null;
  type: IssueType;
  summary: string;
  priority: Priority;
  statusName: string;
  createdAt: Date;
};

export type ImportedLink = { type: LinkType; sourceKey: string; targetKey: string };

export type JiraExport = {
  prefix: string;
  issues: ImportedIssue[];
  links: ImportedLink[];
  /** Distinct source statuses with the number of issues in each, in a sensible workflow order */
  statuses: { name: string; count: number; category: IssueStatus }[];
  byType: Record<string, number>;
  skipped: { otherProjects: number; duplicateKeys: number; noSummary: number };
  parents: { linked: number; outsideExport: number };
  linkStats: { kept: number; outsideExport: number; byType: Record<string, number> };
  warnings: string[];
};

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

const PRIORITY_MAP: Record<string, Priority> = {
  highest: Priority.HIGHEST, blocker: Priority.HIGHEST, critical: Priority.HIGHEST,
  high: Priority.HIGH, major: Priority.HIGH,
  medium: Priority.MEDIUM,
  low: Priority.LOW, minor: Priority.LOW,
  lowest: Priority.LOWEST, trivial: Priority.LOWEST,
};

function mapPriority(raw: string): Priority {
  const p = raw.trim().toLowerCase();
  // Variants such as "High (Urgent Job)": use the leading word.
  return PRIORITY_MAP[p] ?? PRIORITY_MAP[p.split(/[\s(]/)[0]] ?? Priority.MEDIUM;
}

/** Suggested category for a Jira status the importer knows nothing about. The user can change it. */
export function suggestCategory(name: string): IssueStatus {
  const n = name.trim().toLowerCase();
  if (/^(closed|done|resolved|complete[d]?|cancel+ed|rejected)$/.test(n)) return IssueStatus.CLOSED;
  if (/backlog/.test(n)) return IssueStatus.BACKLOG;
  if (/doing|progress|review|testing|\bqa\b|prep|reopened/.test(n)) return IssueStatus.DOING;
  return IssueStatus.TO_DO;
}

const CATEGORY_ORDER: IssueStatus[] = [IssueStatus.BACKLOG, IssueStatus.TO_DO, IssueStatus.DOING, IssueStatus.CLOSED];

function linkKind(linkName: string): LinkType {
  switch (linkName.trim().toLowerCase()) {
    case 'blocks': return LinkType.BLOCKS;
    case 'depends': case 'depends on': return LinkType.DEPENDS_ON;
    case 'parent': return LinkType.PARENT_LINK;
    default: return LinkType.RELATES_TO;
  }
}

/** "05.05.2026 20:23" (day.month.year, as Jira exports in a European locale), read in the given UTC offset. */
export function parseCreated(raw: string, utcOffsetMinutes: number): Date | null {
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(raw.trim());
  if (!m) return null;
  const [, d, mo, y, h = '0', mi = '0'] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi) - utcOffsetMinutes * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Read a Jira "Export CSV (all fields)" file. Only the columns this app has a place for are used:
 * key, id, parent id, type, summary, priority, status, created and the issue links. People, descriptions and
 * comments aren't in a default export (and people are skipped by design).
 */
export function readJiraExport(text: string, utcOffsetMinutes = 0): JiraExport {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file has no issues in it');
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const required = ['Issue key', 'Summary', 'Issue Type', 'Status'];
  const missing = required.filter((c) => col(c) < 0);
  if (missing.length) throw new Error(`This doesn't look like a Jira export: missing column ${missing.join(', ')}`);

  const iKey = col('Issue key'), iId = col('Issue id'), iParent = col('Parent id'), iSummary = col('Summary');
  const iType = col('Issue Type'), iPriority = col('Priority'), iStatus = col('Status'), iCreated = col('Created');
  // Jira repeats a link column once per link of that type, so collect every column with the same title.
  const linkCols = header
    .map((h, i) => ({ i, m: /^(Inward|Outward) issue link \((.+)\)$/.exec(h) }))
    .filter((c): c is { i: number; m: RegExpExecArray } => !!c.m)
    .map((c) => ({ i: c.i, outward: c.m[1] === 'Outward', type: linkKind(c.m[2]), name: c.m[2] }));

  const warnings: string[] = [];
  const keyRe = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;
  const prefixCounts = new Map<string, number>();
  for (const r of rows.slice(1)) {
    const m = keyRe.exec((r[iKey] ?? '').trim());
    if (m) prefixCounts.set(m[1].toUpperCase(), (prefixCounts.get(m[1].toUpperCase()) ?? 0) + 1);
  }
  const prefix = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!prefix) throw new Error('No issue keys such as ABC-123 were found in the "Issue key" column');

  const skipped = { otherProjects: 0, duplicateKeys: 0, noSummary: 0 };
  const issues: ImportedIssue[] = [];
  const seen = new Set<string>();
  const unknownTypes = new Set<string>();
  let badDates = 0;
  const rowOf = new Map<string, string[]>();

  for (const r of rows.slice(1)) {
    const key = (r[iKey] ?? '').trim().toUpperCase();
    const m = keyRe.exec(key);
    if (!m || m[1] !== prefix) { skipped.otherProjects++; continue; }
    if (seen.has(key)) { skipped.duplicateKeys++; continue; }
    const summary = (r[iSummary] ?? '').trim();
    if (!summary) { skipped.noSummary++; continue; }
    seen.add(key);
    const rawType = (r[iType] ?? '').trim();
    let type = TYPE_MAP[rawType.toLowerCase()];
    if (!type) { unknownTypes.add(rawType); type = IssueType.TASK; }
    const created = iCreated >= 0 ? parseCreated(r[iCreated] ?? '', utcOffsetMinutes) : null;
    if (!created) badDates++;
    issues.push({
      key,
      number: +m[2],
      sourceId: iId >= 0 ? (r[iId] ?? '').trim() : '',
      parentSourceId: iParent >= 0 ? ((r[iParent] ?? '').trim() || null) : null,
      type,
      summary: summary.slice(0, 500),
      priority: mapPriority(iPriority >= 0 ? (r[iPriority] ?? '') : ''),
      statusName: (r[iStatus] ?? '').trim() || 'Backlog',
      createdAt: created ?? new Date(),
    });
    rowOf.set(key, r);
  }
  if (skipped.otherProjects) warnings.push(`${skipped.otherProjects} row(s) belong to other projects than ${prefix} and are left out.`);
  if (skipped.duplicateKeys) warnings.push(`${skipped.duplicateKeys} duplicate issue key(s) were ignored.`);
  if (skipped.noSummary) warnings.push(`${skipped.noSummary} row(s) without a summary were left out.`);
  if (unknownTypes.size) warnings.push(`Issue type(s) ${[...unknownTypes].map((t) => `"${t}"`).join(', ')} aren't known and are imported as Task.`);
  if (badDates) warnings.push(`${badDates} issue(s) have a created date that couldn't be read and get today's date.`);

  // Parents: "Parent id" is Jira's internal id, resolved to the parent's key.
  const keyBySourceId = new Map(issues.filter((i) => i.sourceId).map((i) => [i.sourceId, i.key]));
  const parents = { linked: 0, outsideExport: 0 };
  for (const i of issues) {
    if (!i.parentSourceId) continue;
    if (keyBySourceId.has(i.parentSourceId)) parents.linked++;
    else { parents.outsideExport++; i.parentSourceId = null; }
  }

  // Links: each link is listed on both issues, so collect them in one canonical direction and drop repeats.
  const links: ImportedLink[] = [];
  const have = new Set<string>();
  const linkTally = { kept: 0, outsideExport: 0, byType: {} as Record<string, number> };
  for (const i of issues) {
    const r = rowOf.get(i.key)!;
    for (const lc of linkCols) {
      const other = (r[lc.i] ?? '').trim().toUpperCase();
      if (!other) continue;
      if (!seen.has(other)) { linkTally.outsideExport++; continue; }
      if (other === i.key) continue;
      // Outward column: this issue is the source ("blocks X"); inward column: the other issue is.
      const [sourceKey, targetKey] = lc.outward ? [i.key, other] : [other, i.key];
      // "Relates" reads the same both ways, so A→B and B→A are one link.
      const id = lc.type === LinkType.RELATES_TO && sourceKey > targetKey
        ? `${lc.type}|${targetKey}|${sourceKey}`
        : `${lc.type}|${sourceKey}|${targetKey}`;
      if (have.has(id)) continue;
      have.add(id);
      links.push({ type: lc.type, sourceKey, targetKey });
      linkTally.kept++;
      linkTally.byType[lc.type] = (linkTally.byType[lc.type] ?? 0) + 1;
    }
  }

  const statusCount = new Map<string, number>();
  for (const i of issues) statusCount.set(i.statusName, (statusCount.get(i.statusName) ?? 0) + 1);
  const statuses = [...statusCount.entries()]
    .map(([name, count]) => ({ name, count, category: suggestCategory(name) }))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || b.count - a.count);

  const byType: Record<string, number> = {};
  for (const i of issues) byType[i.type] = (byType[i.type] ?? 0) + 1;

  return { prefix, issues, links, statuses, byType, skipped, parents, linkStats: linkTally, warnings };
}
