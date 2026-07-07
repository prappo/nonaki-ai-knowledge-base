#!/bin/sh
# Render can't hand Kong a static declarative config — the upstream Auth
# service's private-network address isn't known until deploy time — so this
# templates it in from an env var (AUTH_INTERNAL_HOST/PORT, set via
# render.yaml's fromService) before handing off to Kong's own entrypoint.
set -e
: "${AUTH_INTERNAL_HOST:?AUTH_INTERNAL_HOST must be set}"
: "${AUTH_INTERNAL_PORT:=9999}"
export AUTH_INTERNAL_HOST AUTH_INTERNAL_PORT

envsubst '${AUTH_INTERNAL_HOST} ${AUTH_INTERNAL_PORT}' < /kong.yml.template > /tmp/kong.yml
export KONG_DECLARATIVE_CONFIG=/tmp/kong.yml

exec /docker-entrypoint.sh "$@"
