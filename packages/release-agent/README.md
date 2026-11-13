# release-agent

Runs a product's release pipeline on your laptop, under the control of the Nonaki app on your server. The engine is product-agnostic. Each repo describes its own release in a **recipe** (`.release/recipe.json`), with optional **hooks** (a JavaScript module next to it) for the parts that need real logic.

**Status:** phase 1, slices 1–2 are done.

| Part | State |
|---|---|
| Recipe format + loader | Done |
| Stage status | Done: files, git tags, remote probes, hooks |
| Setup checks | Done |
| Settings | Done: read, validate, write |
| Risk / approval rules | Done |
| Runner (Agent SDK sessions), store, transcripts, Run all | Next |
| Connection to the control server | Phase 2–3 |

```bash
npm install
npm test                     # format tests + the console parity suite
npm run typecheck
node src/cli/check-recipe.ts recipes/wpsp-pro.recipe.json --repo <checkout> --version 4.17.6 [--offline]
```

## Serving the Release Console web app (gateway mode)

Besides Nonaki (`pair` + `start`), the agent can serve the **Release Console
web app** directly. The browser calls this machine through a Cloudflare
Tunnel, so run output and agent sessions stream live.

```bash
release-agent allow ~/Projects "~/Local Sites"   # folders the web app may add projects from
release-agent tunnel setup --hostname agent.example.com
release-agent link https://release.example.com --code ABCD-2345
release-agent autostart on                       # gateway (127.0.0.1:7420) + tunnel, now and at login
release-agent tunnel status                      # is https://agent.example.com reaching the gateway?
```

- **`tunnel setup`** uses your own `cloudflared`: it signs in to Cloudflare the
  first time (a browser window), creates a tunnel named
  `release-agent-<machine>` (or reuses it), points the hostname at it (it won't
  replace an existing DNS record unless you pass `--overwrite-dns`), and writes
  `~/.release-agent/cloudflared.yml`, which sends only that hostname to
  127.0.0.1:7420 and answers 404 to anything else. Nothing listens on a public
  port. `tunnel run` runs it in the foreground; `tunnel remove [--delete]`
  takes it down.
- **`autostart on`** installs a launchd agent (macOS), a systemd user service
  (Linux), or a Task Scheduler logon task running a hidden, restarting
  PowerShell loop (Windows; not yet tried on a real Windows machine), for the
  gateway and the tunnel, with your shell's PATH so git, gh and Claude are
  found. They start at login and restart if they stop. Logs are in
  `~/.release-agent/logs/`. `autostart off` removes them.
- Quick tunnels (trycloudflare.com) aren't used: they don't carry the live
  event streams.

- **Every request needs the web app's token**: an Ed25519-signed JWT, 5
  minutes long, for this machine and its owner. The gateway keeps only the
  app's public key (saved by `link`), so it can check tokens but never make
  them. Tokens for another machine, another user, another app, expired or
  forged ones are refused (`src/gateway/token.ts`).
- **Only the app's origin gets CORS**, and only loopback and the tunnel's
  hostname are accepted as Host, which keeps DNS rebinding out.
- **Repeated bad tokens** from one client get a 429 after 30 a minute.
- **Heartbeat:** `serve` checks in every minute. When the web app revokes the
  machine, the next check-in turns every request away until it's linked again.
- **Routes:** `GET /health` (no token), `GET /projects`, and
  `/projects/<id>/api/...`, which streams to that repo's console (event
  streams included). For Add project: `GET /discover` (git repos in the allowed
  folders, never through symlinks), `GET /recipes`, `POST /check`,
  `POST /projects`, `POST /projects/<id>/remove`, and
  `POST /projects/<id>/recipe` (switch recipes; refused while a run or agent
  session is going, since it restarts that console). Every folder is resolved to
  its real path and must sit inside an allowed folder.
- **Live status:** `GET /events` is an event stream of every project's branch,
  changes, live run and agent session, and latest CI build: a snapshot, then
  only changes (`src/gateway/live.ts`). It reads each console's cheap
  `GET /api/live` and watches each repo's `.git`, only while someone watches. EventSource can't send headers, so `?access_token=` works
  too; the gateway strips it before the console sees the request.

