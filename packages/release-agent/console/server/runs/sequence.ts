/**
 * "Run all from here": runs stages one after another, pausing wherever a
 * person is needed.
 *
 * - Every question and approval still stops the run, as in a single run.
 * - When a command's closing report says `ok`, the run is finished for you
 *   and the next stage starts.
 * - A report of `blocked` or `failed`, or no report at all, pauses the
 *   sequence on that run. Reply to sort it out: a later `ok` report carries on.
 *   Pressing Finish yourself also carries on, unless you stopped the sequence.
 * - A stopped, failed or interrupted run ends the sequence, and so does a
 *   stage that is blocked when its turn comes.
 * - A sequence never includes a permanent, public stage (tagging, publishing).
 *   It ends just before one, so that stage is always started by hand with the
 *   version typed in.
 */

import { EventEmitter } from 'node:events';
import type { Run, RunEvent, RunManager } from './runner.ts';
import { STAGES, stagePrompt, stageStates, type StageContext, type StageDefinition } from '../release/stages.ts';
import type { ReleaseVersion } from '../release/version.ts';

export type SequenceStatus = 'running' | 'paused' | 'done' | 'stopped';

export interface SequenceSnapshot {
	version: string;
	/** Stage ids in the order they run. */
	stages: string[];
	/** Index into `stages` of the stage running now (or last run). */
	index: number;
	status: SequenceStatus;
	/** Why the sequence paused or stopped. */
	reason: string | null;
	/** The permanent stage the sequence stops before, if any. */
	stopsBefore: string | null;
	runIds: string[];
}

export interface SequencePlan {
	stages: StageDefinition[];
	stopsBefore: StageDefinition | null;
	skipped: StageDefinition[];
}

export class SequenceError extends Error {}

/**
 * The stages "Run all from here" would run, starting at `fromStageId`: up to,
 * not including, the next permanent stage, leaving out finished stages when
 * `skipDone` is set.
 */
export function planSequence( fromStageId: string, ctx: StageContext, skipDone: boolean ): SequencePlan {
	const start = STAGES.findIndex( ( stage ) => stage.id === fromStageId );

	if ( start === -1 ) {
		throw new SequenceError( 'Unknown stage.' );
	}

	if ( STAGES[ start ].irreversible ) {
		throw new SequenceError( `${ STAGES[ start ].title } is permanent and public, so it only runs on its own.` );
	}

	const states = new Map( stageStates( ctx ).map( ( state ) => [ state.id, state ] ) );
	const stages: StageDefinition[] = [];
	const skipped: StageDefinition[] = [];
	let stopsBefore: StageDefinition | null = null;

	for ( const stage of STAGES.slice( start ) ) {
		if ( stage.irreversible ) {
			stopsBefore = stage;
			break;
		}

		// The first stage always runs: it is the one the release manager picked.
		if ( skipDone && stages.length > 0 && states.get( stage.id )?.status === 'done' ) {
			skipped.push( stage );
			continue;
		}

		stages.push( stage );
	}

	return { stages, stopsBefore, skipped };
}

export interface SequencerOptions {
	manager: RunManager;
	/** Builds the stage context for a version (the Lite path comes from Settings). */
	contextFor: ( version: ReleaseVersion ) => StageContext;
}

export class Sequencer extends EventEmitter {
	private current: SequenceSnapshot | null = null;
	private version: ReleaseVersion | null = null;
	private readonly options: SequencerOptions;

	constructor( options: SequencerOptions ) {
		super();
		this.options = options;
	}

	snapshot(): SequenceSnapshot | null {
		return this.current ? { ...this.current, stages: [ ...this.current.stages ], runIds: [ ...this.current.runIds ] } : null;
	}

	get isActive(): boolean {
		return this.current?.status === 'running' || this.current?.status === 'paused';
	}

	start( version: ReleaseVersion, fromStageId: string, skipDone: boolean ): SequenceSnapshot {
		if ( this.isActive ) {
			throw new SequenceError( 'A sequence is already running. Stop it first.' );
		}

		if ( this.options.manager.latest?.isActive ) {
			throw new SequenceError( 'A run is in progress. Finish or stop it first.' );
		}

		const plan = planSequence( fromStageId, this.options.contextFor( version ), skipDone );
		const first = plan.stages[ 0 ];
		const blocked = first.blockedReason( this.options.contextFor( version ) );

		if ( blocked ) {
			throw new SequenceError( blocked );
		}

		this.version = version;
		this.current = {
			version: version.version,
			stages: plan.stages.map( ( stage ) => stage.id ),
			index: 0,
			status: 'running',
			reason: null,
			stopsBefore: plan.stopsBefore?.id ?? null,
			runIds: [],
		};

		this.launch( first );

		return this.snapshot()!;
	}

