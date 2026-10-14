# Automation rules

A rule does something when something happens to an issue. Global administrators manage rules under profile menu → Administration →
**Automation** (`/settings/automation`).

A rule is **when** + **if** + **then**:

| Part | What it is |
|---|---|
| **Project** | One project, or all projects. |
| **When** | An issue is created, edited, assigned, moves to another status, or gets a comment. Edited can be limited to chosen fields (e.g. only when the priority changes); moved can be limited to one target status. |
| **If** (optional) | The issue must match a JQL query, e.g. `priority = Highest AND labels IS EMPTY`. No condition: every issue. |
| **Then** | Up to 10 actions, run in order. If one fails, the rest are skipped and the run is logged as failed. |

## Actions

| Action | Notes |
|---|---|
| Assign the issue | To nobody, the reporter, the project lead or a chosen person. Already assigned that way: nothing happens. |
| Set the priority | |
| Move to a status | A status name (`In Progress`) or category (`TO_DO`, `DOING`, `CLOSED`). The workflow must allow the move; closing uses the resolution Completed. Already there: nothing happens. |
| Add a comment | Optionally an internal note (service desk agents only). |
| Add a label | A single word; created in the project if new. |
| Send an email | To the assignee, reporter or project lead, and/or any addresses. A link to the issue is added. Sent the same way as other JiraTech emails (see Email settings). |

Comments and emails can use placeholders: `{{issue.key}}`, `{{issue.summary}}`, `{{issue.status}}`, `{{issue.priority}}`,
`{{issue.assignee}}`, `{{issue.reporter}}`, `{{issue.url}}`, `{{project.key}}`, `{{project.name}}`, `{{actor.name}}` (who caused the event).

Examples:

- *When an issue is created, if `priority = Highest AND assignee IS EMPTY`: assign to the project lead and email them.*
- *When an issue moves to Resolved: add the label `needs-survey` and a comment thanking the customer.*
- *When a comment is added, if `status = "Waiting for customer"`: move to Waiting for support.*

## Who a rule acts as

Actions run with the access of the person who last saved the rule (shown as its author), so a rule can never do more than that person
could. The change shows in the issue's history under their name. If a rule's author is deleted the rule is switched off until someone opens
and saves it. Saving a rule makes you its author.

## Loop protection

Changes made by a rule are events too, so they can start other rules. To stop this running away:

- a rule never starts itself through its own changes, and chains stop after 3 steps (the extra runs are logged as **Stopped**);
- a rule that runs on the same issue more than 5 times within a minute is stopped.

Even so, two rules that undo each other will fight until the guard stops them: use conditions that exclude the other rule's result.

## Testing and history

- **Test** checks a rule against an issue and lists what it would do (with placeholders filled in) without doing anything.
- Click a rule's name for its **run history**: every time its trigger and condition matched, with the result of each action. Kept for 30 days.
- **Pause** switches a rule off without deleting it.

## API

Global administrators, logged in (API tokens cannot manage rules): `GET|POST /api/automation/rules`, `PUT|DELETE /api/automation/rules/:id`,
`POST /api/automation/rules/:id/test` (`{ issueKey }`), `GET /api/automation/rules/:id/runs`, `GET /api/automation/meta`.
Rules and [webhooks](API-INTEGRATIONS.md) listen to the same issue events.
