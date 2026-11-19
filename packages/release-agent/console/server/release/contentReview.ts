/**
 * The console's side of the content review (see src/recipe/contentReview.ts):
 * starting the review stage, keeping its reviewer session read-only, and
 * saving the reviewer's answer when its session ends.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { createContext, type ReleaseContext } from '../../../src/recipe/context.ts';
import {
	failReviewer,
	reviewerPrompt,
	saveFixedChecks,
	saveReviewerAnswer,
	startReviewer,
} from '../../../src/recipe/contentReview.ts';
import type { Run, RunEvent, RunManager } from '../runs/runner.ts';
import { recipe } from './recipe.ts';
import type { ReleaseVersion } from './version.ts';

/** The stage that runs the review, or null when the recipe has none. */
export const REVIEW_STAGE: string | null = recipe.contentReview?.stage ?? null;

export const isReviewStage = ( stageId: string ) => REVIEW_STAGE !== null && stageId === REVIEW_STAGE;

export function reviewContext( root: string, version: ReleaseVersion | string ): ReleaseContext {
	const ctx = createContext( recipe, root, typeof version === 'string' ? version : version.version );

	if ( ! ctx ) {
		throw new Error( `Invalid version ${ typeof version === 'string' ? version : version.version }` );
	}

	return ctx;
}

/** Tools the reviewer may use: it reads, it never writes, runs commands or drives a browser. */
export const REVIEWER_TOOLS = [ 'Read', 'Grep', 'Glob', 'WebFetch' ];
const WRITE_TOOLS = [ 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'BashOutput', 'KillShell' ];

/**
 * Session options for the reviewer: only reading tools, and no MCP servers at
 * all (no Chrome, no repo or account connectors that could change something).
 * Applied after the base options, so they win.
 */
export function reviewerSessionOptions( base: Partial<Options> ): Partial<Options> {
	const { extraArgs: _chrome, settings: _settings, ...rest } = base;

	return {
		...rest,
		env: { ...( base.env ?? {} ), ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
		tools: REVIEWER_TOOLS,
		allowedTools: REVIEWER_TOOLS,
		disallowedTools: WRITE_TOOLS,
		mcpServers: {},
		strictMcpConfig: true,
	};
}

/** Saves the reviewer's answer when its turn ends, and records a run that ended without one. */
export function watchReviewer( run: Run, ctx: ReleaseContext ): void {
	const onEvent = ( event: RunEvent ) => {
		if ( event.type === 'item' && event.item.kind === 'result' ) {
			try {
				saveReviewerAnswer( ctx, run.id, event.item.text );
			} catch ( error ) {
				console.error( 'content review: could not save the reviewer answer', error );
			}
			return;
		}

		if ( event.type === 'status' && ! run.isActive ) {
			run.off( 'event', onEvent );

			if ( event.status !== 'done' ) {
				failReviewer( ctx, run.id, event.status === 'stopped' ? 'The reviewer was stopped before it answered.' : event.error ?? `The reviewer's session ended (${ event.status }) before it answered.` );
			} else {
				failReviewer( ctx, run.id, 'The reviewer finished without an answer. Run the review again.' );
			}
		}
	};

	run.on( 'event', onEvent );
}

/**
 * Starts a stage's run. The review stage runs its fixed checks first (link
 * checks carry on in the background), then starts the read-only reviewer with
 * the console's own prompt; the prompt passed in is ignored for it.
 */
export function startStageRun( manager: RunManager, stageId: string, root: string, version: ReleaseVersion, prompt: string ): Run {
	if ( ! isReviewStage( stageId ) ) {
		return manager.start( stageId, version.version, prompt );
	}

	const ctx = reviewContext( root, version );
	// starting first: a run already in progress throws before anything is written
	const run = manager.start( stageId, version.version, reviewerPrompt( ctx ) );

	saveFixedChecks( ctx ).links.catch( ( error ) => console.error( 'content review: link checks failed', error ) );
	startReviewer( ctx, run.id );
	watchReviewer( run, ctx );

	return run;
}

/** A reviewer session resumed with a reply: its answer belongs to the review too. */
export function adoptResumedReviewer( run: Run, root: string ): void {
	if ( ! isReviewStage( run.stageId ) ) {
		return;
	}

	const ctx = reviewContext( root, run.version );
	startReviewer( ctx, run.id );
	watchReviewer( run, ctx );
}
