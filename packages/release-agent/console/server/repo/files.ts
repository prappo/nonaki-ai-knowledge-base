/**
 * Safe read and write access to repo files for the viewer and editor.
 *
 * Reads are limited to files inside the plugin root, and never inside hidden
 * folders or files (`.git`, `.env`, `.claude/settings.local.json`) or
 * dependency folders. Symlinks are resolved before the check, so a link cannot
 * point the viewer outside the repo.
 *
 * Writes are narrower still: only existing text files under `docs/releases/`,
 * and only when the file has not changed since it was loaded.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ReleaseVersion } from '../release/version.ts';

export class FileAccessError extends Error {
	readonly status: number;

	constructor( status: number, message: string ) {
		super( message );
		this.status = status;
	}
}

export type FileKind = 'markdown' | 'html' | 'image' | 'text';

export interface FileEntry {
	/** Path relative to the plugin root, with forward slashes. */
	path: string;
	size: number;
	modifiedAt: number;
	kind: FileKind;
	editable: boolean;
}

export interface TextFile extends FileEntry {
	content: string;
	/** sha256 of the content, sent back on save to detect conflicting changes. */
	hash: string;
}

const BLOCKED_SEGMENTS = new Set( [ 'node_modules', 'vendor' ] );
const TEXT_LIMIT = 5 * 1024 * 1024;
const WRITE_LIMIT = 2 * 1024 * 1024;
const LIST_LIMIT = 500;
const EDITABLE_EXTENSIONS = new Set( [ '.md', '.txt', '.html' ] );

const KINDS: Record<string, FileKind> = {
	'.md': 'markdown',
	'.html': 'html',
	'.htm': 'html',
	'.png': 'image',
	'.jpg': 'image',
	'.jpeg': 'image',
	'.gif': 'image',
	'.webp': 'image',
	'.svg': 'image',
};

export const CONTENT_TYPES: Record<string, string> = {
	'.md': 'text/markdown; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.htm': 'text/html; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
};

export function fileKind( relative: string ): FileKind {
	return KINDS[ path.extname( relative ).toLowerCase() ] ?? 'text';
}

export function contentTypeFor( relative: string ): string {
	return CONTENT_TYPES[ path.extname( relative ).toLowerCase() ] ?? 'text/plain; charset=utf-8';
}

export function hashContent( content: string ): string {
	return createHash( 'sha256' ).update( content ).digest( 'hex' );
}

function toPosix( relative: string ): string {
	return relative.split( path.sep ).join( '/' );
}

/** Whether the editor may save this (already validated) relative path. */
export function isEditable( relative: string ): boolean {
	return relative.startsWith( 'docs/releases/' ) && EDITABLE_EXTENSIONS.has( path.extname( relative ).toLowerCase() );
}

/** Throws if any segment is hidden (`.git`, `.env`) or a dependency folder, in any case. */
function assertNotHidden( segments: string[] ): void {
	if ( segments.some( ( segment ) => segment.startsWith( '.' ) || BLOCKED_SEGMENTS.has( segment.toLowerCase() ) ) ) {
		throw new FileAccessError( 403, 'Hidden files and dependency folders are not shown.' );
	}
}

/**
 * Resolves a repo-relative path to an absolute one, or throws. The file must
 * exist; its real path (after symlinks) must still be inside the root.
 */
export function resolveRepoPath( root: string, relative: unknown ): { absolute: string; relative: string } {
	if ( typeof relative !== 'string' || relative.trim() === '' || relative.includes( '\0' ) ) {
		throw new FileAccessError( 400, 'A file path is required.' );
	}

	if ( path.isAbsolute( relative ) ) {
		throw new FileAccessError( 400, 'Use a path relative to the plugin folder.' );
	}

	const segments = relative.split( /[\\/]+/ ).filter( Boolean );

	if ( segments.some( ( segment ) => segment === '..' ) ) {
		throw new FileAccessError( 403, 'That path is outside the plugin folder.' );
	}

	assertNotHidden( segments );

	const realRoot = realpathSync.native( root );
	const candidate = path.join( realRoot, ...segments );

	if ( ! existsSync( candidate ) ) {
		throw new FileAccessError( 404, 'That file does not exist.' );
	}

	// The native call returns the on-disk case, so `Node_Modules` comes back as `node_modules`.
	const real = realpathSync.native( candidate );

	if ( ! real.startsWith( realRoot + path.sep ) ) {
		throw new FileAccessError( 403, 'That path is outside the plugin folder.' );
	}

	// Check the real path too: a symlink, or a different case on a
	// case-insensitive disk, can name a hidden file without looking like one.
	assertNotHidden( path.relative( realRoot, real ).split( path.sep ) );

	if ( ! statSync( real ).isFile() ) {
		throw new FileAccessError( 400, 'That path is a folder, not a file.' );
	}

	return { absolute: real, relative: toPosix( path.relative( realRoot, real ) ) };
}

