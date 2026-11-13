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
 *
 * The Release Console web app (no Nonaki server needed):
 *   release-agent link <app URL> --code <CODE> [--tunnel <https URL>] [--port 7420]
 *   release-agent allow <folder>... / disallow <folder>
 *   release-agent serve [--tunnel <https URL>] [--port 7420]
 *   release-agent tunnel setup --hostname agent.example.com [--name <tunnel>] [--overwrite-dns]
 *   release-agent tunnel run | status | remove [--delete]
 *   release-agent autostart on | off | status
 */

import { spawn } from "node:child_process";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { Agent, AGENT_VERSION, detectCapabilities } from "../agent/agent.ts";
import { agentHome, builtinRecipes, DEFAULT_GATEWAY_PORT, defaultRecipe, readConfig, resolveRecipe, slug, writeConfig, type AgentConfig } from "../agent/config.ts";
import { checkAppUrl, expandFolder, linkMachine, sendHeartbeat } from "../gateway/link.ts";
import { startGateway, type ProjectManager } from "../gateway/server.ts";
import { LiveHub } from "../gateway/live.ts";
import { checkHostname, defaultTunnelName, findCloudflared, installHint, interactiveLogin, runCommand, setupTunnel, tunnelRunArgs } from "../tunnel/cloudflared.ts";
import { autostartFor, type ServiceSpec } from "../tunnel/autostart.ts";
import { checkProject, cleanName, discoverRepos, listRecipes as recipesForWeb, ProjectError, projectId, real } from "../gateway/projects.ts";
import { openRecipe } from "../recipe/load.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string" },
    name: { type: "string" },
    recipe: { type: "string" },
    capability: { type: "string", multiple: true },
    code: { type: "string" },
    tunnel: { type: "string" },
    port: { type: "string" },
    hostname: { type: "string" },
    "overwrite-dns": { type: "boolean" },
    delete: { type: "boolean" },
    "skip-autostart": { type: "boolean" },
  },
});
const [command, arg] = positionals;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** The config, or a fresh one: repos can be added before pairing with anything. */
function loadConfig(): AgentConfig {
  return readConfig() ?? { name: hostname().replace(/\.local$/, ""), repos: [], capabilities: [] };
}

/** For the Nonaki commands, which need `release-agent pair` first. */
function needConfig(): AgentConfig & { server: string; token: string } {
  const config = readConfig();
  if (!config?.server || !config.token) fail("Not paired yet. Make a code on the Releases page, then run: release-agent pair <CODE> --server <url>");
  return config as AgentConfig & { server: string; token: string };
}

function portOption(fallback: number): number {
  if (values.port === undefined) return fallback;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("--port must be a port number.");
  return port;
}

function tunnelOption(): string | undefined {
  if (values.tunnel === undefined) return undefined;
  try {
    return checkAppUrl(values.tunnel, "--tunnel").origin;
  } catch (e) {
    fail((e as Error).message);
  }
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
  writeConfig({ ...previous, server: url.origin, agentId: data.agentId!, token: data.token, name, repos: previous?.repos ?? [], capabilities: previous?.capabilities ?? [] });
  console.log(`✓ Paired with ${url.origin} as "${name}".`);
  if (!previous?.repos.length) console.log("  Next: release-agent add-repo <path to your plugin checkout> [--recipe <file>]");
  else console.log("  Next: release-agent start");
}

