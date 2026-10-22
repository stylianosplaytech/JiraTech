# API tokens, webhooks and the API reference

Three ways to connect other systems to Conductor: **API tokens** let a script call Conductor, **webhooks** make Conductor call a
script when something happens, and **incoming webhooks** let monitoring tools and CI systems raise issues by POSTing to a secret address.

## API reference (OpenAPI)

Every endpoint is described in an OpenAPI 3 document, served by Conductor itself:

| | |
|---|---|
| `/api/docs` | Interactive reference (Swagger UI): endpoints by section, request bodies, and **Try it out**. Click **Authorize** and paste an API token (`jt_…`) to make real requests from the page. |
| `/api/openapi.json` | The machine-readable document, for generating clients (`openapi-generator`, `openapi-typescript`…) or importing into Postman or Insomnia. |

Both are read from the code when the app is built, so they always match the running version. They are open to anyone who can reach the server
(the endpoints themselves still need a token); set `API_DOCS=false` in `backend/.env` to switch them off.

What is described: every route, its parameters, the request bodies (with their types, allowed values, limits and which fields are required) and
which routes need no token. What is not, yet: response bodies, which are the JSON the web app uses.

Writing a controller: a `/** comment */` above a route becomes its summary in the reference, and request classes belong in a `*.dto.ts` file
(that is where the build looks for them). A route that takes a loose body (`@Body() body: { … }`) needs an `@ApiBody({ schema })` to be
described. After changing the build settings in `backend/nest-cli.json`, delete `backend/dist/tsconfig.tsbuildinfo` once, or the incremental
build keeps the old output.

## API tokens

Create them under your profile menu → **API tokens** (`/settings/api-tokens`). Every staff user can have up to 25. A token acts as its
owner, so it reaches exactly the projects and actions that person can; customers (service desk portal users) can't use tokens.

```bash
curl -H "Authorization: Bearer jt_xxxxxxxx" https://conductor.example.com/api/issues/HELP-12
curl -X POST -H "Authorization: Bearer jt_xxxxxxxx" -H "Content-Type: application/json" \
     -d '{"jql":"project = HELP AND status != Done"}' https://conductor.example.com/api/search
```

| | |
|---|---|
| **Read only** | Only `GET`, `HEAD` and `OPTIONS` requests. Anything else answers `403`. |
| **Read and write** | Everything its owner can do, except managing tokens and webhooks (those need a person who logged in). |
| **Expiry** | Optional (30 days, 90 days, 1 year or never). An expired or revoked token answers `401`. |
| **Storage** | Only a SHA-256 hash is kept. The token is shown once, when created. |

API: `GET /api/api-tokens`, `POST /api/api-tokens` (`{ name, access: READ|WRITE, expiresInDays? }`, returns the token once),
`DELETE /api/api-tokens/:id` (revoke). These work with a login (JWT) only.

## Webhooks

