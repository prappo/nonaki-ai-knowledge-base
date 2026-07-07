#!/bin/sh
# Same reasoning as kong-render's wrapper — TRANSFORMERS_INFERENCE_API needs a
# full URL, but Render can only give us the embedding service's host/port as
# separate values (via fromService), not composed into one string.
set -e
: "${EMBEDDINGS_INTERNAL_HOST:?EMBEDDINGS_INTERNAL_HOST must be set}"
: "${EMBEDDINGS_INTERNAL_PORT:=8080}"
export TRANSFORMERS_INFERENCE_API="http://${EMBEDDINGS_INTERNAL_HOST}:${EMBEDDINGS_INTERNAL_PORT}"

exec /bin/weaviate "$@"
