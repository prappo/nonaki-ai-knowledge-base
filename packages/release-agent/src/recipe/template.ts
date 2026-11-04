/**
 * `{var}` templates. See the format notes in types.ts.
 */

import type { Conditional, Template } from "./types.ts";

export type VarValue = string | number | boolean | null | undefined;
export type Vars = Record<string, VarValue>;

/** How values are escaped where they are substituted. */
export type Escape = "none" | "regex" | "arg";

const TOKEN = /\{\{|\}\}|\{([A-Za-z_][\w-]*(?:\.[\w-]+)*)\}/g;

export class TemplateError extends Error {}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Quote a prompt argument only when it needs it (same rule as the release console). */
export function quoteArg(value: string): string {
  return /^[\w./@+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Variable names a template references. */
export function templateRefs(template: Template): string[] {
  const refs: string[] = [];
  for (const m of template.matchAll(TOKEN)) if (m[1]) refs.push(m[1]);
  return refs;
}

export function isSet(value: VarValue): boolean {
  return value !== undefined && value !== null && value !== "" && value !== false && value !== 0;
}

/** Substitute variables. An unknown variable throws: recipes are checked at load time. */
export function render(template: Template, vars: Vars, escape: Escape = "none"): string {
  return template.replace(TOKEN, (token, name: string | undefined) => {
    if (token === "{{") return "{";
    if (token === "}}") return "}";
    if (!(name! in vars)) throw new TemplateError(`Unknown variable {${name}}`);
    const raw = vars[name!];
    const value = raw === undefined || raw === null ? "" : String(raw);
    if (escape === "regex") return escapeRegExp(value);
    if (escape === "arg") return quoteArg(value);
    return value;
  });
}

/** Resolve a conditional; undefined when the condition fails and there's no `else`. */
export function pick<T>(value: Conditional<T>, vars: Vars): T | undefined {
  if (value !== null && typeof value === "object" && "if" in value) {
    return isSet(vars[value.if]) ? value.then : value.else;
  }
  return value as T;
}

/** Every template inside a conditional (both branches), for load-time checks. */
export function branches<T>(value: Conditional<T>): T[] {
  if (value !== null && typeof value === "object" && "if" in value) {
    return [value.then, ...(value.else === undefined ? [] : [value.else])];
  }
  return [value as T];
}

export function conditionVar(value: Conditional<unknown>): string | null {
  return value !== null && typeof value === "object" && "if" in value ? (value as { if: string }).if : null;
}
