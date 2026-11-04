/**
 * WP Simple Pay Pro release hooks: the parts of the pipeline that need more
 * than file checks. Ported from the Release Console's `stages.ts`,
 * `notifications.ts`, `github.ts`, `config.ts` and `health.ts`.
 *
 * Status hooks are sync and get the probe results; probe and health hooks are
 * async. See release-agent's src/recipe/hooks.ts for the APIs.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ── shared ──────────────────────────────────────────────────────────────

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function readFile(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Whether a plugin's main file declares exactly this version in its header. */
export function headerVersionIs(file, version) {
  const content = readFile(file);
  return content !== null && new RegExp(`^\\s*\\*?\\s*Version:\\s*${escapeRegExp(version)}\\s*$`, "m").test(content);
}

/** The zip `wpsp-lite-publish-release` attaches and `wpsp-lite-org-release` downloads. */
export function liteZipName(version) {
  return `stripe-${version}.zip`;
}

// ── Lite on GitHub ──────────────────────────────────────────────────────

const publishedLiteRelease = (release) => (release?.exists && !release.isDraft ? release : null);
const releaseDate = (release) => (release.publishedAt ? ` on ${release.publishedAt.slice(0, 10)}` : "");

/** Publish Lite release on GitHub: done from the local tag, or from GitHub. */
export function litePublish(api) {
  const release = api.probes.liteRelease;
  const version = api.vars.version;
  const zip = liteZipName(version);

  // A release published elsewhere shows on GitHub before this checkout fetches its tag.
  const done = api.declared.done === true || publishedLiteRelease(release) !== null;

  if (!release?.exists) return { done, remote: null };

  if (release.isDraft) {
    return {
      done,
      remote: {
        tone: "warning",
        text: `A draft Lite ${version} release is on GitHub. It is not public until it is published.`,
        url: release.url || null,
        rerunWarning: null,
      },
    };
  }

  const hasZip = release.assets.includes(zip);
  return {
    done,
    remote: {
      tone: hasZip ? "success" : "warning",
      text: hasZip
        ? `Lite ${version} is already released on GitHub${releaseDate(release)}, with ${zip} attached.`
        : `Lite ${version} is released on GitHub${releaseDate(release)}, but ${zip} is not attached. Release Lite to wp.org needs it.`,
      url: release.url || null,
      rerunWarning: `Lite ${version} is already released on GitHub. Running this again will not publish a second release: the command stops when it finds the existing tag. Run it again only to re-check the release.`,
    },
  };
}

// ── Lite on wp.org ──────────────────────────────────────────────────────

/**
 * Whether the SVN working copy's trunk is committed at this version: the
 * header states it and `svn status` shows no local change to the file.
 * Staging bumps the header too but leaves the file modified, so a staged
 * release is not done. `svn status` is offline. Null when svn can't answer.
 */
export function svnTrunkReleased(svnPath, version) {
  const main = path.join(svnPath, "trunk", "stripe-checkout.php");
  if (!existsSync(path.join(svnPath, ".svn")) || !headerVersionIs(main, version)) return false;
  const status = spawnSync("svn", ["status", "-q", main], { encoding: "utf8", timeout: 5000 });
  if (status.error || status.status !== 0) return null;
  return status.stdout.trim() === "";
}

/**
 * Why the wp.org stage can't run yet. It ships the zip attached to Lite's
 * GitHub release, so that zip existing on GitHub unlocks it. When GitHub
 * couldn't be asked, the local Lite tag stands in.
 */
function liteZipBlockedReason(api) {
  const version = api.vars.version;
  const zip = liteZipName(version);
  const release = api.probes.liteRelease;

  if (release === undefined || release === null) {
    if (api.hasLocalTag(api.vars.litePath, version)) return null;
    return release === null
      ? `Run Publish Lite release on GitHub first. Lite has no ${version} tag locally, and GitHub could not be checked.`
      : `Run Publish Lite release on GitHub first. Lite has no ${version} tag yet.`;
  }
  if (!release.exists) return `Run Publish Lite release on GitHub first. GitHub has no Lite ${version} release yet.`;
  if (release.isDraft) return `Lite's ${version} GitHub release is still a draft. Publish it first.`;
  return release.assets.includes(zip)
    ? null
    : `Lite's ${version} GitHub release has no ${zip} attached. This stage uploads that zip to wp.org, so attach it first.`;
}

export function liteWporg(api) {
  const release = publishedLiteRelease(api.probes.liteRelease);
  const zip = liteZipName(api.vars.version);
  return {
    blockedReason: liteZipBlockedReason(api),
    done: svnTrunkReleased(api.resolve(api.vars.svnPath), api.vars.version),
    remote: release?.assets.includes(zip)
      ? { tone: "success", text: `Will stage ${zip} from Lite's GitHub release.`, url: release.url || null, rerunWarning: null }
      : null,
  };
}

