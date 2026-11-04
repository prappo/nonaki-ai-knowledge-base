/**
 * The customer docs in `docs-user/`, for the Library.
 *
 * Lists every article and image, reads each article's title from its front
 * matter, and marks what changed for a release: everything that differs from
 * the previous release tag, committed or not. So the Docs stage's work shows
 * the same before and after it is committed.
 */

import { recipe } from './recipe.ts';
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileKind, type FileEntry } from '../repo/files.ts';
import { looksBinary, MAX_DIFF_BYTES, MAX_UNTRACKED_BYTES, readHead as readFileHead, runGit, type Diff, type GitRunner } from '../repo/git.ts';
import { parseFrontMatter } from './frontMatter.ts';
import type { ReleaseVersion } from './version.ts';

/** The recipe's customer-docs folder (outputs.docsDir); empty when the product has none. */
export const DOCS_DIR = recipe.outputs?.docsDir ?? '';

/** Far more than the docs have (about 500 files); a guard, not a real cap. */
const DOCS_LIMIT = 3000;

export type DocChange = 'added' | 'modified';

export interface DocEntry extends FileEntry {
	/** The article title, from front matter or the first heading. Null for images. */
	title: string | null;
	/** The top folder inside docs-user/, e.g. `plugin-functionality`. Empty for files at the top. */
	section: string;
	/** How it changed since the previous release, or null when it did not. */
	change: DocChange | null;
}

export interface DocsListing {
	files: DocEntry[];
	/** The tag changes are measured from, or null when there is none. */
	baseTag: string | null;
	/** Files deleted since the base tag; they cannot be shown, only counted. */
	deleted: string[];
	truncated: boolean;
}

const VERSION_TAG = /^\d+\.\d+\.\d+(\.\d+)?$/;

function compareVersions( a: string, b: string ): number {
	const [ x, y ] = [ a.split( '.' ).map( Number ), b.split( '.' ).map( Number ) ];

	for ( let i = 0; i < 4; i++ ) {
		const difference = ( x[ i ] ?? 0 ) - ( y[ i ] ?? 0 );

		if ( difference !== 0 ) {
			return difference;
		}
	}

	return 0;
}

/**
 * The newest plain version tag older than `version` (4.17.4.1 for 4.17.5).
 * Prefixed tags such as v4.17.3 are ignored, as Analyze ignores them.
 */
export function previousReleaseTag( tags: string[], version: string ): string | null {
	return (
		tags
			.map( ( tag ) => tag.trim() )
			.filter( ( tag ) => VERSION_TAG.test( tag ) && compareVersions( tag, version ) < 0 )
			.sort( ( a, b ) => compareVersions( b, a ) )[ 0 ] ?? null
	);
}

