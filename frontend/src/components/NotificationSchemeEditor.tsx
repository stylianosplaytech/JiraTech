import type { NotificationScheme, SchemeEvent, SchemeRecipient } from '../api';

const EVENTS: { id: SchemeEvent; label: string; help: string }[] = [
  { id: 'ISSUE_CREATED', label: 'Issue created', help: 'Someone creates an issue (or raises a request)' },
  { id: 'ISSUE_UPDATED', label: 'Issue updated', help: 'Summary, description, priority, labels, sprint… change' },
  { id: 'ISSUE_ASSIGNED', label: 'Issue assigned', help: 'The assignee changes' },
  { id: 'STATUS_CHANGED', label: 'Status changed', help: 'The issue moves through the workflow' },
  { id: 'COMMENTED', label: 'Comment added', help: 'Including internal notes on service desk requests' },
  { id: 'MENTIONED', label: 'Someone mentioned', help: 'An @mention in a description or comment' },
  { id: 'WATCHER_ADDED', label: 'Watcher added', help: 'Someone else adds a person as a watcher' },
  { id: 'ISSUE_DELETED', label: 'Issue deleted', help: 'The issue is deleted' },
];

const RECIPIENTS: { id: SchemeRecipient; label: string; help: string }[] = [
  { id: 'CONCERNED', label: 'Person concerned', help: 'The person mentioned, or added as a watcher' },
  { id: 'REPORTER', label: 'Reporter', help: 'The person who reported the issue (customers are notified separately)' },
  { id: 'ASSIGNEE', label: 'Assignee', help: 'The current assignee; when the assignee changes, the previous one too' },
  { id: 'WATCHERS', label: 'Watchers', help: 'Everyone watching the issue' },
  { id: 'PROJECT_ADMINS', label: 'Project admins', help: 'The project lead and members with the Administrator role' },
];

const ABOUT_ISSUE: SchemeRecipient[] = ['REPORTER', 'ASSIGNEE', 'WATCHERS', 'PROJECT_ADMINS'];
/** Matches APPLICABLE in the backend's notification-scheme.service.ts */
const APPLICABLE: Record<SchemeEvent, SchemeRecipient[]> = {
  ISSUE_CREATED: ABOUT_ISSUE,
  ISSUE_UPDATED: ABOUT_ISSUE,
  ISSUE_ASSIGNED: ABOUT_ISSUE,
  STATUS_CHANGED: ABOUT_ISSUE,
  COMMENTED: ABOUT_ISSUE,
  MENTIONED: ['CONCERNED'],
  WATCHER_ADDED: ['CONCERNED'],
  ISSUE_DELETED: ABOUT_ISSUE,
};

export function sameScheme(a: NotificationScheme, b: NotificationScheme) {
  return EVENTS.every(({ id }) => a[id].length === b[id].length && a[id].every((r) => b[id].includes(r)));
}

/** The event × recipient grid of who is emailed. Read-only without `onChange`. */
export default function NotificationSchemeEditor({ value, onChange }: {
  value: NotificationScheme;
  onChange?: (scheme: NotificationScheme) => void;
}) {
  const toggle = (event: SchemeEvent, recipient: SchemeRecipient, on: boolean) => {
    if (!onChange) return;
    const next = on ? [...value[event], recipient] : value[event].filter((r) => r !== recipient);
    onChange({ ...value, [event]: RECIPIENTS.map((r) => r.id).filter((r) => next.includes(r)) });
  };

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Event</th>
            {RECIPIENTS.map((r) => <th key={r.id} className="text-center w-28" title={r.help}>{r.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {EVENTS.map((e) => (
            <tr key={e.id}>
              <td>
                <div className="font-medium">{e.label}</div>
                <div className="text-xs text-jira-muted">{e.help}</div>
              </td>
              {RECIPIENTS.map((r) => {
                if (!APPLICABLE[e.id].includes(r.id)) return <td key={r.id} className="text-center text-jira-muted">—</td>;
                const on = value[e.id].includes(r.id);
                return (
                  <td key={r.id} className="text-center">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!onChange}
                      onChange={(ev) => toggle(e.id, r.id, ev.target.checked)}
                      aria-label={`Email ${r.label.toLowerCase()} when: ${e.label.toLowerCase()}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-help">
        Nobody is emailed about their own changes, people who can't see the project are never emailed, and anyone can still
        turn off all their email notifications from the profile menu. Everyone involved keeps getting in-app notifications.
        Customers on service desk requests are emailed about public replies and status changes separately.
      </p>
    </div>
  );
}
