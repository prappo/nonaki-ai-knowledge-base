/**
 * The recipe format itself: templates, the loader's errors, settings
 * validation, and that the engine holds no product-specific knowledge.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, validateSettings } from "../src/recipe/context.ts";
import { RecipeError, loadRecipe, validateRecipe } from "../src/recipe/load.ts";
import { stageStates, terminalCommand } from "../src/recipe/stages.ts";
import { render, templateRefs } from "../src/recipe/template.ts";

const wpspFile = path.join(import.meta.dirname, "../recipes/wpsp-pro.recipe.json");

/** Smallest valid recipe, for a product that isn't a WordPress plugin. */
function minimal(overrides: Record<string, unknown> = {}) {
  return {
    recipe: 1,
    name: "Acme CLI",
    version: { pattern: "^(?<major>\\d+)\\.\\d+\\.\\d+$" },
    groups: [{ id: "ship", label: "Ship" }],
    stages: [
      {
        id: "changelog",
        group: "ship",
        title: "Changelog",
        prompt: "/acme-changelog {version}",
        summary: "Writes CHANGELOG.md.",
        doneWhen: { fileMatches: "CHANGELOG.md", regex: "^## {version}$" },
      },
      {
        id: "publish",
        group: "ship",
        title: "Publish",
        prompt: "/acme-publish {version}",
        summary: "npm publish.",
        irreversible: true,
        blockedUntil: [{ check: { fileExists: "CHANGELOG.md" }, reason: "Write the changelog first." }],
        doneWhen: { gitTag: "v{version}" },
      },
    ],
    ...overrides,
  };
}

const problems = (input: unknown): string[] => {
  try {
    validateRecipe(input);
    return [];
  } catch (e) {
    if (e instanceof RecipeError) return e.problems;
    throw e;
  }
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "recipe-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("templates", () => {
  it("substitutes, keeps literal braces, and leaves regex quantifiers alone", () => {
    expect(render("v{version} {{x}} \\d{2}", { version: "1.2.3" })).toBe("v1.2.3 {x} \\d{2}");
    expect(templateRefs("{a} {settings.b} {{c}} {1}")).toEqual(["a", "settings.b"]);
  });

  it("escapes values in regex and prompt-argument contexts", () => {
    expect(render("^{version}$", { version: "1.2.3" }, "regex")).toBe("^1\\.2\\.3$");
    expect(render("--path {p}", { p: "/a b/c.zip" }, "arg")).toBe("--path '/a b/c.zip'");
    expect(render("--path {p}", { p: "a/c.zip" }, "arg")).toBe("--path a/c.zip");
  });

  it("throws on an unknown variable", () => {
    expect(() => render("{nope}", {})).toThrow(/Unknown variable \{nope\}/);
  });
});

describe("loader", () => {
  it("accepts the WPSP recipe and a minimal non-WordPress one", () => {
    expect(() => loadRecipe(wpspFile)).not.toThrow();
    expect(problems(minimal())).toEqual([]);
  });

  it("reports every problem with its path", () => {
    const bad = minimal({
      version: { pattern: "\\d+" },
      stages: [
        {
          id: "Bad Id",
          group: "nope",
          title: "",
          prompt: "/x {verison}",
          summary: "s",
          doneWhen: { all: [{ fileExists: "a" }, { fileSize: "b" }] },
        },
      ],
    });
    const p = problems(bad);

    expect(p).toContain("version.pattern: must be anchored with ^ and $");
    expect(p).toContain("stages[0].id: must be a lower-case slug");
    expect(p).toContain('stages[0 "Bad Id"].group: must be one of the `groups` ids');
    expect(p).toContain('stages[0 "Bad Id"].title: must be a non-empty string');
    expect(p).toContain('stages[0 "Bad Id"].prompt: unknown variable {verison}');
    expect(p).toContain('stages[0 "Bad Id"].doneWhen.all[1]: unknown check (fileSize)');
  });

  it("rejects a regex that doesn't compile, and duplicate stage ids", () => {
    const r = minimal();
    (r.stages as { doneWhen?: unknown }[])[0].doneWhen = { fileMatches: "a", regex: "([" };
    (r.stages as { id: string }[])[1].id = "changelog";
    const p = problems(r);

    expect(p.some((x) => x.startsWith("stages[0 \"changelog\"].doneWhen.regex: invalid regex"))).toBe(true);
    expect(p).toContain('stages[1].id: duplicate "changelog"');
  });

  it("only allows {build.*} inside localBuild.args, and only known artifact kinds", () => {
    const r = minimal({ build: { script: "build.sh", artifacts: [{ kind: "zip", label: "Zip" }] } });
    const s = (r.stages as Record<string, unknown>[])[0];
    s.prompt = "/x {build.id}";
    s.localBuild = { requireArtifact: "tar", args: ["--z {build.artifact.zip}", "--t {build.artifact.tar}"] };
    const p = problems(r);

    expect(p).toContain('stages[0 "changelog"].prompt: unknown variable {build.id}');
    expect(p.some((x) => x.includes("requireArtifact"))).toBe(true);
    expect(p).toContain('stages[0 "changelog"].localBuild.args[1]: unknown variable {build.artifact.tar}');
  });

  it("checks setup checks reference real stages and settings", () => {
    const p = problems(
      minimal({
        checks: [
          { id: "a", label: "A", type: "setting", field: "nope" },
          { id: "b", label: "B", type: "workingTree", stages: ["ghost"] },
          { id: "c", label: "C", type: "magic" },
        ],
      })
    );
    expect(p).toContain("checks[0].field: must be a settings field");
    expect(p).toContain('checks[1].stages: unknown stage "ghost"');
    expect(p.some((x) => x.startsWith("checks[2].type: must be one of"))).toBe(true);
  });
});

