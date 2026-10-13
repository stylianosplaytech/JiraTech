# JiraTech — Application Guide

JiraTech is a Jira-style application lifecycle management (ALM) platform. Teams use it to track work in projects (stories, tasks, defects, epics), move that work through configurable workflows, search it with JQL, plan it into program increments, and report on it.

On top of the standard Jira-style features, JiraTech supports the **SPORTS conventions**: a strict issue hierarchy, SPORTS-specific issue types (Feature/BAU/Release epics, release candidates, code/test/deployment sub-tasks), team and service component naming rules, RAG status, incident escalation and PI scheduling.

> Screenshots in this guide were taken from a local instance loaded with the demo data (`npm run db:seed:demo`), logged in as `admin@jiratech.local`.

---

## Contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Core concepts](#2-core-concepts)
3. [Signing in](#3-signing-in)
4. [The global header](#4-the-global-header)
5. [Board](#5-board)
6. [Creating issues](#6-creating-issues)
7. [Issues: search, JQL, filters and bulk changes](#7-issues-search-jql-filters-and-bulk-changes)
8. [Issue detail](#8-issue-detail)
9. [SPORTS features on an issue: RAG, custom fields, incidents, releases](#9-sports-features-on-an-issue)
10. [Projects](#10-projects)
11. [Project settings: versions, components, workflow, people](#11-project-settings)
12. [Planning (program increments)](#12-planning-program-increments)
13. [Dashboard](#13-dashboard)
14. [Reports](#14-reports)
15. [People](#15-people)
16. [Notifications and email](#16-notifications-and-email)
17. [Permissions reference](#17-permissions-reference)
18. [JQL reference](#18-jql-reference)
19. [Capabilities available through the API only](#19-capabilities-available-through-the-api-only)
20. [Screen index](#20-screen-index)
21. [Service desk and help center](#21-service-desk-and-help-center)

---

## 1. Architecture at a glance

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS, TanStack Query | Single-page app on port **5172** |
| Backend | NestJS (REST API under `/api`) | Port **3000** |
| Database | Prisma ORM with **SQLite** (default) or **PostgreSQL** | Chosen by `DATABASE_URL` in `backend/.env` |
| Auth | JWT (bearer token, 7-day expiry by default) | Token stored in the browser |
| Email | SMTP, or `.eml` files in `backend/mail-outbox/` when no SMTP host is set; service desk mailboxes read over IMAP | |
| PDF | jsPDF, generated in the browser | Used by Reports |

Each backend module maps to a feature area: `auth`, `projects`, `issues` (incl. bulk), `workflow`, `search` (JQL), `board`, `comments/history/links` (in issues), `notifications`, `versions`, `components`, `labels`, `custom-fields`, `planning`, `scheduling`, `releases`, `incidents`, `dashboard`, `reports`, `users`, `access` (project permissions), `service-desk` (request types, queues, SLAs and the customer portal).

Project-scoped requests carry the current project in the `X-Project-Key` header, so every screen works on the project selected in the header.

---

## 2. Core concepts

**Project** — a container for issues, with a unique key (`PAY`, `MOB`, `SPORTS`). Issues are numbered `KEY-1`, `KEY-2`, … Every project has its own versions, components, custom fields, workflow and members.

**Project types**
- *Standard* — free hierarchy and free component naming.
- *Service desk* — customers raise requests in a help center; agents work queues with SLAs. See [section 21](#21-service-desk-and-help-center).
- *SPORTS conventions* — ticked at creation ("Enforce SPORTS conventions"). Stories, tasks and defects must sit under an epic, and components must follow the naming rules (team components start with `@`, service / release-train components use `ASSETID (serviceName)`).

**Issue types and hierarchy**

| Level | Types |
|---|---|
| Epics (top level) | Epic, Feature Epic, BAU Epic, Release Epic |
| Level 2 | Story, Defect, Task, Release Candidate |
| Sub-tasks | Analysis, Bug Fix, Code, Code Review, Arch Review, Code Merge, Documentation, Test Case, Test Run, Deployment, Configuration, Sub-task |

Parent rules are enforced by the server — for example, a *Release Candidate* can only sit under a *Release Epic*, *Code* only under a *Story*, and a *Defect* can sit under an epic or a story. A child issue is always created in its parent's project.

**Statuses and categories** — each project's workflow has its own statuses (e.g. *In Review*, *QA*), and every status belongs to one of four categories: **Backlog, To Do, In Progress, Done**. Dashboards, reports and the `statusCategory` JQL field use the category. New projects start with Backlog → To Do → In Progress → Closed.

**Resolution** — moving an issue into a Done status requires a resolution (*Done* or *Won't do*). Re-opening clears it.

**Priority** — Highest, High, Medium, Low, Lowest. For defects, the SPORTS rules derive priority from a severity × impact matrix.

---

## 3. Signing in

![Login](screenshots/01-login.png)

Sign in with email and password. A successful login stores a JWT in the browser; signing out (account menu) clears it. Accounts are created by an administrator on the **People** page — there is no self-registration. New people get a welcome email with a link to choose their own password (section 15).

**Forgot password?** (next to the password field) opens `/forgot-password`. Enter your email and, if it has an account, you get a
*Reset your JiraTech password* email with a link to choose a new one on the same page as welcome links:

- The link works for **60 minutes** and **once**; asking again within a minute sends nothing more. A new link cancels the previous one.
- The page always answers *Check your email*, whether or not the address has an account, so it can't be used to find out who has one.
- Your old password keeps working until you save the new one; saving logs you in.
- An expired or used link offers *Get a new link*.

Default administrator: `admin@jiratech.local` / `admin123`. Demo users (after `db:seed:demo`) share the same password, e.g. `elena@` (team lead), `nikos@` (developer), `sofia@` (QA), `daniel@` (release manager), `katerina@` (product owner).

---

## 4. The global header

Every page shares one header with:

| Element | What it does |
|---|---|
| **Logo** | Back to the board |
| **Project switcher** | Shows the current project; switches project, links to all projects or *Create project* |
| **Navigation** | Board · Issues · Projects · Planning · Dashboards · Reports · People |
| **Create** | Opens the Create issue dialog |
| **Search** | Quick search across issues and projects (press `/` from anywhere) |
| **Bell** | Notifications, with an unread badge (refreshes every 30 s) |
| **Avatar** | Account menu: name and role, *Email notifications* switch, *Log out* |

**Project switcher**

![Project switcher](screenshots/06-project-switcher.png)

**Quick search** — type a key or words; matching issues appear as you type, and *Search all issues for "…"* opens the full Issues page with that text.

![Quick search](screenshots/03-quick-search.png)

**Account menu** — turn email notifications on or off (in-app notifications are always on).

![Account menu](screenshots/05-account-menu.png)

---

## 5. Board

The home page is the Kanban board of the current project.

![Board — PAY project](screenshots/02-board.png)

- One column per workflow status, with a count in each header.
- Each card shows summary, components, issue type icon, key, priority icon, assignee avatar, and a **BLOCKED** flag or RAG dot when set. Closed issues have their key struck through.
- **Drag a card to another column** to change its status. Only moves allowed by the workflow are accepted; dropping into a Done column asks for a resolution first.
- **Search this board** filters cards by text; **Only my issues** shows issues assigned to you.
- **View all issues** opens the Issues page for the project.

The SPORTS board looks the same, but with the SPORTS issue types and @team components:

![Board — SPORTS project](screenshots/19-board-sports.png)

---

## 6. Creating issues

Click **Create** in the header (or *Add child issue* / *Create sub-task* from an issue).

![Create issue](screenshots/07-create-issue.png)

| Field | Notes |
|---|---|
| Project \* | Only projects where you are a Member or Administrator |
| Issue type \* | All types; the list of valid parents depends on the type |
| Summary \* | |
| Epic name | Shown for epic types |
| Description | Rich text: bold, italic, strikethrough, inline code, heading, lists, quote, code block, link, `@` mention |
| Parent | Type-ahead search for an epic or story. Required in SPORTS-convention projects for level-2 types |
| Assignee, Priority | Priority defaults to Medium |
| Labels | Pick existing labels or create new ones inline |
| Original estimate (hours) | Used by time tracking and the PI scheduler |
| Components, Fix versions | From the project's settings |
| Create another | Keeps the dialog open for the next issue |

Mentioning someone with `@` in the description notifies them and adds them as a watcher.

---

## 7. Issues: search, JQL, filters and bulk changes

The **Issues** page is the search hub.

### Basic search

![Issues — basic search](screenshots/08-search-basic.png)

Filter by text, project, type, status, assignee and other dropdowns. The left sidebar holds:
- **Filters** — built-in: My open issues, Reported by me, All issues, Open issues, Done issues, Updated recently.
- **Saved filters** — your own (starred).
- **Shared with you** — filters other people have shared.

### JQL search

Click **Switch to JQL** to write queries directly. The help line under the box lists fields, operators, functions and date formats.

![Issues — JQL search](screenshots/09-search-jql.png)

- Click column headers to sort; results are paged.
- **Save as** stores the query as a saved filter, optionally shared.
- **Export** downloads the results as CSV.
- Search results only include issues you're allowed to see.

### Bulk changes

Tick issues (or the header checkbox for the whole page) to get the bulk toolbar.

![Bulk change toolbar](screenshots/10-bulk-change.png)

| Action | What it does |
|---|---|
| **Edit** | Set assignee, priority, labels, components or fix versions |
| **Change status** | Move to a status (asks for a resolution when moving to Done) |
| **Watch** | Start watching all selected issues |
| **Move** | Move the selected issues to another project (see *Moving an issue to another project* below); statuses are matched automatically |
| **Delete** | Delete the selected issues |

Every issue is checked individually against permissions and the workflow; anything that can't be changed is listed afterwards with the reason. Untick *Send notifications* for quiet clean-ups.

---

## 8. Issue detail

Open any issue at `/browse/KEY-123` (from the board, search, a link or a notification).

![Issue detail](screenshots/11-issue-detail.png)

**Header** — breadcrumbs (project / epic / issue), watch button with watcher count, copy link, and a **•••** menu (Log time, Create sub-task, Link issue, Move to another project, Copy link, Delete).

**Main column**
- **Attach / Add child issue / Link issue** quick actions. Attachments can be downloaded and deleted.
- **Description** — rich text, edited in place.
- **Child issues** — list with statuses and a progress bar (% of children done).
- **Linked issues** — grouped by link type: *blocks / is blocked by / depends on / relates to*. Links can cross projects; add with type-ahead search, remove from the list.
- **Activity** — three tabs:
  - **Comments** — add, edit and delete; supports rich text and `@mentions`.
  - **History** — every field change, transition, link and attachment, with old → new values.
  - **Work log** — time logged by each person with a note.

![Issue history tab](screenshots/12-issue-history.png)

![Issue work log tab](screenshots/13-issue-worklog.png)

**Side panel**
- **Status button** — shows the current status; the dropdown lists only transitions the workflow allows (including *Re-open* from Done). Moving to Done asks for a resolution.
- **Details** — Assignee, Reporter, Priority, Labels, Components, Fix / Affects versions, Epic, Estimate, **Time tracking** (logged vs. remaining bar), **Blocked** flag, plus the project's **custom fields**. All fields edit in place.
- **Watchers** — list, *Watch / Stop watching*, *Add watcher*.
- Created / updated timestamps.

Opening an issue marks its notifications as read. Deleting an issue removes its comments, history, links, work logs and attachments; issues with children must have them moved or deleted first.

### Moving an issue to another project

**••• → Move to another project** (needs member access in both projects) moves the issue, with all its sub-tasks, as Jira does:

- Each issue gets the next key of the target project. **The old key keeps working**: `/browse/OLD-12`, search (`key = OLD-12`), the help center and email replies quoting it all find the issue.
- You choose its **status** in the target workflow (preset to the status of the same name, else the first one of the same category); sub-tasks are matched the same way. Moving into Done keeps the resolution (or sets *Done*).
- You can pick a **parent** in the target project; projects with strict hierarchy require one for everything except epics. The old parent stays behind.
- **Components, versions and custom fields** carry over when the target has one of the same name (key, for custom fields); **labels** are created there if missing. Sprint and program increment are cleared. The dialog lists everything that would be cleared before you confirm.
- Service desks: the request type is matched by name (or by issue type), and the organization is kept when the target serves it.
- Comments, attachments, work logs, links, watchers and history move with the issue; the history records the old and new project and key.

---

## 9. SPORTS features on an issue

In the SPORTS project, issues carry extra fields and actions.

![SPORTS defect with incident handling](screenshots/14-issue-incident.png)

**RAG status** — Green / Amber / Red selector. Amber and red issues appear under *At risk or delayed* on the dashboard.

**SPORTS custom fields** — Priority Justification (YBET / Critical / Standard), [pts] Customer, Customer Account, [pts] Target Version/s, Progress Status, Reopen Count (maintained automatically), CACHED Inherited Account. Projects can define their own custom fields (text, number, select, version).

**Incident handling** (Defects and Tasks) — the *Incident handling* section offers:

| Action | Effect |
|---|---|
| **Escalate to @TEAM** | Adds that team component to the issue |
| **De-escalate** | Removes a team component (API) |
| **Refuse** | The current team hands the issue back (removes its component) |
| **Reject** | Closes the issue with resolution *Rejected* |
| **Re-open** | Moves it back to In Progress and increments *Reopen Count* |

Every action is logged as an escalation event, and the latest ones appear under *Recent escalations* on the dashboard.

**Release epics** — a Release Epic groups the release candidates (RC builds), regression test runs and deployments for one release:

![SPORTS release epic](screenshots/15-issue-release-epic.png)

---

## 10. Projects

![Projects](screenshots/16-projects.png)

Lists every project you can see, with key, type (Standard / SPORTS conventions), general access (Open / Limited / Private), your role, lead and issue count. **Switch to** makes a project current; the current one is marked **CURRENT**. Search narrows the list.

**Create project** (only people with the global role Admin, Project Manager, Program Manager or Product Manager):

![Create project](screenshots/17-create-project.png)

Name, Key (2–10 letters/digits, starting with a letter; can't be changed later), Description, Project lead, and the *Enforce SPORTS conventions* checkbox.

---

## 11. Project settings

Click a project name to open its page. Administrators see edit controls; everyone else sees a read-only view.

![Project page](screenshots/18-project-page.png)

| Section | Contents |
|---|---|
| **Header** | Name, key, description; *View issues*, *Board*, *Edit details* (name, description, lead) |
| **Status overview** | Bar and counts per status category; each count links to a filtered search |
| **Versions** | Name, released / unreleased, release date; *Release* / *Unrelease*; add a version |
| **Components** | Name, type (Service, Team, Release train), lead; add a component (SPORTS naming rules apply in SPORTS projects) |
| **Workflow** | Statuses in order with category, allowed next statuses and issue count. Add, rename, recategorise, reorder and delete statuses. The **Allowed transitions** matrix sets which moves are permitted (*Allow all* for a free workflow) |
| **People and access** | General access level, members with their project role, add/remove people |
| **Details** (side) | Key, lead, issue count, rules, access, your role, created date |
| **Quick filters** (side) | My open issues, Reported by me, Unassigned, Updated in the last 7 days |

---

## 12. Planning (program increments)

![Planning](screenshots/20-planning.png)

- **PI cards** — each program increment with status (Planning / Active / Completed), date range, issue and sprint counts. Click to select.
- **Sprints** in the selected PI.
- **Issues in the PI** — type, key, summary, status, estimate and scheduled dates.
- **Run scheduler** — orders the PI's issues by priority and type, respects *depends on* links (an issue starts after what it depends on), and fits them into team capacity (by component; 40 h default per team; missing estimates count as 8 h). It writes scheduled start/end dates and shows a summary: *Scheduled*, *Unscheduled*, and *Constraint violations* (e.g. "insufficient capacity for team @DB").

> Running the scheduler updates the scheduled dates on the PI's issues.

---

## 13. Dashboard

Plan-progress dashboard for the current project.

![Dashboard](screenshots/21-dashboard.png)

- **Totals** — total issues, in progress, closed, completion %.
- **Issues by status** and **RAG status** bar charts.
- **Blocked** — issues flagged as blocked, with assignee.
- **At risk or delayed** — amber and red issues.
- **Recent escalations** — latest incident actions (shown when there are any).

---

## 14. Reports

Four management reports for the current project over a chosen period (From / To dates, or *Last 3 / 6 / 12 months*), plus an **SLA performance** report for service desk projects. **Download PDF** produces an A4 PDF with all of them, each starting on a new page.

**Status dashboard** — Monthly Project Status Report: project, report date, overall status, % complete; donuts for issue status, type and priority; pending items by type; closed by last assignee; closed per month (stories, bugs, tasks) over 12 months.

![Reports — status dashboard](screenshots/22-reports-status.png)

**Issue timeline** — the 10 longest-open bugs, stories and epics, drawn as bars from creation date to today, coloured by status category.

![Reports — issue timeline](screenshots/23-reports-timeline.png)

**Priority analysis** — open issues by priority, plus the full list of open Highest and High issues.

![Reports — priority analysis](screenshots/24-reports-priority.png)

**Open issues** — every open issue in the period with key, summary, type, status, priority, assignee and age.

![Reports — open issues](screenshots/25-reports-open.png)

**SLA performance** (service desk projects only) — for requests raised in the period: requests, % meeting the first-response and
resolution goals, and open requests already breached; a donut per clock (met, missed, breached while open, at risk, on track, paused) with
the average time once each clock stopped; compliance by portal and by priority (goal vs. average time, % met — green from 90%, amber from
70%, red below); the resolution SLA met vs. missed per month over 12 months (by resolution date); and a table of open requests that are
breached or have under a quarter of their goal left, most urgent first. "% met" counts met against missed or already breached; clocks
still running don't count yet.

---

## 15. People

![People](screenshots/26-people.png)

Everyone who can sign in and be an assignee, reporter or watcher. Search by name or email. Administrators can **Add person** (full name, email, role) and **Edit** people (including resetting the password).

**Welcome emails.** *Add person* sends the new person a **welcome email** (on by default) with a link to choose their own password:

- The link opens **Choose your password** (`/set-password`), which greets them by name. Passwords need at least 8 characters. Saving logs
  them straight in: staff land on the board, customers in the help center.
- A link works for **7 days** and **once**; sending a new one cancels the previous one. An expired or used link says so and offers
  *Get a new link* (the *Forgot password?* page, section 3).
- Until they choose a password nobody can log in as them, and the list shows them as **Invited** with **Resend** (a new link).
- **Edit → Email them a link to choose a new password** sends the same kind of link to anyone, e.g. someone who forgot their password.
  People can also do this themselves with *Forgot password?* on the login page.
- Untick *Send a welcome email* to type a password for them instead (at least 6 characters).
- The email goes out through the **Email settings** (section 16). If it can't be sent, the person is still added and you're told to check
  the settings and use *Resend*.

Global roles: Admin, Developer, Merge Master, Product Manager, Product Owner, Program Manager, Project Manager, QA Specialist, Release Manager, Scrum Master, Team Lead. **Admin** administers every project and manages people; **Project / Program / Product Manager** can also create projects; the other roles describe the person's job. What someone can do inside a project is set by their **project role** (see section 17).

The page has three tabs: **People**, **Organizations** (customer companies, section 21) and **Recipients**.

**Recipient groups (Recipients tab).** A recipient group gathers people, whole organizations and other email addresses (people without an
account, e.g. a supplier) under one name, such as *All retail customers*. Global admins create, edit and delete them; everyone on staff can
see them. In the email window of a service desk request (section 21), typing in **To, Cc or Bcc** searches people, organizations and
recipient groups together. A group or organization becomes one chip, e.g. *All retail customers (12)*, and the email goes to everyone in it
at the moment it is sent (an organization's current members). On the request the email reads *To: All retail customers (12)*; *Details*
lists everyone. People reached through a group or organization don't become participants of the request; people added one by one still do.

---

## 16. Notifications and email

![Notifications](screenshots/04-notifications.png)

| You get… | When |
|---|---|
| **Assigned** | Someone assigns an issue to you |
| **Mentioned** | Someone `@mentions` you in a comment or description |
| **Watching** | Someone adds you as a watcher |
| **Commented / Status changed / Updated / Deleted** | An issue you reported, are assigned to or watch changes |

- **Direct** tab: assignments, mentions, watcher invitations. **Watching** tab: everything.
- *Only show unread*, *Mark all as read*, and per-item read/unread.
- You're never notified about your own actions; each change produces at most one notification per person.
- Each notification is also emailed unless you switch off *Email notifications* in the account menu.

### Email settings (global admins)

All outgoing email — notifications of every project, replies to service desk customers and welcome emails — is sent one way, set under
**profile menu → Administration → Email settings** (`/settings/email`). **Send with** chooses how:

- **Gmail account**: sent through Google's Gmail API over HTTPS (port 443), so it works where outgoing mail ports are blocked, such as on
  Render's free plan or many company networks. Enter the **Client ID** and **Client secret** of a Google Cloud OAuth client, **Save**, then
  **Connect Gmail account**: Google asks you to choose the account and allow *Send email on your behalf*, then brings you back. Emails are
  sent from that account (Gmail always uses its address); the **Sender** name still applies. JiraTech can only send through it, not read
  it. **Disconnect** stops using it and revokes the access at Google; changing the Client ID disconnects it too. If Google stops accepting
  the connection (revoked, password changed, or the app left in *Testing*), *Send test email* says so: connect again.
  One-time setup in Google Cloud (the page shows these steps and the exact redirect URI to copy):

  1. In [Google Cloud](https://console.cloud.google.com/), signed in as the Gmail account that should send, create a project.
  2. **APIs & Services → Library → Gmail API → Enable**.
  3. **OAuth consent screen**: app name, your email, audience *External* (or *Internal* for Google Workspace), then **Publish app**
     (*In production*). In *Testing*, Google ends the connection after 7 days.
  4. **Credentials → Create credentials → OAuth client ID → Web application**, with the authorized redirect URI
     `https://<your address>/api/mail-settings/google/callback` (one per address you use, e.g. your Render URL and
     `http://localhost:5172`). Email settings shows the exact value with a copy button.
  5. In Email settings choose **Gmail account**, paste the Client ID and secret, **Save**, then **Connect Gmail account** and allow
     *Send email on your behalf* (for your own unverified app: *Advanced → Go to JiraTech*).
- **Mail server (SMTP)**: server, port, security (STARTTLS, usually port 587, or SSL/TLS, port 465), user name and password. The password
  is stored encrypted (key: `MAIL_SECRET`, or `JWT_SECRET`) and never shown again; leave the field empty to keep it.
- **Sender**: the name and address emails come from. Most servers only accept an address they own.
- **Link to JiraTech**: the web address links in emails use (otherwise `APP_URL`, otherwise `http://localhost:5172`).
- **Send a test email** sends one with the saved settings and shows the mail server's reason if it fails (wrong password, wrong port…).

The banner at the top says what is in use. With nothing set there, a Gmail account in the `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
`GMAIL_REFRESH_TOKEN` and `GMAIL_USER` environment variables is used (survives a database reset; see the README for getting the token),
then the `SMTP_*` settings in `backend/.env`; with none of them,
emails are written as `.eml` files to `backend/mail-outbox/` (local development). Each service desk's own *incoming* address is set
separately on its project page (section 21).

---

## 17. Permissions reference

Each project has **members** with a role, plus **general access** for everyone else.

| Project role | Can |
|---|---|
| **Administrator** | Everything below, plus project settings, people, versions, components, custom fields, workflow, and deleting any issue |
| **Member** | Create, edit, assign, link and transition issues; log work; delete issues they reported |
| **Viewer** | Browse, comment and watch |

| General access | Everyone who isn't a member… |
|---|---|
| **Open** | is a Member |
| **Limited** | is a Viewer |
| **Private** | can't see the project at all |

Global admins and the project lead always administer a project. Search, quick search, boards, links and notifications only include what you can see.

**Customers** (the *Customer* user role) have no project role at all: they only use the help center, where they see the requests they raised or that were shared with them. See [section 21](#21-service-desk-and-help-center).

---

## 18. JQL reference

```
project = SPORTS AND status != CLOSED ORDER BY priority DESC
assignee = currentUser() AND type IN (Story, Bug)
text ~ "login" AND updated >= -7d
labels IS EMPTY AND (priority = Highest OR priority = High)
```

| | |
|---|---|
| **Fields** | project, key, type, status, statusCategory, priority, resolution, assignee, reporter, watcher, labels, component, fixVersion, affectedVersion, sprint, parent, epicName, summary, description, comment, text, created, updated, blocked |
| **Operators** | `=  !=  ~  !~  >  >=  <  <=  IN  NOT IN  IS [NOT] EMPTY`, combined with `AND / OR / NOT` and parentheses |
| **Functions** | `currentUser()`, `now()`, `startOfDay()`, `startOfWeek()`, `startOfMonth()` |
| **Dates** | `2026-01-31`, `"2026-01-31 14:00"`, or relative `-7d`, `-2w`, `-4h` |
| **Sorting** | `ORDER BY field ASC|DESC` |

---

## 19. Capabilities available through the API only

These backend features exist but have no screen yet; they can be called through the REST API:

| Feature | Endpoint |
|---|---|
| List release candidates of a Release Epic | `GET /api/releases/:epicId/candidates` |
| Create a release candidate | `POST /api/releases/:epicId/candidates` |
| Sign off the Golden Master (closes the RC and copies its fix versions to the Release Epic) | `POST /api/releases/candidates/:id/sign-off` |
| Generate release notes (delivered features and bug fixes for the epic's fix versions) | `GET /api/releases/:epicId/notes` |
| De-escalate / Refuse an incident | `POST /api/incidents/:id/escalate` with `action` |

The full endpoint list is in the project [README](../README.md#api).

---

## 20. Screen index

| # | Screen | Route | Screenshot |
|---|---|---|---|
| 1 | Login | `/login` | [01-login](screenshots/01-login.png) |
| 2 | Board | `/` | [02-board](screenshots/02-board.png), [19-board-sports](screenshots/19-board-sports.png) |
| 3 | Quick search | header | [03-quick-search](screenshots/03-quick-search.png) |
| 4 | Notifications | header | [04-notifications](screenshots/04-notifications.png) |
| 5 | Account menu | header | [05-account-menu](screenshots/05-account-menu.png) |
| 6 | Project switcher | header | [06-project-switcher](screenshots/06-project-switcher.png) |
| 7 | Create issue | dialog, `/issues/new` | [07-create-issue](screenshots/07-create-issue.png) |
| 8 | Issues — basic | `/search` | [08-search-basic](screenshots/08-search-basic.png) |
| 9 | Issues — JQL | `/search?jql=…` | [09-search-jql](screenshots/09-search-jql.png) |
| 10 | Bulk change | `/search` | [10-bulk-change](screenshots/10-bulk-change.png) |
| 11 | Issue detail | `/browse/:key` | [11-issue-detail](screenshots/11-issue-detail.png), [12-issue-history](screenshots/12-issue-history.png), [13-issue-worklog](screenshots/13-issue-worklog.png) |
| 12 | SPORTS issue | `/browse/:key` | [14-issue-incident](screenshots/14-issue-incident.png), [15-issue-release-epic](screenshots/15-issue-release-epic.png) |
| 13 | Projects | `/projects` | [16-projects](screenshots/16-projects.png), [17-create-project](screenshots/17-create-project.png) |
| 14 | Project page | `/projects/:key` | [18-project-page](screenshots/18-project-page.png) |
| 15 | Planning | `/planning` | [20-planning](screenshots/20-planning.png) |
| 16 | Dashboard | `/dashboard` | [21-dashboard](screenshots/21-dashboard.png) |
| 17 | Reports | `/reports` | [22](screenshots/22-reports-status.png) · [23](screenshots/23-reports-timeline.png) · [24](screenshots/24-reports-priority.png) · [25](screenshots/25-reports-open.png) |
| 18 | People | `/users` | [26-people](screenshots/26-people.png) |
| 18a | Email settings (admins) | `/settings/email` | — |
| 18b | Choose your password (welcome or reset link, no login) | `/set-password?token=…` | — |
| 18c | Forgot password (no login) | `/forgot-password` | — |
| 19 | Page not found | any unknown route | [27-not-found](screenshots/27-not-found.png) |
| 20 | Queues | `/queues` | — |
| 21 | Help center | `/portal`, `/portal/:slug`, `/portal/requests`, `/portal/requests/:key` | — |

---

## 21. Service desk and help center

A **service desk** project handles requests from **customers**: people outside the delivery teams who raise requests in a simple
**help center** and follow them there. The project's members are the **agents**, who work the requests from **queues** against **SLA** goals.

### Setting one up

Choose **Service desk** as the project type in **Create project**. The new project starts with:

| | Default |
|---|---|
| Workflow | Waiting for support → In Progress → Waiting for customer → Resolved (*Waiting for customer* pauses SLAs) |
| Request types | Get IT help, Report a bug, Request access, Suggest an improvement |
| SLA goals | First response / resolution: Highest 30m / 4h · High 1h / 8h · Medium 4h / 24h · Low 8h / 72h · Lowest 24h / 120h |
| Queues | All open · Unassigned · Assigned to me · Waiting for customer · Resolved in the last 7 days |

Project administrators change all of it in the **Service desk** section of the project page (`/projects/KEY#service-desk`):

- **Request types**: what customers can ask for, the issue type each one creates, and which project fields the portal form asks for
  (text, number, select or date; each can be required). New fields can be created right in the dialog.
- **SLA goals**: hours per priority for *time to first response* and *time to resolution*; leave a box empty for no goal.
- **Queues**: named JQL filters, always limited to the project. Without `ORDER BY`, the request closest to breaching comes first.
- **Portals**: the project's customer-facing help centers (see below). Each has a name and link, who may use it, the request types it
  offers, and its **look and feel**: logo (PNG, JPEG, GIF, WebP or SVG up to 256 KB), accent colour and welcome message, with a live preview.
- **Workflow**: the *Pauses SLA* column marks statuses where the resolution clock stops (e.g. *Waiting for customer*).

### Customers

Customers are user accounts with the **Customer** role (create them on the **People** page). They only ever see the help center:
any other page sends them to it, and the API refuses every agent endpoint for them. They can't be project members or leads,
and they don't appear in assignee, watcher or @mention pickers.

### Portals: one team, many client companies

A service desk project can have several **portals**, typically one per client company, so a single team and project can serve many
companies, each through its own branded help center. Under *Service desk → Portals* on the project page, *Add portal* creates one with a
name and a link (`/portal/acme`); it starts closed. For each portal you set:

- **Who can use it**: organizations and/or individual customers, or *Any customer*. Staff with access to the project can always use it.
- **Request types offered**: all of the project's (the default, including ones added later) or a chosen few.
- **Look and feel**: logo, accent colour and welcome message.

Every portal's requests land in the same project — one set of queues, SLAs and agents — and each request remembers its portal and company
(shown on the request panel and as queue columns; JQL `portal = acme`). A project keeps at least one portal; deleting one moves its
requests to the first remaining portal. Service desks created before portals existed were given one automatically, linked by their project
key (`/portal/HELP` keeps working).

**Organizations** group customer accounts by company: a global admin creates them and adds members under **People → Organizations**,
and a service desk's admin links them to portals.

- **Each company sees only its own tickets.** Customers see requests they raised, were added to, or that a colleague shared with their
  own organization. Another company's requests never appear, even though they're in the same project.
- A customer with access to **one** portal lands straight in it (header, home link and banner in its colours); customers with
  several see a list of them, each with its logo.
- When raising a request, customers choose **Share with** — their organization (the default) or *No one*. Colleagues in that organization
  see shared requests under *Requests* and can follow and reply to them. The requester can change this on the request page.
- Agents see the organization on the request panel and in queues, and can change or remove it. Changes are recorded in the history.
- Only global admins change organization membership, because it decides which portals a customer can use.

### Email: one address per service desk

Each service desk can have its **own email address** (e.g. `support@acme.com`), set up under *Service desk → Email* on the project page.
JiraTech reads that address's mailbox over **IMAP** (every minute by default) and:

- turns each **new email** into a request from the sender: the subject becomes the summary, the text the description, and attachments
  (up to 20 MB each) are attached. It is raised through the portal of the sender's organization; otherwise through the channel's
  **default portal**, with the chosen **request type** (or the portal's first);
- adds a **reply** to the existing request as a comment when it answers one of the request's emails (its *In-Reply-To* / *References*
  headers) or the subject carries the request's key, e.g. `Re: [JiraTech] (HELP-12) …`.
  Quoted earlier messages are trimmed. A customer replying to a request *waiting for customer* sends it back to the agents, as on the portal.
  Only people who can see the request may reply to it;
- keeps each email on the request (shown as an email in its activity) and makes the people in its **To and Cc** request participants:
  they see the request in the help center, get its updates and can reply. Unknown addresses get a customer account when *Accept emails
  from anyone* is on; people removed from the request's portal are left out;
- skips out-of-office replies, delivery reports, mailing-list mail and mail from JiraTech's own address, so notifications can't loop.

**Accept emails from anyone**: unknown senders get a customer account (no password; an admin can send them a link to choose one from the People page) and access to
the default portal. Untick it to accept only existing customers of the service desk — do this when the default portal belongs to one client
company. Each address can belong to one service desk only. While the channel is on, emails to customers are sent with it as **Reply-To**.

Admins fill in the mail server, port, security (SSL/TLS or STARTTLS), user name, password and folder, then use *Test connection*,
*Turn on* and *Check now*. The password is stored encrypted (key: `MAIL_SECRET`, or `JWT_SECRET`; changing it means re-entering the
password) and never sent back to the browser. *Send a test email* runs a made-up email through the channel without a mail server.
*Received emails* lists the last 50 emails and what became of each (new request, reply added, ignored or failed, and why).
Read emails are marked as read in the mailbox; a message is never handled twice. Microsoft 365 only allows OAuth sign-in over IMAP, which
isn't supported yet; Gmail works with an app password. Server settings: `MAIL_POLL_SECONDS` (default 60) and `MAIL_POLLING=false` to stop
reading mailboxes (e.g. on a second server instance).

**Mailboxes defined by environment variables.** A desk's email can also be set where the server is hosted (e.g. Render → Environment)
with variables named after its project key, so it survives a database reset. They're applied every time the server starts; the password
stays in the environment and is never stored in the database. Such a desk shows an *Environment* label and its settings can't be changed
or removed in the app, while *Test connection*, *Check now*, *Send a test email* and *Received emails* still work. Removing the variables
switches the desk's email off at the next start and makes it editable in the app again. Mistakes (a bad address, an unknown project key,
portal or request type) are reported in the server log at startup. For a desk with the key HELP:

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

### The help center (`/portal`)

- **Home**: the service desks the customer can use and their open requests.
- **Raise a request**: pick a request type, fill in the summary, description and the type's fields.
- **Requests**: everything they raised, were added to, or that colleagues shared with their organization, filterable by open/closed.
- **A request**: description, field values, the public conversation, status and who it's shared with. Customers reply here;
  replying to a request that is *waiting for customer* sends it back to the agents automatically.

Customers never see internal notes, SLAs, assignees or history. They're notified (in the app and by email, with a link to
the request in the help center) when an agent replies publicly or the status changes. Staff can open the help center from the account
menu, and agents can **raise a request on behalf of** a customer (e.g. one who phoned in).

### Agents

- **Queues** (`/queues`, in the header when the current project is a service desk): each queue's requests with status,
  *First response* and *Resolution* SLA badges (blue on track, amber under 25% left, red breached, grey paused, green met). Refreshes every minute.
- **Issue page**: a **Service request** panel with the request type, the customer, both SLA clocks and the customers it's shared with (add more with *Share with a customer*).
- **Comments**: choose **Reply to customer** (customers see it and are notified) or **Add internal note** (agents only, shown in yellow).
  The first reply to the customer stops the first-response clock.
- **Emails** (see below): answer customers by email from the request, with templates.
- **JQL**: `requestType = "Report a bug"` finds requests of a type; `organization = "Acme Retail"` those shared with an organization.

### Emails on a request

A request raised by email says **Raised via: Email** in its *Service request* panel (*Help center* for portal requests). Every email
received or sent on it is shown in **Activity** as an email: sender, To, Cc, subject (*Details* shows the full headers), the body as the
sender wrote it (earlier quoted messages folded behind **•••**) and its attachments. *Show: Emails* lists only the emails.

- **Reply** answers the sender (or their Reply-To); replying to an email you sent goes to the same people again. **Reply all** (shown
  when the email went to others too) adds everyone else in To and Cc, except the service desk itself. **Forward** sends it on, with its
  attachments ticked. **Send email** (next to *Add internal note*, or on the *Emails* tab) starts a new one, to the customer by default.
- The email window has To, Cc and Bcc (type an address and press Enter, or search people, organizations and recipient groups), the subject (always carrying
  the key, e.g. `Re: [HELP-12] …`), the text, *Include the original message*, and files from the request or uploaded. **Show on the
  customer's portal** (ticked except for forwards) decides whether it also appears there as a reply or stays an internal note; only
  public emails make their recipients participants. An unsent draft is kept in the browser until it is sent or discarded.
- The email is sent from the address in Email settings, named after the agent and the desk (e.g. *Anna Smith (IT Help Desk)*), with the
  desk's address as Reply-To and threading headers, so the answer comes back to the request. Without an enabled email address on the
  desk the window warns that answers won't come back. People who got the email aren't also sent the usual "commented" notification.
- An email the mail server refused is marked **Not sent**, with the reason and **Try again**. Deleting the comment deletes its email.
- Emails received before this feature existed show as ordinary comments.

**Templates.** Pick one at the top of the email window: its text (and, for a new email, its subject) replaces what you wrote, with the
placeholders filled in for the request: `{{customer.name}}`, `{{customer.firstName}}`, `{{customer.email}}` (the first recipient, or the
request's customer), `{{agent.name}}`, `{{agent.firstName}}`, `{{agent.email}}`, `{{issue.key}}`, `{{issue.summary}}`, `{{issue.status}}`,
`{{issue.priority}}`, `{{issue.assignee}}`, `{{request.type}}`, `{{request.link}}` (the request in the help center) and `{{project.name}}`.
Global admins manage **global templates**, offered on every service desk, under *Account menu → Administration → Email templates*;
project admins add a desk's own under *Service desk → Email templates* on the project page (*Insert placeholder* adds them).

### How SLAs are measured

Both clocks start when the request is raised and run around the clock (no business-hours calendar).
*Time to first response* stops at the first public reply from someone other than the requester, or when the request is resolved.
*Time to resolution* pauses while the request is in a status that pauses SLAs, stops when it's resolved, and resumes if it's re-opened
(the time it spent resolved doesn't count).
