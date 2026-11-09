// Ported unchanged from wp-simple-pay-pro origin/develop (9e1146f7b): tools/release-console/server/runs/store.ts
/**
 * Saves run snapshots to disk, so the transcript of a run and its Claude
 * session id survive a server restart.
 *
 * One JSON file per run in `tools/release-console/.state/runs/` (gitignored).
 * A run that was still active when the server stopped is loaded back as
 * `interrupted`: its process is gone, but its session can be resumed.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunSnapshot, RunStatus } from './runner.ts';

const ACTIVE: RunStatus[] = [ 'running', 'waiting', 'awaiting_reply' ];
const KNOWN: RunStatus[] = [ ...ACTIVE, 'done', 'stopped', 'error', 'interrupted' ];
const ID_PATTERN = /^[0-9a-f-]{36}$/;

/** How many saved runs to keep. Older ones are deleted when a run is saved. */
export const KEEP_RUNS = 100;

export interface RunStore {
	save( run: RunSnapshot ): void;
	loadAll(): RunSnapshot[];
	/** Forgets one saved run. Unknown ids are ignored. */
	remove( id: string ): void;
}

function isSnapshot( value: unknown ): value is RunSnapshot {
	const data = value as Partial<RunSnapshot> | null;

	return Boolean(
		data &&
			typeof data.id === 'string' &&
			ID_PATTERN.test( data.id ) &&
			typeof data.stageId === 'string' &&
			typeof data.version === 'string' &&
			typeof data.prompt === 'string' &&
			typeof data.startedAt === 'number' &&
			KNOWN.includes( data.status as RunStatus ) &&
			Array.isArray( data.items ) &&
			Array.isArray( data.files )
	);
}

export class FileRunStore implements RunStore {
	private readonly directory: string;
	private readonly onError: ( message: string ) => void;

	constructor( directory: string, onError: ( message: string ) => void = ( message ) => console.warn( message ) ) {
		this.directory = directory;
		this.onError = onError;
	}

	save( run: RunSnapshot ): void {
		if ( ! ID_PATTERN.test( run.id ) ) {
			return;
		}

		try {
			mkdirSync( this.directory, { recursive: true } );

			const file = path.join( this.directory, `${ run.id }.json` );
			const temporary = `${ file }.tmp`;

			// Pending questions cannot outlive the process that would answer them.
			writeFileSync( temporary, JSON.stringify( { ...run, gates: [] } ) );
			renameSync( temporary, file );
			this.prune();
		} catch ( error ) {
			this.onError( `Could not save run ${ run.id }: ${ ( error as Error ).message }` );
		}
	}

	loadAll(): RunSnapshot[] {
		let names: string[];

		try {
			names = readdirSync( this.directory ).filter( ( name ) => name.endsWith( '.json' ) );
		} catch {
			return [];
		}

		const runs: RunSnapshot[] = [];

		for ( const name of names ) {
			try {
				const data: unknown = JSON.parse( readFileSync( path.join( this.directory, name ), 'utf8' ) );

				if ( ! isSnapshot( data ) ) {
					this.onError( `Skipped saved run ${ name }: it is not a run snapshot.` );
					continue;
				}

				// Waiting to be closed after reporting success is finished, not interrupted.
				const completed = data.status === 'awaiting_reply' && ( data as RunSnapshot ).outcome?.status === 'ok';
				const interrupted = ACTIVE.includes( data.status ) && ! completed;

				runs.push( {
					...data,
					status: completed ? 'done' : interrupted ? 'interrupted' : data.status,
					endedAt: data.endedAt ?? ( interrupted || completed ? data.startedAt : null ),
					sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
					costUsd: typeof data.costUsd === 'number' ? data.costUsd : null,
					error: typeof data.error === 'string' ? data.error : null,
					resumedFrom: typeof data.resumedFrom === 'string' ? data.resumedFrom : null,
					outcome: data.outcome && typeof data.outcome === 'object' ? data.outcome : null,
					gates: [],
				} );
			} catch ( error ) {
				this.onError( `Skipped saved run ${ name }: ${ ( error as Error ).message }` );
			}
		}

		return runs.sort( ( a, b ) => b.startedAt - a.startedAt );
	}

	remove( id: string ): void {
		if ( ! ID_PATTERN.test( id ) ) {
			return;
		}

		try {
			rmSync( path.join( this.directory, `${ id }.json` ), { force: true } );
		} catch ( error ) {
			this.onError( `Could not delete run ${ id }: ${ ( error as Error ).message }` );
		}
	}

	private prune(): void {
		const files = readdirSync( this.directory )
			.filter( ( name ) => name.endsWith( '.json' ) )
			.map( ( name ) => ( { name, modified: statSync( path.join( this.directory, name ) ).mtimeMs } ) );

		if ( files.length <= KEEP_RUNS ) {
			return;
		}

		files
			.sort( ( a, b ) => b.modified - a.modified )
			.slice( KEEP_RUNS )
			.forEach( ( file ) => rmSync( path.join( this.directory, file.name ), { force: true } ) );
	}
}

/** A store that keeps runs in memory only, for tests and fake mode. */
export class MemoryRunStore implements RunStore {
	readonly saved = new Map<string, RunSnapshot>();

	save( run: RunSnapshot ): void {
		this.saved.set( run.id, structuredClone( { ...run, gates: [] } ) );
	}

	loadAll(): RunSnapshot[] {
		return [ ...this.saved.values() ].sort( ( a, b ) => b.startedAt - a.startedAt );
	}

	remove( id: string ): void {
		this.saved.delete( id );
	}
}