describe("a non-WordPress product", () => {
  it("runs entirely from its recipe", () => {
    const recipe = validateRecipe(minimal());
    const ctx = createContext(recipe, root, "2.0.0")!;
    let s = Object.fromEntries(stageStates(ctx).map((x) => [x.id, x]));

    expect(ctx.vars.major).toBe("2");
    expect(s.changelog.status).toBe("ready");
    expect(s.publish).toMatchObject({ status: "blocked", blockedReason: "Write the changelog first.", irreversible: true });

    writeFileSync(path.join(root, "CHANGELOG.md"), "# Changes\n\n## 2.0.0\n");
    mkdirSync(path.join(root, ".git/refs/tags"), { recursive: true });
    writeFileSync(path.join(root, ".git/refs/tags/v2.0.0"), "abc\n");
    s = Object.fromEntries(stageStates(createContext(recipe, root, "2.0.0")!).map((x) => [x.id, x]));

    expect(s.changelog.status).toBe("done");
    expect(s.publish.status).toBe("done");
  });

  it("can't be tricked by a version that looks like regex", () => {
    const recipe = validateRecipe(minimal({ version: { pattern: "^.+$" } }));
    writeFileSync(path.join(root, "CHANGELOG.md"), "## 2x0x0\n");
    const s = stageStates(createContext(recipe, root, "2.0.0")!);
    expect(s[0].status).toBe("ready"); // "2.0.0" must not match "2x0x0"
  });

  it("refuses unsafe versions even when the recipe's own pattern is loose", () => {
    const recipe = validateRecipe(minimal({ version: { pattern: "^.+$" } }));
    for (const v of ["1.0; rm -rf /", "../x", "$(id)", "a b"]) expect(createContext(recipe, root, v)).toBeNull();
  });

  it("builds the terminal command, with --chrome for browser stages", () => {
    const recipe = validateRecipe(minimal());
    const ctx = createContext(recipe, root, "2.0.0")!;
    expect(terminalCommand(recipe.stages[0], ctx)).toBe("claude '/acme-changelog 2.0.0'");
    expect(terminalCommand({ ...recipe.stages[0], requires: ["browser"] }, ctx)).toBe("claude --chrome '/acme-changelog 2.0.0'");
  });
});

describe("settings", () => {
  const recipe = loadRecipe(wpspFile);

  it("matches the console's validation for the Lite and marketing paths", () => {
    // nothing set, nothing on disk
    expect(validateSettings(recipe, root, {})).toEqual([
      { field: "marketingSitePath", level: "warning", message: expect.stringContaining("No marketing site set") },
      { field: "liteRepoPath", level: "warning", message: expect.stringContaining("No Lite checkout at") },
    ]);

    // Lite pointed at the Pro checkout itself
    expect(validateSettings(recipe, root, { liteRepoPath: root }).find((i) => i.field === "liteRepoPath")).toMatchObject({
      level: "error",
      message: "The Lite path points at this Pro checkout. Lite must be a separate folder.",
    });

    // a folder that isn't Lite, and a marketing folder that isn't wpsp-docs
    mkdirSync(path.join(root, "notlite"));
    mkdirSync(path.join(root, "site"));
    const issues = validateSettings(recipe, root, { liteRepoPath: path.join(root, "notlite"), marketingSitePath: path.join(root, "site") });
    expect(issues.map((i) => [i.field, i.level])).toEqual([
      ["marketingSitePath", "error"],
      ["liteRepoPath", "error"],
    ]);
    expect(issues[1].message).toContain("no stripe-checkout.php");
  });

  it("stays product-agnostic: the engine source never mentions WPSP", () => {
    const src = path.join(import.meta.dirname, "../src");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      // attribution headers ("Ported from …") may name the source; the code may not
      const code = readFileSync(path.join(src, f), "utf8").split("\n").filter((l) => !l.startsWith("// Ported")).join("\n");
      expect(code, f).not.toMatch(/wpsp|simple[- ]?pay|stripe|wpsimplepay/i);
    }
  });
});
