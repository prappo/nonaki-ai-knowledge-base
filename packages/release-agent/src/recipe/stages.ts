/**
 * Stage states for the pipeline, computed from the recipe and the disk.
 * Status comes from disk, never from what the agent remembers, so a step run
 * from a terminal shows up too.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { evaluate } from "./checks.ts";
import { resolvePath, type ReleaseContext } from "./context.ts";
import { NO_HOOKS, statusApi, type Hooks } from "./hooks.ts";
import { isSet, pick, quoteArg, render, type Vars } from "./template.ts";
import type { StageDef, StageRemote } from "./types.ts";

export type StageStatus = "done" | "ready" | "blocked";

export type ResolvedReview =
  | { type: "file"; path: string; label: string }
  | { type: "files"; label: string }
  | { type: "docs"; label: string }
  | { type: "changes"; label: string };

/** A build record as the build runner writes it (`build.json`). */
export interface BuildRecord {
  id: string;
  version: string | null;
  status: "running" | "done" | "failed" | "cancelled" | "interrupted";
  startedAt: number;
  endedAt: number | null;
  artifacts: { name: string; size: number; kind: string }[];
  git: { branch: string; commit: string; changes: number } | null;
}

export interface LocalBuildSource {
  record: BuildRecord;
  /** Absolute path of the build's folder. */
  dir: string;
}

export interface LocalBuildChoice {
  id: string;
  version: string | null;
  commit: string | null;
  branch: string | null;
  changes: number;
  endedAt: number | null;
  /** Zip path per artifact kind still on disk, as written in the prompt. */
  artifacts: Record<string, string>;
  prompt: string;
}

export interface StageState {
  id: string;
  group: string;
  title: string;
  prompt: string;
  summary: string;
  gates: string[];
  irreversible: boolean;
  browser: boolean;
  requires: string[];
  localBuild: boolean;
  localBuilds: LocalBuildChoice[];
  status: StageStatus;
  /** False when disk can't show whether the stage ran. */
  tracked: boolean;
  blockedReason: string | null;
  /** Expected output files that don't exist yet (file names). */
  missing: string[];
  review: ResolvedReview | null;
  /** What a remote already has (from a status hook). */
  remote: StageRemote | null;
}

export interface StageOptions {
  /** Finished local builds, for stages that can run against one. */
  builds?: LocalBuildSource[];
  /** Probe results from resolveProbes(); omitted = not looked up. */
  probes?: Record<string, unknown>;
  hooks?: Hooks;
}

export function stagePrompt(stage: StageDef, ctx: ReleaseContext): string {
  return render(stage.prompt, ctx.vars);
}

/** The terminal equivalent of a stage run. */
export function terminalCommand(stage: StageDef, ctx: ReleaseContext): string {
  const browser = stage.requires?.includes("browser") ? " --chrome" : "";
  return `claude${browser} ${quoteArg(stagePrompt(stage, ctx))}`;
}

function blockedReason(stage: StageDef, ctx: ReleaseContext): string | null {
  for (const req of stage.blockedUntil ?? []) {
    if (!evaluate(req.check, ctx)) return render(req.reason, ctx.vars);
  }
  return null;
}

function review(stage: StageDef, ctx: ReleaseContext): ResolvedReview | null {
  const r = stage.review;
  if (!r) return null;
  return r.type === "file" ? { ...r, path: render(r.path, ctx.vars) } : { ...r };
}

/** A path for the prompt: relative to the repo when inside it. */
function promptPath(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}

/** The finished local builds a stage can run against, newest first. */
export function localBuildChoices(
  stage: StageDef,
  ctx: ReleaseContext,
  builds: LocalBuildSource[] = []
): LocalBuildChoice[] {
  const def = stage.localBuild;
  if (!def) return [];

  return builds
    .filter(({ record }) => record.status === "done")
    .sort((a, b) => b.record.startedAt - a.record.startedAt)
    .flatMap(({ record, dir }) => {
      const artifacts: Record<string, string> = {};
      for (const a of record.artifacts) {
        const file = path.join(dir, a.name);
        if (!(a.kind in artifacts) && existsSync(file)) artifacts[a.kind] = promptPath(ctx.root, file);
      }
      if (!(def.requireArtifact in artifacts)) return [];

      const vars: Vars = {
        ...ctx.vars,
        "build.id": record.id,
        "build.version": record.version,
        "build.commit": record.git?.commit ?? null,
        "build.branch": record.git?.branch ?? null,
        "build.changes": record.git?.changes ?? 0,
      };
      for (const [kind, p] of Object.entries(artifacts)) vars[`build.artifact.${kind}`] = p;
      // conditionals may test artifacts that this build lacks
      for (const a of record.artifacts) vars[`build.artifact.${a.kind}`] ??= null;

      const args = def.args.flatMap((arg) => {
        const chosen = pick(arg, vars);
        return chosen === undefined ? [] : [render(chosen, vars, "arg")];
      });

      return [
        {
          id: record.id,
          version: record.version,
          commit: record.git?.commit ?? null,
          branch: record.git?.branch ?? null,
          changes: record.git?.changes ?? 0,
          endedAt: record.endedAt,
          artifacts,
          prompt: [stagePrompt(stage, ctx), ...args].join(" "),
        },
      ];
    });
}

export function stageStates(ctx: ReleaseContext, options: StageOptions = {}): StageState[] {
  const hooks = options.hooks ?? NO_HOOKS;
  const probes = options.probes ?? {};

  return ctx.recipe.stages.map((stage) => {
    const missingPaths: string[] = [];
    let done: boolean | null = stage.doneWhen ? evaluate(stage.doneWhen, ctx, missingPaths) : null;
    let blocked = blockedReason(stage, ctx);
    let remote: StageRemote | null = null;

    const hook = stage.status ? hooks.status.get(stage.id) : undefined;
    if (stage.status && !hook) throw new Error(`Stage "${stage.id}" names status hook ${stage.status}, but hooks weren't loaded`);
    if (hook) {
      const result = hook(statusApi(ctx.root, ctx.vars, probes, { done, blockedReason: blocked })) ?? {};
      if ("done" in result) done = result.done ?? null;
      if ("blockedReason" in result) blocked = result.blockedReason ?? null;
      if ("remote" in result) remote = result.remote ?? null;
    }

    const status: StageStatus = done ? "done" : blocked ? "blocked" : "ready";
    const requires = stage.requires ?? [];

    return {
      id: stage.id,
      group: stage.group,
      title: stage.title,
      prompt: stagePrompt(stage, ctx),
      summary: stage.summary,
      gates: stage.gates ?? [],
      irreversible: stage.irreversible === true,
      browser: requires.includes("browser"),
      requires,
      localBuild: Boolean(stage.localBuild),
      localBuilds: localBuildChoices(stage, ctx, options.builds ?? []),
      status,
      tracked: done !== null,
      blockedReason: done ? null : blocked,
      missing: stage.listMissing ? missingPaths.map((p) => path.basename(p)) : [],
      review: review(stage, ctx),
      remote,
    };
  });
}

/** Stages Run all may include: everything except irreversible ones. */
export function runAllEligible(stage: StageDef): boolean {
  return !stage.irreversible;
}

export { isSet, resolvePath };
