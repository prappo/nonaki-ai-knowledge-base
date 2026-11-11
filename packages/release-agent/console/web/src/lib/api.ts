import type { BuildRecord, ZipEntry, ZipFileContent } from '../../../server/builds/builds.ts';
import type { ConfigIssue, ReleaseConfig } from '../../../server/release/config.ts';
import type { FileEntry, TextFile } from '../../../server/repo/files.ts';
import type { Backup, ConsoleDataSummary, DiscardCandidate } from '../../../server/repo/reset.ts';
import type { HealthCheck } from '../../../server/release/health.ts';
import { OFFLINE_MESSAGE, REMOTE, remoteApiBase, remoteGrant, remoteUrlBase } from './remote.ts';
import type { Changes, Diff } from '../../../server/repo/git.ts';
import type { RunSnapshot, RunSummary } from '../../../server/runs/runner.ts';
import type { SequenceSnapshot } from '../../../server/runs/sequence.ts';
import type { LocalBuildChoice, StageGroup, StageState } from '../../../server/release/stages.ts';
import type { ReleaseVersion } from '../../../server/release/version.ts';

export type { Change, Changes, Diff } from '../../../server/repo/git.ts';
export type { LocalBuildChoice };
export type { DocChange, DocDiff, DocEntry, DocsListing } from '../../../server/release/docs.ts';
import type { DocDiff, DocsListing } from '../../../server/release/docs.ts';
export type { ConfigIssue, FileEntry, HealthCheck, ReleaseConfig, TextFile, RunSnapshot, RunSummary, StageGroup, StageState, ReleaseVersion };
export type { RunOutcome } from '../../../server/runs/transcript.ts';
export type { SequenceSnapshot };
export type { BuildArtifact, BuildRecord, BuildStep, ZipEntry, ZipFileContent } from '../../../server/builds/builds.ts';

export type { Backup, ConsoleDataSummary, DiscardCandidate };
export type { BetaSource, CiBuildRun } from '../../../server/release/ciBuilds.ts';
import type { BetaSource, CiBuildRun } from '../../../server/release/ciBuilds.ts';

export interface ResetPlan {
	changes: DiscardCandidate[];
	backups: Backup[];
	consoleData: ConsoleDataSummary;
	/** Why resetting is refused right now, or null. */
	busy: string | null;
}

export interface LibraryVersion {
	version: string;
	files: FileEntry[];
}

export interface SequencePlan {
	stages: string[];
	skipped: string[];
	stopsBefore: string | null;
	/** Stages blocked right now, with why. An earlier stage may unblock them. */
	blocked: Record<string, string>;
}

export interface ConfigField {
	key: string;
	label: string;
	help: string | null;
	/** Used when the field is left empty. */
	default: string | null;
}

export interface ConfigState {
	config: ReleaseConfig;
	issues: ConfigIssue[];
	/** The recipe's settings, in order. */
	fields: ConfigField[];
	/** The settings file, relative to the repo. */
	file: string;
}
export type { Gate, Question } from '../../../server/runs/runner.ts';
export type { StageReview } from '../../../server/release/stages.ts';
export type { TranscriptItem } from '../../../server/runs/transcript.ts';

export interface ProductBrand {
	name: string;
	/** SVG path data in a 60×41 box, or null for the default mark. */
	mark: string | null;
	color: string | null;
}

export interface ConsoleState {
	product?: ProductBrand;
	root: string;
	branch: string | null;
	version: ReleaseVersion | null;
	expectedBranches: string[];
	stages: StageState[];
	groups: Record<StageGroup, string>;
	run: RunSnapshot | null;
	runs: RunSummary[];
	sequence: SequenceSnapshot | null;
}

export class ApiError extends Error {
	readonly status: number;
	readonly body: Record<string, unknown>;

	constructor( status: number, message: string, body: Record<string, unknown> = {} ) {
		super( message );
		this.status = status;
		this.body = body;
	}
}

/**
 * Where the console's API lives. Standalone it's this origin; embedded in the
 * Nonaki Releases page it's the tunnel to the agent, given as ?api=<path>; in
 * the Release Console web app it's the machine's gateway (see remote.ts).
 */
