#!/bin/sh
set -e

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
