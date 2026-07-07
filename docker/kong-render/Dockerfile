# Kong for Render — same kong:3.6 base as docker-compose.yml, but the
# declarative config is templated at container start instead of being a
# static file, since Render's private-network hostnames aren't known until
# deploy time (see render-entrypoint.sh).
FROM kong:3.6

USER root
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
  && rm -rf /var/lib/apt/lists/*
COPY kong.yml.template /kong.yml.template
COPY render-entrypoint.sh /render-entrypoint.sh
RUN chmod +x /render-entrypoint.sh
USER kong

ENTRYPOINT ["/render-entrypoint.sh"]
CMD ["kong", "docker-start"]