Add them under profile menu → Integrations → **Webhooks** (`/settings/webhooks`). A webhook has an address, the events it wants, and a
project, or all projects. See [Who can set things up](#who-can-set-things-up) below for who may add them.

Two settings apply to every webhook. **Format**: *JSON* (the default, described below), or *Slack* / *Teams*, which send a readable message to a chat
channel instead of the signed event (see [Slack and Teams](CHAT-INTEGRATIONS.md)). **Filter**: an optional JQL query; events about issues that
don't match are not sent (checked as the person who last saved the webhook). In the API these are `format` (`JSON`, `SLACK`, `TEAMS`) and `jql`.

### Events

| Event | When |
|---|---|
| `issue.created` | An issue is created |
| `issue.updated` | Any field is edited, an issue moves to another project (`changes` lists what changed) |
| `issue.assigned` | The assignee changes (sent in addition to `issue.updated`) |
| `issue.transitioned` | The status changes (and the resolution, if it did) |
| `issue.deleted` | An issue is deleted (the payload is what it looked like just before) |
| `comment.created` / `comment.updated` | A comment is added or edited (`comment.internal` marks agent-only notes) |

Events from bulk changes are sent too. Comment deletions and watcher changes are not events yet.

### What is sent

`POST` with a JSON body:

```json
{
  "id": "0b8f…",                       // unique per event
  "event": "issue.transitioned",
  "createdAt": "2026-10-14T12:00:00.000Z",
  "actor": { "id": "…", "name": "Ada Admin", "email": "ada@example.com" },
  "project": { "id": "…", "key": "HELP", "name": "Help desk" },
  "issue": { "key": "HELP-12", "url": "https://…/browse/HELP-12", "summary": "…", "status": "In Progress",
             "priority": "HIGH", "dueDate": "2026-10-30", "assignee": { … }, "reporter": { … }, "labels": [], "components": [] },
  "changes": [{ "field": "status", "from": "Waiting for support", "to": "In Progress" }],
  "comment": { … }                     // comment events only
}
```

Headers: `X-Conductor-Event`, `X-Conductor-Delivery` (unique per attempt series), `X-Conductor-Timestamp` (Unix seconds),
`X-Conductor-Signature` (`sha256=<hex>`).

### Verifying the signature

The signature is an HMAC-SHA256, keyed with the webhook's secret, of `"<timestamp>.<raw request body>"`. Reject requests whose timestamp is
more than a few minutes old.

```js
const crypto = require('crypto');
function verify(rawBody, headers, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret)
    .update(`${headers['x-conductor-timestamp']}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headers['x-conductor-signature']));
}
```

The secret is shown once when the webhook is created. Editing the webhook offers **New secret…** if it is lost or leaked.

### Delivery

- Answer with any `2xx` within 10 seconds. Redirects are not followed.
- A failed delivery is retried after 1 min, 5 min, 30 min, 2 h and 6 h (6 attempts in all). Events can therefore arrive late and, after a
  timeout, more than once: use the payload `id` to ignore repeats.
- A webhook that fails 30 attempts in a row is **switched off** (shown on the page with the last error); edit and save it to switch it back on.
- Each webhook's page shows the last 14 days of deliveries with the payload sent, and can **Send test** or **Resend** an event.
- Retries are made by a timer inside the server. Set `WEBHOOK_WORKER=false` on instances that should not do it.

### Network safety

Conductor refuses webhooks that point at localhost, private networks, link-local addresses (e.g. cloud metadata) and names that resolve to
them, checked again whenever a connection is made. To call servers on your own network, set `WEBHOOK_ALLOW_PRIVATE=true` in `backend/.env`.

API: `GET|POST /api/webhooks`, `GET|PUT|DELETE /api/webhooks/:id`, `GET /api/webhooks/events`, `POST /api/webhooks/:id/rotate-secret`,
`POST /api/webhooks/:id/test`, `GET /api/webhooks/:id/deliveries`, `POST /api/webhooks/:id/deliveries/:deliveryId/redeliver`.
See [Who can set things up](#who-can-set-things-up); these need a login rather than an API token.

## Incoming webhooks

Add them under profile menu → Integrations → **Incoming webhooks** (`/settings/incoming-webhooks`). Each one has a
secret address, shown once when it is created:

```bash
curl -X POST https://conductor.example.com/api/hooks/jth_xxxxxxxx \
     -H "Content-Type: application/json" \
     -d '{"status":"firing","title":"High CPU on web-1","message":"CPU is at 95%","severity":"critical","alerts":[{"fingerprint":"abc123"}]}'
