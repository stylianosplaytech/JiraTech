# Conductor

A Jira-style ALM platform: multiple projects, issues, comments, links, JQL search and saved filters, a service desk with a customer help center — plus the SPORTS planning, release and incident workflows.

## Stack

- **Backend:** NestJS + Prisma+SQLite (default) or PostgreSQL
- **Frontend:** React + Vite + TypeScript +Tailwind CSS
- **Auth:** JWT (extensible to OIDC)

## Quick Start

```bash
# Install dependencies
npm install

# Create your local env file (then set JWT_SECRET)
cp backend/.env.example backend/.env

# Set up database (SQLite — no Docker required).
# Re-run "db:push" after pulling schema changes.
npm run db:push -w backend
npm run db:seed

# Start dev servers (API :3000, UI :5172)
npm run dev
```

### PostgreSQL

The database is picked from `DATABASE_URL` in `backend/.env`: a `file:` URL uses SQLite, a `postgresql://` URL uses PostgreSQL.

```bash
# Start PostgreSQL in Docker (or use your own server)
npm run db:up

# In backend/.env, switch DATABASE_URL to the commented-out PostgreSQL line:
#   DATABASE_URL="postgresql://conductor:conductor@localhost:5432/conductor"

npm run db:push -w backend
npm run db:seed
npm run dev
```

`prisma/schema.prisma` stays the only schema to edit. Always run Prisma through the backend scripts
(`db:push`, `db:generate`, `db:migrate`) or `node scripts/prisma.js <args>` rather than `npx prisma`:
for PostgreSQL they generate `prisma/postgres/schema.prisma` (git-ignored) with the right provider and point Prisma at it.
`npm run dev` and `npm run build` regenerate the Prisma client for the current database first.
After switching databases, run `db:push` (or `db:generate`) once.

Default login: `admin@conductor.local` / `admin123`

### Demo data

To try every feature with realistic content, load the demo data on top of the base seed:

```bash
npm run db:seed:demo
```

