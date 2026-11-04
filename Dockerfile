# Runs the app itself. Weaviate, its embedding model, Postgres and Auth are
# separate services in docker-compose.yml — this image is just Next.js.

FROM node:24-slim AS deps
WORKDIR /app
# better-sqlite3 (pulled in transitively by @prisma/adapter-better-sqlite3) has a
# native addon — make sure it can build if no prebuilt binary matches this image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:24-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Baked into the client bundle at build time (Next.js inlines NEXT_PUBLIC_*).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# `next build` imports every route to collect its metadata, which eagerly
# constructs the Prisma client (src/lib/prisma.ts) — it just needs a
# non-empty, well-formed string at build time, never actually connects.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

# The laptop-side release agent, packed for download from the Releases page
# (GET /api/agent/download). It runs on laptops, never in this container.
FROM node:24-slim AS agent
WORKDIR /agent
COPY packages/release-agent/package.json packages/release-agent/package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY packages/release-agent/ ./
RUN npm run build && npm run build:ui && mkdir -p /out && npm pack --pack-destination /out && mv /out/release-agent-*.tgz /out/release-agent.tgz

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=agent /out/release-agent.tgz ./agent/release-agent.tgz
# the Release Console UI the Releases page embeds (talks to agents through the tunnel)
COPY --from=agent /agent/dist-ui ./public/release-console
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "run", "start"]
