/**
 * Local plugin builds.
 *
 * Runs `scripts/build-plugin.sh`, which builds the Pro zip (and optionally
 * Lite) in a copy of the working tree, so the checkout's vendor/ and
 * composer.lock are never touched. Each build gets a folder under `.builds/`:
 *
 *   .builds/<id>/build.json   status, steps, artifacts, git state
 *   .builds/<id>/build.log    everything the build printed
 *   .builds/<id>/*.zip        the plugin zips
 *
 * One build runs at a time. Builds left "running" by a server that stopped are
 * shown as interrupted.
 */

import { recipe } from '../release/recipe.ts';
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isConsolePath, parseStatus } from '../repo/git.ts';
import { looksBinary, readZipEntry } from './zip.ts';

export type BuildStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface BuildStep {
	id: string;
	title: string;
	startedAt: number;
	endedAt: number | null;
	status: 'running' | 'done' | 'failed';
}

export interface BuildArtifact {
	name: string;
	size: number;
	kind: 'pro' | 'lite' | 'other';
}

export interface BuildGitState {
	branch: string;
	commit: string;
	/** Uncommitted files included in the build. */
	changes: number;
}

export interface BuildRecord {
	id: string;
	version: string | null;
	lite: boolean;
	status: BuildStatus;
	startedAt: number;
	endedAt: number | null;
	steps: BuildStep[];
	artifacts: BuildArtifact[];
	error: string | null;
	git: BuildGitState | null;
}

export interface ZipEntry {
	path: string;
	size: number;
}

export interface ZipFileContent {
	path: string;
	size: number;
	binary: boolean;
	truncated: boolean;
	/** The text, or null for a binary file. */
	content: string | null;
}

/** How much of a file inside a zip to show as text. */
export const ZIP_TEXT_LIMIT = 1024 * 1024;
/** How much of a file inside a zip to serve raw (images, downloads). */
export const ZIP_RAW_LIMIT = 15 * 1024 * 1024;

export class BuildError extends Error {
	readonly status: number;

	constructor( status: number, message: string ) {
		super( message );
		this.status = status;
	}
}

const ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const ARTIFACT_PATTERN = /^[\w.+-]+\.zip$/;
const ZIP_ENTRY_LIMIT = 20000;
const LOG_CHUNK_LIMIT = 256 * 1024;

export type SpawnFn = ( script: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv } ) => ChildProcess;

const defaultSpawn: SpawnFn = ( script, args, options ) =>
	// Its own process group, so Cancel can stop npm, composer and everything they start.
	spawn( 'bash', [ script, ...args ], { ...options, detached: true, stdio: [ 'ignore', 'pipe', 'pipe' ] } );

export interface BuildManagerOptions {
	root: string;
	buildsDir: string;
	script: string;
	env?: NodeJS.ProcessEnv;
	spawn?: SpawnFn;
	/** Reads git state for the record. Injectable for tests. */
	gitState?: ( root: string ) => BuildGitState | null;
}

function readGitState( root: string ): BuildGitState | null {
	try {
		const git = ( args: string[] ) => execFileSync( 'git', args, { cwd: root, encoding: 'utf8' } ).trim();
		// Same count as the Changes page: the console's own files are not part of the build.
		const status = execFileSync( 'git', [ 'status', '--porcelain=v1', '-z', '--untracked-files=all' ], { cwd: root, encoding: 'utf8' } );

		return {
			branch: git( [ 'rev-parse', '--abbrev-ref', 'HEAD' ] ),
			commit: git( [ 'rev-parse', '--short', 'HEAD' ] ),
			changes: parseStatus( status ).changes.filter( ( change ) => ! isConsolePath( change.path ) ).length,
		};
	} catch {
		return null;
	}
}

function newId(): string {
	const now = new Date();
	const pad = ( value: number ) => String( value ).padStart( 2, '0' );
	const date = `${ now.getFullYear() }${ pad( now.getMonth() + 1 ) }${ pad( now.getDate() ) }`;
	const time = `${ pad( now.getHours() ) }${ pad( now.getMinutes() ) }${ pad( now.getSeconds() ) }`;

	return `${ date }-${ time }-${ randomBytes( 2 ).toString( 'hex' ) }`;
}