It adds 7 more people, two standard projects — **PAY** (Payments Platform) and **MOB** (Mobile App) — two service desks, and more SPORTS work:
the IT Help Desk (**HELP**, one portal open to every customer) and **Client Services** (**CS**), one team serving two client companies
through their own branded portals, **Acme Support** (`/portal/acme`) and **Globex Service Center** (`/portal/globex`).
The new issues cover every status, priority and type, with epics and child issues, blocked and at-risk items,
comments with @mentions, links (also across projects), watchers, work logs, history and shared saved filters.
The desks have demo email addresses (`help@conductor.local`, `support@clientservices.local`) with no mailbox connected: try them with *Send a test email*. It is safe to run more than once. Every demo user logs in with the same password as the admin account, e.g.
`elena@conductor.local` (team lead), `nikos@conductor.local` (developer), `sofia@conductor.local` (QA),
`daniel@conductor.local` (release manager), `katerina@conductor.local` (product owner). HELP's agents are Elena (admin), Andreas, Sofia and Lina;
CS's are Lina (admin), Nikos and Andreas. The customers only see the help center at `/portal`: `anna@customer.local` and
`peter@customer.local` (Acme Retail — they see the Acme portal and each other's shared requests) and `george@customer.local`
(Globex — he sees the Globex portal). Neither company ever sees the other's tickets, although both land in CS.

## Modules

| Phase | Module | Status |
|-------|--------|--------|
| 0 | Scaffold, DB, Auth | Done |
| 1 | Issue types, Workflow, Validation | Done |
| 2 | Boards, Forms, Issue detail | Done |
| 3 | PI Planning, Work breakdown | Done |
| 4 | Scheduling, Baselines | Done |
| 5 | Release management | Done |
| 6 | Incident escalation | Done |
| 7 | Monitoring, RAG, Dashboards | Done |
| 8 | Projects, comments, history, links, JQL search, saved filters | Done |
| 9 | Notifications (in-app and email), @mention picker | Done |
| 10 | Project permissions, rich text, configurable workflows, bulk edit | Done |
| 11 | Service desk: customer help center, request types, queues, SLAs, internal notes | Done |

## Jira-style features

- **Projects** — create projects with their own key (`WEB-1`, `PAY-12`…), lead, versions and components; switch project from the header. New projects use standard rules; tick *Enforce SPORTS conventions* to get the SPORTS hierarchy and component naming rules. *Administration → Import from Jira* (admins only, in the profile menu) creates a project from a Jira "Export CSV (all fields)" file: issues keep their keys, parents, links, statuses and due dates (people, descriptions and comments aren't in the export and aren't imported).
- **Issues** — open any issue at `/browse/KEY-123`; edit, transition (including *Re-open*), delete, attach/delete files, watch.
- **Comments** — add, edit and delete; `@user@email` mentions add that user as a watcher.
- **Activity history** — every field change, transition, link and attachment is recorded on the History tab.
- **Links** — blocks / is blocked by / depends on / relates to, across projects, with type-ahead issue search; remove from the issue page.
- **Search** — basic filters or JQL, sortable columns, paging, CSV export, saved and shared filters; global quick search in the header (press `/`).

### Project permissions

Each project has members with a role, plus **general access** for everyone else:

| Role | Can |
|---|---|
| **Administrator** | everything below, plus project settings, people, versions, components, custom fields, workflow, and deleting any issue |
| **Member** | create, edit, assign, link and transition issues; log work; delete issues they reported |
| **Viewer** | browse, comment and watch |

General access is **Open** (everyone is a member), **Limited** (everyone is a viewer) or **Private** (members only — the project is invisible to others).
Global admins and the project lead always administer a project. Search, quick search, boards, links and notifications only include
what you can see. Manage people on the project page under *People and access*.

### Service desk

Create a project with the **Service desk** type. **Customers** (users with the *Customer* role, created on the People page) use the
**help center** at `/portal` to raise requests, reply and follow them; they can't reach anything else. Agents — the project's members —
work requests from **Queues** (JQL filters sorted by SLA urgency), reply to the customer or add **internal notes** customers never see,
and track two **SLAs** per request: time to first response and time to resolution (goals per priority; the clock pauses in statuses marked
*Pauses SLA*, e.g. *Waiting for customer*, and runs around the clock). A customer replying to a request that's waiting for them sends it
back to the agents. Admins configure portals, request types (with portal fields), SLA goals, queues and the desk's **email address** on the project page: each service desk can have its own address whose emails become requests and whose replies become comments.

**Portals: one team, many client companies.** A service desk project can have several **portals**, e.g. one per client company. Each
has its own link (`/portal/acme`), logo, accent colour, welcome message, request types, and the **organizations** or customers allowed
to use it (or *any customer*). Requests from every portal land in the same project, queues and SLAs, so one team handles them all; agents
see each request's portal and company. Customers only ever see requests they raised, were added to, or that a colleague shared with their
own organization — never another company's. Organizations group customers by company (People → *Organizations*, managed by global admins);
link them to portals on the project page. A customer with a single portal lands straight in it; others choose from a list. When raising
a request, customers can **share it with their organization** (the default) or keep it private; the requester and agents can change this
later. JQL: `portal = acme`, `organization = "Acme Retail"`. **Reports → SLA performance** (service desks only, also in the PDF) shows SLA compliance by clock,
portal, priority and month, and the open requests that are breached or at risk. Service desks from before portals existed were given one portal automatically,
linked by their project key, so old `/portal/KEY` links keep working.

### Workflows

Each project has its own workflow: statuses (e.g. *In Review*, *QA*) and the allowed moves between them. Every status belongs to a
category — Backlog, To Do, In Progress or Done — which the dashboard, reports and `statusCategory` search use. Moving to a Done status
asks for a resolution. Project administrators edit the workflow on the project page (add, rename, recategorise, reorder and delete
statuses; tick allowed transitions in the matrix). New projects start with Backlog → To Do → In Progress → Closed.

### Rich text

Descriptions and comments use a rich-text editor (bold, italic, lists, quotes, code, links). Type `@` and a name to mention someone —
they're notified and start watching. Content is sanitised on the server and again in the browser.

### Bulk changes

On the Issues page, tick issues (or the header box for the whole page) to edit assignee, priority, due date, labels, components and fix
versions, change status, watch or delete them in one go. Every issue is checked individually; anything that can't be changed is listed
afterwards with the reason. Untick *Send notifications* for quiet clean-ups.

### Notifications

The bell in the header shows notifications (refreshed every 30 seconds):

| You get… | When |
|---|---|
| **Assigned** | someone assigns an issue to you |
| **Mentioned** | someone writes `@your-email` in a comment or description (type `@` to pick a person) |
| **Watching** | someone adds you as a watcher |
| **Commented / Status changed / Updated / Deleted** | an issue you reported, are assigned to or watch changes |

You're never notified about your own actions, and each change produces at most one notification per person.
The **Direct** tab shows assignments, mentions and watcher invitations; **Watching** shows everything.
Opening an issue marks its notifications as read.

Each notification is also emailed unless you turn off *Email notifications* in the profile menu.

**Outgoing email** for the whole application — every project's notifications, replies to service desk customers and welcome emails —
is set by a global admin under **profile menu → Email settings** (`/settings/email`), with a *Send test email* button. It sends either
through a **Gmail account** using Google's API over HTTPS (works on hosts that block mail ports, such as Render's free plan) or through an
**SMTP server**, plus the sender name and the web address used for links in emails. Passwords, secrets and tokens are stored encrypted
(`MAIL_SECRET`, or `JWT_SECRET`) and never shown again.

