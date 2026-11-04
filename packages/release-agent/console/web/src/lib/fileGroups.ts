/**
 * Sorts a release folder's files into the groups the Files tab shows, using
 * the names the release commands write (see `docs/releases/<version>/`).
 */

import type { FileEntry } from './api.ts';

export type FileGroupId = 'notes' | 'blog' | 'newsletter' | 'social' | 'slack' | 'notifications' | 'reviews' | 'media' | 'other';

export interface FileGroup {
	id: FileGroupId;
	title: string;
	/** The deliverables: articles, posts, notes, the featured image. */
	files: FileEntry[];
	/** Images that belong to an article (screenshots), shown folded under it. */
	media: FileEntry[];
	/** What to call `media` in the UI. */
	mediaLabel: string;
}

const GROUPS: { id: FileGroupId; title: string; mediaLabel: string }[] = [
	{ id: 'notes', title: 'Release notes', mediaLabel: 'Images' },
	{ id: 'blog', title: 'Blog post', mediaLabel: 'Screenshots' },
	{ id: 'newsletter', title: 'Newsletter', mediaLabel: 'Images' },
	{ id: 'social', title: 'Social posts', mediaLabel: 'Images' },
	{ id: 'slack', title: 'Slack', mediaLabel: 'Images' },
	{ id: 'notifications', title: 'In-plugin notifications', mediaLabel: 'Images' },
	{ id: 'reviews', title: 'PR reviews', mediaLabel: 'Images' },
	{ id: 'media', title: 'Other media', mediaLabel: 'Images' },
	{ id: 'other', title: 'Other', mediaLabel: 'Images' },
];

/** The file's path inside the release folder, e.g. `blog/refund-modal.png`. */
export function releaseRelativePath( file: FileEntry, releaseDir: string ): string {
	const prefix = releaseDir.endsWith( '/' ) ? releaseDir : `${ releaseDir }/`;

	return file.path.startsWith( prefix ) ? file.path.slice( prefix.length ) : file.path;
}

export function groupFor( relative: string, kind: FileEntry[ 'kind' ] ): FileGroupId {
	const name = relative.toLowerCase();

	if ( name.startsWith( 'reviews/' ) ) {
		return 'reviews';
	}

	if ( name === 'release.md' || /^\d+\.\d+\.\d+\.\d+\.md$/.test( name ) || /^marketing-site-changes.*\.md$/.test( name ) ) {
		return 'notes';
	}

	if ( name === 'blog.html' || name.startsWith( 'blog/' ) || /featured-image\.[a-z]+$/.test( name ) ) {
		return 'blog';
	}

	if ( name.startsWith( 'newsletter' ) ) {
		return 'newsletter';
	}

	if ( /^(twitter|linkedin)[^/]*\.txt$/.test( name ) ) {
		return 'social';
	}

	if ( /^slack[^/]*\.txt$/.test( name ) ) {
		return 'slack';
	}

	if ( /^notification[^/]*\.html$/.test( name ) ) {
		return 'notifications';
	}

	return kind === 'image' ? 'media' : 'other';
}

/** Lower sorts first: the main file of each group leads, then the rest by name. */
function priority( relative: string ): number {
	const name = relative.toLowerCase();

	if ( name === 'release.md' || name === 'blog.html' || name === 'newsletter.html' || name === 'reviews/readme.md' ) {
		return 0;
	}

	if ( /^\d+\.\d+\.\d+\.\d+\.md$/.test( name ) || /featured-image/.test( name ) || name.endsWith( '-pro.html' ) || name.endsWith( '-pro.txt' ) ) {
		return 1;
	}

	return 2;
}

export function groupReleaseFiles( files: FileEntry[], releaseDir: string ): FileGroup[] {
	const buckets = new Map<FileGroupId, { files: FileEntry[]; media: FileEntry[] }>(
		GROUPS.map( ( group ) => [ group.id, { files: [], media: [] } ] )
	);

	for ( const file of files ) {
		const relative = releaseRelativePath( file, releaseDir );
		const id = groupFor( relative, file.kind );
		const bucket = buckets.get( id )!;
		// The featured image is a deliverable; other images in an article's group are its screenshots.
		const isScreenshot = file.kind === 'image' && id !== 'media' && ! /featured-image/.test( relative.toLowerCase() );

		( isScreenshot ? bucket.media : bucket.files ).push( file );
	}

	const order = ( a: FileEntry, b: FileEntry ) => {
		const [ x, y ] = [ releaseRelativePath( a, releaseDir ), releaseRelativePath( b, releaseDir ) ];

		return priority( x ) - priority( y ) || x.localeCompare( y );
	};

	return GROUPS.map( ( group ) => {
		const bucket = buckets.get( group.id )!;

		return { ...group, files: bucket.files.sort( order ), media: bucket.media.sort( order ) };
	} ).filter( ( group ) => group.files.length + group.media.length > 0 );
}

/** The name to show inside a group: the folder the group implies is dropped. */
export function displayName( file: FileEntry, releaseDir: string ): string {
	const relative = releaseRelativePath( file, releaseDir );

	return relative.replace( /^(blog|newsletter|reviews)\//, '' );
}
