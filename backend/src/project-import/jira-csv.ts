import {
  ParsedSource, SourceIssue, buildColumns, checkIssues, collectStatuses, dayOf, dominantPrefix, keyRe, mapType,
} from './source';

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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Jira writes dates as "05.05.2026 20:23" (day.month.year) or "05/May/26 8:23 PM" depending on locale, in the time
 * zone of whoever exported. Read them in the given UTC offset (minutes). ISO dates carry their own offset.
 */
export function parseDate(raw: string, utcOffsetMinutes: number): Date | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return fromParts(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), utcOffsetMinutes);
  m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month < 0) return null;
    let hour = +(m[4] ?? 0);
    if (m[6]?.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (m[6]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
    const year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return fromParts(year, month, +m[1], hour, +(m[5] ?? 0), utcOffsetMinutes);
  }
  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function fromParts(y: number, mo: number, d: number, h: number, mi: number, utcOffsetMinutes: number) {
  const ms = Date.UTC(y, mo, d, h, mi) - utcOffsetMinutes * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Jira's "Due date" column: a day with no time, written like the other dates (so read as given, not shifted by a time zone). */
function dueDay(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw.trim())) return dayOf(raw);
  const d = parseDate(raw, 0);
  return d ? d.toISOString().slice(0, 10) : null;
}

const hours = (seconds: string) => {
  const n = Number(seconds);
  return seconds.trim() && Number.isFinite(n) ? Math.round((n / 3600) * 100) / 100 : null;
};

/**
 * Read a Jira "Export CSV (all fields)" file. Columns the app has a field for are mapped; every other column
 * is offered as a custom field. Jira repeats a column once per value (labels, links, comments), so columns
 * with the same title are read together.
 */
