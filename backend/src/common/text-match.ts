// SQLite's LIKE is case-insensitive for ASCII, PostgreSQL's is not. Prisma only
// accepts `mode: 'insensitive'` on PostgreSQL (the SQLite client rejects it), so
// add it only there to give the same matching behaviour on both databases.
const isPostgres = /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL ?? '');

/** A Prisma string filter matching `value` anywhere in the column, ignoring case. */
export const contains = (value: string): { contains: string } =>
  (isPostgres ? { contains: value, mode: 'insensitive' } : { contains: value }) as { contains: string };