**Sending with Gmail** (one-time setup, about 10 minutes):

1. In [Google Cloud](https://console.cloud.google.com/), signed in as the Gmail account that should send, create a project.
2. **APIs & Services → Library → Gmail API → Enable**.
3. **OAuth consent screen**: app name, your email, audience *External* (or *Internal* for Google Workspace), then **Publish app**
   (*In production*). In *Testing*, Google ends the connection after 7 days.
4. **Credentials → Create credentials → OAuth client ID → Web application**, with the authorized redirect URI
   `https://<your address>/api/mail-settings/google/callback` (one per address you use, e.g. your Render URL and
   `http://localhost:5172`). Email settings shows the exact value with a copy button.
5. In Email settings choose **Gmail account**, paste the Client ID and secret, **Save**, then **Connect Gmail account** and allow
   *Send email on your behalf* (for your own unverified app: *Advanced → Go to Conductor*).

The connection can only send email (scope `gmail.send`); it can't read the mailbox. *Disconnect* revokes it at Google. To keep it through a
database reset, set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` and `GMAIL_USER` (the account's address) instead; a
refresh token for your own OAuth client can be obtained with Google's
[OAuth 2.0 Playground](https://developers.google.com/oauthplayground) (gear icon → *Use your own OAuth credentials*, scope
`https://www.googleapis.com/auth/gmail.send`; add `https://developers.google.com/oauthplayground` as a redirect URI).

With nothing set in Email settings, the `GMAIL_*` variables are used, otherwise the SMTP settings in `backend/.env`:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false        # true for port 465
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="Conductor <jira@example.com>"
APP_URL=https://conductor.example.com   # used for links in emails
```

Without either, emails are written as `.eml` files to `backend/mail-outbox/` so you can open them locally.

**Welcome emails.** When an admin adds a person on the **People** page, they get a welcome email with a link to choose their own password
(valid for 7 days, usable once; customers then land in the help center). People who haven't chosen one yet show as *Invited*, with
*Resend*; *Edit* has *Email them a link to choose a new password* for anyone who forgot theirs. Untick *Send a welcome email* to set a
password for them instead.

**Forgot password?** The login page links to `/forgot-password`: enter your email and, if it has an account, you get a link to choose a
new password (valid for 60 minutes, usable once; at most one email a minute). The page answers the same either way, so it doesn't reveal
which addresses have accounts. The old password keeps working until the new one is saved.

**Incoming email (service desks).** Each service desk can have its own address, read over IMAP: new emails become requests and replies
(subject containing the key, e.g. `(HELP-12)`) become comments. Configure it on the project page under *Service desk → Email*. Optional settings:

```
MAIL_SECRET=...          # encrypts mail passwords saved in the app (defaults to JWT_SECRET)
MAIL_POLL_SECONDS=60     # how often mailboxes are read
MAIL_POLLING=false       # don't read mailboxes on this instance
```

A service desk's mailbox can instead be defined by environment variables named after its project key, so it survives a database reset
(e.g. Render's free database expiring). They're applied at every start; the desk then shows *Environment* and can't be edited in the app
(*Test connection*, *Check now* and *Send a test email* still work). Removing them switches the desk's email off and makes it editable again.
For HELP:

| Variable | Value |
|---|---|
| `EMAIL_HELP_ADDRESS` | the address customers write to (required; turns the rest on) |
| `EMAIL_HELP_IMAP_HOST` | e.g. `imap.gmail.com` |
| `EMAIL_HELP_IMAP_PASSWORD` | the mailbox password (Gmail: an app password) |
| `EMAIL_HELP_IMAP_USER` | default: the address |
| `EMAIL_HELP_IMAP_PORT` | default: `993` |
| `EMAIL_HELP_IMAP_SECURE` | default: `true` (SSL/TLS); `false` for STARTTLS |
| `EMAIL_HELP_IMAP_FOLDER` | default: `INBOX` (or a Gmail label) |
| `EMAIL_HELP_PORTAL` | default portal's link name, e.g. `acme` (default: the first portal) |
| `EMAIL_HELP_REQUEST_TYPE` | request type name, e.g. `Report a bug` (default: the portal's first) |
| `EMAIL_HELP_ACCEPT_ANYONE` | default: `true` |
| `EMAIL_HELP_ENABLED` | default: `true` once the server and password are set |

### JQL

```
project = SPORTS AND status != CLOSED ORDER BY priority DESC
assignee = currentUser() AND type IN (Story, Bug)
text ~ "login" AND updated >= -7d
labels IS EMPTY AND (priority = Highest OR priority = High)
```

Fields: project, key, type, status (workflow status name), statusCategory, priority, resolution, assignee, reporter, watcher, labels, component, fixVersion, affectedVersion, sprint, parent, epicName, requestType, organization, portal, summary, description, comment, text, created, updated, due, blocked. Due dates compare by day: `due < now()` finds overdue issues, `due <= 7d` those due within a week, `due is EMPTY` those without one.
Operators: `= != ~ !~ > >= < <= IN, NOT IN, IS [NOT] EMPTY`, combined with `AND / OR / NOT` and parentheses.
Functions: `currentUser()`, `now()`, `startOfDay()`, `startOfWeek()`, `startOfMonth()`. Dates: `2026-01-31`, `"2026-01-31 14:00"` or relative `-7d`, `-2w`, `-4h`.

## API

The full reference is served at `/api/docs` (Swagger UI) and `/api/openapi.json` (OpenAPI 3). Scripts authenticate with an **API token** (`Authorization: Bearer jt_…`, created under your profile menu), and Conductor can call out to other systems with signed **webhooks**, and monitoring or CI tools can raise issues through **incoming webhooks**: see [docs/API-INTEGRATIONS.md](docs/API-INTEGRATIONS.md). Issue events and automation rules can post to **Slack** and **Microsoft Teams** channels: see [docs/CHAT-INTEGRATIONS.md](docs/CHAT-INTEGRATIONS.md). Rules that react to issue events (assign, comment, transition, email…) are described in [docs/AUTOMATION.md](docs/AUTOMATION.md).

- `POST /api/auth/login` — authenticate
- `GET /api/issues` — list issues (filterable)
- `POST /api/issues` — create issue
- `POST /api/issues/:id/transition` — workflow transition
- `GET|PATCH|DELETE /api/issues/:idOrKey` — view (by id or key), update, delete
- `GET|POST /api/issues/:id/comments`, `PATCH|DELETE /api/issues/:id/comments/:commentId`
- `GET /api/issues/:id/history` — activity log
- `POST /api/issues/:id/links` (`targetId` or `targetKey`), `DELETE /api/issues/:id/links/:linkId`
- `GET|POST /api/projects`, `GET|PATCH /api/projects/:key`
- `POST /api/search` (`{ jql, startAt, maxResults }`), `GET /api/search/quick?q=`
- `GET|POST /api/filters`, `PATCH|DELETE /api/filters/:id`
- `GET /api/notifications?scope=all|direct&unread=true`, `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read|unread`, `POST /api/notifications/read-all`, `GET|PATCH /api/notifications/preferences`
- `POST /api/versions`, `PATCH /api/versions/:id`
- `GET /api/projects/:key/members`, `PUT|DELETE /api/projects/:key/members/:userId`
- `GET /api/projects/:key/workflow`, `POST|PATCH|DELETE /api/projects/:key/workflow/statuses[/:id]`, `PUT /api/projects/:key/workflow/order`, `PUT /api/projects/:key/workflow/transitions`
- `GET /api/issues/:id/transitions`, `POST /api/issues/:id/transition` (`{ statusId, resolution }`)
- `POST /api/issues/bulk` (`{ issueIds, action: edit|transition|watch|delete, … }`)
- `POST /api/issues/:id/comments` takes `{ body, internal }`; `internal: true` is an agent-only note in service desk projects
- Service desk (agents): `GET /api/service-desk/:key` (settings), `GET /api/service-desk/:key/queues`, `GET /api/service-desk/:key/queues/:id/issues`,
  `GET /api/service-desk/requests/:issue` (request type and SLAs); admins: `POST|PATCH|DELETE /api/service-desk/:key/request-types[/:id]`,
  `POST|PATCH|DELETE /api/service-desk/:key/queues[/:id]`, `PUT /api/service-desk/:key/sla`
- Portals (project admins change them): `GET|POST /api/service-desk/:key/portals`, `PATCH|DELETE /api/service-desk/:key/portals/:id`
  (`{ name, slug, open, welcome, color, logo, requestTypeIds }`), `PUT|DELETE /api/service-desk/:key/portals/:id/organizations/:organizationId`,
  `PUT|DELETE /api/service-desk/:key/portals/:id/customers/:userId`
- Help center (customers and staff): `GET /api/portal/portals`, `GET /api/portal/portals/:slug`, `POST /api/portal/portals/:slug/requests`,
  `GET /api/portal/requests?status=open|closed|all&q=`, `GET /api/portal/requests/:key`, `POST /api/portal/requests/:key/comments`
- `GET /api/users?kind=staff|customers|all` (staff by default)
- Organizations: `GET /api/organizations` (staff); global admins: `POST /api/organizations`, `PATCH|DELETE /api/organizations/:id`,
  `PUT|DELETE /api/organizations/:id/members/:userId`
- Sharing: `PATCH /api/service-desk/requests/:issue/organization` (agents),
  `POST /api/portal/requests/:key/share` (the requester), `organizationId` / `shareWithOrganization` when raising

Project-scoped endpoints (issues list, board, labels, versions, components, custom fields, dashboard, planning) use the `X-Project-Key` header or `?project=KEY`, defaulting to SPORTS.
- `GET /api/board` — kanban board data
- `GET /api/planning/pis` — program increments
- `POST /api/scheduling/run` — run scheduling algorithm
- `GET /api/releases/:epicId/candidates` — release candidates
- `POST /api/incidents/:id/escalate` — escalate incident
- `GET /api/dashboard` — project overview (plan progress, RAG)
- `GET|POST /api/dashboards`, `GET|PATCH|DELETE /api/dashboards/:id` — dashboards people build from their saved filters (private or shared); `POST /api/dashboards/:id/duplicate` saves a copy
- `POST /api/dashboards/:id/gadgets`, `PATCH|DELETE .../gadgets/:gadgetId`, `PUT .../gadgets/order`, `GET .../gadgets/:gadgetId/data` — issue list, count, breakdown, stacked breakdown, progress, resolution-time, stale-issue, due-date, issue-age, backlog-trend, recently-updated and trend gadgets, each tied to a saved filter and run as the viewer
