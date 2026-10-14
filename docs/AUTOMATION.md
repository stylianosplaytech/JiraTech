# Automation rules

A rule does something when something happens to an issue. Manage rules under profile menu → Integrations → **Automation**
(`/settings/automation`): global administrators manage all of them, and project administrators the rules of their own projects (see
[Who can set things up](API-INTEGRATIONS.md#who-can-set-things-up)).

A rule is **when** + **if** + **then**:

| Part | What it is |
|---|---|
| **Project** | One project, or all projects (all projects: global administrators only). |
| **When** | An issue is created, edited, assigned, moves to another status, gets a comment, or **on a schedule**. Edited can be limited to chosen fields (e.g. only when the priority changes); moved can be limited to one target status. |
| **If** (optional) | The issue must match a JQL query, e.g. `priority = Highest AND labels IS EMPTY`. No condition: every issue. (Scheduled rules need one: see below.) |
| **Then** | Up to 10 actions, run in order. If one fails, the rest are skipped and the run is logged as failed. |

## Actions

| Action | Notes |
|---|---|
| Assign the issue | To nobody, the reporter, the project lead or a chosen person. Already assigned that way: nothing happens. |
| Set the priority | |
| Move to a status | A status name (`In Progress`) or category (`TO_DO`, `DOING`, `CLOSED`). The workflow must allow the move; closing uses the resolution Completed. Already there: nothing happens. |
| Add a comment | Optionally an internal note (service desk agents only). |
| Add a label | A single word; created in the project if new. |
| Post to chat | A message in a Slack or Teams channel, through one of its [chat webhooks](CHAT-INTEGRATIONS.md) that you may manage. Placeholders work and the message links to the issue. |
| Send an email | To the assignee, reporter or project lead, and/or any addresses (a project administrator can only use addresses of people with a JiraTech account). A link to the issue is added. Sent the same way as other JiraTech emails (see Email settings). |

Comments and emails can use placeholders: `{{issue.key}}`, `{{issue.summary}}`, `{{issue.status}}`, `{{issue.priority}}`,
`{{issue.assignee}}`, `{{issue.reporter}}`, `{{issue.url}}`, `{{project.key}}`, `{{project.name}}`, `{{actor.name}}` (who caused the event).

Examples:

- *When an issue is created, if `priority = Highest AND assignee IS EMPTY`: assign to the project lead and email them.*
- *When an issue moves to Resolved: add the label `needs-survey` and a comment thanking the customer.*
- *When a comment is added, if `status = "Waiting for customer"`: move to Waiting for support.*

## Scheduled rules

Choose **On a schedule** to run a rule every hour, every day or every week (at a time in **UTC**; for hourly, only the minutes count). The
rule's JQL condition is then required: it chooses the issues to act on, and the actions run once on each of them, up to **100 issues per
run** (if more match, the first 100 are handled and the run history says so; the rest wait for the next run). The author sees only issues
they can browse.

Because the rule runs on everything that matches every time, make the condition exclude issues that were already handled, usually by
having an action change what the condition looks at:

- *Daily 09:00, `status != Closed AND updated <= -14d AND labels IS EMPTY`: add the label `stale` and a comment asking for an update.*
- *Weekly on Monday, `priority = Highest AND assignee IS EMPTY`: email the project lead.* (This one is meant to nag every week.)

**Test** with the issue key left empty lists the issues a scheduled rule would act on right now, and when it runs next. If the server was
down at the scheduled time, the rule runs once when it is back. Set `AUTOMATION_SCHEDULER=false` on instances that should not run
schedules. `{{actor.name}}` is "Automation" in scheduled runs.

## Who a rule acts as

Actions run with the access of the person who last saved the rule (shown as its author), so a rule can never do more than that person
could. The change shows in the issue's history under their name. If a rule's author is deleted the rule is switched off until someone opens
and saves it. Saving a rule makes you its author.

## Loop protection

Changes made by a rule are events too, so they can start other rules. To stop this running away:

- a rule never starts itself through its own changes, and chains stop after 3 steps (the extra runs are logged as **Stopped**);
- a rule that runs on the same issue more than 5 times within a minute is stopped (scheduled rules run far less often than that).

Even so, two rules that undo each other will fight until the guard stops them: use conditions that exclude the other rule's result.

## Testing and history

- **Test** checks a rule against an issue and lists what it would do (with placeholders filled in) without doing anything.
- Click a rule's name for its **run history**: every time its trigger and condition matched, with the result of each action. Kept for 30 days.
- **Pause** switches a rule off without deleting it.

## API

Logged in (API tokens cannot manage rules), as a global or project administrator: `GET|POST /api/automation/rules`, `PUT|DELETE /api/automation/rules/:id`,
`POST /api/automation/rules/:id/test` (`{ issueKey }`), `GET /api/automation/rules/:id/runs`, `GET /api/automation/meta`.
Rules and [webhooks](API-INTEGRATIONS.md) listen to the same issue events.
