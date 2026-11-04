/**
 * Links and images inside a Markdown file shown in the console.
 *
 * The docs use paths relative to the file (`../screenshots/x.png`,
 * `../faq/y.md`). In the console page those would resolve against the
 * console's own URL, so they are rewritten: images to the raw-file endpoint,
 * other Markdown files to their place in the Library.
 */

import { hashFor } from '../app/useRoute.ts';
import { rawUrl } from './api.ts';

/** Absolute URLs, protocol-relative ones, mailto: and the like. */
const EXTERNAL = /^([a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * Resolves `href` against the repo-relative file that contains it. Returns the
 * repo-relative target (without any `#fragment` or `?query`), or null when the
 * link is external, an in-page anchor, rooted at `/`, or climbs out of the repo.
 */
export function resolveRelative( fromFile: string, href: string ): string | null {
	const trimmed = href.trim();

	if ( ! trimmed || trimmed.startsWith( '#' ) || trimmed.startsWith( '/' ) || EXTERNAL.test( trimmed ) ) {
		return null;
	}

	const target = trimmed.split( /[?#]/ )[ 0 ];
	let decoded: string;

	try {
		decoded = decodeURIComponent( target );
	} catch {
		decoded = target;
	}

	const parts = fromFile.split( '/' ).slice( 0, -1 );

	for ( const segment of decoded.split( '/' ) ) {
		if ( segment === '' || segment === '.' ) {
			continue;
		}

		if ( segment === '..' ) {
			if ( parts.length === 0 ) {
				return null;
			}

			parts.pop();
		} else {
			parts.push( segment );
		}
	}

	return parts.length ? parts.join( '/' ) : null;
}

/** Where a repo file opens in the Library, or null when the Library does not show it. */
export function libraryLink( path: string ): string | null {
	if ( path.startsWith( 'docs-user/' ) ) {
		return hashFor( 'library', { source: 'docs', file: path } );
	}

	const release = path.match( /^docs\/releases\/(\d+\.\d+\.\d+)\// );

	return release ? hashFor( 'library', { source: release[ 1 ], file: path } ) : null;
}

/**
 * The href to use for an image or link inside `filePath`: images and other
 * files load from the raw endpoint, Markdown and HTML files open in the
 * Library. Returns null to leave the href as it is (external, anchors).
 */
export function relinkHref( filePath: string, type: 'image' | 'link', href: string ): string | null {
	const target = resolveRelative( filePath, href );

	if ( ! target ) {
		return null;
	}

	return type === 'link' && /\.(md|html?)$/i.test( target ) ? libraryLink( target ) ?? rawUrl( target ) : rawUrl( target );
}
