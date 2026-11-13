/**
 * Starting the gateway (`release-agent serve`) and its tunnel at login, and
 * restarting them if they stop: a launchd agent on macOS, a systemd user
 * service on Linux, a Task Scheduler task at logon on Windows (running a
 * hidden PowerShell loop that restarts it). Each gets the PATH of the shell that turned it on, so
 * git, gh, node and Claude are found as they are in the terminal.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { runCommand, type Runner } from "./cloudflared.ts";

export type ServiceName = "serve" | "tunnel";

export interface ServiceSpec {
  name: ServiceName;
  /** What it runs: the program, then its arguments. */
  program: string[];
  env: Record<string, string>;
  logFile: string;
}

const LABEL = (name: ServiceName) => `dev.release-agent.${name}`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function launchdPlist(spec: ServiceSpec): string {
  const strings = (items: string[]) => items.map((i) => `    <string>${xml(i)}</string>`).join("\n");
  const env = Object.entries(spec.env)
    .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL(spec.name)}</string>
  <key>ProgramArguments</key>
  <array>
${strings(spec.program)}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(spec.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(spec.logFile)}</string>
</dict>
</plist>
`;
}

export function systemdUnit(spec: ServiceSpec): string {
  // systemd splits ExecStart on spaces; quote each argument.
  const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const env = Object.entries(spec.env)
    .map(([k, v]) => `Environment=${quote(`${k}=${v}`)}`)
    .join("\n");
  return `[Unit]
Description=release-agent ${spec.name === "serve" ? "gateway" : "Cloudflare Tunnel"}
After=network-online.target

[Service]
ExecStart=${spec.program.map(quote).join(" ")}
${env}
Restart=always
RestartSec=10
StandardOutput=append:${spec.logFile}
StandardError=append:${spec.logFile}

[Install]
WantedBy=default.target
`;
}

/** PowerShell single-quoted string. */
const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The loop a Windows logon task runs, hidden: start the program, append its
 * output to the log, and start it again 10 seconds after it stops. It writes
 * its PID so `autostart off` can stop it and what it started.
 */
export function windowsLoopScript(spec: ServiceSpec, pidFile: string): string {
  const [program, ...args] = spec.program;
  const env = Object.entries(spec.env)
    .map(([k, v]) => `$env:${k} = ${ps(v)}`)
    .join("\r\n");
  return [
    "# Written by release-agent (release-agent autostart on).",
    "$ErrorActionPreference = 'Continue'",
    env,
    `Set-Content -Path ${ps(pidFile)} -Value $PID`,
    "while ($true) {",
    `  & ${ps(program)} ${args.map(ps).join(" ")} *>> ${ps(spec.logFile)}`,
    "  Start-Sleep -Seconds 10",
    "}",
    "",
  ].join("\r\n");
}

export const windowsTaskName = (name: ServiceName) => `release-agent ${name}`;

/** What Task Scheduler runs at logon: the loop, in a hidden PowerShell window. */
export function windowsTaskCommand(scriptFile: string): string {
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptFile}"`;
}

export interface Autostart {
  supported: boolean;
  install(spec: ServiceSpec): Promise<void>;
  uninstall(name: ServiceName): Promise<boolean>;
  status(name: ServiceName): Promise<{ installed: boolean; running: boolean; pid: number | null }>;
  file(name: ServiceName): string;
}