/** Which artifact a zip is, by the recipe's `build.artifacts[].match`. */
function artifactKind( name: string ): BuildArtifact[ 'kind' ] {
	const found = ( recipe.build?.artifacts ?? [] ).find( ( artifact ) => artifact.match && new RegExp( artifact.match ).test( name ) );

	return ( found?.kind ?? 'other' ) as BuildArtifact[ 'kind' ];
}

/** Parses `unzip -Z -l` output into entries. */
export function parseZipListing( output: string ): ZipEntry[] {
	const entries: ZipEntry[] = [];

	for ( const line of output.split( '\n' ) ) {
		// -rw-r--r--  3.0 unx     2051 tx     1093 defN 26-Oct-13 15:22 wp-simple-pay-pro-3/readme.txt
		const match = line.match( /^[-dlrwxst]{10}\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+)$/ );

		if ( match && ! match[ 2 ].endsWith( '/' ) ) {
			entries.push( { path: match[ 2 ], size: Number( match[ 1 ] ) } );
		}
	}

	return entries;
}

export class BuildManager extends EventEmitter {
	private readonly options: BuildManagerOptions;
	private running: { id: string; child: ChildProcess; log: WriteStream; record: BuildRecord; cancelled: boolean } | null = null;

	constructor( options: BuildManagerOptions ) {
		super();
		this.options = options;
		mkdirSync( options.buildsDir, { recursive: true } );
		this.markInterrupted();
	}

	get runningId(): string | null {
		return this.running?.id ?? null;
	}

	list(): BuildRecord[] {
		let names: string[];

		try {
			names = readdirSync( this.options.buildsDir ).filter( ( name ) => ID_PATTERN.test( name ) );
		} catch {
			return [];
		}

		return names
			.map( ( name ) => this.get( name ) )
			.filter( ( record ): record is BuildRecord => record !== null )
			.sort( ( a, b ) => b.startedAt - a.startedAt );
	}

	get( id: string ): BuildRecord | null {
		if ( ! ID_PATTERN.test( id ) ) {
			return null;
		}

		if ( this.running?.id === id ) {
			return structuredClone( this.running.record );
		}

		try {
			return JSON.parse( readFileSync( path.join( this.options.buildsDir, id, 'build.json' ), 'utf8' ) ) as BuildRecord;
		} catch {
			return null;
		}
	}

	/** Finished builds with the folder holding their zips, for comparing against. */
	finished(): { record: BuildRecord; dir: string }[] {
		return this.list()
			.filter( ( record ) => record.status === 'done' )
			.map( ( record ) => ( { record, dir: path.join( this.options.buildsDir, record.id ) } ) );
	}

	start( { lite }: { lite: boolean } ): BuildRecord {
		if ( this.running ) {
			throw new BuildError( 409, 'A build is already running. Wait for it, or cancel it.' );
		}

		const id = newId();
		const dir = path.join( this.options.buildsDir, id );

		mkdirSync( dir, { recursive: true } );

		const record: BuildRecord = {
			id,
			version: null,
			lite,
			status: 'running',
			startedAt: Date.now(),
			endedAt: null,
			steps: [],
			artifacts: [],
			error: null,
			git: ( this.options.gitState ?? readGitState )( this.options.root ),
		};

		const log = createWriteStream( path.join( dir, 'build.log' ) );

		log.on( 'error', ( error ) => console.warn( `Could not write the log for build ${ id }: ${ error.message }` ) );
		const child = ( this.options.spawn ?? defaultSpawn )( this.options.script, [ dir, ...( lite ? [ '--lite' ] : [] ) ], {
			cwd: this.options.root,
			env: { ...process.env, ...this.options.env, PRO_ROOT: this.options.root },
		} );

		this.running = { id, child, log, record, cancelled: false };
		this.save( record );

		let pending = '';
		const onData = ( chunk: Buffer ) => {
			log.write( chunk );
			pending += chunk.toString( 'utf8' );

			const lines = pending.split( '\n' );
			pending = lines.pop() ?? '';
			lines.forEach( ( line ) => this.onLine( record, dir, line ) );
		};

		child.stdout?.on( 'data', onData );
		child.stderr?.on( 'data', onData );
		child.on( 'error', ( error ) => this.finish( record, null, error.message ) );
		child.on( 'close', ( code ) => {
			if ( pending ) {
				this.onLine( record, dir, pending );
			}

			this.finish( record, code );
		} );

		this.emit( 'change', record );

		return structuredClone( record );
	}

