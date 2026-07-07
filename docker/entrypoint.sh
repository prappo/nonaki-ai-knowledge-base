#!/bin/sh
set -e

# Some hosts (e.g. Render's render.yaml) can't compose a full URL from parts
# in config — they set the pieces instead, and we build the URL here.
if [ -z "$SUPABASE_INTERNAL_URL" ] && [ -n "$SUPABASE_INTERNAL_HOST" ]; then
  export SUPABASE_INTERNAL_URL="http://${SUPABASE_INTERNAL_HOST}:${SUPABASE_INTERNAL_PORT:-80}"
fi

echo "Waiting for Postgres at ${DATABASE_URL}..."
until node -e "
const { Client } = require('pg');
new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  .connect()
  .then((c) => c.end())
  .catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 1
done

echo "Running database migrations..."
npx prisma migrate deploy

exec "$@"
