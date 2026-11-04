/**
 * Per-machine release settings, from the recipe's `settings` section
 * (was: the WPSP marketing-site and Lite paths). Stored in the repo's
 * settings file, which the release commands can read too.
 */

import { createRepoContext, readStoredSettings, SettingsError, validateSettings, writeSettings, type SettingIssue } from '../../../src/recipe/context.ts';
import { recipe } from './recipe.ts';

export type ReleaseConfig = Record<string, string | null>;
export type { SettingIssue as ConfigIssue };

export const CONFIG_FILE = recipe.settings?.file ?? '.release/settings.json';

export class ConfigError extends Error {
	readonly issues: SettingIssue[];

	constructor( issues: SettingIssue[] ) {
		super( issues.map( ( issue ) => issue.message ).join( ' ' ) );
		this.issues = issues;
	}
}

export function readConfig( root: string ): ReleaseConfig {
	return Object.fromEntries( Object.entries( readStoredSettings( recipe, root ) ).map( ( [ key, value ] ) => [ key, value ?? null ] ) );
}

export function validateConfig( root: string, config: ReleaseConfig ): SettingIssue[] {
	return validateSettings( recipe, root, config );
}

export function writeConfig( root: string, input: Record<string, unknown> ): ReleaseConfig {
	try {
		return Object.fromEntries( Object.entries( writeSettings( recipe, root, input ) ).map( ( [ key, value ] ) => [ key, value ?? null ] ) );
	} catch ( error ) {
		if ( error instanceof SettingsError ) {
			throw new ConfigError( error.issues );
		}

		throw error;
	}
}

/** Env vars for Claude sessions (settings the user set explicitly). */
export function sessionEnv( root: string ): Record<string, string> {
	return createRepoContext( recipe, root ).env;
}

/** The settings form: every field, with the default used when it's left empty. */
export function settingFields( root: string ) {
	const defaults = createRepoContext( recipe, root, {} ).vars;

	return Object.entries( recipe.settings?.fields ?? {} ).map( ( [ key, def ] ) => ( {
		key,
		label: def.label,
		help: def.help ?? null,
		default: def.default ? String( defaults[ `settings.${ key }` ] ?? '' ) || null : null,
	} ) );
}