	cancel( id: string ): void {
		if ( this.running?.id !== id ) {
			throw new BuildError( 409, 'That build is not running.' );
		}

		this.running.cancelled = true;

		const pid = this.running.child.pid;

		try {
			// Negative pid: the whole process group (npm, composer, grunt).
			if ( pid ) {
				process.kill( -pid, 'SIGTERM' );
			}
		} catch {
			this.running.child.kill( 'SIGTERM' );
		}
	}

	delete( id: string ): void {
		if ( ! ID_PATTERN.test( id ) || ! this.get( id ) ) {
			throw new BuildError( 404, 'No such build.' );
		}

		if ( this.running?.id === id ) {
			throw new BuildError( 409, 'Cancel the build before deleting it.' );
		}

		rmSync( path.join( this.options.buildsDir, id ), { recursive: true, force: true } );
		this.emit( 'change', null );
	}

	/** The log from `offset` on, so the browser can follow it. */
	log( id: string, offset: number ): { text: string; offset: number } {
		if ( ! this.get( id ) ) {
			throw new BuildError( 404, 'No such build.' );
		}

		const file = path.join( this.options.buildsDir, id, 'build.log' );

		if ( ! existsSync( file ) ) {
			return { text: '', offset: 0 };
		}

		const buffer = readFileSync( file );
		const start = Math.max( 0, Math.min( offset, buffer.length ) );
		const end = Math.min( buffer.length, start + LOG_CHUNK_LIMIT );

		return { text: buffer.subarray( start, end ).toString( 'utf8' ), offset: end };
	}

	/** The absolute path of a build's zip, after checking the name belongs to it. */
	artifactPath( id: string, name: string ): string {
		const record = this.get( id );

		if ( ! record ) {
			throw new BuildError( 404, 'No such build.' );
		}

		if ( ! ARTIFACT_PATTERN.test( name ) || ! record.artifacts.some( ( artifact ) => artifact.name === name ) ) {
			throw new BuildError( 404, 'That build has no such file.' );
		}

		const dir = path.resolve( this.options.buildsDir, id );
		const file = path.resolve( dir, name );

		// The patterns above already rule out separators; this keeps the zip inside its build folder even if they change.
		if ( path.dirname( file ) !== dir ) {
			throw new BuildError( 404, 'That build has no such file.' );
		}

		if ( ! existsSync( file ) ) {
			throw new BuildError( 404, 'The zip has been removed.' );
		}

		return file;
	}

	zipEntries( id: string, name: string ): Promise<{ entries: ZipEntry[]; truncated: boolean }> {
		const file = this.artifactPath( id, name );

		return new Promise( ( resolve, reject ) => {
			execFile( 'unzip', [ '-Z', '-l', file ], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, ( error, stdout ) => {
				if ( error ) {
					reject( new BuildError( 500, `Could not read the zip: ${ error.message }` ) );
					return;
				}

				const entries = parseZipListing( stdout );

				resolve( { entries: entries.slice( 0, ZIP_ENTRY_LIMIT ), truncated: entries.length > ZIP_ENTRY_LIMIT } );
			} );
		} );
	}

