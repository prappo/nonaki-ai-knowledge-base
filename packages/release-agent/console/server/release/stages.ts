/**
 * Pipeline stages, from the recipe (was: the 14 hard-coded WPSP stages).
 *
 * Same exports and shapes the Release Console's server used, so app.ts and
 * sequence.ts work unchanged; status comes from the generic recipe engine
 * (files, git tags, probes, hooks).
 */

import { createContext, type ReleaseContext } from '../../../src/recipe/context.ts';
import { defaultFetchJson, resolveProbes, type ProbeCache } from '../../../src/recipe/hooks.ts';
import {
	localBuildChoices as recipeLocalBuildChoices,
	stagePrompt as recipeStagePrompt,
	stageStates as recipeStageStates,
	type LocalBuildChoice as RecipeChoice,
	type ResolvedReview,
	type StageState as RecipeStageState,
} from '../../../src/recipe/stages.ts';
import type { StageDef, StageRemote } from '../../../src/recipe/types.ts';
import type { BuildRecord } from '../builds/builds.ts';
import { runCommand } from './health.ts';
import { hooks, recipe } from './recipe.ts';
import type { ReleaseVersion } from './version.ts';

export type StageStatus = 'done' | 'ready' | 'blocked';
export type StageGroup = string;
export type StageReview = ResolvedReview;
export type { StageRemote };

export const STAGE_GROUPS: Record<StageGroup, string> = Object.fromEntries( recipe.groups.map( ( group ) => [ group.id, group.label ] ) );

/** A finished local build and the folder holding its zips. */
export interface LocalBuildSource {
	record: BuildRecord;
	dir: string;
}

export interface StageContext {
	root: string;
	version: ReleaseVersion;
	/** Probe results (remote lookups); omitted = not looked up. */
	probes?: Record<string, unknown>;
	localBuilds?: LocalBuildSource[];
}

/** The console's choice shape: the first two artifact kinds as pro / liteZip. */
export interface LocalBuildChoice {
	id: string;
	version: string | null;
	commit: string | null;
	branch: string | null;
	changes: number;
	lite: boolean;
	endedAt: number | null;
	pro: string;
	liteZip: string | null;
	prompt: string;
}

export type StageState = Omit<RecipeStageState, 'localBuilds'> & { command: string; localBuilds: LocalBuildChoice[] };

export interface StageDefinition {
	id: string;
	group: StageGroup;
	title: string;
	command: string;
	summary: string;
	gates: string[];
	irreversible?: boolean;
	browser?: boolean;
	localBuild?: boolean;
	blockedReason: ( ctx: StageContext ) => string | null;
	isDone: ( ctx: StageContext ) => boolean | null;
	review: ( ctx: StageContext ) => StageReview | null;
}

const commandOf = ( prompt: string ) => prompt.match( /^\/(\S+)/ )?.[ 1 ] ?? prompt.split( /\s+/ )[ 0 ];

function engineContext( ctx: StageContext ): ReleaseContext {
	const context = createContext( recipe, ctx.root, ctx.version.version );

	if ( ! context ) {
		throw new Error( `Invalid version ${ ctx.version.version }` );
	}

	return context;
}

const [ firstKind, secondKind ] = ( recipe.build?.artifacts ?? [] ).map( ( artifact ) => artifact.kind );

function choice( item: RecipeChoice ): LocalBuildChoice {
	const quote = ( value: string | undefined ) => ( value === undefined ? null : /^[\w./@+-]+$/.test( value ) ? value : `'${ value.replace( /'/g, `'\\''` ) }'` );

	return {
		id: item.id,
		version: item.version,
		commit: item.commit,
		branch: item.branch,
		changes: item.changes,
		endedAt: item.endedAt,
		lite: secondKind !== undefined && secondKind in item.artifacts,
		pro: quote( item.artifacts[ firstKind ] ) ?? '',
		liteZip: secondKind ? quote( item.artifacts[ secondKind ] ) : null,
		prompt: item.prompt,
	};
}

export function stageStates( ctx: StageContext ): StageState[] {
	return recipeStageStates( engineContext( ctx ), { builds: ctx.localBuilds ?? [], probes: ctx.probes, hooks } ).map( ( state ) => ( {
		...state,
		command: commandOf( state.prompt ),
		localBuilds: state.localBuilds.map( choice ),
	} ) );
}

const stateOf = ( id: string, ctx: StageContext ) => stageStates( ctx ).find( ( state ) => state.id === id )!;

function definition( def: StageDef ): StageDefinition {
	return {
		id: def.id,
		group: def.group,
		title: def.title,
		command: commandOf( def.prompt ),
		summary: def.summary,
		gates: def.gates ?? [],
		irreversible: def.irreversible === true,
		browser: ( def.requires ?? [] ).includes( 'browser' ),
		localBuild: Boolean( def.localBuild ),
		blockedReason: ( ctx ) => {
			const state = stateOf( def.id, ctx );
			return state.status === 'done' ? null : state.blockedReason;
		},
		isDone: ( ctx ) => {
			const state = stateOf( def.id, ctx );
			return state.tracked ? state.status === 'done' : null;
		},
		review: ( ctx ) => stateOf( def.id, ctx ).review,
	};
}

export const STAGES: StageDefinition[] = recipe.stages.map( definition );

export function findStage( id: string ): StageDefinition | undefined {
	return STAGES.find( ( stage ) => stage.id === id );
}

export function stagePrompt( stage: StageDefinition, version: ReleaseVersion ): string {
	const def = recipe.stages.find( ( item ) => item.id === stage.id )!;
	const ctx = createContext( recipe, '/', version.version );

	return ctx ? recipeStagePrompt( def, ctx ) : `/${ stage.command } ${ version.version }`;
}

export function localBuildChoices( stage: StageDefinition, ctx: StageContext ): LocalBuildChoice[] {
	const def = recipe.stages.find( ( item ) => item.id === stage.id )!;

	return recipeLocalBuildChoices( def, engineContext( ctx ), ctx.localBuilds ?? [] ).map( choice );
}

/** Run the recipe's probes (GitHub releases, feeds, …) through a cache. */
export async function resolveStageProbes( root: string, version: ReleaseVersion, cache: ProbeCache ): Promise<Record<string, unknown>> {
	const ctx = createContext( recipe, root, version.version );

	return ctx ? resolveProbes( recipe, hooks, ctx.root, ctx.vars, cache, { run: runCommand, fetchJson: defaultFetchJson } ) : {};
}
