#!/bin/sh
set -eu

mkdir -p "${UPLOAD_DIR:-/data/uploads}"

if [ "${RUN_PRISMA_GENERATE:-true}" = "true" ]; then
  node backend/scripts/prisma.js generate
fi

if [ "${RUN_DB_PUSH:-true}" = "true" ]; then
  node backend/scripts/prisma.js db push --skip-generate
fi

if [ "${SEED_DATABASE_ON_STARTUP:-false}" = "true" ]; then
  npm run db:seed -w backend
fi

exec node backend/dist/main.js
