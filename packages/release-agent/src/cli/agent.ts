#!/usr/bin/env node
/**
 * release-agent — run releases on this machine, controlled from a Nonaki server.
 *
 *   release-agent pair <CODE> --server <url> [--name <machine name>]
 *   release-agent add-repo <path> [--recipe <file|built-in name>] [--name <name>]
 *   release-agent recipes
 *   release-agent update
 *   release-agent remove-repo <id>
 *   release-agent repos
 *   release-agent start
 */

import { existsSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { Agent, AGENT_VERSION, detectCapabilities } from "../agent/agent.ts";
import { builtinRecipes, defaultRecipe, readConfig, resolveRecipe, slug, writeConfig, type AgentConfig } from "../agent/config.ts";
import { openRecipe } from "../recipe/load.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string" },
    name: { type: "string" },
    recipe: { type: "string" },
    capability: { type: "string", multiple: true },
  },
});
const [command, arg] = positionals;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function needConfig(): AgentConfig {
  const config = readConfig();
  if (!config) fail("Not paired yet. Make a code on the Releases page, then run: release-agent pair <CODE> --server <url>");
  return config;
}

async function pair() {
  if (!arg) fail("usage: release-agent pair <CODE> --server <url> [--name <machine name>]");
  const server = values.server ?? readConfig()?.server;
  if (!server) fail("--server is required, e.g. --server https://kb.example.com");
  const url = new URL(server);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    fail("Use an https:// server address (http is only allowed for localhost): the token travels with every request.");
  }
  const name = values.name ?? hostname().replace(/\.local$/, "");
  const previous = readConfig();
  const res = await fetch(new URL("/api/agent/pair", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: arg, name, capabilities: detectCapabilities(previous?.capabilities), version: AGENT_VERSION }),
  });
  const data = (await res.json().catch(() => ({}))) as { agentId?: string; token?: string; error?: string };
  if (!res.ok || !data.token) fail(data.error ?? `Pairing failed (HTTP ${res.status}).`);
  writeConfig({ server: url.origin, agentId: data.agentId!, token: data.token, name, repos: previous?.repos ?? [], capabilities: previous?.capabilities ?? [] });
  console.log(`✓ Paired with ${url.origin} as "${name}".`);
  if (!previous?.repos.length) console.log("  Next: release-agent add-repo <path to your plugin checkout> [--recipe <file>]");
  else console.log("  Next: release-agent start");
}

async function addRepo() {
  const config = needConfig();
  if (!arg) fail("usage: release-agent add-repo <path> [--recipe <file>] [--name <name>]");
  const repo = path.resolve(arg);
  if (!existsSync(path.join(repo, ".git"))) fail(`${repo} isn't a git checkout.`);
  const recipe = values.recipe ? resolveRecipe(values.recipe) : defaultRecipe(repo);
  if (!recipe) {
    const names = builtinRecipes().map((r) => r.name).join(", ");
    fail(
      values.recipe
        ? `No recipe "${values.recipe}" — give a file path, or a built-in one: ${names || "none"}.`
        : `No recipe at ${path.join(repo, ".release/recipe.json")}. Pass one with --recipe <file or name>. Built-in: ${names || "none"}.`
    );
  }
  const opened = await openRecipe(recipe).catch((e: Error) => fail(e.message));
  const name = values.name ?? opened.recipe.name;
  const id = slug(name);
  config.repos = [...config.repos.filter((r) => r.id !== id), { id, name, path: repo, recipe }];
  writeConfig(config);
  console.log(`✓ ${name}: ${opened.recipe.stages.length} stages from ${recipe}`);
  console.log("  Run `release-agent start` (or restart it) to serve it.");
}

function removeRepo() {
  const config = needConfig();
  const before = config.repos.length;
  config.repos = config.repos.filter((r) => r.id !== arg);
  if (config.repos.length === before) fail(`No repo "${arg}". See: release-agent repos`);
  writeConfig(config);
  console.log(`✓ Removed ${arg}.`);
}

/** Download the agent from the paired server (with this agent's token) and install it globally. */
async function update() {
  const config = needConfig();
  const res = await fetch(new URL("/api/agent/download", config.server), { headers: { authorization: `Bearer ${config.token}` } });
  if (!res.ok) fail(`Couldn't download the agent (HTTP ${res.status}). ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ""}`);
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(path.join(tmpdir(), "release-agent-"));
  const file = path.join(dir, "release-agent.tgz");
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`Installing the agent from ${config.server}…`);
  const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "-g", "--no-audit", "--no-fund", file], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  if (npm.status !== 0) fail("npm install failed (see above).");
  console.log("✓ Updated. Restart it: release-agent start");
}

function listRecipes() {
  const list = builtinRecipes();
  if (!list.length) console.log("No built-in recipes.");
  for (const r of list) console.log(`  ${r.name.padEnd(20)} ${r.file}`);
}

function listRepos() {
  const config = needConfig();
  console.log(`Paired with ${config.server} as "${config.name}"`);
  if (!config.repos.length) console.log("  no repos yet — release-agent add-repo <path>");
  for (const r of config.repos) console.log(`  ${r.id.padEnd(24)} ${r.path}\n  ${"".padEnd(24)} recipe: ${r.recipe}`);
}

async function start() {
  const config = needConfig();
  if (!config.repos.length) fail("No repos yet. Add one: release-agent add-repo <path> [--recipe <file>]");
  const fake = process.env.RELEASE_AGENT_FAKE === "1";
  if (fake) console.log("Fake mode: runs are a scripted session — no Claude calls, no repo changes.");
  const agent = new Agent(config, { fake });
  await agent.load();
  const quit = () => {
    console.log("\nStopping (any active run is marked interrupted)…");
    agent.stop();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  await agent.run();
}

const commands: Record<string, () => unknown> = { pair, "add-repo": addRepo, "remove-repo": removeRepo, repos: listRepos, recipes: listRecipes, update, start };
const run = commands[command ?? ""];
if (!run) {
  console.log(`release-agent ${AGENT_VERSION}

  pair <CODE> --server <url> [--name <name>]   connect this machine (code from the Releases page)
  add-repo <path> [--recipe <file|name>]       serve a repo (recipe defaults to <path>/.release/recipe.json)
  recipes                                      list the recipes that ship with the agent
  update                                       install the latest agent from the paired server
  remove-repo <id>                             stop serving a repo
  repos                                        show the config
  start                                        connect and wait for commands`);
  process.exit(command ? 1 : 0);
}
await run();