export function autostartFor(platform = process.platform, run: Runner = runCommand, home = homedir(), uid = process.getuid?.() ?? 0): Autostart {
  if (platform === "darwin") {
    const file = (name: ServiceName) => path.join(home, "Library", "LaunchAgents", `${LABEL(name)}.plist`);
    const domain = `gui/${uid}`;
    return {
      supported: true,
      file,
      async install(spec) {
        mkdirSync(path.dirname(file(spec.name)), { recursive: true });
        mkdirSync(path.dirname(spec.logFile), { recursive: true });
        writeFileSync(file(spec.name), launchdPlist(spec));
        await run("launchctl", ["bootout", `${domain}/${LABEL(spec.name)}`]); // an older copy, if loaded
        const res = await run("launchctl", ["bootstrap", domain, file(spec.name)]);
        if (res.code !== 0) throw new Error(`launchctl couldn't start ${LABEL(spec.name)}: ${res.stderr.trim() || res.stdout.trim()}`);
      },
      async uninstall(name) {
        const had = existsSync(file(name));
        await run("launchctl", ["bootout", `${domain}/${LABEL(name)}`]);
        rmSync(file(name), { force: true });
        return had;
      },
      async status(name) {
        const res = await run("launchctl", ["print", `${domain}/${LABEL(name)}`]);
        const pid = Number(res.stdout.match(/\bpid = (\d+)/)?.[1] ?? 0) || null;
        return { installed: existsSync(file(name)), running: res.code === 0 && /state = running/.test(res.stdout), pid };
      },
    };
  }

  if (platform === "linux") {
    const unit = (name: ServiceName) => `release-agent-${name}.service`;
    const file = (name: ServiceName) => path.join(home, ".config", "systemd", "user", unit(name));
    return {
      supported: true,
      file,
      async install(spec) {
        mkdirSync(path.dirname(file(spec.name)), { recursive: true });
        mkdirSync(path.dirname(spec.logFile), { recursive: true });
        writeFileSync(file(spec.name), systemdUnit(spec));
        await run("systemctl", ["--user", "daemon-reload"]);
        const res = await run("systemctl", ["--user", "enable", "--now", unit(spec.name)]);
        if (res.code !== 0) throw new Error(`systemctl couldn't start ${unit(spec.name)}: ${res.stderr.trim() || res.stdout.trim()}`);
        await run("systemctl", ["--user", "restart", unit(spec.name)]);
      },
      async uninstall(name) {
        const had = existsSync(file(name));
        await run("systemctl", ["--user", "disable", "--now", unit(name)]);
        rmSync(file(name), { force: true });
        await run("systemctl", ["--user", "daemon-reload"]);
        return had;
      },
      async status(name) {
        const res = await run("systemctl", ["--user", "show", unit(name), "--property=ActiveState,MainPID"]);
        const pid = Number(res.stdout.match(/MainPID=(\d+)/)?.[1] ?? 0) || null;
        return { installed: existsSync(file(name)), running: /ActiveState=active/.test(res.stdout), pid };
      },
    };
  }

  if (platform === "win32") {
    const dir = path.join(home, ".release-agent", "autostart");
    const file = (name: ServiceName) => path.join(dir, `${name}.ps1`);
    const pidFile = (name: ServiceName) => path.join(dir, `${name}.pid`);
    const stop = async (name: ServiceName) => {
      await run("schtasks", ["/End", "/TN", windowsTaskName(name)]);
      // Ending the task stops PowerShell, not always what it started: end the whole tree.
      try {
        const pid = readFileSync(pidFile(name), "utf8").trim();
        if (/^\d+$/.test(pid)) await run("taskkill", ["/F", "/T", "/PID", pid]);
      } catch {
        /* not running */
      }
      rmSync(pidFile(name), { force: true });
    };
    return {
      supported: true,
      file,
      async install(spec) {
        mkdirSync(dir, { recursive: true });
        mkdirSync(path.dirname(spec.logFile), { recursive: true });
        await stop(spec.name);
        writeFileSync(file(spec.name), windowsLoopScript(spec, pidFile(spec.name)));
        const created = await run("schtasks", ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", windowsTaskName(spec.name), "/TR", windowsTaskCommand(file(spec.name))]);
        if (created.code !== 0) throw new Error(`Task Scheduler couldn't add "${windowsTaskName(spec.name)}": ${created.stderr.trim() || created.stdout.trim()}`);
        const started = await run("schtasks", ["/Run", "/TN", windowsTaskName(spec.name)]);
        if (started.code !== 0) throw new Error(`Task Scheduler couldn't start "${windowsTaskName(spec.name)}": ${started.stderr.trim() || started.stdout.trim()}`);
      },
      async uninstall(name) {
        const had = existsSync(file(name));
        await stop(name);
        await run("schtasks", ["/Delete", "/F", "/TN", windowsTaskName(name)]);
        rmSync(file(name), { force: true });
        return had;
      },
      async status(name) {
        const res = await run("schtasks", ["/Query", "/TN", windowsTaskName(name), "/FO", "LIST"]);
        let pid: number | null = null;
        try {
          pid = Number(readFileSync(pidFile(name), "utf8").trim()) || null;
        } catch {
          /* none */
        }
        return { installed: res.code === 0, running: res.code === 0 && /Status:\s+Running/i.test(res.stdout), pid };
      },
    };
  }

  const unsupported = async () => {
    throw new Error("Starting at login isn't built in on this system. Run `release-agent serve` and `release-agent tunnel run` yourself.");
  };
  return {
    supported: false,
    file: (name) => name,
    install: unsupported,
    uninstall: unsupported,
    status: async () => ({ installed: false, running: false, pid: null }),
  };
}
