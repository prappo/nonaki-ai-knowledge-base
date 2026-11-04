/**
 * Release versions, from the recipe's `version` section (was: the WPSP rules).
 */

import path from 'node:path';
import { parseVersion as parseRecipeVersion } from '../../../src/recipe/context.ts';
import { render } from '../../../src/recipe/template.ts';
import { recipe } from './recipe.ts';

export interface ReleaseVersion {
	/** The version as entered. */
	version: string;
	/** Where this release's generated files live, relative to the repo (recipe `outputs.dir`). */
	releaseDir: string;
	/** Every recipe variable for the version (base, hotfix, analysisFile, …). */
	vars: Record<string, string>;
}

export function parseVersion( input: unknown ): ReleaseVersion | null {
	const vars = parseRecipeVersion( recipe, input );

	if ( ! vars ) {
		return null;
	}

	const strings = Object.fromEntries( Object.entries( vars ).map( ( [ key, value ] ) => [ key, value === null || value === undefined ? '' : String( value ) ] ) );
	const releaseDir = recipe.outputs ? render( recipe.outputs.dir, vars ) : path.join( '.release', String( vars.version ) );

	return { version: String( vars.version ), releaseDir, vars: strings };
}

/** Branch names the release expects (the recipe's gitBranch check). */
export function releaseBranches( version: ReleaseVersion ): string[] {
	const check = recipe.checks?.find( ( item ) => item.type === 'gitBranch' ) as { expect: string[] } | undefined;

	return check ? check.expect.map( ( template ) => render( template, { ...version.vars } ) ) : [];
}

/** What a valid version looks like, for error messages. */
export const VERSION_HINT = recipe.version.hint ?? 'Enter a valid version.';

/**
 * The folder holding every release's output folder (e.g. docs/releases), and
 * whether a folder name in it is a release: its own outputs.dir must be it.
 */
export function libraryRoot(): { dir: string; isRelease: ( name: string ) => ReleaseVersion | null } | null {
	if ( ! recipe.outputs ) {
		return null;
	}

	// render outputs.dir for a sample version to find its parent folder
	const sample = [ '0.0.0', '1.0.0', '0.0.0.0', '1' ].map( parseVersion ).find( Boolean );

	if ( ! sample ) {
		return null;
	}

	const dir = path.dirname( sample.releaseDir );

	return {
		dir,
		isRelease: ( name ) => {
			const version = parseVersion( name );

			return version && version.releaseDir === path.join( dir, name ) ? version : null;
		},
	};
}
