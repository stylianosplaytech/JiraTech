# JiraTech

A Jira-style ALM platform: multiple projects, issues, comments, links, JQL search and saved filters — plus the SPORTS planning, release and incident workflows.

## Stack

- **Backend:** NestJS + Prisma + SQLite (dev)
- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Auth:** JWT (extensible to OIDC)

## Quick Start

```bash
# Install dependencies
npm install

# Set up database (SQLite — no Docker required).
# Re-run "prisma db push" after pulling schema changes.
cd backend
npx prisma db push
npm run db:seed
cd ..

# Start dev servers (API :3000, UI :5173)
npm run dev
```

For PostgreSQL, change `provider` in `backend/prisma/schema.prisma` to `postgresql`, start Docker (`npm run db:up`), set `DATABASE_URL` in `backend/.env` to the Postgres connection string, then run `npx prisma db push`.

Default login: `admin@jiratech.local` / `admin123`

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

## Jira-style features

- **Projects** — create projects with their own key (`WEB-1`, `PAY-12`…), lead, versions and components; switch project from the header. New projects use standard rules; tick *Enforce SPORTS conventions* to get the SPORTS hierarchy and component naming rules.
- **Issues** — open any issue at `/browse/KEY-123`; edit, transition (including *Re-open*), delete, attach/delete files, watch.
- **Comments** — add, edit and delete; `@user@email` mentions add that user as a watcher.
- **Activity history** — every field change, transition, link and attachment is recorded on the History tab.
- **Links** — blocks / is blocked by / depends on / relates to, across projects, with type-ahead issue search; remove from the issue page.
- **Search** — basic filters or JQL, sortable columns, paging, CSV export, saved and shared filters; global quick search in the header (press `/`).

### JQL

```
project = SPORTS AND status != CLOSED ORDER BY priority DESC
assignee = currentUser() AND type IN (Story, Bug)
text ~ "login" AND updated >= -7d
labels IS EMPTY AND (priority = Highest OR priority = High)
```

Fields: project, key, type, status, priority, resolution, assignee, reporter, watcher, labels, component, fixVersion, affectedVersion, sprint, parent, epicName, summary, description, comment, text, created, updated, blocked.
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
- `POST /api/versions`, `PATCH /api/versions/:id`

Project-scoped endpoints (issues list, board, labels, versions, components, custom fields, dashboard, planning) use the `X-Project-Key` header or `?project=KEY`, defaulting to SPORTS.
- `GET /api/board` — kanban board data
- `GET /api/planning/pis` — program increments
- `POST /api/scheduling/run` — run scheduling algorithm
- `GET /api/releases/:epicId/candidates` — release candidates
- `POST /api/incidents/:id/escalate` — escalate incident
- `GET /api/dashboard` — monitoring dashboard
