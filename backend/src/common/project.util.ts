import { NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export const DEFAULT_PROJECT_KEY = 'SPORTS';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Resolve the project a request is working in. Falls back to SPORTS (or the oldest
 * project) when the client did not say which project it wants.
 */
export async function resolveProject(prisma: Db, key?: string) {
  const normalized = key?.trim().toUpperCase();
  const project = normalized
    ? await prisma.project.findUnique({ where: { key: normalized } })
    : (await prisma.project.findUnique({ where: { key: DEFAULT_PROJECT_KEY } }))
      ?? (await prisma.project.findFirst({ orderBy: { createdAt: 'asc' } }));
  if (!project) {
    throw new NotFoundException(normalized ? `Project ${normalized} not found` : 'No projects exist');
  }
  return project;
}

export async function getSportsProject(prisma: Db) {
  return resolveProject(prisma);
}

/**
 * Hand out the next issue key for a project. Call inside a transaction so the counter
 * bump and the issue insert commit together.
 */
export async function nextIssueKey(tx: Db, projectId: string): Promise<{ key: string; number: number }> {
  const project = await tx.project.update({
    where: { id: projectId },
    data: { issueCounter: { increment: 1 } },
  });
  let number = project.issueCounter;
  // Projects created before the counter existed start at 0; catch up with existing issues.
  const { _max } = await tx.issue.aggregate({ where: { projectId }, _max: { number: true } });
  if ((_max.number ?? 0) >= number) {
    number = (_max.number ?? 0) + 1;
    await tx.project.update({ where: { id: projectId }, data: { issueCounter: number } });
  }
  return { key: `${project.key}-${number}`, number };
}
