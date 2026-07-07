import { htmlToText } from "./extract";

export type WpConfig = { url: string };

/** One importable item — a published post or page. */
export type WpItem = { externalId: string; title: string; kind: string };

type WpApiItem = {
  id: number;
  link: string;
  title: { rendered: string };
  content?: { rendered: string };
  excerpt?: { rendered: string };
  modified: string;
};

export function normalizeWpUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

async function wpFetch(url: string) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

async function listType(baseUrl: string, type: "posts" | "pages"): Promise<WpItem[]> {
  const items: WpItem[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await wpFetch(
      `${baseUrl}/wp-json/wp/v2/${type}?per_page=100&page=${page}&status=publish&_fields=id,title,modified`
    );
    if (res.status === 400) break; // past the last page
    if (!res.ok) {
      if (page === 1) throw new Error(`WordPress API returned ${res.status} for /${type}`);
      break;
    }
    const batch = (await res.json()) as WpApiItem[];
    items.push(
      ...batch.map((item) => ({
        externalId: `${type === "posts" ? "post" : "page"}-${item.id}`,
        title: htmlToText(item.title.rendered) || `Untitled ${item.id}`,
        kind: type === "posts" ? "post" : "page",
      }))
    );
    const totalPages = Number(res.headers.get("X-WP-TotalPages") ?? "1");
    if (page >= totalPages || batch.length === 0) break;
  }
  return items;
}

/** List all published posts + pages (titles only — content fetched per item). */
export async function listWpItems(config: WpConfig): Promise<WpItem[]> {
  const baseUrl = normalizeWpUrl(config.url);
  const [posts, pages] = await Promise.all([
    listType(baseUrl, "posts").catch((err) => {
      throw err instanceof Error ? err : new Error(String(err));
    }),
    listType(baseUrl, "pages").catch(() => [] as WpItem[]),
  ]);
  const all = [...posts, ...pages];
  if (all.length === 0) {
    throw new Error(
      "No published posts or pages found — is the WP REST API enabled at /wp-json/wp/v2 ?"
    );
  }
  return all;
}

export type WpFile = { title: string; content: string; url: string; kind: string };

/** Fetch one post/page's content by its externalId ("post-12" / "page-3"). */
export async function fetchWpItem(config: WpConfig, externalId: string): Promise<WpFile> {
  const baseUrl = normalizeWpUrl(config.url);
  const [kind, idStr] = externalId.split("-");
  const type = kind === "post" ? "posts" : "pages";
  const res = await wpFetch(
    `${baseUrl}/wp-json/wp/v2/${type}/${idStr}?_fields=id,link,title,content,excerpt,modified`
  );
  if (!res.ok) throw new Error(`WordPress returned ${res.status} for ${externalId}`);
  const item = (await res.json()) as WpApiItem;

  const content = htmlToText(item.content?.rendered ?? "");
  if (!content) throw new Error(`${externalId} has no readable content`);

  return {
    title: htmlToText(item.title.rendered) || `Untitled ${kind} ${item.id}`,
    content,
    url: item.link,
    kind,
  };
}
