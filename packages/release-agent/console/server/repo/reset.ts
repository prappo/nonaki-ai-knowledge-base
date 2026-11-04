/**
 * Undoing what the release commands changed, and clearing the console's data.
 *
 * Discarding repo changes is destructive, so it is made reversible: every
 * selected file is copied to a backup (`.state/backups/<id>/`) before it is
 * reverted to the last commit, and Restore puts the backup back exactly,
 * including deleting files that did not exist at the time.
 *
 * Only paths `git status` reports can be discarded, so this can never touch an
 * arbitrary file.
 */

import { recipe } from '../release/recipe.ts';
import { execFile } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { workingTreeChanges, type Change, type GitRunner, runGit } from './git.ts';

const execFileAsync = promisify( execFile );

/**
 * Files the Release Console's own setup changed (its build exclusions, npm
 * script, ignore rules, command fixes, plan). Reverting one removes that
 * setup, so they are not selected for discard by default.
 */
export const CONSOLE_SETUP_FILES: string[] = recipe.reset?.protect ?? [];

/**
 * Where the release commands write: version files and readmes (Prep), the
 * release folder and PRODUCT.md (Analyze, Marketing), docs-user/ and its
 * screenshot specs (Docs), translations, and the `{next}` replacements Prep
 * makes in the source. Changes elsewhere are left unticked by default.
 */
const RELEASE_PATHS = { test: ( value: string ) => ( recipe.reset?.preselect ?? [] ).some( ( pattern ) => new RegExp( pattern ).test( value ) ) };

export interface DiscardCandidate extends Change {
	/** A console run recorded writing this file. */
	writtenByRun: boolean;
	/** Holds part of the console's own setup. */
	consoleSetup: boolean;
	/** In a place the release commands write to. */
	releasePath: boolean;
	/** Ticked when the list opens. */
	selected: boolean;
}

export interface BackupEntry {
	path: string;
	/** Whether the file existed when it was discarded; if not, Restore deletes it again. */
	existed: boolean;
}

export interface Backup {
	id: string;
	createdAt: number;
	entries: BackupEntry[];
	restoredAt: number | null;
}

export class ResetError extends Error {
	readonly status: number;

	constructor( status: number, message: string ) {
		super( message );
		this.status = status;
	}
}

const BACKUP_ID = /^\d{13}-[0-9a-f]{4}$/;

export async function discardCandidates( root: string, runFiles: Set<string>, git: GitRunner = runGit ): Promise<DiscardCandidate[]> {
	const { changes } = await workingTreeChanges( root, git );

	return changes.map( ( change ) => {
		const consoleSetup = CONSOLE_SETUP_FILES.includes( change.path );
		const writtenByRun = runFiles.has( change.path );
		const releasePath = RELEASE_PATHS.test( change.path ) || ( change.from !== null && RELEASE_PATHS.test( change.from ) );

		return {
			...change,
			writtenByRun,
			consoleSetup,
			releasePath,
			// Ticked only when a run wrote it or the release commands write there.
			selected: ! consoleSetup && ( writtenByRun || releasePath ),
		};
	} );
}

function backupsDir( stateDir: string ): string {
	return path.join( stateDir, 'backups' );
}

export function listBackups( stateDir: string ): Backup[] {
	const dir = backupsDir( stateDir );

	if ( ! existsSync( dir ) ) {
		return [];
	}

	return readdirSync( dir )
		.filter( ( name ) => BACKUP_ID.test( name ) )
		.map( ( name ) => {
			try {
				return JSON.parse( readFileSync( path.join( dir, name, 'backup.json' ), 'utf8' ) ) as Backup;
			} catch {
				return null;
			}
		} )
		.filter( ( backup ): backup is Backup => backup !== null )
		.sort( ( a, b ) => b.createdAt - a.createdAt );
}

/**
 * Backs up, then reverts, the given changed paths. Returns the backup.
 * Every path must be a current uncommitted change.
 */
