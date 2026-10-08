# JiraTech

A Jira-style ALM platform for the SPORTS project — streamlining planning, development, QA, release management, and incident handling.

## Stack

- **Backend:** NestJS + Prisma + PostgreSQL
- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Auth:** JWT (extensible to OIDC)

## Quick Start

```bash
# Install dependencies
npm install

# Set up database (SQLite — no Docker required)
cd backend
npx prisma db push
npm run db:seed
cd ..

# Start dev servers (API :3000, UI :5173)
npm run dev
```

For PostgreSQL (production), start Docker and set `DATABASE_URL` in `backend/.env` to the Postgres connection string, then run `npx prisma db push`.

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

## API

- `POST /api/auth/login` — authenticate
- `GET /api/issues` — list issues (filterable)
- `POST /api/issues` — create issue
- `PATCH /api/issues/:id/transition` — workflow transition
- `GET /api/board` — kanban board data
- `GET /api/planning/pis` — program increments
- `POST /api/scheduling/run` — run scheduling algorithm
- `GET /api/releases/:epicId/candidates` — release candidates
- `POST /api/incidents/:id/escalate` — escalate incident
- `GET /api/dashboard` — monitoring dashboard
