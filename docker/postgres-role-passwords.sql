-- supabase/postgres runs this automatically after its own migrations
-- (see /docker-entrypoint-initdb.d/migrate.sh) to set internal role passwords.
-- This is a fixed, container-internal-only credential — GoTrue is the only
-- thing that ever uses it, over the docker-compose network, never exposed.
ALTER ROLE supabase_auth_admin WITH PASSWORD 'local-gotrue-db-password';
