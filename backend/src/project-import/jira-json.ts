import { IssueStatus } from '@prisma/client';
import {
  ParsedSource, Person, SourceIssue, SourceVersion, buildColumns, checkIssues, collectStatuses, customText, dayOf, dominantPrefix, keyRe, mapType,
} from './source';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Standard fields that carry data but have no field of their own in the app: offered as custom fields. */
const EXTRA_STANDARD: Record<string, string> = {
  environment: 'Environment',
  creator: 'Creator',
  resolution: 'Resolution',
  resolutiondate: 'Resolved',
  timespent: 'Time spent (seconds)',
};

const person = (u: Json | null | undefined): Person | null => {
  if (!u || typeof u !== 'object') return null;
  const p: Person = { name: u.displayName ?? u.name, username: u.name ?? u.key, email: u.emailAddress };
  return p.name || p.username || p.email ? p : null;
};

const date = (v: unknown) => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? null : d;
};

const hours = (seconds: unknown) => (typeof seconds === 'number' && seconds > 0 ? Math.round((seconds / 3600) * 100) / 100 : null);

const versions = (xs: unknown): SourceVersion[] =>
  Array.isArray(xs) ? xs.filter((v) => v?.name).map((v) => ({ name: String(v.name), released: !!v.released, releaseDate: date(v.releaseDate) })) : [];

