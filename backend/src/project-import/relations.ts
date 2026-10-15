import { LinkType } from '@prisma/client';
import { Person, SourceIssue, linkKind } from './source';

/**
 * Each issue's parent within the file: its Jira parent, else its epic. A parent that isn't in the file can't be
 * kept, so those issues are counted and left without one.
 */
export function resolveParents(issues: SourceIssue[]) {
  const keys = new Set(issues.map((i) => i.key));
  const keyBySourceId = new Map(issues.filter((i) => i.sourceId).map((i) => [i.sourceId, i.key]));
  const parentOf = new Map<string, string>();
  let outsideExport = 0;
  for (const i of issues) {
    const candidates = [
      i.parent?.key,
      i.parent?.sourceId ? keyBySourceId.get(i.parent.sourceId) : undefined,
      i.epicKey ?? undefined,
    ].filter((k): k is string => !!k);
    if (!i.parent && !i.epicKey) continue;
    const found = candidates.find((k) => keys.has(k) && k !== i.key);
    if (found) parentOf.set(i.key, found);
    else outsideExport++;
  }
  return { parentOf, linked: parentOf.size, outsideExport };
}

export type LinkRow = { type: LinkType; sourceKey: string; targetKey: string };

/**
 * Links between issues in the file. Jira lists a link on both issues, so collect each once, in one direction.
 * Links to issues outside the file can't be kept.
 */
export function collectLinks(issues: SourceIssue[]) {
  const keys = new Set(issues.map((i) => i.key));
  const links: LinkRow[] = [];
  const have = new Set<string>();
  const byType: Record<string, number> = {};
  let outsideExport = 0;
  for (const i of issues) {
    for (const l of i.links) {
      if (!keys.has(l.key)) { outsideExport++; continue; }
      if (l.key === i.key) continue;
      const type = linkKind(l.type);
      // Outward: this issue is the source ("blocks X"); inward: the other issue is.
      const [sourceKey, targetKey] = l.outward ? [i.key, l.key] : [l.key, i.key];
      // "Relates" reads the same both ways, so A→B and B→A are one link.
      const id = type === LinkType.RELATES_TO && sourceKey > targetKey ? `${type}|${targetKey}|${sourceKey}` : `${type}|${sourceKey}|${targetKey}`;
      if (have.has(id)) continue;
      have.add(id);
      links.push({ type, sourceKey, targetKey });
      byType[type] = (byType[type] ?? 0) + 1;
    }
  }
  return { links, kept: links.length, outsideExport, byType };
}

// ─── People ──────────────────────────────────────────────────────────────────

export type AppUser = { id: string; email: string; name: string };

export const personId = (p: Person) => (p.email ?? p.username ?? p.name ?? '').trim().toLowerCase();
export const personName = (p: Person) => p.name ?? p.username ?? p.email ?? 'Unknown';

/** The user an export's person is: by email, else the username as the start of an email address, else by name. */
export function matchUser(p: Person, users: AppUser[]): AppUser | null {
  const email = p.email?.trim().toLowerCase();
  if (email) {
    const byEmail = users.find((u) => u.email.toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const username = p.username?.trim().toLowerCase();
  if (username) {
    const byName = users.find((u) => u.email.toLowerCase().split('@')[0] === username);
    if (byName) return byName;
  }
  const name = p.name?.trim().toLowerCase();
  return (name && users.find((u) => u.name.trim().toLowerCase() === name)) || null;
}

/** Everyone the issues mention (as reporter, assignee, commenter or work log author), and who they are in this app. */
export function resolvePeople(issues: SourceIssue[], users: AppUser[]) {
  const seen = new Map<string, { person: Person; user: AppUser | null }>();
  const add = (p: Person | null) => {
    if (!p) return;
    const id = personId(p);
    if (id && !seen.has(id)) seen.set(id, { person: p, user: matchUser(p, users) });
  };
  for (const i of issues) {
    add(i.reporter);
    add(i.assignee);
    i.comments.forEach((c) => add(c.author));
    i.worklogs.forEach((w) => add(w.author));
  }
  const all = [...seen.values()];
  return {
    userFor: (p: Person | null) => (p ? seen.get(personId(p))?.user ?? null : null),
    total: all.length,
    matched: all.filter((x) => x.user).length,
    unmatched: all.filter((x) => !x.user).map((x) => personName(x.person)).sort(),
  };
}