export function readCsvSource(text: string, utcOffsetMinutes = 0): ParsedSource {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file has no issues in it');
  const header = rows[0].map((h) => h.trim());
  const at = (...names: string[]) => header.flatMap((h, i) => (names.includes(h.toLowerCase()) ? [i] : []));
  const first = (...names: string[]) => at(...names)[0] ?? -1;

  const iKey = first('issue key'), iSummary = first('summary'), iType = first('issue type'), iStatus = first('status');
  const missing = [['Issue key', iKey], ['Summary', iSummary], ['Issue Type', iType], ['Status', iStatus]].filter(([, i]) => i === -1);
  if (missing.length) throw new Error(`This doesn't look like a Jira export: missing column ${missing.map(([n]) => n).join(', ')}`);

  const iId = first('issue id'), iParentId = first('parent id'), iParent = first('parent');
  const iPriority = first('priority'), iCreated = first('created'), iUpdated = first('updated');
  const iDescription = first('description'), iReporter = first('reporter'), iAssignee = first('assignee');
  const iEstimate = first('original estimate'), iRemaining = first('remaining estimate'), iDue = first('due date');
  const iLabels = at('labels'), iComponents = at('component/s', 'components');
  const iFix = at('fix version/s', 'fix versions'), iAffects = at('affects version/s', 'affected version/s');
  const iComments = at('comment');
  const iEpic = header.findIndex((h) => /^custom field \(epic link\)$/i.test(h));

  const linkCols = header
    .map((h, i) => ({ i, m: /^(Inward|Outward) issue link \((.+)\)$/.exec(h) }))
    .filter((c): c is { i: number; m: RegExpExecArray } => !!c.m)
    .map((c) => ({ i: c.i, outward: c.m[1] === 'Outward', type: c.m[2] }));

  const used = new Set<number>([
    iKey, iSummary, iType, iStatus, iId, iParentId, iParent, iPriority, iCreated, iUpdated, iDescription, iReporter, iAssignee,
    iEstimate, iRemaining, iDue, iEpic, ...iLabels, ...iComponents, ...iFix, ...iAffects, ...iComments, ...linkCols.map((c) => c.i),
  ]);
  // Every other column becomes a custom field; columns with the same title are one field.
  const customCols = new Map<string, { label: string; idx: number[] }>();
  header.forEach((h, i) => {
    if (used.has(i) || !h) return;
    const id = h.toLowerCase();
    const label = /^custom field \((.+)\)$/i.exec(h)?.[1] ?? h;
    const entry = customCols.get(id) ?? { label, idx: [] };
    entry.idx.push(i);
    customCols.set(id, entry);
  });

  const prefix = dominantPrefix(rows.slice(1).map((r) => r[iKey] ?? ''));
  if (!prefix) throw new Error('No issue keys such as ABC-123 were found in the "Issue key" column');

  const left = { otherProjects: 0, duplicateKeys: 0, noSummary: 0 };
  const issues: SourceIssue[] = [];
  const seen = new Set<string>();
  const unknownTypes = new Set<string>();
  let badDates = 0;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const many = (r: string[], idx: number[]) => idx.map((i) => cell(r, i)).filter(Boolean);

  for (const r of rows.slice(1)) {
    const key = cell(r, iKey).toUpperCase();
    const m = keyRe.exec(key);
    if (!m || m[1] !== prefix) { left.otherProjects++; continue; }
    if (seen.has(key)) { left.duplicateKeys++; continue; }
    const summary = cell(r, iSummary);
    if (!summary) { left.noSummary++; continue; }
    seen.add(key);

    const created = parseDate(cell(r, iCreated), utcOffsetMinutes);
    if (!created) badDates++;
    const parentKey = cell(r, iParent), parentId = cell(r, iParentId);
    const person = (v: string) => (v ? { username: v, name: v } : null);
    const links: SourceIssue['links'] = [];
    for (const lc of linkCols) {
      const other = cell(r, lc.i).toUpperCase();
      if (other) links.push({ type: lc.type, outward: lc.outward, key: other });
    }
    const custom: Record<string, string> = {};
    for (const [id, c] of customCols) {
      const v = many(r, c.idx).join(', ');
      if (v) custom[id] = v;
    }

    issues.push({
      key,
      number: +m[2],
      sourceId: cell(r, iId),
      parent: parentKey || parentId ? { key: parentKey ? parentKey.toUpperCase() : undefined, sourceId: parentId || undefined } : null,
      epicKey: cell(r, iEpic).toUpperCase() || null,
      typeName: cell(r, iType),
      summary: summary.slice(0, 500),
      description: (r[iDescription] ?? '').trim() || null,
      statusName: cell(r, iStatus) || 'Backlog',
      priorityName: cell(r, iPriority) || null,
      created,
      updated: parseDate(cell(r, iUpdated), utcOffsetMinutes),
      reporter: person(cell(r, iReporter)),
      assignee: person(cell(r, iAssignee)),
      labels: many(r, iLabels),
      components: many(r, iComponents),
      fixVersions: many(r, iFix).map((name) => ({ name })),
      affectsVersions: many(r, iAffects).map((name) => ({ name })),
      dueDate: dueDay(cell(r, iDue)),
      estimateHours: hours(cell(r, iEstimate)),
      remainingHours: hours(cell(r, iRemaining)),
      links,
      // "05/May/26 8:23 PM;username;text"
      comments: many(r, iComments).map((c) => {
        const p = /^([^;]*);([^;]*);([\s\S]*)$/.exec(c);
        return p
          ? { created: parseDate(p[1], utcOffsetMinutes), author: person(p[2].trim()), body: p[3] }
          : { created: null, author: null, body: c };
      }),
      worklogs: [],
      custom,
    });
  }

  for (const i of issues) if (!mapType(i.typeName)) unknownTypes.add(i.typeName);
  const labels = new Map([...customCols].map(([id, c]) => [id, c.label]));
  return {
    format: 'csv',
    prefix,
    issues,
    columns: buildColumns(issues, labels),
    statuses: collectStatuses(issues, () => null),
    warnings: checkIssues(issues, prefix, left, unknownTypes, badDates),
  };
}