/** The Keychain item `svn-login.sh` saves the wp.org login in. */
export const WPORG_KEYCHAIN_SERVICE = "wpsp-wporg-svn";

/** Setup check: svn installed, where the working copy is, and the wp.org login. */
export async function svnCheck(api) {
  const result = await api.run("svn", ["--version", "--quiet"], 5000);
  if (!result.ok) return { status: "fail", detail: "`svn` is not installed. Install it with `brew install subversion`." };

  const wc = api.resolve(api.vars.svnPath);
  const where = existsSync(path.join(wc, ".svn")) ? wc : `${wc} (checked out on first use)`;
  const detail = `svn ${result.stdout.trim()}. Working copy: ${where}.`;
  // The login svn-login.sh saves; the item's name is SW_KEYCHAIN_SERVICE in lib/svn-wc.sh.
  const login = await api.run("security", ["find-generic-password", "-s", WPORG_KEYCHAIN_SERVICE], 5000);
  const user = login.ok ? login.stdout.match(/"acct"<blob>="([^"]*)"/)?.[1] : undefined;

  return user
    ? { status: "ok", detail: `${detail} Logged in to wp.org as ${user}.` }
    : {
        status: "warn",
        detail: `${detail} Not logged in to wp.org, so the commit would stop for a password. Run \`bash .claude/scripts/lite-release/svn-login.sh\` in a terminal first.`,
      };
}

// ── in-plugin notifications ─────────────────────────────────────────────

export const NOTIFICATION_FEEDS = {
  live: "https://plugin.wpsimplepay.com/wp-content/notifications.json",
  draft: "https://plugin.wpsimplepay.com/wp-content/notifications-draft.json",
};

export function parseFeed(data) {
  if (!Array.isArray(data)) throw new Error("The feed is not a list.");
  return data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = Number(item.id);
    if (!Number.isFinite(id)) return [];
    return [
      {
        id,
        title: String(item.title ?? ""),
        content: String(item.content ?? ""),
        type: Array.isArray(item.type) ? item.type.map(String) : [],
      },
    ];
  });
}

/** Probe: both feeds, or null when either couldn't be read. */
export async function notificationFeeds(api) {
  try {
    const [live, draft] = await Promise.all([api.fetchJson(NOTIFICATION_FEEDS.live), api.fetchJson(NOTIFICATION_FEEDS.draft)]);
    return { live: parseFeed(live), draft: parseFeed(draft) };
  } catch {
    return null;
  }
}

/**
 * This version's notifications in the feeds. A notification belongs to the
 * version when its copy names "WP Simple Pay {version}" (or "WP Simple Pay
 * Pro {version}"), which every release notification's intro does.
 */
export function releaseNotifications(feeds, version) {
  const mentions = new RegExp(`WP Simple Pay (Pro )?${escapeRegExp(version)}(?![\\d.]*\\d)`);
  const liveIds = new Set(feeds.live.map((item) => item.id));
  const seen = new Map();
  for (const item of [...feeds.live, ...feeds.draft]) {
    if (mentions.test(item.content) && !seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()].map((item) => ({
    id: item.id,
    audience: item.type.includes("lite") ? "lite" : "pro",
    published: liveIds.has(item.id),
  }));
}

/** Draft in-plugin notifications: done once the feeds have both audiences. */
export function notificationsDraft(api) {
  const feeds = api.probes.notificationFeeds;
  if (!feeds) return { done: null, remote: null };

  const version = api.vars.version;
  const found = releaseNotifications(feeds, version);
  const both = found.some((i) => i.audience === "pro") && found.some((i) => i.audience === "lite");
  if (found.length === 0) return { done: both, remote: null };

  const label = (item) => `${item.audience === "pro" ? "Pro" : "Lite"} #${item.id} (${item.published ? "published" : "draft"})`;
  const published = found.some((item) => item.published);

  return {
    done: both,
    remote: {
      tone: both ? "success" : "warning",
      text: `On plugin.wpsimplepay.com: ${found.map(label).join(", ")}.${both ? "" : " One audience is missing."}`,
      url: "https://plugin.wpsimplepay.com/wp-admin/edit.php?post_type=wpf_notification",
      rerunWarning: `${version}'s notifications already exist on plugin.wpsimplepay.com${published ? ", and at least one is published" : ""}. Running this again stops at the duplicate check instead of drafting a second pair.`,
    },
  };
}
