/**
 * The recipe this console serves, loaded once per process.
 *
 * The agent starts one console server per repo with RELEASE_REPO (the repo
 * root) and RELEASE_RECIPE (the recipe file). Everything product-specific the
 * Release Console used to hard-code comes from here.
 */

import path from 'node:path';
import { openRecipe } from '../../../src/recipe/load.ts';

const recipeFile = process.env.RELEASE_RECIPE;
const repo = process.env.RELEASE_REPO;

if ( ! recipeFile || ! repo ) {
	throw new Error( 'Set RELEASE_RECIPE (the recipe file) and RELEASE_REPO (the repo root).' );
}

export const opened = await openRecipe( recipeFile );
export const recipe = opened.recipe;
export const hooks = opened.hooks;
export const ROOT = path.resolve( repo );

/** Folders that hold the release tooling itself: left out of Changes, Reset and builds. */
export const HIDDEN_PATHS = recipe.reset?.hide ?? [];
