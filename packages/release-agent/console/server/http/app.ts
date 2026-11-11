/**
 * HTTP API and static file server for the Release Console.
 *
 * The server can start Claude Code sessions that edit the repo, so it only
 * answers requests from its own page:
 *
 * - The Host header must be the console's own address. This stops DNS
 *   rebinding, where another site points its hostname at 127.0.0.1.
 * - Writes must be `application/json`. A cross-site form or `fetch` cannot send
 *   that without a CORS preflight, and the server never approves one.
 * - When the browser sends an Origin header, it must be an allowed origin.
 */

import { execFile } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { CONFIG_FILE, ConfigError, readConfig, settingFields, validateConfig, writeConfig } from '../release/config.ts';
import { healthChecks, type HealthCheck } from '../release/health.ts';
import { BuildError, ZIP_RAW_LIMIT, type BuildManager } from '../builds/builds.ts';
import {
	consoleDataSummary,
	deleteBackup,
	deleteConsoleData,
	discardCandidates,
	discardChanges,
	listBackups,
	ResetError,
	restoreBackup,
	type ConsoleDataPaths,
} from '../repo/reset.ts';
import { contentTypeFor, FileAccessError, listReleaseFiles, readTextFile, resolveRepoPath, writeTextFile } from '../repo/files.ts';
import { diffFor, runGit, workingTreeChanges, type GitRunner } from '../repo/git.ts';
import { RunConflictError, type GateAnswer, type RunEvent, type RunManager } from '../runs/runner.ts';
import { planSequence, SequenceError, type Sequencer } from '../runs/sequence.ts';
import { ProbeCache } from '../../../src/recipe/hooks.ts';
import { CiBuildError, parseBranch, pushedBranches, type CiBuilds } from '../release/ciBuilds.ts';
import { findStage, localBuildChoices, resolveStageProbes, STAGE_GROUPS, stagePrompt, stageStates, type StageContext } from '../release/stages.ts';
import { libraryRoot, parseVersion, releaseBranches, VERSION_HINT, type ReleaseVersion } from '../release/version.ts';
import { docDiff, listUserDocs } from '../release/docs.ts';
import { recipe } from '../release/recipe.ts';

const execFileAsync = promisify( execFile );

/** What the console calls the product, from the recipe's `brand`. */
const PRODUCT = { name: recipe.brand?.name ?? recipe.name, mark: recipe.brand?.mark ?? null, color: recipe.brand?.color ?? null };
/** Build artifact labels by kind, from the recipe's `build.artifacts`. */
const ARTIFACT_LABELS: Record<string, string> = Object.fromEntries( ( recipe.build?.artifacts ?? [] ).map( ( item ) => [ item.kind, item.label ] ) );
const MAX_BODY_BYTES = 1024 * 1024;

export interface AppOptions {
	root: string;
	manager: RunManager;
	/** Host header values the server accepts, e.g. `127.0.0.1:4317`. */
	allowedHosts: string[];
	/** Origin header values the server accepts, e.g. `http://127.0.0.1:4317`. */
	allowedOrigins: string[];
	/** Built web UI. Omitted in tests and when running the Vite dev server. */
	staticDir?: string;
	/** Returns the current branch. Injectable for tests. */
	currentBranch?: ( root: string ) => Promise<string | null>;
	/** Runs git for the changes and diff views. Injectable for tests. */
	git?: GitRunner;
	/** Where Reset keeps discard backups and which console data it may delete. */
	reset?: { stateDir: string; consoleData: ConsoleDataPaths };
	/** Local plugin builds. */
	builds?: BuildManager;
	/** Runs "Run all from here" sequences. */
	sequencer?: Sequencer;
	/** Runs the health checks. Injectable for tests. */
	health?: ( version: ReleaseVersion | null ) => Promise<HealthCheck[]>;
	/** Caches the recipe's remote lookups (probes). Without it, stages only read disk. */
	probes?: ProbeCache;
	/** Starts and lists the GitHub build workflow. */
	ciBuilds?: CiBuilds;
	/** Agent sessions (free-prompt Claude Code), kept apart from release runs. */
	chats?: RunManager;
}

class HttpError extends Error {
	readonly status: number;

	constructor( status: number, message: string ) {
		super( message );
		this.status = status;
	}
}

export async function gitBranch( root: string ): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync( 'git', [ 'rev-parse', '--abbrev-ref', 'HEAD' ], { cwd: root } );

		return stdout.trim() || null;
	} catch {
		return null;
	}
}

function sendJson( res: http.ServerResponse, status: number, body: unknown ): void {
	res.writeHead( status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	} );
	res.end( JSON.stringify( body ) );
}

