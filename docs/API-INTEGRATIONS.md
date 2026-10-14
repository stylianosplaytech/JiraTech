# API tokens and webhooks

Two ways to connect other systems to JiraTech: **API tokens** let a script call JiraTech, and **webhooks** make JiraTech call a
script when something happens.

## API tokens

Create them under your profile menu → **API tokens** (`/settings/api-tokens`). Every staff user can have up to 25. A token acts as its
owner, so it reaches exactly the projects and actions that person can; customers (service desk portal users) can't use tokens.

```bash
curl -H "Authorization: Bearer jt_xxxxxxxx" https://jiratech.example.com/api/issues/HELP-12
curl -X POST -H "Authorization: Bearer jt_xxxxxxxx" -H "Content-Type: application/json" \
     -d '{"jql":"project = HELP AND status != Done"}' https://jiratech.example.com/api/search
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

Global administrators add them under profile menu → Administration → **Webhooks** (`/settings/webhooks`). A webhook has an address, the
events it wants, and optionally a single project (default: all projects).

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
             "priority": "HIGH", "assignee": { … }, "reporter": { … }, "labels": [], "components": [] },
  "changes": [{ "field": "status", "from": "Waiting for support", "to": "In Progress" }],
  "comment": { … }                     // comment events only
}
```

Headers: `X-JiraTech-Event`, `X-JiraTech-Delivery` (unique per attempt series), `X-JiraTech-Timestamp` (Unix seconds),
`X-JiraTech-Signature` (`sha256=<hex>`).

### Verifying the signature

The signature is an HMAC-SHA256, keyed with the webhook's secret, of `"<timestamp>.<raw request body>"`. Reject requests whose timestamp is
more than a few minutes old.

```js
const crypto = require('crypto');
function verify(rawBody, headers, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret)
    .update(`${headers['x-jiratech-timestamp']}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headers['x-jiratech-signature']));
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

JiraTech refuses webhooks that point at localhost, private networks, link-local addresses (e.g. cloud metadata) and names that resolve to
them, checked again whenever a connection is made. To call servers on your own network, set `WEBHOOK_ALLOW_PRIVATE=true` in `backend/.env`.

API: `GET|POST /api/webhooks`, `GET|PUT|DELETE /api/webhooks/:id`, `GET /api/webhooks/events`, `POST /api/webhooks/:id/rotate-secret`,
`POST /api/webhooks/:id/test`, `GET /api/webhooks/:id/deliveries`, `POST /api/webhooks/:id/deliveries/:deliveryId/redeliver`.
Global administrators only, and with a login rather than an API token.
