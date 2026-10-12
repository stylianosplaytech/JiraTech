import { IssueType, Prisma, Priority } from '@prisma/client';

/** What a new service desk starts with; admins change all of it on the project page. */

export const DEFAULT_REQUEST_TYPES: { name: string; description: string; issueType: IssueType }[] = [
  { name: 'Get IT help', description: 'Ask a question or get help with a problem.', issueType: IssueType.TASK },
  { name: 'Report a bug', description: 'Something is broken or not working as expected.', issueType: IssueType.DEFECT },
  { name: 'Request access', description: 'Get access to a system, application or shared resource.', issueType: IssueType.TASK },
  { name: 'Suggest an improvement', description: 'Propose a new feature or a change to an existing one.', issueType: IssueType.STORY },
];

const H = 60;
/** Minutes to first response / to resolution, per priority. */
export const DEFAULT_SLA: Record<Priority, [number, number]> = {
  HIGHEST: [30, 4 * H],
  HIGH: [1 * H, 8 * H],
  MEDIUM: [4 * H, 24 * H],
  LOW: [8 * H, 72 * H],
  LOWEST: [24 * H, 120 * H],
};

export const DEFAULT_QUEUES: { name: string; jql: string }[] = [
  { name: 'All open', jql: 'statusCategory != Done' },
  { name: 'Unassigned', jql: 'assignee IS EMPTY AND statusCategory != Done' },
  { name: 'Assigned to me', jql: 'assignee = currentUser() AND statusCategory != Done' },
  { name: 'Waiting for customer', jql: 'status = "Waiting for customer"' },
  { name: 'Resolved in the last 7 days', jql: 'statusCategory = Done AND updated >= -7d ORDER BY updated DESC' },
];

/** Request types, SLA goals and queues for a new service desk project. */
export async function setUpServiceDesk(tx: Prisma.TransactionClient, projectId: string) {
  await tx.requestType.createMany({
    data: DEFAULT_REQUEST_TYPES.map((t, position) => ({ ...t, projectId, position })),
  });
  await tx.slaTarget.createMany({
    data: Object.entries(DEFAULT_SLA).map(([priority, [firstResponseMinutes, resolutionMinutes]]) => ({
      projectId, priority: priority as Priority, firstResponseMinutes, resolutionMinutes,
    })),
  });
  await tx.queue.createMany({
    data: DEFAULT_QUEUES.map((q, position) => ({ ...q, projectId, position })),
  });
}