## Marketing videos

The Nonaki **Marketing** page (`/marketing`) makes promo videos for a repo's
product with AI, on this machine. A video is a brief plus five steps, each a
Claude Code session started by the console (cwd = the repo, so it uses the
product's real UI copy, docs and screenshots):

1. **Write the script**: the story scene by scene. You edit and approve it on
   the page; nothing else runs until you do, and an edited script needs
   approving again.
2. **Pick the music**: a royalty-free track from Pixabay, through Claude in Chrome.
3. **Record the voiceover**: ElevenLabs, one clip per scene (optional).
4. **Build the scenes**: a Remotion project, checked from a contact sheet of frames.
5. **Render the video**: the 1920×1080 MP4, played and downloaded on the page.

Everything lives in `~/.release-agent/marketing/`: one shared Remotion install
(`npm install` there, run once by the first build), the starter kit and a
finished example (`marketing-kit/` in this package), the ElevenLabs key
(`elevenlabs.key`, 0600, given only to the voiceover session), and a folder per
repo and video. Each step's instructions are written to the video's
`.instructions/<step>.md`; *Run again* with notes revises a step.

Needs `ffmpeg`, Chrome with the Claude extension (music), and an ElevenLabs API
key with Text to Speech and Voices access (voiceover, added in Setup).

## Recipe at a glance

| Key | What it holds |
|---|---|
| `vars` | Repo-level variables (sibling checkouts…), from settings and `{env.*}`. |
| `version` | An anchored `pattern`. Its named groups become variables, and `vars` derives more from them (`{ "if": "hotfix", "then": …, "else": … }`). |
| `groups`, `stages` | The pipeline. Each stage has a `prompt` (the command as typed), a `doneWhen` check, `blockedUntil`, `irreversible`, `requires` (agent capabilities such as `browser`), `forbid` (risk rules refused outright in that stage, with no approval card, e.g. `["browser-send"]` on a stage that only drafts an email), and an optional `status` hook. |
| `probes` | Remote lookups shared by stages: `githubRelease`, or a `script` hook. Cached for 60 s, failures are not cached, and `null` means the lookup failed. |
| `settings` | Per-machine paths in a gitignored JSON file, with defaults, an `env` for sessions, and validation rules. |
| `checks` | Setup checks: `gitBranch`, `previousTag`, `workingTree`, `command`, `setting`, `dockerContainer`, `dirEntry`, `localWpSite`, `script`. |
| `outputs`, `reset` | Library grouping; what Reset pre-ticks, protects and hides. |
| `risk` | `extra` rules (with `before` for ordering), `alsoMatch` for built-in rules, and `messages` to reword built-in reasons. |
| `build` | The build script and its artifact kinds. |

**Hooks** are `"<module>.mjs#<export>"` references, resolved inside the recipe's folder:

| Kind | Runs | Signature |
|---|---|---|
| Status hooks | Sync | `(api) => { done?, blockedReason?, remote? }` |
| Probe hooks | Async | `(api) => value \| null` |
| Health hooks | Async | `(api) => { status, detail }` |

The API they receive is in `src/recipe/hooks.ts`.

**Templates** use `{var}`. Values are regex-escaped inside `regex` fields and shell-quoted inside `localBuild.args`. Every reference is checked when the recipe loads. The full reference is in `src/recipe/types.ts`.

## WP Simple Pay, and parity with its Release Console

- `recipes/wpsp-pro.recipe.json` and `recipes/wpsp-pro.hooks.mjs` hold the console's 14-stage pipeline (`origin/develop`).
- `test/console/*.test.ts` are the console's own tests, copied verbatim by `npm run sync-console-tests [ref]`, which rewrites only their imports. `test/console/adapter.ts` rebuilds the console's module API on top of the engine.
- `test/console/differential.test.ts` imports the console's original modules from the WPSP checkout and compares every field of the output over generated fixtures:
  - 400 repos × 14 stages;
  - about 2,900 shell commands, including chains and overlaps;
  - browser scripts;
  - 60 machines' setup checks.
- Set `WPSP_ROOT` if the checkout is somewhere other than the default Local site path.