	/** Ends the sequence. The current run carries on; it just won't be followed by another. */
	stop( reason = 'You stopped the sequence.' ): void {
		if ( this.isActive ) {
			this.update( { status: 'stopped', reason } );
		}
	}

	/** Forgets a finished sequence, so the banner goes away. */
	dismiss(): void {
		if ( ! this.isActive ) {
			this.current = null;
			this.emit( 'change', null );
		}
	}

	private launch( stage: StageDefinition ): void {
		const run = this.options.manager.start( stage.id, this.version!.version, stagePrompt( stage, this.version! ) );

		this.current!.runIds.push( run.id );
		this.watch( run );
		this.emit( 'change', this.snapshot() );
	}

	private watch( run: Run ): void {
		const onEvent = ( event: RunEvent ) => {
			if ( ! this.current || this.current.runIds.at( -1 ) !== run.id ) {
				run.off( 'event', onEvent );
				return;
			}

			if ( event.type !== 'status' ) {
				return;
			}

			if ( event.status === 'awaiting_reply' ) {
				this.onTurnEnded( run );
				return;
			}

			if ( event.status === 'done' ) {
				run.off( 'event', onEvent );
				this.onRunDone();
				return;
			}

			if ( event.status === 'stopped' || event.status === 'error' || event.status === 'interrupted' ) {
				run.off( 'event', onEvent );
				this.stop( `${ this.title( run.stageId ) } ${ event.status === 'error' ? 'failed' : event.status }, so the sequence stopped.` );
			}
		};

		run.on( 'event', onEvent );
	}

	private onTurnEnded( run: Run ): void {
		const outcome = run.outcome;

		if ( outcome?.status === 'ok' && this.current?.status !== 'stopped' ) {
			// The command says it is done: finish the run for the release
			// manager. Deferred so it doesn't happen inside the run's own event.
			if ( this.current?.status === 'paused' ) {
				this.update( { status: 'running', reason: null } );
			}

			setImmediate( () => {
				if ( run.status === 'awaiting_reply' ) {
					run.finish();
				}
			} );
			return;
		}

		if ( this.current?.status === 'running' ) {
			const title = this.title( run.stageId );
			const reason = outcome
				? `${ title } ${ outcome.status === 'blocked' ? 'stopped early' : 'failed' }${ outcome.summary ? `: ${ outcome.summary }` : '.' } Reply to sort it out, or press Finish to carry on.`
				: `${ title } is waiting for you. Reply if it asked something, or press Finish to carry on.`;

			this.update( { status: 'paused', reason } );
		}
	}

	private onRunDone(): void {
		if ( ! this.current || this.current.status === 'stopped' ) {
			return;
		}

		const next = this.current.index + 1;

		if ( next >= this.current.stages.length ) {
			const before = this.current.stopsBefore ? STAGES.find( ( stage ) => stage.id === this.current!.stopsBefore ) : null;

			this.update( {
				status: 'done',
				reason: before
					? `All stages ran. ${ before.title } is next; it is permanent, so start it yourself.`
					: 'All stages ran.',
			} );
			return;
		}

		const stage = STAGES.find( ( item ) => item.id === this.current!.stages[ next ] )!;
		const blocked = stage.blockedReason( this.options.contextFor( this.version! ) );

		if ( blocked ) {
			this.update( { index: next, status: 'stopped', reason: `${ stage.title } cannot start: ${ blocked }` } );
			return;
		}

		this.current.index = next;
		this.current.status = 'running';
		this.current.reason = null;

		try {
			this.launch( stage );
		} catch ( error ) {
			this.update( { status: 'stopped', reason: `${ stage.title } could not start: ${ ( error as Error ).message }` } );
		}
	}

	private title( stageId: string ): string {
		return STAGES.find( ( stage ) => stage.id === stageId )?.title ?? stageId;
	}

	private update( changes: Partial<SequenceSnapshot> ): void {
		if ( ! this.current ) {
			return;
		}

		Object.assign( this.current, changes );
		this.emit( 'change', this.snapshot() );
	}
}
