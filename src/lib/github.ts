export type GithubConfig = {
  repo: string;
  token?: string;
  /** Which issue/PR states to import: "all" (default), "open", or "closed". */
  state?: "all" | "open" | "closed";
};

/** One importable item — an issue or pull request. */
export type GithubItem = {
  externalId: string;
  title: string;
  kind: string;
  state?: string;
};

function ghHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nonaki-knowledge-base",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function normalizeRepo(input: string): string {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/, "");
  // keep only owner/repo — drop pasted sub-paths like /issues or /pulls
  return cleaned.split("/").filter(Boolean).slice(0, 2).join("/");
}

/** Turn a GitHub API error into a message that says what to actually do. */
async function explainGhError(res: Response, token?: string): Promise<string> {
  // Org enforces SAML SSO — the token exists but isn't authorized for the org
  if (res.status === 403 && res.headers.get("x-github-sso")) {
    return "This organization enforces SAML SSO — open the token's settings on GitHub and click “Configure SSO” / “Authorize” for the organization, then try again.";
  }
  if (
    (res.status === 403 || res.status === 429) &&
    res.headers.get("x-ratelimit-remaining") === "0"
  ) {
    return token
      ? "GitHub rate limit hit — wait a few minutes and try again."
      : "GitHub rate limit hit — add a personal access token to raise the limit (60/hr → 5,000/hr).";
  }
  if (res.status === 401) {
    return "The GitHub token is invalid or expired — create a new one and try again.";
  }
  if (res.status === 404) {
    if (!token) {
      return "Repository not found. If it's private or belongs to an organization, add a personal access token — private/org repos return 404 without one.";
    }
    // The token is present but GitHub pretends the repo doesn't exist.
    // Check whether the token itself is valid to give a precise diagnosis.
    try {
      const user = await fetch("https://api.github.com/user", {
        headers: ghHeaders(token),
        signal: AbortSignal.timeout(15_000),
      });
      if (user.status === 401) {
        return "The GitHub token is invalid or expired — create a new one and try again.";
      }
    } catch {
      /* network hiccup — fall through to the generic explanation */
    }
    return [
      "The token works, but it can't see this repository. For ORGANIZATION repos:",
      "• Fine-grained tokens must be created with the organization selected as “Resource owner” (github.com/settings/personal-access-tokens → New token → Resource owner dropdown) — a token scoped to your personal account can't see org repos, even ones you have access to. The org may also need to approve the token.",
      "• Or use a CLASSIC token (github.com/settings/tokens) with the `repo` scope — it inherits all your org access. If the org enforces SSO, click “Configure SSO” on the token afterwards.",
      "Also double-check the repo path is exactly owner/repo.",
    ].join("\n");
  }
  if (res.status === 403) {
    return "GitHub denied access (403) — the token is missing the Issues/Pull requests read permission for this repository.";
  }
  return `GitHub API returned ${res.status}`;
}

async function ghFetch(path: string, token?: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(await explainGhError(res, token));
  return res.json();
}

type GhIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  closed_at: string | null;
  user?: { login: string };
  labels?: ({ name?: string } | string)[];
  pull_request?: unknown; // present → it's a PR
  merged_at?: string | null;
};

/** List issues and pull requests, filtered by the configured state. */
export async function listGithubItems(config: GithubConfig): Promise<GithubItem[]> {
  const repo = normalizeRepo(config.repo);
  const state = config.state ?? "all";
  const items: GithubItem[] = [];

  // The issues endpoint returns PRs too (flagged with `pull_request`)
  for (let page = 1; page <= 10; page++) {
    const batch = (await ghFetch(
      `/repos/${repo}/issues?state=${state}&per_page=100&page=${page}&sort=created&direction=desc`,
      config.token
    )) as GhIssue[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(
      ...batch.map((issue) => {
        const isPr = Boolean(issue.pull_request);
        return {
          externalId: `${isPr ? "pr" : "issue"}-${issue.number}`,
          title: `#${issue.number} ${issue.title}`,
          kind: isPr ? "pr" : "issue",
          state: issue.merged_at ? "merged" : issue.state,
        };
      })
    );
    if (batch.length < 100) break;
  }

  if (items.length === 0) {
    throw new Error(
      state === "all"
        ? "No issues or pull requests found in this repository."
        : `No ${state} issues or pull requests found in this repository.`
    );
  }
  return items;
}

export type GithubFile = { title: string; content: string; url: string; kind: string };

type GhComment = {
  body: string | null;
  user?: { login: string };
  created_at: string;
};

/** Fetch one issue/PR (body + up to 30 comments) as an indexable document. */
export async function fetchGithubItem(
  config: GithubConfig,
  externalId: string
): Promise<GithubFile> {
  const repo = normalizeRepo(config.repo);
  const number = externalId.split("-").pop();

  const issue = (await ghFetch(
    `/repos/${repo}/issues/${number}`,
    config.token
  )) as GhIssue;
  const isPr = Boolean(issue.pull_request);

  const labels = (issue.labels ?? [])
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter(Boolean)
    .join(", ");

  const lines: string[] = [
    `# ${issue.title} (${isPr ? "PR" : "Issue"} #${issue.number})`,
    [
      `State: ${issue.merged_at ? "merged" : issue.state}`,
      issue.user?.login && `Author: ${issue.user.login}`,
      labels && `Labels: ${labels}`,
      `Opened: ${issue.created_at.slice(0, 10)}`,
      issue.closed_at && `Closed: ${issue.closed_at.slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    "",
    issue.body?.trim() || "(no description)",
  ];

  // Comments often carry the actual answer/resolution
  try {
    const comments = (await ghFetch(
      `/repos/${repo}/issues/${number}/comments?per_page=30`,
      config.token
    )) as GhComment[];
    if (Array.isArray(comments) && comments.length > 0) {
      lines.push("", "## Comments");
      for (const c of comments) {
        if (!c.body?.trim()) continue;
        lines.push(
          "",
          `### ${c.user?.login ?? "unknown"} (${c.created_at.slice(0, 10)})`,
          c.body.trim()
        );
      }
    }
  } catch {
    // comments are best-effort — index the issue body regardless
  }

  return {
    title: `#${issue.number} ${issue.title}`,
    content: lines.join("\n"),
    url: issue.html_url,
    kind: isPr ? "pr" : "issue",
  };
}