async function readJson( req: http.IncomingMessage ): Promise<Record<string, unknown>> {
	const type = String( req.headers[ 'content-type' ] ?? '' ).split( ';' )[ 0 ].trim().toLowerCase();

	if ( type !== 'application/json' ) {
		throw new HttpError( 415, 'Requests must be sent as application/json.' );
	}

	const chunks: Buffer[] = [];
	let size = 0;

	for await ( const chunk of req ) {
		size += ( chunk as Buffer ).length;

		if ( size > MAX_BODY_BYTES ) {
			throw new HttpError( 413, 'The request body is too large.' );
		}

		chunks.push( chunk as Buffer );
	}

	const raw = Buffer.concat( chunks ).toString( 'utf8' );

	if ( ! raw.trim() ) {
		return {};
	}

	try {
		const parsed = JSON.parse( raw );

		if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
			throw new Error();
		}

		return parsed as Record<string, unknown>;
	} catch {
		throw new HttpError( 400, 'The request body is not a JSON object.' );
	}
}

function parseGateAnswer( body: Record<string, unknown> ): GateAnswer {
	if ( body.type === 'question' ) {
		const answers = body.answers;

		if ( ! answers || typeof answers !== 'object' || Array.isArray( answers ) ) {
			throw new HttpError( 400, 'A question answer needs an answers object.' );
		}

		const clean: Record<string, string> = {};

		for ( const [ question, value ] of Object.entries( answers ) ) {
			if ( typeof value !== 'string' ) {
				throw new HttpError( 400, 'Every answer must be a string.' );
			}

			clean[ question ] = value;
		}

		return { type: 'question', answers: clean };
	}

	if ( body.type === 'approval' ) {
		if ( typeof body.allow !== 'boolean' ) {
			throw new HttpError( 400, 'An approval needs allow: true or false.' );
		}

		return {
			type: 'approval',
			allow: body.allow,
			...( typeof body.message === 'string' ? { message: body.message } : {} ),
			...( typeof body.confirm === 'string' ? { confirm: body.confirm } : {} ),
		};
	}

	throw new HttpError( 400, 'Unknown answer type.' );
}

const CONTENT_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.json': 'application/json; charset=utf-8',
};

/**
 * Streams a file into a response whose headers are already sent. If the read
 * fails (the file was removed or made unreadable after the checks), the
 * response is cut short. Without the handler the stream's 'error' event would
 * be unhandled and crash the server.
 */
export function pipeFile( file: string, res: http.ServerResponse ): void {
	createReadStream( file )
		.on( 'error', () => res.destroy() )
		.pipe( res );
}

function serveStatic( staticDir: string, urlPath: string, res: http.ServerResponse ): void {
	const decoded = decodeURIComponent( urlPath );
	let file = path.resolve( staticDir, `.${ decoded }` );

	if ( file !== staticDir && ! file.startsWith( staticDir + path.sep ) ) {
		throw new HttpError( 404, 'Not found.' );
	}

	if ( ! existsSync( file ) || statSync( file ).isDirectory() ) {
		file = path.join( staticDir, 'index.html' );
	}

	if ( ! existsSync( file ) ) {
		throw new HttpError( 404, 'The web UI has not been built. Run `npm run build:ui` in tools/release-console.' );
	}

	res.writeHead( 200, {
		'Content-Type': CONTENT_TYPES[ path.extname( file ) ] ?? 'application/octet-stream',
		'Cache-Control': file.endsWith( 'index.html' ) ? 'no-store' : 'public, max-age=31536000, immutable',
		'X-Content-Type-Options': 'nosniff',
	} );
	pipeFile( file, res );
}

function streamEvents( req: http.IncomingMessage, res: http.ServerResponse, manager: RunManager, runId: string ): void {
	const snapshot = manager.snapshot( runId );

	if ( ! snapshot ) {
		throw new HttpError( 404, 'No such run.' );
	}

	res.writeHead( 200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-store',
		Connection: 'keep-alive',
	} );

	const send = ( payload: unknown ) => res.write( `data: ${ JSON.stringify( payload ) }\n\n` );

	send( { type: 'snapshot', run: snapshot } );

	const heartbeat = setInterval( () => res.write( ': ping\n\n' ), 15000 );
	// A saved run from an earlier server start never changes, so it only gets the snapshot.
	const live = manager.get( runId );
	const onEvent = ( event: RunEvent ) => send( event );

	live?.on( 'event', onEvent );
	req.on( 'close', () => {
		clearInterval( heartbeat );
		live?.off( 'event', onEvent );
	} );
}

function serveRaw( root: string, relative: string, res: http.ServerResponse ): void {
	const { absolute, relative: resolved } = resolveRepoPath( root, relative );
	const type = contentTypeFor( resolved );
	const headers: http.OutgoingHttpHeaders = {
		'Content-Type': type,
		'Content-Length': statSync( absolute ).size,
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		// Release HTML (blog, newsletter, notifications) and SVGs are shown in an
		// iframe. Every raw file gets the CSP sandbox, whatever its type, so no
		// script in a repo file ever runs in the console's origin, even if the
		// file is opened directly.
		'Content-Security-Policy': "sandbox; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
	};

	res.writeHead( 200, headers );
	pipeFile( absolute, res );
}

