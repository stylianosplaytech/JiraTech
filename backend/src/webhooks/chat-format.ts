/** How a webhook sends its events: the signed JSON as is, or a readable message for a chat channel. */
export const WEBHOOK_FORMATS = ['JSON', 'SLACK', 'TEAMS'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export const isChatFormat = (format: string): format is 'SLACK' | 'TEAMS' => format === 'SLACK' || format === 'TEAMS';

/** What an event says, before it is dressed for Slack or Teams. */
interface Message {
  /** "Ada Admin moved this from To Do to Done" */
  sentence: string;
  issue: { key: string; url: string; summary: string } | null;
  facts: { label: string; value: string }[];
  /** A comment's text */
  quote: string | null;
}

interface Person {
  name?: string;
}

interface EventPayload {
  event?: string;
  message?: string;
  text?: string;
  actor?: Person | null;
  project?: { key?: string; name?: string } | null;
  issue?: {
    key?: string; url?: string; summary?: string; type?: string; status?: string; priority?: string; resolution?: string | null; dueDate?: string | null;
    assignee?: Person | null; reporter?: Person | null;
  } | null;
  changes?: { field: string; from: string | null; to: string | null }[];
  comment?: { body?: string; internal?: boolean } | null;
}

const FIELD_NAMES: Record<string, string> = {
  summary: 'Summary', description: 'Description', priority: 'Priority', estimate: 'Estimate', remainingEstimate: 'Remaining estimate', dueDate: 'Due date',
  blocked: 'Blocked', epicName: 'Epic name', assignee: 'Assignee', reporter: 'Reporter', sprint: 'Sprint', components: 'Components',
  labels: 'Labels', fixVersions: 'Fix versions', affectsVersions: 'Affects versions', project: 'Project', status: 'Status',
  resolution: 'Resolution', key: 'Key', parent: 'Parent', requestType: 'Request type',
};

const human = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function describe(p: EventPayload): Message {
  const who = p.actor?.name ?? 'Someone';
  const i = p.issue;
  const issue = i?.key ? { key: i.key, url: i.url ?? '', summary: i.summary ?? '' } : null;
  const facts: Message['facts'] = [];
  const add = (label: string, value?: string | null) => { if (value) facts.push({ label, value }); };
  const change = (field: string) => p.changes?.find((c) => c.field === field);
  let sentence: string;
  let quote: string | null = null;

  switch (p.event) {
    case 'ping':
      return { sentence: p.message ?? 'A test message from Conductor', issue: null, facts: [], quote: null };
    case 'automation.message':
      sentence = p.text ?? '';
      add('Project', p.project?.name);
      add('Status', i?.status);
      add('Priority', i?.priority ? human(i.priority) : null);
      add('Assignee', i?.assignee?.name);
      break;
    case 'issue.created':
      sentence = `${who} created ${i?.type ? `a ${human(i.type).toLowerCase()}` : 'an issue'}`;
      add('Project', p.project?.name);
      add('Priority', i?.priority ? human(i.priority) : null);
      add('Status', i?.status);
      add('Assignee', i?.assignee?.name);
      add('Reporter', i?.reporter?.name);
      add('Due date', i?.dueDate);
      break;
    case 'issue.assigned': {
      const to = change('assignee')?.to;
      sentence = to ? `${who} assigned this to ${to}` : `${who} unassigned this`;
      break;
    }
    case 'issue.transitioned': {
      const s = change('status');
      sentence = `${who} moved this from ${s?.from ?? '?'} to ${s?.to ?? i?.status ?? '?'}`;
      const r = change('resolution');
      if (r?.to) add('Resolution', human(r.to));
      break;
    }
    case 'issue.deleted':
      sentence = `${who} deleted this issue`;
      break;
    case 'comment.created':
    case 'comment.updated':
      sentence = `${who} ${p.event === 'comment.created' ? 'commented' : 'edited a comment'}${p.comment?.internal ? ' (internal note)' : ''}`;
      quote = p.comment?.body ? clip(p.comment.body, 500) : null;
      break;
    default:
      sentence = `${who} updated this issue`;
      for (const c of p.changes ?? []) {
        const name = FIELD_NAMES[c.field] ?? c.field;
        // Priority and resolution travel as codes (MEDIUM); chat reads better with words.
        const word = (v: string | null) => (v ? clip(c.field === 'priority' || c.field === 'resolution' ? human(v) : v, 80) : 'none');
        const from = word(c.from);
        const to = word(c.to);
        add(name, c.field === 'description' ? 'edited' : `${from} → ${to}`);
      }
  }
  return { sentence, issue, facts: facts.slice(0, 10), quote };
}

// ─── Slack ───────────────────────────────────────────────────────────────────

/** Slack's mrkdwn treats these three characters specially. */
const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function slackBody(payload: EventPayload) {
  const m = describe(payload);
  const title = m.issue ? `*<${m.issue.url}|${slackEscape(m.issue.key)}> ${slackEscape(clip(m.issue.summary, 200))}*` : '';
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: clip([slackEscape(m.sentence), title].filter(Boolean).join('\n'), 2900) } },
  ];
  if (m.facts.length) {
    blocks.push({ type: 'section', fields: m.facts.map((f) => ({ type: 'mrkdwn', text: clip(`*${slackEscape(f.label)}*\n${slackEscape(f.value)}`, 1900) })) });
  }
  if (m.quote) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(`>${slackEscape(m.quote).replace(/\n/g, '\n>')}`, 2900) } });
  }
  // `text` is what notifications and clients without blocks show.
  const fallback = [m.sentence, m.issue ? `${m.issue.key} ${m.issue.summary}` : ''].filter(Boolean).join(': ');
  return { text: clip(fallback, 300), blocks };
}

// ─── Microsoft Teams (an Adaptive Card, as the "Workflows" webhook trigger expects) ───

export function teamsBody(payload: EventPayload) {
  const m = describe(payload);
  const body: unknown[] = [{ type: 'TextBlock', text: m.sentence, wrap: true }];
  if (m.issue) body.push({ type: 'TextBlock', text: `**${m.issue.key}** ${clip(m.issue.summary, 200)}`, weight: 'Bolder', size: 'Medium', wrap: true });
  if (m.facts.length) body.push({ type: 'FactSet', facts: m.facts.map((f) => ({ title: f.label, value: clip(f.value, 300) })) });
  if (m.quote) body.push({ type: 'TextBlock', text: m.quote, wrap: true, isSubtle: true });
  const content: Record<string, unknown> = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  };
  if (m.issue?.url) content.actions = [{ type: 'Action.OpenUrl', title: `Open ${m.issue.key}`, url: m.issue.url }];
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content }] };
}

/** The request body for a chat webhook, built from the event that was stored for the delivery. */
export function chatBody(format: 'SLACK' | 'TEAMS', payload: unknown) {
  const p = (payload && typeof payload === 'object' ? payload : {}) as EventPayload;
  return format === 'SLACK' ? slackBody(p) : teamsBody(p);
}
