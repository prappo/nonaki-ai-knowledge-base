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

## Recipe at a glance

| Key | What it holds |
|---|---|
| `vars` | Repo-level variables (sibling checkouts…), from settings and `{env.*}`. |
| `version` | An anchored `pattern`. Its named groups become variables, and `vars` derives more from them (`{ "if": "hotfix", "then": …, "else": … }`). |
| `groups`, `stages` | The pipeline. Each stage has a `prompt` (the command as typed), a `doneWhen` check, `blockedUntil`, `irreversible`, `requires` (agent capabilities such as `browser`), and an optional `status` hook. |
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