export const API_BASE = ( () => {
	const base = new URLSearchParams( window.location.search ).get( 'api' ) ?? '';

	// only a same-origin path, never another site
	return /^\/[\w\-./%]*$/.test( base ) ? base.replace( /\/$/, '' ) : '';
} )();

/** An API path (starting with /api), for fetch. */
export const apiUrl = ( path: string ) => `${ REMOTE ? remoteApiBase() : API_BASE }${ path }`;

/** An API path for what can't send headers: event streams, links, downloads, images. */
export const linkUrl = ( path: string ) => `${ REMOTE ? remoteUrlBase() : API_BASE }${ path }`;

async function request<T>( url: string, init?: RequestInit ): Promise<T> {
	let response = await send( url, init );

	// The token ran out under a long-open page: once more with a new one.
	if ( REMOTE && response.status === 401 ) {
		await remoteGrant( true );
		response = await send( url, init );
	}

	const body = await response.json().catch( () => ( {} ) );

	if ( ! response.ok ) {
		throw new ApiError( response.status, body.error ?? `Request failed (${ response.status }).`, body );
	}

	return body as T;
}

async function send( url: string, init?: RequestInit ): Promise<Response> {
	if ( ! REMOTE ) {
		return fetch( apiUrl( url ), init );
	}

	const { token } = await remoteGrant();

	try {
		return await fetch( apiUrl( url ), { ...init, headers: { ...( init?.headers as Record<string, string> ), Authorization: `Bearer ${ token }` } } );
	} catch {
		// The machine went away (asleep, agent stopped, tunnel down).
		throw new ApiError( 0, OFFLINE_MESSAGE );
	}
}

function post<T>( url: string, body: unknown = {} ): Promise<T> {
	return request<T>( url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );
}

const query = ( params: Record<string, string> ) => new URLSearchParams( params ).toString();

/** URL that serves a repo file as-is, keeping its folder so relative links resolve. */
/** A file inside a build's zip, served as-is (for images and single-file downloads). */
export function zipFileUrl( id: string, name: string, path: string, download = false ): string {
	return linkUrl( `/api/builds/${ id }/files/${ encodeURIComponent( name ) }/raw?${ new URLSearchParams( { path, ...( download ? { download: '1' } : {} ) } ) }` );
}

/** Download link for a build's zip. */
export function buildFileUrl( id: string, name: string ): string {
	return linkUrl( `/api/builds/${ id }/files/${ encodeURIComponent( name ) }` );
}

export function rawUrl( path: string ): string {
	return linkUrl( `/api/raw/${ path.split( '/' ).map( encodeURIComponent ).join( '/' ) }` );
}

/** Release runs; Agent sessions use CHAT with the same per-run routes. */
export const RUNS = '/api/runs';
export const CHAT = '/api/chat';