async function addRepo() {
  const config = loadConfig();
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
  const config = loadConfig();
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
  const { mkdtempSync, writeFileSync } = await import("node:fs");
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
  const config = loadConfig();
  if (config.server) console.log(`Paired with ${config.server} as "${config.name}"`);
  if (config.web) console.log(`Linked to ${config.web.app} as "${config.web.machineName}" (${config.web.ownerEmail})${config.web.revoked ? " · REVOKED" : ""}`);
  if (config.allowedRoots?.length) console.log(`  allowed folders: ${config.allowedRoots.join(", ")}`);
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

// ── the Release Console web app ──────────────────────────────────────────

async function link() {
  if (!arg || !values.code) fail("usage: release-agent link <app URL> --code <CODE> [--tunnel https://agent.example.com] [--port 7420]");
  const config = loadConfig();
  const port = portOption(config.web?.port ?? DEFAULT_GATEWAY_PORT);
  const tunnelUrl = tunnelOption() ?? config.web?.tunnelUrl ?? (config.tunnel ? `https://${config.tunnel.hostname}` : undefined);
  try {
    config.web = await linkMachine({ app: arg, code: values.code, version: AGENT_VERSION, tunnelUrl, port, allowedRoots: config.allowedRoots ?? [] });
  } catch (e) {
    fail((e as Error).message);
  }
  writeConfig(config);
  console.log(`✓ Linked to ${config.web.app} as "${config.web.machineName}", for ${config.web.ownerEmail}.`);
  if (!config.allowedRoots?.length) console.log("  Next: release-agent allow <folder>   (where your repos live, e.g. ~/Projects)");
  if (!tunnelUrl) console.log("  Then: release-agent tunnel setup --hostname agent.<your domain>   (or serve --tunnel https://…)");
  else console.log("  Next: release-agent autostart on   (or run release-agent serve yourself)");
}

function allow() {
  const folders = positionals.slice(1);
  if (!folders.length) fail("usage: release-agent allow <folder>...   e.g. release-agent allow ~/Projects \"~/Local Sites\"");
  const config = loadConfig();
  const roots = new Set(config.allowedRoots ?? []);
  for (const folder of folders) {
    // The real location, so the web app's paths and these folders compare like for like.
    const abs = real(expandFolder(folder));
    if (!abs) fail(`${expandFolder(folder)} doesn't exist.`);
    if (abs === "/" || abs === expandFolder("~")) fail(`Allow a folder that holds your repos, not ${abs}: the web app can add projects from anywhere inside it.`);
    roots.add(abs);
  }
  config.allowedRoots = [...roots].sort();
  writeConfig(config);
  console.log(`✓ The web app may add projects from:\n${config.allowedRoots.map((r) => `  ${r}`).join("\n")}`);
  if (config.web) console.log("  Restart `release-agent serve` to tell the web app.");
}

function disallow() {
  if (!arg) fail("usage: release-agent disallow <folder>");
  const config = loadConfig();
  const abs = real(expandFolder(arg)) ?? expandFolder(arg);
  const before = config.allowedRoots ?? [];
  config.allowedRoots = before.filter((r) => r !== abs);
  if (config.allowedRoots.length === before.length) fail(`${abs} isn't allowed. See: release-agent repos`);
  writeConfig(config);
  console.log(`✓ No longer allowed: ${abs}`);
}

/** Serve every repo's console through the gateway, for the web app, and check in with it every minute. */
async function serve() {
  const config = loadConfig();
  const web = config.web;
  if (!web) fail("Not linked yet. Add this machine on the web app, then run: release-agent link <app URL> --code <CODE>");
  const tunnel = tunnelOption();
  if (tunnel) web.tunnelUrl = tunnel;
  web.port = portOption(web.port);
  writeConfig(config);
  if (web.revoked) console.log("! The web app revoked this machine; requests will be refused until you link it again.");
  if (!web.tunnelUrl) console.log("! No tunnel URL yet: the web app can't reach this machine. Pass --tunnel https://<your tunnel hostname>.");

  const fake = process.env.RELEASE_AGENT_FAKE === "1";
  const agent = new Agent(config, { fake });
  await agent.load();
  const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);
  let revoked = Boolean(web.revoked);
  const tunnelHosts = web.tunnelUrl ? [new URL(web.tunnelUrl).host] : [];

  // Live status for the web app: works only while a browser is watching.
  const live = new LiveHub({ projects: () => agent.gatewayProjects() });

  // The web app's Add project / Remove: checked here, on the machine.
  const manage: ProjectManager = {
    discover: () => discoverRepos(config.allowedRoots ?? [], config.repos),
    recipes: () => recipesForWeb(),
    check: (body) => checkProject(body, config.allowedRoots ?? []),
    add: async (body, who) => {
      const checked = await checkProject(body, config.allowedRoots ?? []);
      const existing = config.repos.find((r) => (real(r.path) ?? r.path) === checked.path);
      if (existing) throw new ProjectError(409, `This machine already serves that folder as "${existing.name}".`);
      const name = cleanName(body.name, checked.name);
      const repo = { id: projectId(name, config.repos.map((r) => r.id)), name, path: checked.path, recipe: checked.recipeFile };
      await agent.addRepo(repo);
      config.repos.push(repo);
      writeConfig(config);
      log(`${who} added the project "${name}" (${checked.path}) from the web app`);
      live.poke();
      return {
        project: { id: repo.id, name, path: checked.path, recipe: checked.recipe, recipeTitle: checked.recipeTitle, githubRepo: checked.githubRepo, branch: checked.branch },
      };
    },
    setRecipe: async (id, body, who) => {
      const repo = config.repos.find((r) => r.id === id);
      if (!repo) throw new ProjectError(404, "This machine doesn't serve that project.");
      const checked = await checkProject({ path: repo.path, recipe: body.recipe }, config.allowedRoots ?? []);
      // Switching restarts its console, which would cut off a run.
      const port = agent.gatewayProjects().find((p) => p.id === id)?.port;
      if (port) {
        const busy = (await fetch(`http://127.0.0.1:${port}/api/live`).then((r) => r.json(), () => null)) as { run?: { active?: boolean } | null; chat?: { active?: boolean } | null } | null;
        if (busy?.run?.active || busy?.chat?.active) throw new ProjectError(409, "A run or agent session is going in this project. Change the recipe when it's done.");
      }
      agent.removeRepo(id);
      const updated = { ...repo, recipe: checked.recipeFile };
      await agent.addRepo(updated);
      config.repos = config.repos.map((r) => (r.id === id ? updated : r));
      writeConfig(config);
      log(`${who} switched "${repo.name}" to the recipe ${checked.recipe} from the web app`);
      live.poke();
      return { project: { id, recipe: checked.recipe, recipeTitle: checked.recipeTitle, stages: checked.stages.length } };
    },
    remove: async (id, who) => {
      const repo = config.repos.find((r) => r.id === id);
      if (!repo) return false;
      agent.removeRepo(id);
      config.repos = config.repos.filter((r) => r.id !== id);
      writeConfig(config);
      log(`${who} removed the project "${repo.name}" from the web app (its folder is untouched)`);
      live.poke();
      return true;
    },
  };

  let server: Awaited<ReturnType<typeof startGateway>>;
  try {
    server = await startGateway(
      {
        appOrigin: web.app,
        machineId: web.machineId,
        ownerId: web.ownerId,
        publicKey: web.publicKey,
        tunnelHosts,
        projects: () => agent.gatewayProjects(),
        version: AGENT_VERSION,
        revoked: () => revoked,
        manage,
        live,
        log,
      },
      web.port
    );
  } catch (e) {
    agent.stop();
    fail(`Couldn't listen on 127.0.0.1:${web.port}: ${(e as Error).message}. Pick another with --port.`);
  }
  log(`gateway on http://127.0.0.1:${web.port}${web.tunnelUrl ? `, published at ${web.tunnelUrl}` : ""} · ${config.repos.length} project${config.repos.length === 1 ? "" : "s"} · for ${web.ownerEmail}`);
  if (web.tunnelUrl) log(`point your Cloudflare Tunnel at http://127.0.0.1:${web.port}`);

  let wasOk: boolean | null = null;
  const beat = async () => {
    const result = await sendHeartbeat(web, { version: AGENT_VERSION, allowedRoots: config.allowedRoots ?? [] });
    if (result.ok) {
      if (wasOk !== true) log(`checked in with ${web.app}`);
      if (revoked) {
        revoked = false;
        web.revoked = false;
        writeConfig(config);
      }
    } else if (result.revoked) {
      if (!revoked) log("the web app revoked this machine: refusing every request until it's linked again");
      revoked = true;
      web.revoked = true;
      writeConfig(config);
    } else if (wasOk !== false) log(`can't reach ${web.app}: ${result.error} (still serving; retrying every minute)`);
    wasOk = result.ok;
  };
  await beat();
  const timer = setInterval(() => void beat(), 60_000);

  const quit = () => {
    console.log("\nStopping (any active run is marked interrupted)…");
    clearInterval(timer);
    live.close();
    server.close();
    agent.stop();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}

// ── Cloudflare Tunnel, and starting at login ─────────────────────────────

const TUNNEL_CONFIG = () => path.join(agentHome(), "cloudflared.yml");

function needCloudflared(): string {
  const bin = findCloudflared();
  if (!bin) fail(`cloudflared isn't installed. Install it (${installHint()}), then run this again.`);
  return bin;
}

async function tunnelCommand() {
  const sub = arg;
  const config = loadConfig();

  if (sub === "setup") {
    if (!values.hostname) fail("usage: release-agent tunnel setup --hostname agent.example.com [--name <tunnel>] [--overwrite-dns] [--skip-autostart]");
    let hostname: string;
    try {
      hostname = checkHostname(values.hostname);
    } catch (e) {
      fail((e as Error).message);
    }
    const bin = needCloudflared();
    const port = portOption(config.web?.port ?? DEFAULT_GATEWAY_PORT);
    const name = values.name ?? config.tunnel?.name ?? defaultTunnelName();
    let setup;
    try {
      setup = await setupTunnel({
        hostname,
        name,
        port,
        configFile: TUNNEL_CONFIG(),
        bin,
        login: () => interactiveLogin(bin),
        overwriteDns: values["overwrite-dns"],
        log: (m) => console.log(`  ${m}`),
      });
    } catch (e) {
      fail((e as Error).message);
    }
    config.tunnel = { name: setup.name, id: setup.id, hostname: setup.hostname, configFile: setup.configFile };
    if (config.web) {
      config.web.tunnelUrl = `https://${setup.hostname}`;
      config.web.port = port;
    }
    writeConfig(config);
    console.log(`✓ https://${setup.hostname} → this machine's gateway (127.0.0.1:${port}), through the tunnel "${setup.name}".`);
    if (!config.web) {
      console.log("  Next: link this machine: release-agent link <app URL> --code <CODE>   (the tunnel address is used automatically)");
      return;
    }
    if (values["skip-autostart"]) {
      console.log("  Start it: release-agent tunnel run   (and release-agent serve), or: release-agent autostart on");
      return;
    }
    await autostartOn(config);
    return;
  }

  if (sub === "run") {
    if (!config.tunnel) fail("No tunnel yet. Run: release-agent tunnel setup --hostname agent.example.com");
    const bin = needCloudflared();
    const child = spawn(bin, tunnelRunArgs(config.tunnel.configFile), { stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    child.on("close", (code) => process.exit(code ?? 0));
    return;
  }

  if (sub === "status") {
    if (!config.tunnel) {
      console.log("No tunnel yet. Set one up: release-agent tunnel setup --hostname agent.example.com");
      return;
    }
    const { hostname, name } = config.tunnel;
    console.log(`Tunnel "${name}": https://${hostname} → 127.0.0.1:${config.web?.port ?? DEFAULT_GATEWAY_PORT}`);
    const service = await autostartFor().status("tunnel");
    console.log(`  started at login: ${service.installed ? (service.running ? `yes, running (pid ${service.pid})` : "yes, but not running") : "no"}`);
    try {
      const res = await fetch(`https://${hostname}/health`, { signal: AbortSignal.timeout(10_000) });
      const body = (await res.json().catch(() => ({}))) as { gateway?: string; machineId?: string };
      if (res.ok && body.gateway === "release-agent") console.log(`  ✓ reachable: the gateway answers at https://${hostname}`);
      else console.log(`  ✗ https://${hostname} answered HTTP ${res.status}, not the gateway. Is release-agent serve running?`);
    } catch (e) {
      console.log(`  ✗ can't reach https://${hostname}: ${(e as Error).message}. Is the tunnel running? (release-agent tunnel run, or autostart on)`);
    }
    return;
  }

  if (sub === "remove") {
    if (!config.tunnel) fail("No tunnel to remove.");
    await autostartFor().uninstall("tunnel").catch(() => false);
    const { name, hostname } = config.tunnel;
    if (values.delete) {
      const bin = needCloudflared();
      const res = await runCommand(bin, ["tunnel", "delete", "-f", name]);
      if (res.code !== 0) fail(`cloudflared couldn't delete the tunnel: ${res.stderr.trim()}`);
      console.log(`✓ Deleted the tunnel "${name}". Remove the DNS record for ${hostname} in Cloudflare if you won't reuse it.`);
    }
    rmSync(config.tunnel.configFile, { force: true });
    delete config.tunnel;
    writeConfig(config);
    console.log(`✓ This machine no longer publishes https://${hostname}.${values.delete ? "" : " (The tunnel still exists in Cloudflare; add --delete to delete it.)"}`);
    return;
  }

  fail("usage: release-agent tunnel setup --hostname <host> | run | status | remove [--delete]");
}

/** What `serve` runs as at login: this same CLI, with the current PATH. */
function serveSpec(): ServiceSpec {
  const cli = realpathSync(process.argv[1]);
  return {
    name: "serve",
    program: [process.execPath, ...process.execArgv, cli, "serve"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      ...(process.env.RELEASE_AGENT_HOME ? { RELEASE_AGENT_HOME: process.env.RELEASE_AGENT_HOME } : {}),
    },
    logFile: path.join(agentHome(), "logs", "serve.log"),
  };
}

async function autostartOn(config: AgentConfig) {
  if (!config.web) fail("Link this machine first: release-agent link <app URL> --code <CODE>");
  const auto = autostartFor();
  if (!auto.supported) fail("Starting at login isn't built in on this system yet. Run release-agent serve and release-agent tunnel run yourself.");
  try {
    await auto.install(serveSpec());
    console.log(`✓ The gateway starts at login (log: ${path.join(agentHome(), "logs", "serve.log")}).`);
    if (config.tunnel) {
      await auto.install({
        name: "tunnel",
        program: [needCloudflared(), ...tunnelRunArgs(config.tunnel.configFile)],
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "" },
        logFile: path.join(agentHome(), "logs", "tunnel.log"),
      });
      console.log(`✓ The tunnel starts at login (log: ${path.join(agentHome(), "logs", "tunnel.log")}).`);
    } else {
      console.log("  No tunnel yet, so only the gateway starts. Set one up: release-agent tunnel setup --hostname agent.example.com");
    }
  } catch (e) {
    fail((e as Error).message);
  }
  console.log("  Both are running now, and restart if they stop. Check: release-agent autostart status");
}

async function autostart() {
  const config = loadConfig();
  const auto = autostartFor();
  if (arg === "on") return autostartOn(config);
  if (arg === "off") {
    const a = await auto.uninstall("serve").catch(() => false);
    const b = await auto.uninstall("tunnel").catch(() => false);
    console.log(a || b ? "✓ Stopped, and they won't start at login any more." : "Nothing was set to start at login.");
    return;
  }
  if (arg === "status") {
    for (const name of ["serve", "tunnel"] as const) {
      const s = await auto.status(name);
      console.log(`  ${name === "serve" ? "gateway" : "tunnel "}: ${s.installed ? (s.running ? `running (pid ${s.pid})` : "set to start at login, but not running") : "not set to start at login"}`);
    }
    return;
  }
  fail("usage: release-agent autostart on | off | status");
}

const commands: Record<string, () => unknown> = {
  pair,
  "add-repo": addRepo,
  "remove-repo": removeRepo,
  repos: listRepos,
  recipes: listRecipes,
  update,
  start,
  link,
  allow,
  disallow,
  serve,
  tunnel: tunnelCommand,
  autostart,
};
const run = commands[command ?? ""];
if (!run) {
  console.log(`release-agent ${AGENT_VERSION}

  pair <CODE> --server <url> [--name <name>]   connect this machine (code from the Releases page)
  add-repo <path> [--recipe <file|name>]       serve a repo (recipe defaults to <path>/.release/recipe.json)
  recipes                                      list the recipes that ship with the agent
  update                                       install the latest agent from the paired server
  remove-repo <id>                             stop serving a repo
  repos                                        show the config
  start                                        connect and wait for commands

  The Release Console web app:
  link <app URL> --code <CODE> [--tunnel <url>] link this machine (code from the web app)
  allow <folder>... / disallow <folder>        folders the web app may add projects from
  serve [--tunnel <url>] [--port 7420]         serve your projects to the web app
  tunnel setup --hostname agent.example.com    publish the gateway with a Cloudflare Tunnel
  tunnel run | status | remove [--delete]      run it here, check it, or take it down
  autostart on | off | status                  start the gateway and tunnel at login`);
  process.exit(command ? 1 : 0);
}
await run();