	/** Reads one file inside a build's zip. The path must be one the zip lists. */
	async zipFile( id: string, name: string, entryPath: unknown, maxBytes: number ): Promise<{ data: Buffer; size: number; truncated: boolean }> {
		const file = this.artifactPath( id, name );

		if ( typeof entryPath !== 'string' || entryPath === '' || entryPath.endsWith( '/' ) ) {
			throw new BuildError( 400, 'Pick a file inside the zip.' );
		}

		let found;

		try {
			found = await readZipEntry( file, entryPath, maxBytes );
		} catch ( error ) {
			throw new BuildError( 500, `Could not read the zip: ${ ( error as Error ).message }` );
		}

		if ( ! found ) {
			throw new BuildError( 404, 'That file is not in the zip.' );
		}

		return found;
	}

	/** A file inside a build's zip, as text when it is text. */
	async zipText( id: string, name: string, entryPath: unknown ): Promise<ZipFileContent> {
		const { data, size, truncated } = await this.zipFile( id, name, entryPath, ZIP_TEXT_LIMIT );
		const binary = looksBinary( data );

		return { path: entryPath as string, size, binary, truncated, content: binary ? null : data.toString( 'utf8' ) };
	}

	private onLine( record: BuildRecord, dir: string, line: string ): void {
		const step = line.match( /^::step:: (\S+) (.+)$/ );

		if ( step ) {
			this.closeStep( record, 'done' );
			record.steps.push( { id: step[ 1 ], title: step[ 2 ].trim(), startedAt: Date.now(), endedAt: null, status: 'running' } );
			this.changed( record );
			return;
		}

		const artifact = line.match( /^::artifact:: (.+)$/ );

		if ( artifact ) {
			const name = artifact[ 1 ].trim();

			if ( ARTIFACT_PATTERN.test( name ) && existsSync( path.join( dir, name ) ) ) {
				record.artifacts.push( { name, size: statSync( path.join( dir, name ) ).size, kind: artifactKind( name ) } );
				this.changed( record );
			}

			return;
		}

		const error = line.match( /^::error:: (.+)$/ );

		if ( error ) {
			record.error = error[ 1 ].trim();
			this.changed( record );
			return;
		}

		const version = line.match( /^Version: (\d+\.\d+\.\d+(?:\.\d+)?)$/ );

		if ( version && ! record.version ) {
			record.version = version[ 1 ];
			this.changed( record );
		}
	}

	private closeStep( record: BuildRecord, status: 'done' | 'failed' ): void {
		const last = record.steps.at( -1 );

		if ( last && last.status === 'running' ) {
			last.status = status;
			last.endedAt = Date.now();
		}
	}

	private finish( record: BuildRecord, code: number | null, spawnError?: string ): void {
		if ( ! this.running || this.running.record !== record ) {
			return;
		}

		const cancelled = this.running.cancelled;
		const ok = code === 0 && ! spawnError;

		record.status = ok ? 'done' : cancelled ? 'cancelled' : 'failed';
		record.endedAt = Date.now();
		record.error = ok ? null : cancelled ? 'You cancelled the build.' : spawnError ?? record.error ?? `The build stopped with exit code ${ code }. See the log.`;
		this.closeStep( record, ok ? 'done' : 'failed' );
		this.running.log.end();
		this.running = null;
		this.save( record );
		this.emit( 'change', record );
	}

	private changed( record: BuildRecord ): void {
		this.save( record );
		this.emit( 'change', record );
	}

	private save( record: BuildRecord ): void {
		const file = path.join( this.options.buildsDir, record.id, 'build.json' );

		try {
			writeFileSync( `${ file }.tmp`, JSON.stringify( record, null, '\t' ) );
			renameSync( `${ file }.tmp`, file );
		} catch ( error ) {
			// The folder was removed from outside. Keep the server up; the build is just not recorded.
			console.warn( `Could not save build ${ record.id }: ${ ( error as Error ).message }` );
		}
	}

	private markInterrupted(): void {
		for ( const record of this.list() ) {
			if ( record.status === 'running' ) {
				const step = record.steps.at( -1 );

				if ( step?.status === 'running' ) {
					step.status = 'failed';
					step.endedAt = record.startedAt;
				}

				this.save( { ...record, steps: record.steps, status: 'interrupted', endedAt: record.endedAt ?? record.startedAt, error: 'The console stopped while this build was running.' } );
			}
		}
	}
}
