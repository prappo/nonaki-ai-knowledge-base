/**
 * Setup checks, from the recipe's `checks` (was: the WPSP machine checks).
 */

import { createContext, createRepoContext } from '../../../src/recipe/context.ts';
import { healthChecks as recipeHealthChecks, runCommand, type CommandResult, type CommandRunner, type HealthCheck } from '../../../src/health/health.ts';
import { hooks, recipe } from './recipe.ts';
import type { ReleaseVersion } from './version.ts';

export { runCommand };
export type { CommandResult, CommandRunner, HealthCheck };
export type CheckStatus = HealthCheck[ 'status' ];

export interface HealthOptions {
	root: string;
	version: ReleaseVersion | null;
	run?: CommandRunner;
}

export async function healthChecks( options: HealthOptions ): Promise<HealthCheck[]> {
	const ctx = options.version ? createContext( recipe, options.root, options.version.version ) : createRepoContext( recipe, options.root );

	return recipeHealthChecks( ctx ?? createRepoContext( recipe, options.root ), { run: options.run, hooks } );
}
