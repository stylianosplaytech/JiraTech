import { Prisma } from '@prisma/client';

/** Finds an issue by its id, its key (e.g. SPORTS-12), or a key it had before it was moved to another project. */
export function issueRef(idOrKey: string): Prisma.IssueWhereInput {
  const key = idOrKey.toUpperCase();
  return { OR: [{ id: idOrKey }, { key }, { previousKeys: { some: { key } } }] };
}