/** Plugin output and development summaries that fill many Jira fields but carry nothing to import. */
const NOISE = /^(<link href=|\{summaryBean=)/;

/** A sprint arrives as a Java object dump: "...Sprint@1f[id=7,name=Sprint 12,state=ACTIVE...]". */
function sprintName(v: unknown): string | null {
  return typeof v === 'string' && v.includes('greenhopper') ? /[,[]name=([^,\]]+)/.exec(v)?.[1] ?? null : null;
}

function fieldText(v: unknown): string {
  if (v === 0) return '';
  if (Array.isArray(v) && v.some((x) => sprintName(x))) return v.map((x) => sprintName(x) ?? '').filter(Boolean).join(', ');
  if (typeof v === 'string' && NOISE.test(v)) return '';
  return customText(v);
}

/**
 * Read issues from Jira's REST API: a JSON array of issues, or a search response with an "issues" list. The
 * export only knows custom fields by id, so they are offered as "customfield_NNN" (or by name when the file has
 * a "names" map) with a sample value to recognise them by.
 */
export function readJsonSource(text: string): ParsedSource {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON');
  }
  const list: Json[] = Array.isArray(data) ? data : Array.isArray((data as Json)?.issues) ? (data as Json).issues : [];
  if (!list.length || !list.every((i) => i && typeof i === 'object')) throw new Error('No issues were found. Expected a JSON list of Jira issues');
  if (!list[0].key || !list[0].fields) throw new Error('This doesn\'t look like a Jira export: issues need "key" and "fields"');
  const names: Json = (!Array.isArray(data) ? (data as Json).names : undefined) ?? list[0].names ?? {};

  const prefix = dominantPrefix(list.map((i) => String(i.key ?? '')));
  if (!prefix) throw new Error('No issue keys such as ABC-123 were found');

  // Which custom field is the epic link: the one whose values are keys of epics in this file.
  const epicType = new Map(list.map((i) => [String(i.key).toUpperCase(), String(i.fields?.issuetype?.name ?? '')]));
  const tally = new Map<string, { n: number; epics: number }>();
  for (const i of list) {
    for (const [f, v] of Object.entries<unknown>(i.fields ?? {})) {
      if (!f.startsWith('customfield_') || typeof v !== 'string' || !keyRe.test(v)) continue;
      const t = tally.get(f) ?? { n: 0, epics: 0 };
      t.n++;
      if (epicType.get(v.toUpperCase())?.toLowerCase() === 'epic') t.epics++;
      tally.set(f, t);
    }
  }
  const epicField = [...tally.entries()]
    .filter(([, t]) => t.n >= 3 && t.epics / t.n >= 0.5)
    .sort((a, b) => b[1].epics - a[1].epics)[0]?.[0];

  const left = { otherProjects: 0, duplicateKeys: 0, noSummary: 0 };
  const issues: SourceIssue[] = [];
  const seen = new Set<string>();
  const unknownTypes = new Set<string>();
  const categories = new Map<string, IssueStatus>();
  const customLabels = new Map<string, string>();
  let badDates = 0, shortWorklogs = 0, attachments = 0;

  for (const raw of list) {
    const key = String(raw.key ?? '').toUpperCase();
    const m = keyRe.exec(key);
    if (!m || m[1] !== prefix) { left.otherProjects++; continue; }
    if (seen.has(key)) { left.duplicateKeys++; continue; }
    const f: Json = raw.fields ?? {};
    const summary = String(f.summary ?? '').trim();
    if (!summary) { left.noSummary++; continue; }
    seen.add(key);

    const typeName = String(f.issuetype?.name ?? '');
    if (!mapType(typeName)) unknownTypes.add(typeName);
    const created = date(f.created);
    if (!created) badDates++;
    const statusName = String(f.status?.name ?? '').trim() || 'Backlog';
    const cat = f.status?.statusCategory?.key;
    if (!categories.has(statusName) && cat) {
      categories.set(statusName, cat === 'done' ? IssueStatus.CLOSED : cat === 'indeterminate' ? IssueStatus.DOING : IssueStatus.TO_DO);
    }

    const custom: Record<string, string> = {};
    const addCustom = (id: string, label: string, v: unknown) => {
      // Listed even when empty, so the column picker can hide empty ones.
      if (!customLabels.has(id)) customLabels.set(id, label);
      const text = fieldText(v);
      if (text) custom[id] = text.slice(0, 4000);
    };
    for (const [id, v] of Object.entries<unknown>(f)) {
      if (id.startsWith('customfield_')) {
        if (id !== epicField) addCustom(id, names[id] ?? id, v);
      } else if (EXTRA_STANDARD[id]) addCustom(id, EXTRA_STANDARD[id], v);
    }

    const links: SourceIssue['links'] = [];
    for (const l of f.issuelinks ?? []) {
      const other = (l.outwardIssue ?? l.inwardIssue)?.key;
      if (other) links.push({ type: String(l.type?.name ?? 'Relates'), outward: !!l.outwardIssue, key: String(other).toUpperCase() });
    }
    const worklog: Json = f.worklog ?? {};
    if ((worklog.total ?? 0) > (worklog.worklogs?.length ?? 0)) shortWorklogs++;
    if (Array.isArray(f.attachment) && f.attachment.length) attachments++;

    issues.push({
      key,
      number: +m[2],
      sourceId: String(raw.id ?? ''),
      parent: f.parent?.key ? { key: String(f.parent.key).toUpperCase(), sourceId: f.parent.id ? String(f.parent.id) : undefined } : null,
      epicKey: epicField && typeof f[epicField] === 'string' ? f[epicField].toUpperCase() : null,
      typeName,
      summary: summary.slice(0, 500),
      description: typeof f.description === 'string' && f.description.trim() ? f.description : null,
      statusName,
      priorityName: f.priority?.name ?? null,
      created,
      updated: date(f.updated),
      reporter: person(f.reporter),
      assignee: person(f.assignee),
      labels: Array.isArray(f.labels) ? f.labels.map(String) : [],
      components: Array.isArray(f.components) ? f.components.filter((c: Json) => c?.name).map((c: Json) => String(c.name)) : [],
      fixVersions: versions(f.fixVersions),
      affectsVersions: versions(f.versions),
      dueDate: dayOf(f.duedate),
      estimateHours: hours(f.timeoriginalestimate),
      remainingHours: hours(f.timeestimate),
      links,
      comments: (f.comment?.comments ?? []).map((c: Json) => ({ author: person(c.author), body: String(c.body ?? ''), created: date(c.created) })).filter((c: { body: string }) => c.body),
      worklogs: (worklog.worklogs ?? []).map((w: Json) => ({
        author: person(w.author),
        seconds: Number(w.timeSpentSeconds) || 0,
        comment: typeof w.comment === 'string' && w.comment.trim() ? w.comment : null,
        started: date(w.started) ?? date(w.created),
      })).filter((w: { seconds: number }) => w.seconds > 0),
      custom,
    });
  }

  const warnings = checkIssues(issues, prefix, left, unknownTypes, badDates);
  if (shortWorklogs) warnings.push(`${shortWorklogs} issue(s) have more work log entries than the export contains; only the included ones are imported.`);
  if (attachments) warnings.push(`${attachments} issue(s) have attachments. The export lists them but doesn't contain the files, so they aren't imported.`);
  if (epicField) warnings.push(`${names[epicField] ?? epicField} was recognised as the epic link: issues are placed under their epic.`);

  return {
    format: 'json',
    prefix,
    issues,
    columns: buildColumns(issues, customLabels),
    statuses: collectStatuses(issues, (name) => categories.get(name) ?? null),
    warnings,
  };
}
