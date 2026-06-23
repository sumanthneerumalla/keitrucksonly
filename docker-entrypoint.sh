#!/bin/sh
set -e

echo "==> Generating Prisma Client..."
npx prisma generate

echo "==> Running migrations..."
if npx prisma migrate deploy 2>&1; then
  echo "==> Migrations applied successfully."
else
  EXIT_CODE=$?
  echo ""
  echo "!!! Migration failed (exit code $EXIT_CODE)."

  # All HOSTED tiers run NODE_ENV=production (hosted-dev + hosted-prod) -> strict:
  # do NOT auto-resolve, fail hard so a human looks (auto-deleting a half-applied
  # migration can mask schema damage). Only LOCAL dev (NODE_ENV=development) gets
  # the lenient auto-resolve below.
  if [ "$NODE_ENV" = "production" ]; then
    echo "!!! PRODUCTION (hosted): Refusing to auto-resolve. Fix migrations manually before restarting."
    echo "!!! Inspect the _prisma_migrations table for failed records."
    echo "!!! To resolve: docker exec <db-container> psql -U postgres -d <db> -c \"DELETE FROM _prisma_migrations WHERE finished_at IS NULL;\""
    exit 1
  fi

  # Dev only: attempt auto-resolve of failed migrations
  echo "!!! DEV: Attempting auto-resolve of failed migrations..."

  # Delete failed migration records (finished_at IS NULL = started but never completed)
  npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL' || true
DELETE FROM _prisma_migrations WHERE finished_at IS NULL;
SQL

  echo "==> Retrying migrations..."
  if npx prisma migrate deploy 2>&1; then
    echo "==> Migrations applied successfully on retry."
  else
    echo ""
    echo "!!! Migration failed again after auto-resolve."
    echo "!!! Manual intervention required. Starting app anyway so you can debug."
    echo "!!! Connect to the DB and inspect _prisma_migrations table."
  fi
fi

echo "==> Starting application..."

# Tee shell stdout/stderr to /tmp/runtime.log so /api/logs can serve recent
# output to platform admins. Uses a FIFO + backgrounded tee so we keep
# `exec "$@"` semantics: the app runs as PID 1 (after exec), signals flow
# correctly on shutdown, and tee just sits in the background duplicating
# the stream. Alpine's `sh` is `ash` — process substitution isn't available,
# hence the FIFO pattern instead of `exec > >(tee ...)`.
LOG_FILE=/tmp/runtime.log
LOG_FIFO=/tmp/.runtime.fifo
rm -f "$LOG_FIFO"
mkfifo "$LOG_FIFO"
tee "$LOG_FILE" < "$LOG_FIFO" &
exec > "$LOG_FIFO" 2>&1

exec "$@"
