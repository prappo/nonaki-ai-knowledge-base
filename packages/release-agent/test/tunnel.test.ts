/**
 * Publishing the gateway with a Cloudflare Tunnel, and starting it at login.
 * A fake cloudflared and launchctl stand in, so nothing reaches Cloudflare
 * or the real login items.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkHostname, defaultTunnelName, setupTunnel, tunnelConfigYaml, type Runner } from "../src/tunnel/cloudflared.ts";
import { autostartFor, launchdPlist, systemdUnit, type ServiceSpec } from "../src/tunnel/autostart.ts";

const base = mkdtempSync(path.join(tmpdir(), "tunnel-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A cloudflared that remembers tunnels and DNS records, and logs every call. */
function fakeCloudflared(cfHome: string, opts: { dnsTaken?: boolean; tunnels?: { id: string; name: string }[] } = {}) {
  const tunnels = [...(opts.tunnels ?? [])];
  const calls: string[][] = [];
  const run: Runner = async (_bin, args) => {
    calls.push(args);
    const [, sub] = args;
    if (sub === "list") return { code: 0, stdout: JSON.stringify(tunnels), stderr: "" };
    if (sub === "create") {
      const id = "11111111-2222-3333-4444-555555555555";
      tunnels.push({ id, name: args[2] });
      writeFileSync(path.join(cfHome, `${id}.json`), "{}");
      return { code: 0, stdout: `Created tunnel ${args[2]} with id ${id}`, stderr: "" };
    }
    if (sub === "route") {
      if (opts.dnsTaken && !args.includes("--overwrite-dns")) return { code: 1, stdout: "", stderr: "Failed to add route: code: 1003, reason: An A, AAAA, or CNAME record with that host already exists." };
      return { code: 0, stdout: "", stderr: "Added CNAME" };
    }
    return { code: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
  };
  return { run, calls, tunnels };
}

function cfHomeSignedIn() {
  const dir = mkdtempSync(path.join(base, "cf-"));
  writeFileSync(path.join(dir, "cert.pem"), "cert");
  return dir;
}

describe("checkHostname", () => {
  it("takes a hostname, and refuses what isn't one", () => {
    expect(checkHostname("Agent.Example.com")).toBe("agent.example.com");
    expect(checkHostname("https://agent.example.com/")).toBe("agent.example.com");
    for (const bad of ["localhost", "agent", "1.2.3.4", "-x.example.com", "a..b.com", "agent.example.com/path", "a b.com"]) {
      expect(() => checkHostname(bad), bad).toThrow();
    }
  });

  it("names the tunnel after the machine", () => {
    expect(defaultTunnelName("Prappos-MacBook-Pro.local")).toBe("release-agent-prappos-macbook-pro");
  });
});

describe("setupTunnel", () => {
  it("creates the tunnel, routes the hostname, and writes a config that only reaches the gateway", async () => {
    const cfHome = cfHomeSignedIn();
    const cf = fakeCloudflared(cfHome);
    const configFile = path.join(base, "a", "cloudflared.yml");
    const setup = await setupTunnel({ hostname: "agent.example.com", name: "release-agent-mac", port: 7420, configFile, bin: "cloudflared", run: cf.run, login: async () => false, cfHome });

    expect(setup).toMatchObject({ name: "release-agent-mac", id: "11111111-2222-3333-4444-555555555555", hostname: "agent.example.com" });
    expect(cf.calls.map((c) => c.slice(0, 3).join(" "))).toEqual(["tunnel list --output", "tunnel create release-agent-mac", "tunnel list --output", "tunnel route dns"]);
    expect(cf.calls.at(-1)).toEqual(["tunnel", "route", "dns", setup.id, "agent.example.com"]);
    const yaml = readFileSync(configFile, "utf8");
    expect(yaml).toContain('hostname: "agent.example.com"');
    expect(yaml).toContain('service: "http://127.0.0.1:7420"');
    expect(yaml).toMatch(/- service: http_status:404\n$/); // everything else: 404
  });

  it("reuses an existing tunnel of that name", async () => {
    const cfHome = cfHomeSignedIn();
    writeFileSync(path.join(cfHome, "abc.json"), "{}");
    const cf = fakeCloudflared(cfHome, { tunnels: [{ id: "abc", name: "release-agent-mac" }] });
    await setupTunnel({ hostname: "agent.example.com", name: "release-agent-mac", port: 7420, configFile: path.join(base, "b.yml"), bin: "cloudflared", run: cf.run, login: async () => false, cfHome });
    expect(cf.calls.some((c) => c[1] === "create")).toBe(false);
  });

  it("won't take over someone's DNS record unless told to", async () => {
    const cfHome = cfHomeSignedIn();
    const input = { hostname: "agent.example.com", name: "t", port: 7420, configFile: path.join(base, "c.yml"), bin: "cloudflared", login: async () => false, cfHome };
    await expect(setupTunnel({ ...input, run: fakeCloudflared(cfHome, { dnsTaken: true }).run })).rejects.toThrow(/already has a DNS record.*--overwrite-dns/);
    const cf = fakeCloudflared(cfHome, { dnsTaken: true });
    await setupTunnel({ ...input, run: cf.run, overwriteDns: true });
    expect(cf.calls.at(-1)).toContain("--overwrite-dns");
  });

  it("explains a tunnel made on another machine", async () => {
    const cfHome = cfHomeSignedIn();
    const cf = fakeCloudflared(cfHome, { tunnels: [{ id: "elsewhere", name: "t" }] });
    await expect(setupTunnel({ hostname: "agent.example.com", name: "t", port: 7420, configFile: path.join(base, "d.yml"), bin: "cloudflared", run: cf.run, login: async () => false, cfHome })).rejects.toThrow(
      /doesn't have its credentials/
    );
  });

  it("signs in first when this machine hasn't", async () => {
    const cfHome = mkdtempSync(path.join(base, "cf-"));
    let asked = false;
    const login = async () => {
      asked = true;
      writeFileSync(path.join(cfHome, "cert.pem"), "cert");
      return true;
    };
    await setupTunnel({ hostname: "agent.example.com", name: "t", port: 7420, configFile: path.join(base, "e.yml"), bin: "cloudflared", run: fakeCloudflared(cfHome).run, login, cfHome });
    expect(asked).toBe(true);
    await expect(
      setupTunnel({ hostname: "agent.example.com", name: "t", port: 7420, configFile: path.join(base, "f.yml"), bin: "cloudflared", run: fakeCloudflared(mkdtempSync(path.join(base, "cf-"))).run, login: async () => false, cfHome: mkdtempSync(path.join(base, "cf-")) })
    ).rejects.toThrow(/sign-in didn't finish/);
  });
});

describe("tunnelConfigYaml", () => {
  it("quotes paths with spaces", () => {
    expect(tunnelConfigYaml({ id: "x", credentialsFile: "/Users/a b/.cloudflared/x.json", hostname: "h.example.com", port: 7420 })).toContain('credentials-file: "/Users/a b/.cloudflared/x.json"');
  });
});

describe("autostart", () => {
  const spec: ServiceSpec = {
    name: "serve",
    program: ["/usr/local/bin/node", "/Users/a b/release-agent.mjs", "serve"],
    env: { PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/Users/a b" },
    logFile: "/Users/a b/.release-agent/logs/serve.log",
  };

  it("writes a launchd agent that starts at login and restarts", () => {
    const plist = launchdPlist(spec);
    expect(plist).toContain("<string>dev.release-agent.serve</string>");
    expect(plist).toContain("<string>/Users/a b/release-agent.mjs</string>");
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(launchdPlist({ ...spec, program: ["/x/a&b<c>"] })).toContain("/x/a&amp;b&lt;c&gt;");
  });

  it("writes a systemd user service", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain('ExecStart="/usr/local/bin/node" "/Users/a b/release-agent.mjs" "serve"');
    expect(unit).toContain('Environment="PATH=/opt/homebrew/bin:/usr/bin"');
    expect(unit).toContain("Restart=always");
  });

  it("installs, reports and removes a launchd agent", async () => {
    const home = mkdtempSync(path.join(base, "home-"));
    mkdirSync(path.join(home, "Library"), { recursive: true });
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[0] === "print") return { code: 0, stdout: "state = running\n\tpid = 4242\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const auto = autostartFor("darwin", run, home, 501);
    await auto.install({ ...spec, logFile: path.join(home, "logs", "serve.log") });
    expect(existsSync(auto.file("serve"))).toBe(true);
    expect(calls).toContainEqual(["launchctl", "bootstrap", "gui/501", auto.file("serve")]);
    expect(await auto.status("serve")).toEqual({ installed: true, running: true, pid: 4242 });
    expect(await auto.uninstall("serve")).toBe(true);
    expect(existsSync(auto.file("serve"))).toBe(false);
    expect(calls.at(-1)).toEqual(["launchctl", "bootout", "gui/501/dev.release-agent.serve"]);
  });

  it("says so where it isn't built in", async () => {
    const auto = autostartFor("win32");
    expect(auto.supported).toBe(false);
    await expect(auto.install(spec)).rejects.toThrow(/isn't built in/);
  });
});
