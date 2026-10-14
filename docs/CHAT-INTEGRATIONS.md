# Slack and Microsoft Teams

JiraTech can post to a Slack or Teams channel in two ways: automatically when something happens to an issue, and from an
[automation rule](AUTOMATION.md) with a message you write. Both use a **chat webhook**: an ordinary
[webhook](API-INTEGRATIONS.md#webhooks) whose format is *Slack* or *Teams*.

## Set up a channel

1. Get the channel's incoming-webhook address.
   - **Slack:** create an incoming webhook for the channel (Slack app → *Incoming Webhooks* → *Add New Webhook to Workspace*). The address
     looks like `https://hooks.slack.com/services/T…/B…/…`.
   - **Teams:** in the channel, *••• → Workflows → "Post to a channel when a webhook request is received"*, and copy the address it gives you.
2. In JiraTech open profile menu → Integrations → **Webhooks** → **Add webhook**. Choose **Sends: Slack channel** (or **Microsoft Teams
   channel**), paste the address, and name it after the channel (e.g. *#support*).
3. Choose the project (or all projects, for global administrators), the events the channel should hear about, and optionally a filter
   (below). **Send test** posts a test message to the channel.

Project administrators can set up channels for their own projects; see [who can set things up](API-INTEGRATIONS.md#who-can-set-things-up).

## What the messages look like

One message per event: who did what, a link to the issue, and the details.

| Event | Message |
|---|---|
| Created | *Ada created a task*, with the project, priority, status, assignee and reporter |
| Edited | *Ada updated this issue*, with each change as *Priority: Medium → Highest* |
| Assigned | *Ada assigned this to Ben* |
| Status changed | *Ada moved this from To Do to In Progress* (and the resolution when closing) |
| Deleted | *Ada deleted this issue* |
| Comment added or edited | *Ada commented*, with the comment quoted (internal notes are marked) |

Slack gets formatted blocks; Teams gets an Adaptive Card with an **Open** button. Text that would be read as formatting (`<`, `>`, `&`) is
escaped, so a summary can't break a message or ping people.

## Only what matters: filters

A webhook (of any format) can have a **JQL filter**: events about issues that don't match are not sent. For example a channel for urgent
work: `priority = Highest AND status != Closed`. The filter is checked as the person who last saved the webhook, so it can only narrow down what
they can already see. For *deleted* it is checked just before the issue goes.

## Posting from automation rules

Add the action **Post to chat (Slack or Teams)** to a rule, choose a channel and write the message; the usual placeholders
(`{{issue.key}}`, `{{issue.summary}}`, …) work and the message links to the issue.

- *Daily 09:00, `priority = Highest AND status != Closed` → Post to chat: "Still open: {{issue.key}} {{issue.summary}}"* gives a morning list.
- A chat webhook with **no events ticked** speaks only when a rule posts to it, which keeps a channel quiet.
- You can only choose channels you may manage yourself: a project administrator can post to their own project's channels, not to a
  company-wide one or another project's.

## When something goes wrong

Messages are retried like other webhooks (6 attempts over about 8 hours), and the webhook's name opens its delivery log. A refusal now
shows what the service said, for example `The server answered 400: invalid_payload` or `no_service` (Slack: the webhook was revoked). A webhook that
fails 30 times in a row is switched off.

## Not included

Replying to or acting on issues from chat (slash commands, buttons), Slack OAuth apps, and direct messages: this is one-way, to a channel.
