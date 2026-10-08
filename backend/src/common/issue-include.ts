import { Prisma } from '@prisma/client';

export const ISSUE_INCLUDE = {
  project: { select: { id: true, key: true, name: true, strictHierarchy: true, leadId: true } },
  assignee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
  parent: { select: { id: true, key: true, type: true, summary: true, epicName: true } },
  components: { include: { component: true } },
  versions: { include: { version: true } },
  labels: { include: { label: true } },
  customFieldValues: { include: { field: true } },
  attachments: { include: { uploadedBy: { select: { id: true, name: true } } } },
  workLogs: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' as const } },
  watchers: { include: { user: { select: { id: true, name: true, email: true } } } },
  sprint: true,
  pi: true,
  children: { select: { id: true, key: true, type: true, summary: true, status: true } },
  linksFrom: { include: { target: { select: { id: true, key: true, summary: true, type: true, status: true, projectId: true } } } },
  linksTo: { include: { source: { select: { id: true, key: true, summary: true, type: true, status: true, projectId: true } } } },
} satisfies Prisma.IssueInclude;