export async function discardChanges( root: string, stateDir: string, paths: unknown, git: GitRunner = runGit ): Promise<Backup> {
	if ( ! Array.isArray( paths ) || paths.length === 0 || ! paths.every( ( item ) => typeof item === 'string' ) ) {
		throw new ResetError( 400, 'Choose at least one change to discard.' );
	}

	const { changes } = await workingTreeChanges( root, git );
	const byPath = new Map( changes.map( ( change ) => [ change.path, change ] ) );
	const selected: Change[] = [];

	for ( const item of new Set( paths as string[] ) ) {
		const change = byPath.get( item );

		if ( ! change ) {
			throw new ResetError( 409, `${ item } has no uncommitted changes (it may have changed since the list was loaded). Reload and try again.` );
		}

		selected.push( change );
	}

	const id = `${ Date.now() }-${ randomBytes( 2 ).toString( 'hex' ) }`;
	const dir = path.join( backupsDir( stateDir ), id );
	const entries: BackupEntry[] = [];

	mkdirSync( path.join( dir, 'files' ), { recursive: true } );

	// 1. Back up everything first, so a failure part way loses nothing.
	for ( const change of selected ) {
		for ( const file of change.from ? [ change.from, change.path ] : [ change.path ] ) {
			const absolute = path.join( root, file );
			let existed = false;

			try {
				lstatSync( absolute );
				existed = true;
			} catch {
				existed = false;
			}

			if ( existed ) {
				const target = path.join( dir, 'files', file );

				mkdirSync( path.dirname( target ), { recursive: true } );
				cpSync( absolute, target, { verbatimSymlinks: true } );
			}

			entries.push( { path: file, existed } );
		}
	}

	const backup: Backup = { id, createdAt: Date.now(), entries, restoredAt: null };

	writeFileSync( path.join( dir, 'backup.json' ), JSON.stringify( backup, null, '\t' ) );

	// 2. Revert tracked changes to HEAD (a path missing from HEAD is removed),
	//    and delete untracked files.
	const tracked = selected.filter( ( change ) => change.kind !== 'untracked' ).flatMap( ( change ) => ( change.from ? [ change.from, change.path ] : [ change.path ] ) );
	const untracked = selected.filter( ( change ) => change.kind === 'untracked' ).map( ( change ) => change.path );

	if ( tracked.length ) {
		await execFileAsync( 'git', [ 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked ], { cwd: root } );
	}

	for ( const file of untracked ) {
		rmSync( path.join( root, file ), { force: true } );
	}

	return backup;
}

/** Puts a backup's files back exactly as they were before the discard. */
export function restoreBackup( root: string, stateDir: string, id: unknown ): Backup {
	if ( typeof id !== 'string' || ! BACKUP_ID.test( id ) ) {
		throw new ResetError( 404, 'No such backup.' );
	}

	const dir = path.join( backupsDir( stateDir ), id );
	const backup = listBackups( stateDir ).find( ( item ) => item.id === id );

	if ( ! backup ) {
		throw new ResetError( 404, 'No such backup.' );
	}

	const realRoot = path.resolve( root );

	for ( const entry of backup.entries ) {
		const target = path.resolve( realRoot, entry.path );

		// The manifest is ours, but never write outside the repo whatever it says.
		if ( ! target.startsWith( realRoot + path.sep ) ) {
			continue;
		}

		if ( entry.existed ) {
			mkdirSync( path.dirname( target ), { recursive: true } );
			rmSync( target, { force: true } );
			cpSync( path.join( dir, 'files', entry.path ), target, { verbatimSymlinks: true } );
		} else {
			rmSync( target, { force: true } );
		}
	}

	const restored = { ...backup, restoredAt: Date.now() };

	writeFileSync( path.join( dir, 'backup.json' ), JSON.stringify( restored, null, '\t' ) );

	return restored;
}

export function deleteBackup( stateDir: string, id: unknown ): void {
	if ( typeof id !== 'string' || ! BACKUP_ID.test( id ) || ! existsSync( path.join( backupsDir( stateDir ), id ) ) ) {
		throw new ResetError( 404, 'No such backup.' );
	}

	rmSync( path.join( backupsDir( stateDir ), id ), { recursive: true, force: true } );
}

function folderSize( dir: string ): number {
	let total = 0;

	try {
		for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
			const full = path.join( dir, entry.name );

			if ( entry.isSymbolicLink() ) {
				continue;
			}

			total += entry.isDirectory() ? folderSize( full ) : statSync( full ).size;
		}
	} catch {
		return total;
	}

	return total;
}

export interface ConsoleDataPaths {
	runsDir: string;
	buildsDir: string;
	cacheDir: string;
	configFile: string;
}

export interface ConsoleDataSummary {
	runs: number;
	builds: number;
	bytes: number;
	settings: boolean;
}

export function consoleDataSummary( paths: ConsoleDataPaths ): ConsoleDataSummary {
	const count = ( dir: string, pattern: RegExp ) => {
		try {
			return readdirSync( dir ).filter( ( name ) => pattern.test( name ) ).length;
		} catch {
			return 0;
		}
	};

	return {
		runs: count( paths.runsDir, /\.json$/ ),
		builds: count( paths.buildsDir, /^\d{8}-\d{6}-[0-9a-f]{4}$/ ),
		bytes: folderSize( paths.runsDir ) + folderSize( paths.buildsDir ) + folderSize( paths.cacheDir ),
		settings: existsSync( paths.configFile ),
	};
}

/** Deletes run history, builds, the cache and the saved settings. Discard backups are kept. */
export function deleteConsoleData( paths: ConsoleDataPaths ): void {
	for ( const dir of [ paths.runsDir, paths.buildsDir, paths.cacheDir ] ) {
		rmSync( dir, { recursive: true, force: true } );
	}

	rmSync( paths.configFile, { force: true } );
}
