/**
 * Working tree changes for the diff view.
 *
 * Diffs are only shown for paths `git status` reports, so the diff endpoint
 * cannot be used to read arbitrary files.
 */

import { HIDDEN_PATHS } from '../release/recipe.ts';
import { execFile } from 'node:child_process';
import { closeSync, constants, lstatSync, openSync, readlinkSync, readSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify( execFile );
const MAX_CHANGES = 500;
export const MAX_DIFF_BYTES = 2 * 1024 * 1024;
export const MAX_UNTRACKED_BYTES = 512 * 1024;

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'other';

export interface Change {
	path: string;
	/** Previous path for a rename. */
	from: string | null;
	kind: ChangeKind;
	staged: boolean;
}

export interface Changes {
	changes: Change[];
	truncated: boolean;
	/** Changes left out because they are the console's own files. */
	hidden: number;
}

/**
 * The Release Console's own source. Its edits are not release work, so the
 * Changes view and the Setup check leave them out.
 */
export const CONSOLE_PATHS = HIDDEN_PATHS;

export function isConsolePath( filePath: string ): boolean {
	return CONSOLE_PATHS.some( ( prefix ) => filePath.startsWith( prefix ) );
}

export interface Diff {
	path: string;
	kind: ChangeKind;
	/** Unified diff text, or the full content of an untracked file. */
	diff: string;
	binary: boolean;
	truncated: boolean;
}

export type GitRunner = ( args: string[], cwd: string ) => Promise<string>;

export const runGit: GitRunner = async ( args, cwd ) => {
	const { stdout } = await execFileAsync( 'git', args, { cwd, maxBuffer: MAX_DIFF_BYTES * 2, encoding: 'utf8' } );

	return stdout;
};

function kindFor( x: string, y: string ): ChangeKind {
	if ( x === '?' && y === '?' ) {
		return 'untracked';
	}

	if ( x === 'U' || y === 'U' || ( x === 'A' && y === 'A' ) || ( x === 'D' && y === 'D' ) ) {
		return 'conflicted';
	}

	if ( x === 'R' || y === 'R' ) {
		return 'renamed';
	}

	if ( x === 'A' ) {
		return 'added';
	}

	if ( x === 'D' || y === 'D' ) {
		return 'deleted';
	}

	if ( x === 'M' || y === 'M' || x === 'T' || y === 'T' ) {
		return 'modified';
	}

	return 'other';
}

/** Parses `git status --porcelain=v1 -z` output. */
export function parseStatus( output: string ): Omit<Changes, 'hidden'> {
	const fields = output.split( '\0' );
	const changes: Change[] = [];
	let truncated = false;

	for ( let i = 0; i < fields.length; i++ ) {
		const field = fields[ i ];

		if ( field.length < 4 ) {
			continue;
		}

		const x = field[ 0 ];
		const y = field[ 1 ];
		const filePath = field.slice( 3 );
		const kind = kindFor( x, y );
		let from: string | null = null;

		// A rename or copy is followed by its source path as the next field.
		if ( x === 'R' || x === 'C' ) {
			from = fields[ i + 1 ] ?? null;
			i++;
		}

		if ( changes.length >= MAX_CHANGES ) {
			truncated = true;
			break;
		}

		changes.push( { path: filePath, from, kind, staged: x !== ' ' && x !== '?' } );
	}

	changes.sort( ( a, b ) => a.path.localeCompare( b.path ) );

	return { changes, truncated };
}

export async function workingTreeChanges( root: string, git: GitRunner = runGit ): Promise<Changes> {
	const { changes, truncated } = parseStatus( await git( [ 'status', '--porcelain=v1', '-z', '--untracked-files=all' ], root ) );
	const release = changes.filter( ( change ) => ! isConsolePath( change.path ) );

	return { changes: release, truncated, hidden: changes.length - release.length };
}

export function looksBinary( buffer: Buffer ): boolean {
	return buffer.subarray( 0, 8000 ).includes( 0 );
}

/**
 * Reads at most `limit` bytes from the start of a file, without loading the rest.
 * O_NOFOLLOW makes the open fail if the file is a symlink, so a file swapped for
 * a link after diffFor's lstat check is still never followed (no-op on Windows).
 */
export function readHead( file: string, limit: number ): Buffer {
	const buffer = Buffer.alloc( limit );
	const fd = openSync( file, constants.O_RDONLY | ( constants.O_NOFOLLOW ?? 0 ) );

	try {
		return buffer.subarray( 0, readSync( fd, buffer, 0, limit, 0 ) );
	} finally {
		closeSync( fd );
	}
}

export async function diffFor( root: string, filePath: unknown, git: GitRunner = runGit ): Promise<Diff> {
	if ( typeof filePath !== 'string' || filePath === '' ) {
		throw new Error( 'A file path is required.' );
	}

	const { changes } = await workingTreeChanges( root, git );
	const change = changes.find( ( item ) => item.path === filePath );

	if ( ! change ) {
		throw new Error( 'That file has no uncommitted changes.' );
	}

	if ( change.kind === 'untracked' ) {
		const absolute = path.join( root, change.path );
		const stats = lstatSync( absolute );

		// Never follow an untracked symlink: it could point outside the repo.
		if ( stats.isSymbolicLink() ) {
			return {
				path: change.path,
				kind: change.kind,
				diff: `Symbolic link to ${ readlinkSync( absolute ) }`,
				binary: false,
				truncated: false,
			};
		}

		const size = stats.size;
		const buffer = readHead( absolute, MAX_UNTRACKED_BYTES );
		const binary = looksBinary( buffer );

		return {
			path: change.path,
			kind: change.kind,
			diff: binary ? '' : buffer.toString( 'utf8' ),
			binary,
			truncated: size > MAX_UNTRACKED_BYTES,
		};
	}

	const paths = change.from ? [ change.from, change.path ] : [ change.path ];
	const output = await git( [ 'diff', '--no-color', '--no-ext-diff', 'HEAD', '--', ...paths ], root );
	const truncated = output.length > MAX_DIFF_BYTES;

	return {
		path: change.path,
		kind: change.kind,
		diff: truncated ? output.slice( 0, MAX_DIFF_BYTES ) : output,
		binary: /^Binary files .* differ$/m.test( output ),
		truncated,
	};
}
