#!/usr/bin/env node
// Runs the Prisma CLI against the database named by DATABASE_URL.
//
// Prisma does not allow the datasource provider to come from an env var, so
// prisma/schema.prisma (provider "sqlite") stays the single source of truth.
// When DATABASE_URL points at PostgreSQL, a copy with provider "postgresql" is
// written to prisma/postgres/schema.prisma (git-ignored) and used instead.
//
// Usage: node scripts/prisma.js <prisma args...>   e.g. `node scripts/prisma.js db push`
const { config } = require('dotenv');
const { spawnSync } = require('child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const root = resolve(__dirname, '..');
config({ path: resolve(root, '.env') });

const url = process.env.DATABASE_URL ?? '';
const isPostgres = /^postgres(ql)?:\/\//i.test(url);
const baseSchema = resolve(root, 'prisma/schema.prisma');
// Relative to `root` (the CLI's cwd): with shell: true on Windows, absolute paths
// containing spaces would be split into separate arguments.
let schema = 'prisma/schema.prisma';

if (isPostgres) {
  const source = readFileSync(baseSchema, 'utf8');
  const converted = source.replace(
    /(datasource\s+db\s*\{[^}]*provider\s*=\s*)"sqlite"/,
    '$1"postgresql"',
  );
  if (converted === source) {
    console.error('scripts/prisma.js: could not find provider = "sqlite" in prisma/schema.prisma');
    process.exit(1);
  }
  const dir = resolve(root, 'prisma/postgres');
  mkdirSync(dir, { recursive: true });
  schema = 'prisma/postgres/schema.prisma';
  writeFileSync(
    resolve(root, schema),
    '// GENERATED from ../schema.prisma by scripts/prisma.js — do not edit.\n' + converted,
  );
}

const args = process.argv.slice(2);
console.log(`[prisma] ${isPostgres ? 'postgresql' : 'sqlite'} → prisma ${args.join(' ')}`);
const result = spawnSync('npx', ['prisma', ...args, '--schema', schema], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