function requireVersion( raw: string | null ): ReleaseVersion {
	const version = parseVersion( raw );

	if ( ! version ) {
		throw new HttpError( 400, VERSION_HINT );
	}

	return version;
}

function asHttpError( error: unknown, status = 409 ): HttpError {
	if ( error instanceof HttpError ) {
		return error;
	}

	if ( error instanceof FileAccessError ) {
		return new HttpError( error.status, error.message );
	}

	if ( error instanceof RunConflictError ) {
		return new HttpError( 409, error.message );
	}

	if ( error instanceof ConfigError ) {
		return new HttpError( 400, error.message );
	}

	if ( error instanceof SequenceError ) {
		return new HttpError( 409, error.message );
	}

	if ( error instanceof BuildError || error instanceof ResetError || error instanceof CiBuildError ) {
		return new HttpError( error.status, error.message );
	}

	return new HttpError( status, error instanceof Error ? error.message : String( error ) );
}

/** Every release's output folder (the recipe's outputs.dir) with its files, newest version first. */
export function libraryVersions( root: string ): { version: string; files: ReturnType<typeof listReleaseFiles> }[] {
	const library = libraryRoot();

	if ( ! library || ! existsSync( path.join( root, library.dir ) ) ) {
		return [];
	}

	const parts = ( value: string ) => value.split( /[.-]/ ).map( ( part ) => Number.parseInt( part, 10 ) || 0 );

	return readdirSync( path.join( root, library.dir ), { withFileTypes: true } )
		.filter( ( entry ) => entry.isDirectory() && library.isRelease( entry.name ) )
		.map( ( entry ) => entry.name )
		.sort( ( a, b ) => {
			const [ x, y ] = [ parts( a ), parts( b ) ];

			for ( let i = 0; i < Math.max( x.length, y.length ); i++ ) {
				if ( ( y[ i ] ?? 0 ) !== ( x[ i ] ?? 0 ) ) {
					return ( y[ i ] ?? 0 ) - ( x[ i ] ?? 0 );
				}
			}

			return 0;
		} )
		.map( ( version ) => ( { version, files: listReleaseFiles( root, library.isRelease( version )! ) } ) );
}

/** The live run of a manager, summarized: what it is, how it's going, and whether it needs someone. */
export function liveRun( manager: RunManager ) {
	const run = manager.latest;

	if ( ! run ) {
		return null;
	}

	const snap = run.snapshot();

	return {
		id: snap.id,
		stageId: snap.stageId,
		title: recipe.stages.find( ( s ) => s.id === snap.stageId )?.title ?? null,
		version: snap.version,
		prompt: snap.prompt.slice( 0, 120 ),
		status: snap.status,
		active: [ 'running', 'waiting', 'awaiting_reply' ].includes( snap.status ),
		needsYou: snap.gates.length > 0 || snap.status === 'awaiting_reply',
		startedAt: snap.startedAt,
		endedAt: snap.endedAt,
	};
}

