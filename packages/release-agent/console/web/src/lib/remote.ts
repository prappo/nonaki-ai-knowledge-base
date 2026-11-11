/**
 * Remote mode: the console opened by the Release Console web app, at
 * `?machine=<id>&project=<project id on that machine>`, served from the web
 * app's own origin. It asks the web app (same origin, the user's session) for
 * tokens and the machine's address, then talks to that machine's gateway
 * directly: a full token in the Authorization header for API calls, and a
 * read-only token in the path for what can't send headers (event streams,
 * file views, downloads, images).
 *
 * The machine's address always comes from the web app, never from the URL,
 * so a crafted link can't send the user's token anywhere else.
 */

interface Grant {
	token: string;
	urlToken: string;
	tunnelUrl: string;
	expires: number;
	urlExpires: number;
}

const params = new URLSearchParams( window.location.search );
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export const REMOTE = ( () => {
	const machine = params.get( 'machine' ) ?? '';
	const project = params.get( 'project' ) ?? '';
	return ID.test( machine ) && ID.test( project ) ? { machine, project } : null;
} )();

let grant: Grant | null = null;
let pending: Promise<Grant> | null = null;

async function fetchGrant(): Promise<Grant> {
	const res = await fetch( `/api/machines/${ encodeURIComponent( REMOTE!.machine ) }/token`, { method: 'POST', credentials: 'same-origin' } );
	const data = await res.json().catch( () => ( {} ) );

	if ( ! res.ok ) {
		throw new Error( data.error ?? `Couldn't get access to the machine (HTTP ${ res.status }).` );
	}

	const url = new URL( data.tunnelUrl );
	const loopback = [ 'localhost', '127.0.0.1', '[::1]' ].includes( url.hostname );

	if ( url.protocol !== 'https:' && ! ( url.protocol === 'http:' && loopback ) ) {
		throw new Error( 'The machine has no https address.' );
	}

	return {
		token: data.token,
		urlToken: data.urlToken,
		tunnelUrl: url.origin,
		expires: Date.parse( data.expiresAt ),
		urlExpires: Date.parse( data.urlExpiresAt ),
	};
}

/** A grant with at least a minute left, fetched again when not. */
export async function remoteGrant( fresh = false ): Promise<Grant> {
	if ( ! fresh && grant && grant.expires - Date.now() > 60_000 ) {
		return grant;
	}

	pending ??= fetchGrant().finally( () => ( pending = null ) );
	grant = await pending;
	return grant;
}

export const OFFLINE_MESSAGE = "Couldn't reach your machine. Start `release-agent serve` on it (and its Cloudflare Tunnel); this page connects as soon as it's up.";

/** Before the first render: the machine's address, so URLs can be built synchronously, and that it answers. */
export async function connectRemote(): Promise<void> {
	const { tunnelUrl } = await remoteGrant();

	try {
		const res = await fetch( `${ tunnelUrl }/health`, { signal: AbortSignal.timeout( 8000 ) } );
		if ( ! res.ok ) {
			throw new Error();
		}
	} catch {
		throw new Error( OFFLINE_MESSAGE );
	}
	// Keep the URL token fresh for links made later; event streams reconnect with it.
	setInterval( () => void remoteGrant( true ).catch( () => {} ), 4 * 60_000 );
}

const projectPath = () => `/projects/${ encodeURIComponent( REMOTE!.project ) }`;

/** Where API calls go (with the full token in a header). */
export const remoteApiBase = () => `${ grant!.tunnelUrl }${ projectPath() }`;

/** Where links go: the read-only token in the path, so relative links in served HTML keep it. */
export const remoteUrlBase = () => `${ grant!.tunnelUrl }/t/${ encodeURIComponent( grant!.urlToken ) }${ projectPath() }`;