```

The address is the credential: anyone who has it can create issues through that webhook, so keep it out of public places. Use
**New address…** in the webhook's editor if it leaks (the old one stops working at once). Anything wrong with the address answers `404`.
Send a JSON object (not a list); up to 60 requests a minute are accepted for each webhook, then `429`.

### Turning a message into an issue

Templates take values from the JSON that was sent: `{{title}}`, or nested ones like `{{alerts.0.labels.alertname}}` (a number picks an item
from a list). A value that isn't there is left out.

| Setting | |
|---|---|
| **Create issues in** | The project. Issues are created as the person who last saved the webhook (so they need to be able to create issues there). |
| **Summary**, **Description** | Templates, e.g. `[{{severity}}] {{title}}`. The received JSON can be added to the description. |
| **Issue type**, **Priority**, **Assign to**, **Labels** | Fixed values. |
| **Priority from the message** | A template whose result picks the priority: `critical`, `high`, `warning`, `info`, `P1`–`P5`, `sev1`–`sev5`… are recognised; anything else uses the fixed priority. |
| **Same alert when this is equal** | A template that identifies an alert, e.g. `{{alerts.0.fingerprint}}`. While the issue for that alert is open, a message with the same value is added to it as a comment instead of raising another issue. Once it is closed, the next one raises a new issue. |
| **Close the issue when…** | A field and value (e.g. `status` equals `resolved`): such a message closes the open issue for its alert, with a comment. If no issue is open it is ignored. Needs the "same alert" setting. |

**Try a message** pastes a sample payload and shows what would happen (new issue, comment, close, or ignored) without creating anything. The
webhook's name opens its log of the last 14 days, with each payload and what became of it (created, commented, resolved, ignored, failed).

Issues made this way go through the same path as any other, so [automation rules](AUTOMATION.md) and outgoing webhooks react to them.

### Connecting common tools

- **Grafana / Alertmanager:** add a *webhook* contact point with the address. Alertmanager's payload has `status` (firing or resolved) and
  `alerts` (each with `fingerprint` and `labels`); a webhook with summary `{{alerts.0.labels.alertname}}`, same alert
  `{{alerts.0.fingerprint}}` and close when `status` equals `resolved` works well. Grouped alerts arrive as one message, so only the first
  alert in the group is read; use a group-by that makes each alert its own message if you need one issue each.
- **CI (GitHub Actions, Jenkins, GitLab):** a `curl` step on failure, with the pipeline and commit in the JSON.
- **Sentry, Datadog, PagerDuty, Uptime Robot** and similar all have a generic webhook integration: send a sample to **Try a message** and
  write the templates from what you see.

API (see [Who can set things up](#who-can-set-things-up); API tokens cannot manage them): `GET|POST /api/inbound-webhooks`, `PUT|DELETE /api/inbound-webhooks/:id`,
`POST /api/inbound-webhooks/:id/rotate-token`, `POST /api/inbound-webhooks/:id/test` (`{ payload }`), `GET /api/inbound-webhooks/:id/deliveries`.

## Who can set things up

Webhooks, incoming webhooks and [automation rules](AUTOMATION.md) (the **Integrations** section of the profile menu) can be managed by:

| | |
|---|---|
| **Global administrators** | Everything, including webhooks and rules that apply to **every project**. |
| **Project administrators** (the project lead, or a member with the Admin role) | The ones that belong to **their own projects**, and only those. They see a project picker limited to the projects they administer, without "All projects". Webhooks, rules and incoming webhooks of other projects, and global ones, don't exist as far as they can tell (`404`). |

Everyone else doesn't get the section. Some limits apply to project administrators because their changes reach beyond their own project:

- An automation rule's **email** action can send to the assignee, reporter, project lead and anyone who has a Conductor account, but not to addresses outside Conductor
  (a global administrator can).
- A project can have up to 20 webhooks, 50 rules and 20 incoming webhooks (everything that applies to every project has its own, larger limits), so no project can use up the rest.
- A rule or incoming webhook runs as the person who last saved it, so what it can do is what that person can do in the project. If a project administrator edits a rule
  that someone else made, it becomes theirs.
- API tokens still can't manage any of this: it needs a login, as before.

`GET /api/access/admin-scope` tells the signed-in user which projects they may manage (and whether that is all of them).
