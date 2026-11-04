import { useEffect, useState } from 'react';

export type Page = 'pipeline' | 'library' | 'builds' | 'changes' | 'history' | 'setup';

export const PAGES: Page[] = [ 'pipeline', 'library', 'builds', 'changes', 'history', 'setup' ];

export interface Route {
	page: Page;
	/** Extra state in the hash, e.g. #/library?file=docs/releases/4.17.5/blog.html */
	params: URLSearchParams;
}

export function parseHash( hash: string ): Route {
	const [ pathPart, query = '' ] = hash.replace( /^#\/?/, '' ).split( '?' );
	const page = PAGES.includes( pathPart as Page ) ? ( pathPart as Page ) : 'pipeline';

	return { page, params: new URLSearchParams( query ) };
}

export function hashFor( page: Page, params: Record<string, string> = {} ): string {
	const query = new URLSearchParams( params ).toString();

	return `#/${ page }${ query ? `?${ query }` : '' }`;
}

/** The page shown, kept in the URL hash so a reload or a shared link opens the same place. */
export function useRoute(): [ Route, ( page: Page, params?: Record<string, string> ) => void ] {
	const [ route, setRoute ] = useState( () => parseHash( window.location.hash ) );

	useEffect( () => {
		const onChange = () => setRoute( parseHash( window.location.hash ) );

		window.addEventListener( 'hashchange', onChange );

		return () => window.removeEventListener( 'hashchange', onChange );
	}, [] );

	const navigate = ( page: Page, params: Record<string, string> = {} ) => {
		const next = hashFor( page, params );

		if ( window.location.hash !== next ) {
			window.location.hash = next;
		} else {
			setRoute( parseHash( next ) );
		}
	};

	return [ route, navigate ];
}
