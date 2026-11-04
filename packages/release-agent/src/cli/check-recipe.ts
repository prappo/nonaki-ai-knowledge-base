/**
 * Validate a recipe (and load its hooks), then print the setup checks and the
 * pipeline it sees for a repo + version. Probes run live unless --offline.
 *
 *   node src/cli/check-recipe.ts <recipe.json> [--repo <path>] [--version <v>] [--offline]
 */

import { parseArgs } from "node:util";
import { createContext, createRepoContext } from "../recipe/context.ts";
import { HookError, ProbeCache, defaultFetchJson, resolveProbes } from "../recipe/hooks.ts";
import { RecipeError, openRecipe } from "../recipe/load.ts";
import { stageStates } from "../recipe/stages.ts";
import { healthChecks, runCommand } from "../health/health.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { repo: { type: "string" }, version: { type: "string" }, offline: { type: "boolean" } },
});

const file = positionals[0];
if (!file) {
  console.error("usage: check-recipe <recipe.json> [--repo <path>] [--version <v>] [--offline]");
  process.exit(2);
}

try {
  const { recipe, hooks } = await openRecipe(file);
  console.log(`✓ ${recipe.name}: ${recipe.stages.length} stages, ${recipe.checks?.length ?? 0} setup checks, ${Object.keys(recipe.probes ?? {}).length} probes, ${hooks.status.size + hooks.probes.size + hooks.health.size} hooks`);

  if (values.repo) {
    const icon = { ok: "✓", warn: "!", fail: "✗", info: "·" } as const;
    const repoCtx = values.version ? createContext(recipe, values.repo, values.version) : createRepoContext(recipe, values.repo);
    if (!repoCtx) {
      console.error(`✗ "${values.version}" is not a valid version${recipe.version.hint ? ` (${recipe.version.hint})` : ""}`);
      process.exit(1);
    }
    console.log("\n  Setup");
    for (const c of await healthChecks(repoCtx, { hooks })) console.log(`  ${icon[c.status]} ${c.label.padEnd(22)} ${c.detail}`);

    const ctx = values.version ? createContext(recipe, values.repo, values.version) : null;
    if (ctx) {
      const repoCtx = ctx;
      const probes = values.offline
        ? {}
        : await resolveProbes(recipe, hooks, repoCtx.root, repoCtx.vars, new ProbeCache(), { run: runCommand, fetchJson: defaultFetchJson });
      const mark = { done: "●", ready: "○", blocked: "⊘" } as const;
      let group = "";
      for (const s of stageStates(repoCtx, { probes, hooks })) {
        if (s.group !== group) {
          group = s.group;
          console.log(`\n  ${recipe.groups.find((g) => g.id === group)?.label ?? group}`);
        }
        const flags = [s.irreversible && "irreversible", s.browser && "chrome", !s.tracked && "not tracked"].filter(Boolean);
        console.log(`  ${mark[s.status]} ${s.title.padEnd(34)} ${s.status.padEnd(8)}${flags.length ? ` [${flags.join(", ")}]` : ""}`);
        if (s.blockedReason) console.log(`      ${s.blockedReason}`);
        if (s.missing.length) console.log(`      missing: ${s.missing.join(", ")}`);
        if (s.remote) console.log(`      ${s.remote.tone === "success" ? "↗" : "⚠"} ${s.remote.text}`);
      }
    }
  }
} catch (e) {
  console.error(e instanceof RecipeError || e instanceof HookError ? `✗ ${e.message}` : e);
  process.exit(1);
}