/** An article's title: front matter `title`, else its first `# ` heading. */
export function articleTitle( content: string ): string | null {
	const { data, body } = parseFrontMatter( content );

	if ( data.title ) {
		return data.title;
	}

	return body.match( /^#\s+(.+?)\s*#*\s*$/m )?.[ 1 ] ?? null;
}

/** Only the start of an article is read for its title. */
function readHead( file: string ): string {
	try {
		return readFileSync( file, 'utf8' ).slice( 0, 4096 );
	} catch {
		return '';
	}
}

function walk( root: string, dir: string, out: string[], limit: number ): boolean {
	let entries;

	try {
		entries = readdirSync( path.join( root, dir ), { withFileTypes: true } );
	} catch {
		return false;
	}

	for ( const entry of entries.sort( ( a, b ) => a.name.localeCompare( b.name ) ) ) {
		// Hidden files (.optimized.json and the like) are not shown anywhere in the console.
		if ( entry.name.startsWith( '.' ) ) {
			continue;
		}

		const relative = `${ dir }/${ entry.name }`;

		if ( entry.isDirectory() ) {
			if ( walk( root, relative, out, limit ) ) {
				return true;
			}
		} else if ( entry.isFile() ) {
			if ( out.length >= limit ) {
				return true;
			}

			out.push( relative );
		}
	}

	return false;
}

/** Paths under docs-user/ that differ from `tag`, committed or not, and the untracked ones. */
async function changesSince( root: string, tag: string | null, git: GitRunner ): Promise<{ changes: Map<string, DocChange>; deleted: string[] }> {
	const changes = new Map<string, DocChange>();
	const deleted: string[] = [];

	if ( tag ) {
		// Working tree against the tag: commits since it plus anything uncommitted.
		const output = await git( [ 'diff', '--name-status', '--no-renames', '-z', tag, '--', DOCS_DIR ], root );
		const fields = output.split( '\0' );

		for ( let i = 0; i + 1 < fields.length; i += 2 ) {
			const [ status, file ] = [ fields[ i ], fields[ i + 1 ] ];

			if ( status === 'D' ) {
				deleted.push( file );
			} else if ( status === 'A' ) {
				changes.set( file, 'added' );
			} else if ( status ) {
				changes.set( file, 'modified' );
			}
		}
	}

	// New files nobody has added yet. With no tag, this is all there is to go on.
	const untracked = await git( [ 'ls-files', '--others', '--exclude-standard', '-z', '--', DOCS_DIR ], root );

	for ( const file of untracked.split( '\0' ).filter( Boolean ) ) {
		changes.set( file, 'added' );
	}

	return { changes, deleted };
}

export async function listUserDocs( root: string, version: ReleaseVersion | null, git: GitRunner = runGit, limit = DOCS_LIMIT ): Promise<DocsListing> {
	if ( ! DOCS_DIR ) {
		return { files: [], baseTag: null, deleted: [], truncated: false };
	}

	const paths: string[] = [];
	const truncated = walk( root, DOCS_DIR, paths, limit );
	let baseTag: string | null = null;
	let changes = new Map<string, DocChange>();
	let deleted: string[] = [];

	if ( version ) {
		try {
			baseTag = previousReleaseTag( ( await git( [ 'tag', '--list' ], root ) ).split( '\n' ), version.version );
			( { changes, deleted } = await changesSince( root, baseTag, git ) );
		} catch {
			// Not a git checkout, or the tag is unreadable: list the docs without changes.
			baseTag = null;
		}
	}

	const files = paths.flatMap( ( relative ): DocEntry[] => {
		let stats;

		try {
			stats = statSync( path.join( root, relative ) );
		} catch {
			return [];
		}

		const kind = fileKind( relative );
		const inside = relative.slice( DOCS_DIR.length + 1 );

		return [
			{
				path: relative,
				size: stats.size,
				modifiedAt: stats.mtimeMs,
				kind,
				editable: false,
				title: kind === 'markdown' ? articleTitle( readHead( path.join( root, relative ) ) ) : null,
				section: inside.includes( '/' ) ? inside.split( '/' )[ 0 ] : '',
				change: changes.get( relative ) ?? null,
			},
		];
	} );

	return { files, baseTag, deleted: deleted.sort(), truncated };
}

export interface DocDiff extends Diff {
	/** The tag the article is compared with. */
	baseTag: string;
	/** The article's text at the base tag, for the visual comparison; null when it did not exist there or is binary. */
	before: string | null;
	/** The article's text now; null when it is binary or deleted. */
	after: string | null;
}

/** A file's text at `ref`, or null when it is not there, is binary or is too big to compare. */
async function textAt( root: string, ref: string, relative: string, git: GitRunner ): Promise<string | null> {
	try {
		const content = await git( [ 'show', `${ ref }:${ relative }` ], root );

		return content.length > MAX_UNTRACKED_BYTES || content.includes( '\0' ) ? null : content;
	} catch {
		return null;
	}
}

/** A file's text in the working tree, or null when it is missing, binary or too big. */
function textNow( root: string, relative: string ): string | null {
	const absolute = path.join( root, relative );

	try {
		if ( lstatSync( absolute ).isSymbolicLink() || statSync( absolute ).size > MAX_UNTRACKED_BYTES ) {
			return null;
		}

		const buffer = readFileHead( absolute, MAX_UNTRACKED_BYTES );

		return looksBinary( buffer ) ? null : buffer.toString( 'utf8' );
	} catch {
		return null;
	}
}

/** A path inside docs-user/, normalized; throws for anything else. */
function docPath( filePath: unknown ): string {
	if ( typeof filePath !== 'string' || filePath === '' ) {
		throw new Error( 'A file path is required.' );
	}

	const normalized = path.posix.normalize( filePath );

	if ( ! DOCS_DIR || ! normalized.startsWith( `${ DOCS_DIR }/` ) || normalized.split( '/' ).includes( '..' ) ) {
		throw new Error( `Only files in ${ DOCS_DIR || 'the docs folder' }/ can be compared.` );
	}

	return normalized;
}

/**
 * What changed in one article since the previous release tag: the same
 * comparison that marks it New or Updated in the Library (working tree against
 * the tag, so uncommitted edits count). A file git has never seen comes back
 * whole, as `untracked`.
 */
export async function docDiff( root: string, version: ReleaseVersion, filePath: unknown, git: GitRunner = runGit ): Promise<DocDiff> {
	const relative = docPath( filePath );
	const baseTag = previousReleaseTag( ( await git( [ 'tag', '--list' ], root ) ).split( '\n' ), version.version );

	if ( ! baseTag ) {
		throw new Error( `There is no release tag before ${ version.version } to compare with.` );
	}

	const untracked = ( await git( [ 'ls-files', '--others', '--exclude-standard', '-z', '--', relative ], root ) ).split( '\0' ).includes( relative );

	if ( untracked ) {
		const absolute = path.join( root, relative );

		// Never follow an untracked symlink: it could point outside the repo.
		if ( lstatSync( absolute ).isSymbolicLink() ) {
			throw new Error( 'That file is a symbolic link.' );
		}

		const buffer = readFileHead( absolute, MAX_UNTRACKED_BYTES );
		const binary = looksBinary( buffer );

		return {
			path: relative,
			kind: 'untracked',
			diff: binary ? '' : buffer.toString( 'utf8' ),
			binary,
			truncated: statSync( absolute ).size > MAX_UNTRACKED_BYTES,
			baseTag,
			before: null,
			after: binary ? null : textNow( root, relative ),
		};
	}

	const output = await git( [ 'diff', '--no-color', '--no-ext-diff', '--no-renames', baseTag, '--', relative ], root );

	if ( ! output.trim() ) {
		throw new Error( `That file has not changed since ${ baseTag }.` );
	}

	const truncated = output.length > MAX_DIFF_BYTES;
	const kind = /^new file mode/m.test( output ) ? 'added' : /^deleted file mode/m.test( output ) ? 'deleted' : 'modified';

	return {
		path: relative,
		kind,
		diff: truncated ? output.slice( 0, MAX_DIFF_BYTES ) : output,
		binary: /^Binary files .* differ$/m.test( output ),
		truncated,
		baseTag,
		before: kind === 'added' ? null : await textAt( root, baseTag, relative, git ),
		after: kind === 'deleted' ? null : textNow( root, relative ),
	};
}
