# Nonaki — AI Knowledge Base

A self-maintaining RAG (Retrieval-Augmented Generation) knowledge base.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/prappo/nonaki-ai-knowledge-base&env=DATABASE_URL,DIRECT_URL,NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,WEAVIATE_URL,WEAVIATE_API_KEY,GROQ_API_KEY&envDescription=Required%20credentials%20for%20Supabase%2C%20Weaviate%20and%20Groq%20%E2%80%94%20see%20.env.example&envLink=https://github.com/prappo/nonaki-ai-knowledge-base/blob/main/.env.example)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/prappo/nonaki-ai-knowledge-base)

## Stack

| Concern | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript, Tailwind v4) |
| Vector DB | **Weaviate Cloud** with the built-in `text2vec-weaviate` embedding service (or self-hosted Weaviate + `text2vec-transformers` via Docker — see below) |
| Answers & drafting | **Groq** free-tier LLMs (`groq-sdk`, streaming — default `llama-3.3-70b-versatile`) |
| Chunking | **LangChain** `RecursiveCharacterTextSplitter` (`@langchain/textsplitters`) |
| Metadata DB | **Supabase Postgres** via **Prisma 7** (sources, documents, proposals, sync/ask logs) |
| Auth | **Supabase Auth** (email + password, middleware-protected app; embeds & webhooks stay public) |
| File parsing | `pdf-parse` (PDF), `mammoth` (DOCX), plain text (TXT/MD) |

## Features

- **Ask (console)** — streaming RAG answers with numbered citations and a confidence meter. Hybrid (vector + BM25) retrieval from Weaviate.
- **Search** — raw hybrid search over indexed chunks.
- **Data sources**
  - **WordPress import** — paste a site URL; published posts & pages are pulled from the public REST API (`/wp-json/wp/v2`), stripped to text, chunked and indexed.
  - **File uploads** — PDF / DOCX / TXT / MD, parsed → chunked → indexed.
- **Maintenance & approval flow** — re-syncing WordPress detects changed or removed content and queues **proposals** instead of silently updating:
  - side-by-side diff of current vs proposed content
  - **Approve & publish** → document version bumps, content is re-chunked with LangChain and re-indexed in Weaviate
  - **Reject** → the indexed version is kept
  - archive proposals remove a document's chunks from Weaviate
- **Doc assistant** — ask the AI to revise any document; the draft lands in the review queue as a proposal.
- **Maintenance digest** — weekly stats, pending decisions, recent approvals, live activity feed.
- **Settings** — chunk size, retrieval depth, citation policy.

## Setup

```bash
# Node 24 (via nvm)
nvm use 24

# install (note: if NODE_ENV=production is set in your shell, force dev deps)
NODE_ENV=development npm install --include=dev

# database
npx prisma migrate dev
```

Fill in `.env` (see `.env.example`):

```env
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres"   # Supabase → Database → Transaction pooler
DIRECT_URL="postgresql://...pooler.supabase.com:5432/postgres"     # Session pooler (for prisma migrate)
NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"           # Supabase → Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
WEAVIATE_URL="https://<cluster>.weaviate.cloud"   # console.weaviate.cloud → free sandbox
WEAVIATE_API_KEY="..."                             # cluster admin API key
GROQ_API_KEY="gsk_..."                             # console.groq.com (free)
GROQ_MODEL="llama-3.3-70b-versatile"               # any free Groq model
```

First run: sign up at `/login`, then (optionally) disable further sign-ups in
Supabase → Authentication → Sign In / Up.

Migrating from the old SQLite setup? `npm run db:migrate-data` copies
everything from `dev.db` into Supabase, preserving document IDs so existing
Weaviate chunks stay linked.

The `Chunk` collection in Weaviate is created automatically on first use, configured with the `text2vec-weaviate` embedding service (no separate embedding provider needed).

## Run

```bash
npm run dev    # http://localhost:3000
```

## Run fully locally with Docker

`docker-compose.yml` runs everything — Postgres, Auth, Weaviate, and its
embedding model — in containers on your machine. The **only** thing that
still leaves the Docker network is the AI provider call itself
(Groq/OpenAI/Anthropic/DeepSeek); this is a separate stack from your regular
`.env`/cloud setup and doesn't touch it.

```bash
cp .env.docker.example .env.docker
# fill in at least one AI provider key (e.g. GROQ_API_KEY) in .env.docker
docker compose --env-file .env.docker up --build
```

Then open `http://localhost:3000` and sign up — Auth auto-confirms new
accounts locally (no SMTP server). Weaviate uses the self-hosted
`text2vec-transformers` module (a small sentence-transformer model, ~90MB)
for embeddings instead of Weaviate Cloud's service — nothing leaves the
network for that step either.

Services: `app` (this repo), `postgres` (`supabase/postgres`, also backs
Auth), `auth` (`supabase/gotrue`), `kong` (routes `/auth/v1/*` to Auth,
matching what the app's Supabase client expects), `weaviate`, and
`t2v-transformers` (the local embedding model).

## Self-host the same stack on Render

`render.yaml` deploys the equivalent stack as separate Render services
instead of Docker Compose containers — same six pieces (app, Postgres, Auth,
Kong, Weaviate, embeddings), still with only the AI provider call leaving
the network. Two of them (`docker/kong-render/`, `docker/weaviate-render/`)
are thin wrappers around the stock `kong`/`weaviate` images because Render
can't hand a service a static config file referencing another service's
address — the wrapper composes it from env vars at container start instead.

Deploy: connect this repo in the Render dashboard as a Blueprint, then set
an AI provider key (e.g. `GROQ_API_KEY`) on the `nonaki-app` service — it's
excluded from the blueprint itself. See the comments in `render.yaml` for
the couple of things worth double-checking on first deploy.

## Flow

```
WordPress / uploads ──▶ parse ──▶ LangChain chunker ──▶ Weaviate (text2vec-weaviate)
                                                            │
        Ask ──▶ hybrid retrieval ──▶ Groq LLM ──▶ streamed, cited answer
                                                            │
WordPress re-sync ──▶ drift detected ──▶ proposal (diff) ──▶ approve ──▶ re-chunk + re-index
                                                        └──▶ reject  ──▶ keep current
```