function entryFor( absolute: string, relative: string ): FileEntry {
	const stats = statSync( absolute );

	return {
		path: relative,
		size: stats.size,
		modifiedAt: stats.mtimeMs,
		kind: fileKind( relative ),
		editable: isEditable( relative ),
	};
}

/** Every file in the version's release folder, newest first. */
export function listReleaseFiles( root: string, version: ReleaseVersion ): FileEntry[] {
	const directory = path.join( root, version.releaseDir );

	if ( ! existsSync( directory ) ) {
		return [];
	}

	const entries: FileEntry[] = [];
	const walk = ( absoluteDir: string, relativeDir: string ) => {
		for ( const item of readdirSync( absoluteDir, { withFileTypes: true } ) ) {
			if ( entries.length >= LIST_LIMIT || item.name.startsWith( '.' ) ) {
				continue;
			}

			const absolute = path.join( absoluteDir, item.name );
			const relative = `${ relativeDir }/${ item.name }`;

			if ( item.isDirectory() ) {
				walk( absolute, relative );
			} else if ( item.isFile() ) {
				entries.push( entryFor( absolute, relative ) );
			}
		}
	};

	walk( directory, version.releaseDir );

	return entries.sort( ( a, b ) => b.modifiedAt - a.modifiedAt || a.path.localeCompare( b.path ) );
}

export function readTextFile( root: string, relative: unknown ): TextFile {
	const resolved = resolveRepoPath( root, relative );
	const entry = entryFor( resolved.absolute, resolved.relative );

	if ( entry.kind === 'image' ) {
		throw new FileAccessError( 415, 'Images are shown directly, not as text.' );
	}

	if ( entry.size > TEXT_LIMIT ) {
		throw new FileAccessError( 413, 'That file is too large to show here.' );
	}

	const content = readFileSync( resolved.absolute, 'utf8' );

	return { ...entry, content, hash: hashContent( content ) };
}

/**
 * Saves an edited release file. `expectedHash` is the hash the editor loaded;
 * if the file changed since (Claude or someone else wrote it), nothing is saved.
 */
export function writeTextFile( root: string, relative: unknown, content: unknown, expectedHash: unknown ): TextFile {
	if ( typeof content !== 'string' ) {
		throw new FileAccessError( 400, 'The file content must be text.' );
	}

	if ( Buffer.byteLength( content ) > WRITE_LIMIT ) {
		throw new FileAccessError( 413, 'That content is too large to save here.' );
	}

	if ( typeof expectedHash !== 'string' || expectedHash === '' ) {
		throw new FileAccessError( 400, 'Saving needs the hash of the version you edited.' );
	}

	const resolved = resolveRepoPath( root, relative );

	if ( ! isEditable( resolved.relative ) ) {
		throw new FileAccessError( 403, 'Only .md, .txt and .html files in docs/releases/ can be edited here.' );
	}

	const current = readFileSync( resolved.absolute, 'utf8' );

	if ( hashContent( current ) !== expectedHash ) {
		throw new FileAccessError( 409, 'The file changed after you opened it. Reload it, then make your edit again.' );
	}

	const temporary = `${ resolved.absolute }.release-console-${ process.pid }.tmp`;

	writeFileSync( temporary, content );
	renameSync( temporary, resolved.absolute );

	return readTextFile( root, resolved.relative );
}