export const api = {
	state: ( version: string ) =>
		request<ConsoleState>( `/api/state${ version ? `?${ query( { version } ) }` : '' }` ),
	run: ( runId: string, base = RUNS ) => request<{ run: RunSnapshot }>( `${ base }/${ runId }` ),
	startRun: ( stageId: string, version: string, confirm?: string, buildId?: string ) =>
		post<{ run: RunSnapshot }>( '/api/runs', { stageId, version, confirm, buildId } ),
	resume: ( runId: string, message: string, base = RUNS ) =>
		post<{ run: RunSnapshot }>( `${ base }/${ runId }/resume`, { message } ),
	answerQuestion: ( runId: string, gateId: string, answers: Record<string, string>, base = RUNS ) =>
		post( `${ base }/${ runId }/gates/${ gateId }`, { type: 'question', answers } ),
	answerApproval: ( runId: string, gateId: string, allow: boolean, message?: string, confirm?: string, base = RUNS ) =>
		post( `${ base }/${ runId }/gates/${ gateId }`, { type: 'approval', allow, message, confirm } ),
	reply: ( runId: string, text: string, base = RUNS ) => post( `${ base }/${ runId }/reply`, { text } ),
	finish: ( runId: string, base = RUNS ) => post( `${ base }/${ runId }/finish` ),
	stop: ( runId: string, base = RUNS ) => post( `${ base }/${ runId }/stop` ),
	chats: () => request<{ runs: RunSummary[]; run: RunSnapshot | null; releaseRun: RunSnapshot | null }>( CHAT ),
	startChat: ( prompt: string, permissions: 'ask' | 'risky', chrome: boolean ) =>
		post<{ run: RunSnapshot }>( CHAT, { prompt, permissions, chrome } ),
	/** Deletes a chat: the session and every session that resumed it. */
	deleteChat: ( runId: string ) => post<{ deleted: string[] }>( `${ CHAT }/${ runId }/delete` ),
	deleteAllChats: () => post<{ deleted: number }>( `${ CHAT }/delete-all` ),
	files: ( version: string ) => request<{ files: FileEntry[] }>( `/api/files?${ query( { version } ) }` ),
	file: ( path: string ) => request<{ file: TextFile }>( `/api/file?${ query( { path } ) }` ),
	saveFile: ( path: string, content: string, hash: string ) =>
		post<{ file: TextFile }>( '/api/file', { path, content, hash } ),
	changes: () => request<Changes>( '/api/changes' ),
	health: ( version: string ) =>
		request<{ checks: HealthCheck[] }>( `/api/health${ version ? `?${ query( { version } ) }` : '' }` ),
	config: () => request<ConfigState>( '/api/config' ),
	saveConfig: ( config: Record<string, string> ) => post<ConfigState>( '/api/config', config ),
	sequencePlan: ( version: string, from: string, skipDone: boolean ) =>
		request<SequencePlan>( `/api/sequence/plan?${ query( { version, from, skipDone: skipDone ? '1' : '0' } ) }` ),
	startSequence: ( version: string, fromStageId: string, skipDone: boolean ) =>
		post<{ sequence: SequenceSnapshot }>( '/api/sequence', { version, fromStageId, skipDone } ),
	stopSequence: () => post<{ sequence: SequenceSnapshot | null }>( '/api/sequence/stop' ),
	dismissSequence: () => post<{ sequence: SequenceSnapshot | null }>( '/api/sequence/dismiss' ),
	library: () => request<{ versions: LibraryVersion[] }>( '/api/library' ),
	docs: ( version: string ) => request<DocsListing>( `/api/docs${ version ? `?${ query( { version } ) }` : '' }` ),
	docDiff: ( version: string, path: string ) => request<{ diff: DocDiff }>( `/api/docs/diff?${ query( { version, path } ) }` ),
	builds: () => request<{ builds: BuildRecord[]; running: string | null; labels?: Record<string, string> }>( '/api/builds' ),
	startBuild: ( lite: boolean ) => post<{ build: BuildRecord }>( '/api/builds', { lite } ),
	buildLog: ( id: string, offset: number ) =>
		request<{ text: string; offset: number; build: BuildRecord | null }>( `/api/builds/${ id }/log?${ query( { offset: String( offset ) } ) }` ),
	ciBuilds: () => request<{ branch: string | null; branches?: string[]; runs: CiBuildRun[] | null }>( '/api/ci-builds' ),
	startCiBuild: ( branch: string, beta = false ) => post<{ branch: string; beta: boolean; source: BetaSource | null }>( '/api/ci-builds', { branch, beta } ),
	cancelBuild: ( id: string ) => post( `/api/builds/${ id }/cancel` ),
	deleteBuild: ( id: string ) => post( `/api/builds/${ id }/delete` ),
	zipFile: ( id: string, name: string, path: string ) =>
		request<{ file: ZipFileContent }>( `/api/builds/${ id }/files/${ encodeURIComponent( name ) }/entry?${ query( { path } ) }` ),
	zipContents: ( id: string, name: string ) =>
		request<{ entries: ZipEntry[]; truncated: boolean }>( `/api/builds/${ id }/files/${ encodeURIComponent( name ) }/contents` ),
	resetPlan: () => request<ResetPlan>( '/api/reset' ),
	discard: ( paths: string[], confirm: string ) => post<{ backup: Backup }>( '/api/reset/discard', { paths, confirm } ),
	restoreBackup: ( id: string ) => post<{ backup: Backup }>( '/api/reset/restore', { id } ),
	deleteBackup: ( id: string ) => post( '/api/reset/backups/delete', { id } ),
	deleteConsoleData: ( confirm: string ) => post( '/api/reset/console-data', { confirm } ),
	diff: ( path: string ) => request<{ diff: Diff }>( `/api/diff?${ query( { path } ) }` ),
};
