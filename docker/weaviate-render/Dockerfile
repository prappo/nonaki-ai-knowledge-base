# Weaviate for Render — same semitechnologies/weaviate:1.37.11 base as
# docker-compose.yml, but TRANSFORMERS_INFERENCE_API is composed from
# separate host/port env vars at container start (see render-entrypoint.sh).
FROM semitechnologies/weaviate:1.37.11

COPY render-entrypoint.sh /render-entrypoint.sh
RUN chmod +x /render-entrypoint.sh

ENTRYPOINT ["/render-entrypoint.sh"]
CMD ["--host", "0.0.0.0", "--port", "8080", "--scheme", "http"]