export function createApp( options: AppOptions ): http.RequestListener {
	const { root, manager } = options;
	const currentBranch = options.currentBranch ?? gitBranch;
	const git = options.git ?? runGit;
	const health = options.health ?? ( ( version: ReleaseVersion | null ) => healthChecks( { root, version } ) );
	const stageContext = ( version: ReleaseVersion ): StageContext => ( {
		root,
		version,
		localBuilds: options.builds?.finished() ?? [],
	} );
	let lastRunKey: string | null = null;
	// The same context, plus what GitHub has. A run that just ended may have
	// published, so its end clears the cached lookups.
	const remoteStageContext = async ( version: ReleaseVersion ): Promise<StageContext> => {
		const context = stageContext( version );
		const latest = manager.latestSnapshot();
		const runKey = latest ? `${ latest.id }:${ latest.status }` : null;

		if ( runKey !== lastRunKey ) {
			lastRunKey = runKey;
			options.probes?.clear();
		}

		const probes = options.probes ? await resolveStageProbes( root, version, options.probes ) : undefined;

		return { ...context, probes };
	};
	const staticDir = options.staticDir ? path.resolve( options.staticDir ) : null;

	/**
	 * /api/builds
	 *   GET  /                          list
	 *   POST /             { lite }     start
	 *   GET  /:id                       one build
	 *   GET  /:id/log?offset=N          log since offset
	 *   POST /:id/cancel | /:id/delete
	 *   GET  /:id/files/:name           download a zip
	 *   GET  /:id/files/:name/contents  list a zip's files
	 */
	async function routeBuilds( req: http.IncomingMessage, res: http.ServerResponse, method: string, rest: string[] ): Promise<void> {
		const builds = options.builds;

		if ( ! builds ) {
			throw new HttpError( 404, 'Builds are not available.' );
		}

		try {
			if ( rest.length === 0 && method === 'GET' ) {
				sendJson( res, 200, { builds: builds.list(), running: builds.runningId, labels: ARTIFACT_LABELS } );
				return;
			}

			if ( rest.length === 0 && method === 'POST' ) {
				const body = await readJson( req );

				sendJson( res, 201, { build: builds.start( { lite: body.lite === true } ) } );
				return;
			}

			const [ id, action, name, extra ] = rest;

			if ( method === 'GET' && rest.length === 1 ) {
				const build = builds.get( id );

				if ( ! build ) {
					throw new HttpError( 404, 'No such build.' );
				}

				sendJson( res, 200, { build } );
				return;
			}

			if ( method === 'GET' && action === 'log' && rest.length === 2 ) {
				const offset = Number( new URL( req.url ?? '/', 'http://localhost' ).searchParams.get( 'offset' ) ?? 0 );

				sendJson( res, 200, { ...builds.log( id, Number.isFinite( offset ) ? offset : 0 ), build: builds.get( id ) } );
				return;
			}

			if ( method === 'GET' && action === 'files' && name && rest.length === 3 ) {
				const file = builds.artifactPath( id, decodeURIComponent( name ) );

				res.writeHead( 200, {
					'Content-Type': 'application/zip',
					'Content-Length': statSync( file ).size,
					'Content-Disposition': `attachment; filename="${ path.basename( file ) }"`,
					'Cache-Control': 'no-store',
				} );
				pipeFile( file, res );
				return;
			}

			if ( method === 'GET' && action === 'files' && name && extra === 'contents' && rest.length === 4 ) {
				sendJson( res, 200, await builds.zipEntries( id, decodeURIComponent( name ) ) );
				return;
			}

			const entryPath = new URL( req.url ?? '/', 'http://localhost' ).searchParams.get( 'path' );

			// GET /:id/files/:name/entry?path=…  one file inside the zip, as text when it is text
			if ( method === 'GET' && action === 'files' && name && extra === 'entry' && rest.length === 4 ) {
				sendJson( res, 200, { file: await builds.zipText( id, decodeURIComponent( name ), entryPath ) } );
				return;
			}

			// GET /:id/files/:name/raw?path=…[&download=1]  one file inside the zip, as-is
			if ( method === 'GET' && action === 'files' && name && extra === 'raw' && rest.length === 4 ) {
				const { data, truncated } = await builds.zipFile( id, decodeURIComponent( name ), entryPath, ZIP_RAW_LIMIT );

				if ( truncated ) {
					throw new HttpError( 413, 'That file is too large to open here. Download the zip instead.' );
				}

				const type = contentTypeFor( entryPath ?? '' );
				const headers: http.OutgoingHttpHeaders = {
					'Content-Type': type,
					'Content-Length': data.length,
					'Cache-Control': 'no-store',
					'X-Content-Type-Options': 'nosniff',
					// Nothing from inside a zip ever runs in the console's origin.
					'Content-Security-Policy': "sandbox; script-src 'none'; object-src 'none'",
					'Content-Disposition': `${ new URL( req.url ?? '/', 'http://localhost' ).searchParams.get( 'download' ) === '1' ? 'attachment' : 'inline' }; filename="${ path.basename( entryPath ?? 'file' ).replace( /"/g, '' ) }"`,
				};

				res.writeHead( 200, headers );
				res.end( data );
				return;
			}

			if ( method === 'POST' && rest.length === 2 && ( action === 'cancel' || action === 'delete' ) ) {
				await readJson( req );

				if ( action === 'cancel' ) {
					builds.cancel( id );
				} else {
					builds.delete( id );
				}

				sendJson( res, 200, { build: builds.get( id ) } );
				return;
			}
		} catch ( error ) {
			throw asHttpError( error );
		}

		throw new HttpError( 404, 'Not found.' );
	}

	/** Why nothing may be reset right now, or null. */
	function busyReason(): string | null {
		if ( manager.latest?.isActive ) {
			return 'A run is in progress. Finish or stop it first.';
		}

		if ( options.sequencer?.isActive ) {
			return 'A Run all sequence is active. Stop it first.';
		}

		if ( options.builds?.runningId ) {
			return 'A build is running. Wait for it, or cancel it.';
		}

		return null;
	}

	/**
	 * /api/reset
	 *   GET  /                              what can be discarded, backups, console data
	 *   POST /discard  { paths, confirm }   back up, then revert those changes
	 *   POST /restore  { id }               put a backup back
	 *   POST /backups/delete { id }
	 *   POST /console-data { confirm }      delete run history, builds, cache, settings
	 */
	async function routeReset( req: http.IncomingMessage, res: http.ServerResponse, method: string, rest: string[] ): Promise<void> {
		const reset = options.reset;

		if ( ! reset ) {
			throw new HttpError( 404, 'Reset is not available.' );
		}

		try {
			if ( method === 'GET' && rest.length === 0 ) {
				sendJson( res, 200, {
					changes: await discardCandidates( root, manager.writtenFiles(), git ),
					backups: listBackups( reset.stateDir ),
					consoleData: consoleDataSummary( reset.consoleData ),
					busy: busyReason(),
				} );
				return;
			}

			if ( method !== 'POST' ) {
				throw new HttpError( 404, 'Not found.' );
			}

			const body = await readJson( req );
			const action = rest.join( '/' );

			if ( action === 'backups/delete' ) {
				deleteBackup( reset.stateDir, body.id );
				sendJson( res, 200, { backups: listBackups( reset.stateDir ) } );
				return;
			}

			const busy = busyReason();

			if ( busy ) {
				throw new HttpError( 409, busy );
			}

			if ( action === 'discard' ) {
				if ( body.confirm !== 'discard' ) {
					throw new HttpError( 400, 'Type discard to confirm.' );
				}

				sendJson( res, 200, { backup: await discardChanges( root, reset.stateDir, body.paths, git ) } );
				return;
			}

			if ( action === 'restore' ) {
				sendJson( res, 200, { backup: restoreBackup( root, reset.stateDir, body.id ) } );
				return;
			}

			if ( action === 'console-data' ) {
				if ( body.confirm !== 'delete' ) {
					throw new HttpError( 400, 'Type delete to confirm.' );
				}

				deleteConsoleData( reset.consoleData );
				manager.clearHistory();
				options.sequencer?.dismiss();
				sendJson( res, 200, { consoleData: consoleDataSummary( reset.consoleData ) } );
				return;
			}
		} catch ( error ) {
			throw asHttpError( error );
		}

		throw new HttpError( 404, 'Not found.' );
	}

	async function route( req: http.IncomingMessage, res: http.ServerResponse ): Promise<void> {
		const host = String( req.headers.host ?? '' );

		if ( ! options.allowedHosts.includes( host ) ) {
			throw new HttpError( 403, 'Unexpected Host header.' );
		}

		const origin = req.headers.origin;

		if ( origin !== undefined && ! options.allowedOrigins.includes( origin ) ) {
			throw new HttpError( 403, 'Unexpected Origin header.' );
		}

		const url = new URL( req.url ?? '/', 'http://localhost' );
		const method = req.method ?? 'GET';
		const parts = url.pathname.split( '/' ).filter( Boolean );

		if ( parts[ 0 ] !== 'api' ) {
			if ( method !== 'GET' || ! staticDir ) {
				throw new HttpError( 404, 'Not found.' );
			}

			serveStatic( staticDir, url.pathname, res );
			return;
		}

		const resource = parts[ 1 ];

		// GET /api/live — small and cheap, for live status elsewhere (the web app's project list):
		// the branch, and the live release run and agent session, without their transcripts.
		if ( method === 'GET' && parts.length === 2 && resource === 'live' ) {
			sendJson( res, 200, { branch: await currentBranch( root ), run: liveRun( manager ), chat: options.chats ? liveRun( options.chats ) : null } );
			return;
		}

		// GET /api/state?version=4.17.5
		if ( method === 'GET' && parts.length === 2 && resource === 'state' ) {
			const rawVersion = url.searchParams.get( 'version' );
			const version = rawVersion ? requireVersion( rawVersion ) : null;
			const branch = await currentBranch( root );

			sendJson( res, 200, {
				root,
				branch,
				version,
				expectedBranches: version ? releaseBranches( version ) : [],
				stages: version ? stageStates( await remoteStageContext( version ) ) : [],
				groups: STAGE_GROUPS,
				product: PRODUCT,
				run: manager.latestSnapshot(),
				sequence: options.sequencer?.snapshot() ?? null,
				runs: manager.list( version?.version ),
			} );
			return;
		}

		// GET /api/sequence/plan?version=4.17.5&from=prep&skipDone=1 — what "Run all from here" would run
		if ( method === 'GET' && parts.length === 3 && resource === 'sequence' && parts[ 2 ] === 'plan' ) {
			const version = requireVersion( url.searchParams.get( 'version' ) );

			try {
				const plan = planSequence( String( url.searchParams.get( 'from' ) ?? '' ), stageContext( version ), url.searchParams.get( 'skipDone' ) === '1' );

				const context = stageContext( version );
				// Blocked now; an earlier stage in the sequence may unblock it before its turn.
				const blocked = Object.fromEntries(
					plan.stages
						.map( ( stage ) => [ stage.id, stage.blockedReason( context ) ] as const )
						.filter( ( [ , reason ] ) => reason !== null )
				);

				sendJson( res, 200, {
					stages: plan.stages.map( ( stage ) => stage.id ),
					skipped: plan.skipped.map( ( stage ) => stage.id ),
					stopsBefore: plan.stopsBefore?.id ?? null,
					blocked,
				} );
			} catch ( error ) {
				throw asHttpError( error );
			}
			return;
		}

		// POST /api/sequence { version, fromStageId, skipDone } | /api/sequence/stop | /api/sequence/dismiss
		if ( method === 'POST' && resource === 'sequence' && parts.length <= 3 ) {
			const body = await readJson( req );
			const sequencer = options.sequencer;

			if ( ! sequencer ) {
				throw new HttpError( 404, 'Sequences are not available.' );
			}

			try {
				if ( parts.length === 2 ) {
					const version = parseVersion( body.version );

					if ( ! version ) {
						throw new HttpError( 400, VERSION_HINT );
					}

					sendJson( res, 201, { sequence: sequencer.start( version, String( body.fromStageId ?? '' ), body.skipDone === true ) } );
					return;
				}

				if ( parts[ 2 ] === 'stop' ) {
					sequencer.stop();
				} else if ( parts[ 2 ] === 'dismiss' ) {
					sequencer.dismiss();
				} else {
					throw new HttpError( 404, 'Not found.' );
				}

				sendJson( res, 200, { sequence: sequencer.snapshot() } );
			} catch ( error ) {
				throw asHttpError( error );
			}
			return;
		}

		// GET /api/health?version=4.17.5
		if ( method === 'GET' && parts.length === 2 && resource === 'health' ) {
			const rawVersion = url.searchParams.get( 'version' );

			sendJson( res, 200, { checks: await health( rawVersion ? requireVersion( rawVersion ) : null ) } );
			return;
		}

		// GET /api/config — the per-machine release settings
		if ( method === 'GET' && parts.length === 2 && resource === 'config' ) {
			const config = readConfig( root );

			sendJson( res, 200, { config, issues: validateConfig( root, config ), fields: settingFields( root ), file: CONFIG_FILE } );
			return;
		}

		// POST /api/config { <setting>: value, … } — the recipe's settings fields
		if ( method === 'POST' && parts.length === 2 && resource === 'config' ) {
			const body = await readJson( req );

			try {
				const config = writeConfig( root, body );

				sendJson( res, 200, { config, issues: validateConfig( root, config ), fields: settingFields( root ), file: CONFIG_FILE } );
			} catch ( error ) {
				if ( error instanceof ConfigError ) {
					sendJson( res, 400, { error: error.message, issues: error.issues } );
					return;
				}

				throw asHttpError( error );
			}
			return;
		}

		// GET /api/library — every release folder and its files, newest version first
		if ( method === 'GET' && parts.length === 2 && resource === 'library' ) {
			sendJson( res, 200, { versions: libraryVersions( root ) } );
			return;
		}

		// GET /api/docs/diff?version=4.17.5&path=docs-user/… — one article against the previous release tag
		if ( method === 'GET' && parts.length === 3 && resource === 'docs' && parts[ 2 ] === 'diff' ) {
			const version = requireVersion( url.searchParams.get( 'version' ) ?? '' );

			try {
				sendJson( res, 200, { diff: await docDiff( root, version, url.searchParams.get( 'path' ), git ) } );
			} catch ( error ) {
				throw asHttpError( error, 404 );
			}
			return;
		}

		// GET /api/docs?version=4.17.5 — the customer docs, marked with what changed since the previous release
		if ( method === 'GET' && parts.length === 2 && resource === 'docs' ) {
			const rawVersion = url.searchParams.get( 'version' );

			sendJson( res, 200, await listUserDocs( root, rawVersion ? requireVersion( rawVersion ) : null, git ) );
			return;
		}

		if ( resource === 'reset' ) {
			await routeReset( req, res, method, parts.slice( 2 ) );
			return;
		}

		if ( resource === 'builds' ) {
			await routeBuilds( req, res, method, parts.slice( 2 ) );
			return;
		}

		if ( resource === 'ci-builds' && parts.length === 2 ) {
			const ciBuilds = options.ciBuilds;

			if ( ! ciBuilds ) {
				throw new HttpError( 404, 'GitHub builds are not available.' );
			}

			// GET /api/ci-builds — the current branch, the pushed branches to suggest, and the workflow's recent runs (null when GitHub could not be asked)
			if ( method === 'GET' ) {
				const [ branch, branches, runs ] = await Promise.all( [ currentBranch( root ), pushedBranches( root ), ciBuilds.recent() ] );

				sendJson( res, 200, { branch, branches, runs } );
				return;
			}

			// POST /api/ci-builds { branch, beta? } — run the build workflow on a pushed branch
			if ( method === 'POST' ) {
				const body = await readJson( req );

				try {
					const branch = parseBranch( body.branch );
					// Only a literal true makes a beta build, so a stray value never does.
					const beta = body.beta === true;

					const source = await ciBuilds.dispatch( branch, { beta } );

					sendJson( res, 202, { branch, beta, source } );
				} catch ( error ) {
					throw asHttpError( error );
				}
				return;
			}
		}

		// GET /api/files?version=4.17.5 — everything in the release folder
		if ( method === 'GET' && parts.length === 2 && resource === 'files' ) {
			const version = requireVersion( url.searchParams.get( 'version' ) );

			sendJson( res, 200, { files: listReleaseFiles( root, version ) } );
			return;
		}

		// GET /api/file?path=… — one text file, with its hash for saving
		if ( method === 'GET' && parts.length === 2 && resource === 'file' ) {
			try {
				sendJson( res, 200, { file: readTextFile( root, url.searchParams.get( 'path' ) ) } );
			} catch ( error ) {
				throw asHttpError( error );
			}
			return;
		}

		// POST /api/file { path, content, hash } — save an edited release file
		if ( method === 'POST' && parts.length === 2 && resource === 'file' ) {
			const body = await readJson( req );

			if ( manager.latest?.isActive ) {
				throw new HttpError( 409, 'A run is in progress and may be writing this file. Save after it ends.' );
			}

			try {
				sendJson( res, 200, { file: writeTextFile( root, body.path, body.content, body.hash ) } );
			} catch ( error ) {
				throw asHttpError( error );
			}
			return;
		}

		// GET /api/raw/<path> — a file as-is, for images and the HTML preview.
		// The path is in the URL so relative links inside the HTML resolve.
		if ( method === 'GET' && resource === 'raw' && parts.length > 2 ) {
			try {
				serveRaw( root, parts.slice( 2 ).map( ( part ) => decodeURIComponent( part ) ).join( '/' ), res );
			} catch ( error ) {
				throw asHttpError( error );
			}
			return;
		}

		// GET /api/changes — uncommitted changes in the working tree
		if ( method === 'GET' && parts.length === 2 && resource === 'changes' ) {
			try {
				sendJson( res, 200, await workingTreeChanges( root, git ) );
			} catch ( error ) {
				throw asHttpError( error, 500 );
			}
			return;
		}

		// GET /api/diff?path=…
		if ( method === 'GET' && parts.length === 2 && resource === 'diff' ) {
			try {
				sendJson( res, 200, { diff: await diffFor( root, url.searchParams.get( 'path' ), git ) } );
			} catch ( error ) {
				throw asHttpError( error, 404 );
			}
			return;
		}

		// GET /api/runs?version=4.17.5 — run history
		if ( method === 'GET' && parts.length === 2 && resource === 'runs' ) {
			const rawVersion = url.searchParams.get( 'version' );

			sendJson( res, 200, { runs: manager.list( rawVersion ? requireVersion( rawVersion ).version : undefined ) } );
			return;
		}

		// POST /api/runs { stageId, version, confirm?, buildId? }
		if ( method === 'POST' && parts.length === 2 && resource === 'runs' ) {
			const body = await readJson( req );
			const version = parseVersion( body.version );

			if ( ! version ) {
				throw new HttpError( 400, VERSION_HINT );
			}

			const stage = findStage( String( body.stageId ?? '' ) );

			if ( ! stage ) {
				throw new HttpError( 404, 'Unknown stage.' );
			}

			const context = await remoteStageContext( version );
			const blocked = stage.blockedReason( context );

			if ( blocked ) {
				throw new HttpError( 409, blocked );
			}

			// Optionally run against a local build instead of the CI build.
			let prompt = stagePrompt( stage, version );

			if ( body.buildId !== undefined && body.buildId !== null ) {
				if ( ! stage.localBuild ) {
					throw new HttpError( 400, `${ stage.title } does not run against a local build.` );
				}

				const choice = localBuildChoices( stage, context ).find( ( item ) => item.id === body.buildId );

				if ( ! choice ) {
					throw new HttpError( 404, 'That local build is not available. It may still be running, have failed, or been deleted. Pick another on the Builds page.' );
				}

				prompt = choice.prompt;
			}

			// Checked on the server too, so only a deliberate request can start a publishing stage.
			if ( stage.irreversible && String( body.confirm ?? '' ).trim() !== version.version ) {
				throw new HttpError( 400, `${ stage.title } is permanent and public. Type ${ version.version } to start it.` );
			}

			try {
				sendJson( res, 201, { run: manager.start( stage.id, version.version, prompt ).snapshot() } );
			} catch ( error ) {
				throw asHttpError( error );
			}
			return;
		}

		// Agent sessions: Claude Code in the repo with a free prompt, like the terminal.
		// GET /api/chat — sessions, newest first · POST /api/chat { prompt, permissions }
		if ( resource === 'chat' && parts.length === 2 ) {
			const chats = options.chats;

			if ( ! chats ) {
				throw new HttpError( 404, 'Agent sessions are not available.' );
			}

			if ( method === 'GET' ) {
				sendJson( res, 200, { runs: chats.list(), run: chats.latestSnapshot(), releaseRun: manager.latest?.isActive ? manager.latestSnapshot() : null } );
				return;
			}

			if ( method === 'POST' ) {
				const body = await readJson( req );
				const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

				if ( ! prompt ) {
					throw new HttpError( 400, 'Type what Claude should do.' );
				}

				const permissions = body.permissions === 'risky' ? 'risky' : 'ask';

				try {
					const stageId = body.chrome === true ? 'chat-chrome' : 'chat';

					sendJson( res, 201, { run: chats.start( stageId, 'session', prompt, { permissions, confirmPhrase: chats.confirmPhrase ?? 'confirm' } ).snapshot() } );
				} catch ( error ) {
					throw asHttpError( error );
				}
				return;
			}
		}

		// POST /api/chat/delete-all — delete every Agent session
		if ( resource === 'chat' && method === 'POST' && parts.length === 3 && parts[ 2 ] === 'delete-all' ) {
			if ( ! options.chats ) {
				throw new HttpError( 404, 'Agent sessions are not available.' );
			}

			try {
				sendJson( res, 200, { deleted: options.chats.deleteAll() } );
			} catch ( error ) {
				throw asHttpError( error );
			}
			return;
		}

		// POST /api/chat/:id/delete — delete one chat (the session and the ones that resumed it)
		if ( resource === 'chat' && method === 'POST' && parts.length === 4 && parts[ 3 ] === 'delete' ) {
			if ( ! options.chats ) {
				throw new HttpError( 404, 'Agent sessions are not available.' );
			}

			try {
				sendJson( res, 200, { deleted: options.chats.deleteConversation( parts[ 2 ] ) } );
			} catch ( error ) {
				throw asHttpError( error, error instanceof Error && error.message === 'No such run.' ? 404 : 409 );
			}
			return;
		}

		// per-run routes, for release runs (/api/runs/…) and Agent sessions (/api/chat/…)
		const target = resource === 'chat' ? options.chats : manager;

		if ( ! target ) {
			throw new HttpError( 404, 'Not found.' );
		}

		if ( ( resource !== 'runs' && resource !== 'chat' ) || ! parts[ 2 ] ) {
			throw new HttpError( 404, 'Not found.' );
		}

		const runId = parts[ 2 ];

		// GET /api/runs/:id/events
		if ( method === 'GET' && parts.length === 4 && parts[ 3 ] === 'events' ) {
			streamEvents( req, res, target, runId );
			return;
		}

		// GET /api/runs/:id
		if ( method === 'GET' && parts.length === 3 ) {
			const snapshot = target.snapshot( runId );

			if ( ! snapshot ) {
				throw new HttpError( 404, 'No such run.' );
			}

			sendJson( res, 200, { run: snapshot } );
			return;
		}

		if ( method !== 'POST' ) {
			throw new HttpError( 404, 'Not found.' );
		}

		// POST /api/runs/:id/resume { message } — continue an ended run's session
		if ( parts.length === 4 && parts[ 3 ] === 'resume' ) {
			const body = await readJson( req );

			if ( ! target.snapshot( runId ) ) {
				throw new HttpError( 404, 'No such run.' );
			}

			try {
				const message = typeof body.message === 'string' ? body.message : '';

				sendJson( res, 201, { run: target.resume( runId, message ).snapshot() } );
			} catch ( error ) {
				throw asHttpError( error );
			}
			return;
		}

		const run = target.get( runId );

		if ( ! run ) {
			throw new HttpError(
				target.snapshot( runId ) ? 409 : 404,
				target.snapshot( runId ) ? 'That run has ended. Use Resume to continue its session.' : 'No such run.'
			);
		}

		const body = await readJson( req );

		try {
			// POST /api/runs/:id/gates/:gateId
			if ( parts.length === 5 && parts[ 3 ] === 'gates' ) {
				if ( ! run.resolveGate( parts[ 4 ], parseGateAnswer( body ) ) ) {
					throw new HttpError( 404, 'That question or approval is no longer pending.' );
				}
			} else if ( parts.length === 4 && parts[ 3 ] === 'reply' ) {
				if ( typeof body.text !== 'string' ) {
					throw new HttpError( 400, 'A reply needs text.' );
				}

				run.reply( body.text );
			} else if ( parts.length === 4 && parts[ 3 ] === 'finish' ) {
				run.finish();
			} else if ( parts.length === 4 && parts[ 3 ] === 'stop' ) {
				run.stop();
			} else {
				throw new HttpError( 404, 'Not found.' );
			}
		} catch ( error ) {
			throw asHttpError( error );
		}

		sendJson( res, 200, { run: run.snapshot() } );
	}

	return ( req, res ) => {
		route( req, res ).catch( ( error: unknown ) => {
			const status = error instanceof HttpError ? error.status : 500;
			const message = error instanceof Error ? error.message : 'Unexpected error.';

			if ( res.headersSent ) {
				res.end();
				return;
			}

			sendJson( res, status, { error: message } );
		} );
	};
}
