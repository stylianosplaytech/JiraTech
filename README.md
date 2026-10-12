# JiraTech

A Jira-style ALM platform: multiple projects, issues, comments, links, JQL search and saved filters, a service desk with a customer help center — plus the SPORTS planning, release and incident workflows.

## Stack

- **Backend:** NestJS + Prisma + SQLite (default) or PostgreSQL
- **Frontend:** React + Vite + TypeScript + Tailwind CSS
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
#   DATABASE_URL="postgresql://jiratech:jiratech@localhost:5432/jiratech"

npm run db:push -w backend
npm run db:seed
npm run dev
```

`prisma/schema.prisma` stays the only schema to edit. Always run Prisma through the backend scripts
(`db:push`, `db:generate`, `db:migrate`) or `node scripts/prisma.js <args>` rather than `npx prisma`:
for PostgreSQL they generate `prisma/postgres/schema.prisma` (git-ignored) with the right provider and point Prisma at it.
`npm run dev` and `npm run build` regenerate the Prisma client for the current database first.
After switching databases, run `db:push` (or `db:generate`) once.

Default login: `admin@jiratech.local` / `admin123`

### Demo data

To try every feature with realistic content, load the demo data on top of the base seed:

```bash
npm run db:seed:demo
```

It adds 7 more people, two standard projects — **PAY** (Payments Platform) and **MOB** (Mobile App) — two service desks, and more SPORTS work:
the IT Help Desk (**HELP**, open to every customer) and **Acme Support** (**ACME**, a branded help center only for the *Acme Retail* organization).
The new issues cover every status, priority and type, with epics and child issues, blocked and at-risk items,
comments with @mentions, links (also across projects), watchers, work logs, history and shared saved filters.
It is safe to run more than once. Every demo user logs in with the same password as the admin account, e.g.
`elena@jiratech.local` (team lead), `nikos@jiratech.local` (developer), `sofia@jiratech.local` (QA),
`daniel@jiratech.local` (release manager), `katerina@jiratech.local` (product owner). HELP's agents are Elena (admin), Andreas, Sofia and Lina;
ACME's are Lina (admin), Nikos and Andreas. The customers only see the help center at `/portal`: `anna@customer.local` and
`peter@customer.local` (Acme Retail — they see both help centers and each other's shared requests) and `george@customer.local`
(Globex — he lands straight in the IT Help Desk).

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

- **Projects** — create projects with their own key (`WEB-1`, `PAY-12`…), lead, versions and components; switch project from the header. New projects use standard rules; tick *Enforce SPORTS conventions* to get the SPORTS hierarchy and component naming rules.
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
back to the agents. Admins configure request types (with portal fields), SLA goals, queues and who may use the help center on the project page.

**Several help centers.** Every service desk project is its own help center at `/portal/KEY`, with its own logo, accent colour and
welcome message (project page → *Help center → Look and feel*). A help center is open to every customer, or only to the
**organizations** and customers you list. Organizations group customers by company (People → *Organizations*, managed by global admins);
link them to a service desk on its project page. A customer with a single help center lands straight in it; others choose from a list.
When raising a request, customers can **share it with their organization** (the default) so colleagues can follow it, or keep it private;
the requester can change this later and agents can too. JQL: `organization = "Acme Retail"`.

### Workflows

Each project has its own workflow: statuses (e.g. *In Review*, *QA*) and the allowed moves between them. Every status belongs to a
category — Backlog, To Do, In Progress or Done — which the dashboard, reports and `statusCategory` search use. Moving to a Done status
asks for a resolution. Project administrators edit the workflow on the project page (add, rename, recategorise, reorder and delete
statuses; tick allowed transitions in the matrix). New projects start with Backlog → To Do → In Progress → Closed.

### Rich text

Descriptions and comments use a rich-text editor (bold, italic, lists, quotes, code, links). Type `@` and a name to mention someone —
they're notified and start watching. Content is sanitised on the server and again in the browser.

### Bulk changes

On the Issues page, tick issues (or the header box for the whole page) to edit assignee, priority, labels, components and fix
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
Configure SMTP in `backend/.env`:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false        # true for port 465
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="JiraTech <jira@example.com>"
APP_URL=https://jiratech.example.com   # used for links in emails
```

Without `SMTP_HOST`, emails are written as `.eml` files to `backend/mail-outbox/` so you can open them locally.

### JQL

```
project = SPORTS AND status != CLOSED ORDER BY priority DESC
assignee = currentUser() AND type IN (Story, Bug)
text ~ "login" AND updated >= -7d
labels IS EMPTY AND (priority = Highest OR priority = High)
```

Fields: project, key, type, status (workflow status name), statusCategory, priority, resolution, assignee, reporter, watcher, labels, component, fixVersion, affectedVersion, sprint, parent, epicName, requestType, organization, summary, description, comment, text, created, updated, blocked.
Operators: `= != ~ !~ > >= < <= IN, NOT IN, IS [NOT] EMPTY`, combined with `AND / OR / NOT` and parentheses.
Functions: `currentUser()`, `now()`, `startOfDay()`, `startOfWeek()`, `startOfMonth()`. Dates: `2026-01-31`, `"2026-01-31 14:00"` or relative `-7d`, `-2w`, `-4h`.

## API

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
  `POST|PATCH|DELETE /api/service-desk/:key/queues[/:id]`, `PUT /api/service-desk/:key/sla`, `PATCH /api/service-desk/:key/portal`,
  `GET /api/service-desk/:key/customers`, `PUT|DELETE /api/service-desk/:key/customers/:userId`
- Help center (customers and staff): `GET /api/portal/desks`, `GET /api/portal/desks/:key`, `POST /api/portal/desks/:key/requests`,
  `GET /api/portal/requests?status=open|closed|all&q=`, `GET /api/portal/requests/:key`, `POST /api/portal/requests/:key/comments`
- `GET /api/users?kind=staff|customers|all` (staff by default)
- Organizations: `GET /api/organizations` (staff); global admins: `POST /api/organizations`, `PATCH|DELETE /api/organizations/:id`,
  `PUT|DELETE /api/organizations/:id/members/:userId`
- Help center access and branding: `PATCH /api/service-desk/:key/portal` (`{ portalOpen, welcome, color, logo }`),
  `PUT|DELETE /api/service-desk/:key/organizations/:organizationId`; sharing: `PATCH /api/service-desk/requests/:issue/organization` (agents),
  `POST /api/portal/requests/:key/share` (the requester), `organizationId` / `shareWithOrganization` when raising

Project-scoped endpoints (issues list, board, labels, versions, components, custom fields, dashboard, planning) use the `X-Project-Key` header or `?project=KEY`, defaulting to SPORTS.
- `GET /api/board` — kanban board data
- `GET /api/planning/pis` — program increments
- `POST /api/scheduling/run` — run scheduling algorithm
- `GET /api/releases/:epicId/candidates` — release candidates
- `POST /api/incidents/:id/escalate` — escalate incident
- `GET /api/dashboard` — monitoring dashboard
