/**
 * Load and validate a recipe. Validation is strict and reports every problem
 * with its path (e.g. `stages[3].doneWhen.all[1]`), including unknown
 * template variables and regexes that don't compile.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadHooks, type Hooks } from "./hooks.ts";
import { branches, conditionVar, escapeRegExp, templateRefs } from "./template.ts";
import type { Check, Conditional, Recipe } from "./types.ts";
import { BUILTIN_BASH_RULES, BUILTIN_RISK_RULES } from "../runs/risk.ts";

export class RecipeError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid recipe:\n  - ${problems.join("\n  - ")}`);
    this.problems = problems;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;

const HEALTH_TYPES = [
  "gitBranch", "previousTag", "workingTree", "command", "setting",
  "dockerContainer", "dirEntry", "localWpSite", "script",
];
const ENV_REF = /^env\.[A-Za-z_][A-Za-z0-9_]*$/;
/** `"<relative module>#<export>"`, staying inside the recipe's folder. */
const HOOK_REF = /^(?!\/)(?!.*(^|\/)\.\.(\/|#))[\w./-]+\.m?js#[A-Za-z_$][\w$]*$/;
const RULES = ["required", "isDirectory", "contains", "notSamePath"];
const REVIEWS = ["file", "files", "docs", "changes"];

class Validator {
  problems: string[] = [];
  /** Variables any template may use. */
  known = new Set<string>(["version", "repo", "repoParent"]);

  fail(at: string, message: string) {
    this.problems.push(`${at}: ${message}`);
  }

  str(v: unknown, at: string, optional = false): v is string {
    if (v === undefined && optional) return false;
    if (typeof v !== "string" || (!optional && v.trim() === "")) {
      this.fail(at, "must be a non-empty string");
      return false;
    }
    return true;
  }

  strArray(v: unknown, at: string, optional = false): v is string[] {
    if (v === undefined && optional) return false;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      this.fail(at, "must be an array of strings");
      return false;
    }
    return true;
  }

  regex(v: unknown, at: string, flags = "") {
    if (!this.str(v, at)) return;
    try {
      new RegExp(v, flags);
    } catch (e) {
      this.fail(at, `invalid regex (${(e as Error).message})`);
    }
  }

  template(v: unknown, at: string, extra: Set<string> = new Set(), optional = false) {
    if (!this.str(v, at, optional)) return;
    for (const ref of templateRefs(v)) {
      if (!this.known.has(ref) && !extra.has(ref) && !matchesPrefix(ref, extra) && !ENV_REF.test(ref)) {
        this.fail(at, `unknown variable {${ref}}`);
      }
    }
  }

  conditional(v: unknown, at: string, extra?: Set<string>) {
    if (isObj(v) && "if" in v) {
      const name = v.if;
      if (typeof name !== "string" || (!this.known.has(name) && !extra?.has(name) && !matchesPrefix(name, extra) && !ENV_REF.test(name))) {
        this.fail(`${at}.if`, `unknown variable "${String(name)}"`);
      }
      if (!("then" in v)) this.fail(at, "conditional needs `then`");
      for (const [i, b] of branches(v as Conditional<unknown>).entries()) {
        this.template(b, `${at}.${i === 0 ? "then" : "else"}`, extra);
      }
      return;
    }
    this.template(v, at, extra);
  }

  hook(v: unknown, at: string) {
    if (typeof v !== "string" || !HOOK_REF.test(v)) this.fail(at, 'must be "<module.mjs>#<export>", relative to the recipe, without ".."');
  }

  check(v: unknown, at: string): void {
    if (!isObj(v)) return this.fail(at, "must be a check object");
    const keys = Object.keys(v);
    if ("fileExists" in v) return this.template(v.fileExists, `${at}.fileExists`);
    if ("fileMatches" in v) {
      this.template(v.fileMatches, `${at}.fileMatches`);
      this.template(v.regex, `${at}.regex`);
      // compile with sample values (escaped, as at run time) to catch a broken pattern
      if (typeof v.regex === "string") {
        const sample = v.regex.replace(/\{\{|\}\}|\{[A-Za-z_][\w.-]*\}/g, (t) =>
          t === "{{" ? "{" : t === "}}" ? "}" : escapeRegExp("1.0.0")
        );
        this.regex(sample, `${at}.regex`, typeof v.flags === "string" ? v.flags : "m");
      }
      return;
    }
    if ("gitTag" in v) {
      this.template(v.gitTag, `${at}.gitTag`);
      this.template(v.repo, `${at}.repo`, undefined, true);
      return;
    }
    for (const op of ["all", "any"] as const) {
      if (op in v) {
        if (!Array.isArray(v[op]) || (v[op] as unknown[]).length === 0) return this.fail(`${at}.${op}`, "must be a non-empty array");
        (v[op] as unknown[]).forEach((c, i) => this.check(c, `${at}.${op}[${i}]`));
        return;
      }
    }
    if ("not" in v) return this.check(v.not, `${at}.not`);
    this.fail(at, `unknown check (${keys.join(", ") || "empty"})`);
  }
}

function matchesPrefix(ref: string, extra?: Set<string>): boolean {
  if (!extra) return false;
  for (const e of extra) if (e.endsWith(".*") && ref.startsWith(e.slice(0, -1))) return true;
  return false;
}

/** Named groups of a regex source, in order. */
function namedGroups(pattern: string): string[] {
  return [...pattern.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((m) => m[1]);
}

export function validateRecipe(input: unknown): Recipe {
  const v = new Validator();
  if (!isObj(input)) throw new RecipeError(["recipe: must be a JSON object"]);
  const r = input;

  if (r.recipe !== 1) v.fail("recipe", "must be 1 (the format version)");
  v.str(r.name, "name");
  if (r.consoleState !== undefined && !(typeof r.consoleState === "string" && r.consoleState.trim() && !r.consoleState.startsWith("/") && !r.consoleState.split("/").includes(".."))) {
    v.fail("consoleState", "must be a folder inside the repo (relative, without ..)");
  }
  if (r.brand !== undefined) {
    if (!isObj(r.brand)) v.fail("brand", "must be an object");
    else {
      v.str(r.brand.name, "brand.name", true);
      v.str(r.brand.mark, "brand.mark", true);
      if (r.brand.color !== undefined && !(typeof r.brand.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(r.brand.color))) v.fail("brand.color", "must be a hex colour");
    }
  }

  // settings resolve before the version, so version.vars may use {settings.*}
  if (isObj(r.settings) && isObj(r.settings.fields)) {
    for (const field of Object.keys(r.settings.fields)) v.known.add(`settings.${field}`);
  }

  // repo-level vars, then version + its vars (order matters: a var may use earlier ones)
  if (r.vars !== undefined) {
    if (!isObj(r.vars)) v.fail("vars", "must be an object");
    else
      for (const [name, value] of Object.entries(r.vars)) {
        v.conditional(value, `vars.${name}`);
        v.known.add(name);
      }
  }
  if (!isObj(r.version)) v.fail("version", "must be an object");
  else {
    const pattern = r.version.pattern;
    v.regex(pattern, "version.pattern");
    if (typeof pattern === "string" && (!pattern.startsWith("^") || !pattern.endsWith("$"))) {
      v.fail("version.pattern", "must be anchored with ^ and $");
    }
    if (typeof pattern === "string") namedGroups(pattern).forEach((g) => v.known.add(g));
    v.str(r.version.hint, "version.hint", true);
    if (r.version.vars !== undefined) {
      if (!isObj(r.version.vars)) v.fail("version.vars", "must be an object");
      else
        for (const [name, value] of Object.entries(r.version.vars)) {
          v.conditional(value, `version.vars.${name}`);
          v.known.add(name);
        }
    }
  }

  // settings → {settings.<field>}
  const settingFields = new Set<string>();
  if (r.settings !== undefined) {
    if (!isObj(r.settings) || !isObj(r.settings.fields)) v.fail("settings", "needs `file` and `fields`");
    else {
      v.str(r.settings.file, "settings.file");
      for (const [field, def] of Object.entries(r.settings.fields)) {
        const at = `settings.fields.${field}`;
        settingFields.add(field);
        v.known.add(`settings.${field}`);
        if (!isObj(def)) {
          v.fail(at, "must be an object");
          continue;
        }
        v.str(def.label, `${at}.label`);
        if (def.type !== "path") v.fail(`${at}.type`, `must be "path"`);
        v.template(def.default, `${at}.default`, undefined, true);
        if (def.env !== undefined && !(typeof def.env === "string" && /^[A-Z_][A-Z0-9_]*$/.test(def.env))) {
          v.fail(`${at}.env`, "must be an UPPER_SNAKE env var name");
        }
        if (def.validate !== undefined) {
          if (!Array.isArray(def.validate)) v.fail(`${at}.validate`, "must be an array");
          else
            def.validate.forEach((rule: unknown, i: number) => {
              const rat = `${at}.validate[${i}]`;
              if (!isObj(rule) || !RULES.includes(rule.rule as string)) return v.fail(rat, `rule must be one of ${RULES.join(", ")}`);
              if (rule.level !== "error" && rule.level !== "warning") v.fail(`${rat}.level`, `must be "error" or "warning"`);
              v.template(rule.message, `${rat}.message`, new Set(["value"]));
              if (rule.rule === "contains") v.strArray(rule.paths, `${rat}.paths`);
              if (rule.rule === "notSamePath") v.template(rule.path, `${rat}.path`);
            });
        }
      }
    }
  }

  // probes
  if (r.probes !== undefined) {
    if (!isObj(r.probes)) v.fail("probes", "must be an object");
    else
      for (const [name, p] of Object.entries(r.probes)) {
        const at = `probes.${name}`;
        if (!/^[A-Za-z_]\w*$/.test(name)) v.fail(at, "name must be an identifier");
        if (!isObj(p)) {
          v.fail(at, "must be an object");
          continue;
        }
        if (p.type === "githubRelease") {
          v.template(p.repo, `${at}.repo`);
          v.template(p.tag, `${at}.tag`);
        } else if (p.type === "script") v.hook(p.hook, `${at}.hook`);
        else v.fail(`${at}.type`, 'must be "githubRelease" or "script"');
      }
  }

  // groups
  const groupIds = new Set<string>();
  if (!Array.isArray(r.groups) || r.groups.length === 0) v.fail("groups", "must be a non-empty array");
  else
    r.groups.forEach((g: unknown, i: number) => {
      if (!isObj(g) || !v.str(g.id, `groups[${i}].id`)) return;
      if (groupIds.has(g.id as string)) v.fail(`groups[${i}].id`, `duplicate "${g.id}"`);
      groupIds.add(g.id as string);
      v.str(g.label, `groups[${i}].label`);
    });

  // build (before stages: artifact kinds feed localBuild vars)
  const artifactKinds: string[] = [];
  if (r.build !== undefined) {
    if (!isObj(r.build)) v.fail("build", "must be an object");
    else {
      v.str(r.build.script, "build.script");
      if (!Array.isArray(r.build.artifacts) || r.build.artifacts.length === 0) v.fail("build.artifacts", "must be a non-empty array");
      else
        r.build.artifacts.forEach((a: unknown, i: number) => {
          if (isObj(a) && v.str(a.kind, `build.artifacts[${i}].kind`)) artifactKinds.push(a.kind as string);
          if (isObj(a)) v.str(a.label, `build.artifacts[${i}].label`);
          if (isObj(a) && a.match !== undefined) v.regex(a.match, `build.artifacts[${i}].match`);
        });
      v.strArray(r.build.exclude, "build.exclude", true);
      v.str(r.build.ciWorkflow, "build.ciWorkflow", true);
    }
  }

  // stages
  const stageIds = new Set<string>();
  if (!Array.isArray(r.stages) || r.stages.length === 0) v.fail("stages", "must be a non-empty array");
  else
    r.stages.forEach((s: unknown, i: number) => {
      const at = `stages[${i}]`;
      if (!isObj(s)) return v.fail(at, "must be an object");
      if (typeof s.id !== "string" || !ID.test(s.id)) v.fail(`${at}.id`, "must be a lower-case slug");
      else if (stageIds.has(s.id)) v.fail(`${at}.id`, `duplicate "${s.id}"`);
      else stageIds.add(s.id);
      const sat = `stages[${i}${typeof s.id === "string" ? ` "${s.id}"` : ""}]`;
      if (typeof s.group !== "string" || !groupIds.has(s.group)) v.fail(`${sat}.group`, "must be one of the `groups` ids");
      v.str(s.title, `${sat}.title`);
      v.template(s.prompt, `${sat}.prompt`);
      v.str(s.summary, `${sat}.summary`);
      v.strArray(s.gates, `${sat}.gates`, true);
      v.strArray(s.requires, `${sat}.requires`, true);
      if (s.irreversible !== undefined && typeof s.irreversible !== "boolean") v.fail(`${sat}.irreversible`, "must be true or false");
      if (s.doneWhen !== undefined) v.check(s.doneWhen, `${sat}.doneWhen`);
      if (s.listMissing && s.doneWhen === undefined) v.fail(`${sat}.listMissing`, "needs doneWhen");
      if (s.blockedUntil !== undefined) {
        if (!Array.isArray(s.blockedUntil)) v.fail(`${sat}.blockedUntil`, "must be an array");
        else
          s.blockedUntil.forEach((req: unknown, j: number) => {
            if (!isObj(req)) return v.fail(`${sat}.blockedUntil[${j}]`, "must be { check, reason }");
            v.check(req.check, `${sat}.blockedUntil[${j}].check`);
            v.template(req.reason, `${sat}.blockedUntil[${j}].reason`);
          });
      }
      if (s.review !== undefined) {
        if (!isObj(s.review) || !REVIEWS.includes(s.review.type as string)) v.fail(`${sat}.review.type`, `must be one of ${REVIEWS.join(", ")}`);
        else {
          v.str(s.review.label, `${sat}.review.label`);
          if (s.review.type === "file") v.template(s.review.path, `${sat}.review.path`);
        }
      }
      if (s.status !== undefined) v.hook(s.status, `${sat}.status`);
      if (s.localBuild !== undefined) {
        const lb = s.localBuild;
        if (!isObj(lb)) v.fail(`${sat}.localBuild`, "must be an object");
        else {
          if (r.build === undefined) v.fail(`${sat}.localBuild`, "needs a top-level `build`");
          if (typeof lb.requireArtifact !== "string" || (artifactKinds.length && !artifactKinds.includes(lb.requireArtifact))) {
            v.fail(`${sat}.localBuild.requireArtifact`, `must be one of the build artifact kinds (${artifactKinds.join(", ")})`);
          }
          const buildVars = new Set([
            "build.id", "build.version", "build.commit", "build.branch", "build.changes",
            ...artifactKinds.map((k) => `build.artifact.${k}`),
          ]);
          if (!Array.isArray(lb.args)) v.fail(`${sat}.localBuild.args`, "must be an array");
          else lb.args.forEach((a: unknown, j: number) => v.conditional(a, `${sat}.localBuild.args[${j}]`, buildVars));
        }
      }
    });

  // setup checks
  const healthIds = new Set<string>();
  if (r.checks !== undefined) {
    if (!Array.isArray(r.checks)) v.fail("checks", "must be an array");
    else
      r.checks.forEach((c: unknown, i: number) => {
        const at = `checks[${i}]`;
        if (!isObj(c)) return v.fail(at, "must be an object");
        if (!v.str(c.id, `${at}.id`)) return;
        if (healthIds.has(c.id as string)) v.fail(`${at}.id`, `duplicate "${c.id}"`);
        healthIds.add(c.id as string);
        v.str(c.label, `${at}.label`);
        if (!HEALTH_TYPES.includes(c.type as string)) return v.fail(`${at}.type`, `must be one of ${HEALTH_TYPES.join(", ")}`);
        if (c.stages !== undefined && v.strArray(c.stages, `${at}.stages`)) {
          for (const id of c.stages) if (!stageIds.has(id)) v.fail(`${at}.stages`, `unknown stage "${id}"`);
        }
        v.str(c.stageName, `${at}.stageName`, true);
        switch (c.type) {
          case "gitBranch":
            if (v.strArray(c.expect, `${at}.expect`)) c.expect.forEach((t, j) => v.template(t, `${at}.expect[${j}]`));
            break;
          case "previousTag":
            v.regex(c.tagPattern, `${at}.tagPattern`);
            break;
          case "command":
            v.strArray(c.run, `${at}.run`);
            if (c.capture !== undefined) v.regex(c.capture, `${at}.capture`);
            v.template(c.okDetail, `${at}.okDetail`, new Set(["match", "stage"]));
            v.template(c.okDetailFallback, `${at}.okDetailFallback`, new Set(["stage"]), true);
            v.template(c.failDetail, `${at}.failDetail`, new Set(["stage"]));
            v.template(c.missingDetail, `${at}.missingDetail`, new Set(["stage"]), true);
            break;
          case "setting":
            if (typeof c.field !== "string" || !settingFields.has(c.field)) v.fail(`${at}.field`, "must be a settings field");
            v.str(c.issueHint, `${at}.issueHint`, true);
            if (c.localWpSite !== undefined) {
              if (!isObj(c.localWpSite)) v.fail(`${at}.localWpSite`, "must be an object of messages");
              else for (const k of ["notFound", "stopped", "running"]) v.template(c.localWpSite[k], `${at}.localWpSite.${k}`, new Set(["site", "stage"]), true);
            }
            break;
          case "dockerContainer":
            v.regex(c.namePattern, `${at}.namePattern`);
            for (const k of ["okDetail", "failDetail", "dockerDownDetail"]) v.template(c[k], `${at}.${k}`, new Set(["stage"]));
            break;
          case "dirEntry":
            v.template(c.dir, `${at}.dir`);
            v.str(c.prefix, `${at}.prefix`);
            v.template(c.okDetail, `${at}.okDetail`, new Set(["match", "stage", "dir"]));
            v.template(c.failDetail, `${at}.failDetail`, new Set(["stage", "dir"]));
            break;
          case "script":
            v.hook(c.hook, `${at}.hook`);
            break;
          case "localWpSite":
            v.template(c.path, `${at}.path`);
            for (const k of ["notFound", "stopped", "running"]) v.template(c[k], `${at}.${k}`, new Set(["site", "stage"]), true);
            break;
        }
      });
  }

  // outputs
  if (r.outputs !== undefined) {
    const o = r.outputs;
    if (!isObj(o) || !Array.isArray(o.groups)) v.fail("outputs", "needs `dir`, `groups` and `fallback`");
    else {
      v.template(o.dir, "outputs.dir");
      v.str(o.docsDir, "outputs.docsDir", true);
      const ids = new Set<string>();
      o.groups.forEach((g: unknown, i: number) => {
        const at = `outputs.groups[${i}]`;
        if (!isObj(g)) return v.fail(at, "must be an object");
        if (v.str(g.id, `${at}.id`)) ids.add(g.id as string);
        v.str(g.title, `${at}.title`);
        for (const k of ["match", "main", "secondary"] as const) {
          if (g[k] === undefined && k !== "match") continue;
          if (v.strArray(g[k], `${at}.${k}`)) g[k].forEach((p, j) => v.regex(p, `${at}.${k}[${j}]`));
        }
      });
      if (!isObj(o.fallback)) v.fail("outputs.fallback", "needs `image` and `other` group ids");
      else
        for (const k of ["image", "other"]) {
          if (!ids.has(o.fallback[k] as string)) v.fail(`outputs.fallback.${k}`, "must be an outputs group id");
        }
    }
  }

  if (r.reset !== undefined) {
    if (!isObj(r.reset)) v.fail("reset", "must be an object");
    else {
      if (v.strArray(r.reset.preselect, "reset.preselect")) r.reset.preselect.forEach((p, i) => v.regex(p, `reset.preselect[${i}]`));
      v.strArray(r.reset.protect, "reset.protect");
      v.strArray(r.reset.hide, "reset.hide", true);
    }
  }

  if (r.risk !== undefined) {
    if (isObj(r.risk) && r.risk.messages !== undefined) {
      if (!isObj(r.risk.messages)) v.fail("risk.messages", "must be an object of rule id → reason");
      else
        for (const [id, msg] of Object.entries(r.risk.messages)) {
          if (!BUILTIN_RISK_RULES.includes(id)) v.fail(`risk.messages.${id}`, "not a built-in rule");
          v.str(msg, `risk.messages.${id}`);
        }
    }
    if (isObj(r.risk) && r.risk.alsoMatch !== undefined) {
      if (!isObj(r.risk.alsoMatch)) v.fail("risk.alsoMatch", "must be an object of rule id → regexes");
      else
        for (const [id, patterns] of Object.entries(r.risk.alsoMatch)) {
          if (!BUILTIN_BASH_RULES.includes(id)) v.fail(`risk.alsoMatch.${id}`, "not a built-in shell rule");
          if (v.strArray(patterns, `risk.alsoMatch.${id}`)) patterns.forEach((p, i) => v.regex(p, `risk.alsoMatch.${id}[${i}]`));
        }
    }
    const extra = isObj(r.risk) ? r.risk.extra : undefined;
    if (extra !== undefined) {
      if (!Array.isArray(extra)) v.fail("risk.extra", "must be an array");
      else
        extra.forEach((rule: unknown, i: number) => {
          const at = `risk.extra[${i}]`;
          if (!isObj(rule)) return v.fail(at, "must be an object");
          v.str(rule.rule, `${at}.rule`);
          v.regex(rule.match, `${at}.match`);
          v.str(rule.reason, `${at}.reason`);
          if (typeof rule.rule === "string" && BUILTIN_RISK_RULES.includes(rule.rule)) v.fail(`${at}.rule`, "clashes with a built-in rule");
          if (rule.before !== undefined && !BUILTIN_RISK_RULES.includes(rule.before as string)) {
            v.fail(`${at}.before`, `must be a built-in rule (${BUILTIN_RISK_RULES.join(", ")})`);
          }
        });
    }
  }

  if (v.problems.length) throw new RecipeError(v.problems);
  return input as unknown as Recipe;
}

/** A recipe with its hooks loaded, ready for stageStates / healthChecks. */
export interface OpenedRecipe {
  recipe: Recipe;
  hooks: Hooks;
  file: string;
}

/** Load, validate and import the hooks of a recipe file. */
export async function openRecipe(file: string): Promise<OpenedRecipe> {
  const recipe = loadRecipe(file);
  return { recipe, hooks: await loadHooks(recipe, path.dirname(path.resolve(file))), file: path.resolve(file) };
}

export function loadRecipe(file: string): Recipe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new RecipeError([`${file}: ${(e as Error).message}`]);
  }
  return validateRecipe(parsed);
}

/** For tests and tooling: every Check in a recipe's stages. */
export function stageChecks(recipe: Recipe): Check[] {
  return recipe.stages.flatMap((s) => [
    ...(s.doneWhen ? [s.doneWhen] : []),
    ...(s.blockedUntil ?? []).map((b) => b.check),
  ]);
}

export { conditionVar };
