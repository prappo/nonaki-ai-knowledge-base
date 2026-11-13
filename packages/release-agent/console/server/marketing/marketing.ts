/**
 * Marketing: AI-made promo videos for the repo's product, on this machine.
 *
 * Each video goes through stages, and each stage is a Claude Code session
 * (started by the console, cwd = the repo, so it can read the product's real
 * UI copy, docs and screenshots):
 *
 *   script  → the story, scene by scene. Nothing moves on until you approve it.
 *   music   → a royalty-free track, picked and downloaded through Chrome
 *   voice   → an ElevenLabs voiceover, one clip per scene (optional)
 *   build   → a Remotion project that animates the script
 *   render  → the final 1080p MP4
 *
 * Everything lives outside the repo, under the agent's marketing home:
 *
 *   <home>/package.json, node_modules/   one Remotion install shared by every video
 *   <home>/kit/, <home>/example/         starter components and a finished example
 *   <home>/elevenlabs.key                the ElevenLabs API key (0600), never sent anywhere
 *   <home>/<repo>/<slug>/                one video: brief.json, script.md, music/,
 *                                        voice/, project/, out/
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAGE_IDS = [ 'script', 'music', 'voice', 'build', 'render' ] as const;
export type MarketingStageId = ( typeof STAGE_IDS )[ number ];

/** Run stage ids: one per stage, so run history says which stage a session was. */
export const runStageId = ( stage: MarketingStageId ) => `marketing-${ stage }`;
export const stageOfRun = ( stageId: string ): MarketingStageId | null => {
	const stage = stageId.replace( /^marketing-/, '' );
	return ( STAGE_IDS as readonly string[] ).includes( stage ) ? ( stage as MarketingStageId ) : null;
};

export const STAGE_INFO: Record<MarketingStageId, { title: string; description: string; needs: Array<'chrome' | 'elevenlabs'> }> = {
	script: { title: 'Write the script', description: 'The story scene by scene: headline, what is on screen, the numbers and the voiceover line.', needs: [] },
	music: { title: 'Pick the music', description: 'A royalty-free background track that fits the story, downloaded through Chrome.', needs: [ 'chrome' ] },
	voice: { title: 'Record the voiceover', description: 'One ElevenLabs clip per scene, so each scene is timed to its line.', needs: [ 'elevenlabs' ] },
	build: { title: 'Build the scenes', description: 'A Remotion project that animates the script, checked frame by frame.', needs: [] },
	render: { title: 'Render the video', description: 'The final 1920×1080 MP4, with music and voice mixed in.', needs: [] },
};

export interface VideoBrief {
	slug: string;
	title: string;
	/** The feature or change to promote, and what it does. */
	feature: string;
	/** Persona, the pain, numbers, anything the story should use. */
	story: string;
	audience: string;
	/** Target length in seconds. */
	length: number;
	voice: boolean;
	/** Mood for the music, e.g. "warm, hopeful piano". */
	music: string;
	createdAt: number;
	/** Set when you approve the script; tied to the script it approved. */
	approvedAt: number | null;
	approvedHash: string | null;
}

export type StageStatus = 'done' | 'ready' | 'blocked' | 'running' | 'skipped';

export interface MarketingStage {
	id: MarketingStageId;
	title: string;
	description: string;
	needs: Array<'chrome' | 'elevenlabs'>;
	status: StageStatus;
	/** Why it can't run yet, when blocked. */
	reason: string | null;
}

export interface VideoFile {
	/** Relative to the video's folder. */
	path: string;
	size: number;
	modifiedAt: number;
}

export interface VideoSummary {
	slug: string;
	title: string;
	createdAt: number;
	/** The furthest stage done, or null. */
	progress: MarketingStageId | null;
	hasVideo: boolean;
}

export interface VideoDetail {
	brief: VideoBrief;
	stages: MarketingStage[];
	script: string | null;
	/** The approval matches the script as it is now. */
	approved: boolean;
	musicNotes: string | null;
	music: VideoFile | null;
	voiceClips: VideoFile[];
	review: VideoFile | null;
	video: VideoFile | null;
	/** The folder, for "open in Finder" and the terminal. */
	folder: string;
}

export interface MarketingSetup {
	home: string;
	folder: string;
	elevenLabs: boolean;
	/** Remotion is installed in the shared home. */
	kitInstalled: boolean;
	ffmpeg: boolean;
	chrome: boolean;
}

export class MarketingError extends Error {
	readonly status: number;

	constructor( status: number, message: string ) {
		super( message );
		this.status = status;
	}
}

/** Paths inside a video folder that the stages write. */
export const OUTPUTS = {
	brief: 'brief.json',
	script: 'script.md',
	music: 'music/track.mp3',
	musicNotes: 'music/notes.md',
	voiceDir: 'voice',
	voiceDurations: 'voice/durations.json',
	root: 'project/src/Root.tsx',
	review: 'out/review.png',
	video: ( slug: string ) => `out/${ slug }.mp4`,
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY = /^[A-Za-z0-9_-]{20,200}$/;
const KIT_VERSION_FILE = '.kit-version';

const sha = ( text: string ) => createHash( 'sha256' ).update( text ).digest( 'hex' );
const has = ( cmd: string ) => ! spawnSync( cmd, [ '-version' ], { stdio: 'ignore' } ).error;

/** The kit shipped with the agent: next to the bundle, or in the source checkout. */
export function kitSource(): string | null {
	const here = path.dirname( fileURLToPath( import.meta.url ) );
	for ( const candidate of [ path.join( here, '../marketing-kit' ), path.join( here, '../../../marketing-kit' ) ] ) {
		if ( existsSync( path.join( candidate, 'package.json' ) ) ) return candidate;
	}
	return null;
}

export function slugify( title: string ): string {
	return (
		title
			.toLowerCase()
			.normalize( 'NFKD' )
			.replace( /[^\w\s-]/g, '' )
			.replace( /[\s_]+/g, '-' )
			.replace( /-+/g, '-' )
			.replace( /^-|-$/g, '' )
			.slice( 0, 48 ) || 'video'
	);
}

export class Marketing {
	/** The marketing home, shared by every repo on this machine. */
	readonly home: string;
	/** This repo's videos. */
	readonly dir: string;
	private readonly options: { chrome: boolean; kit?: string | null };

	constructor( home: string, repoId: string, options: { chrome: boolean; kit?: string | null } = { chrome: true } ) {
		this.home = home;
		this.dir = path.join( home, repoId.replace( /[^\w.-]/g, '_' ) );
		this.options = options;
	}

	/** Creates the home and copies in the kit when it's missing or the agent ships a newer one. */
	ensureKit(): void {
		mkdirSync( this.dir, { recursive: true } );
		const source = this.options.kit === undefined ? kitSource() : this.options.kit;
		if ( ! source ) return;

		const shipped = JSON.parse( readFileSync( path.join( source, 'package.json' ), 'utf8' ) ) as { kitVersion?: number };
		const marker = path.join( this.home, KIT_VERSION_FILE );
		const current = existsSync( marker ) ? Number( readFileSync( marker, 'utf8' ) ) : 0;

		if ( current === shipped.kitVersion && existsSync( path.join( this.home, 'kit' ) ) ) return;

		for ( const part of [ 'kit', 'example' ] ) {
			rmSync( path.join( this.home, part ), { recursive: true, force: true } );
			if ( existsSync( path.join( source, part ) ) ) cpSync( path.join( source, part ), path.join( this.home, part ), { recursive: true } );
		}
		cpSync( path.join( source, 'package.json' ), path.join( this.home, 'package.json' ) );
		writeFileSync( marker, String( shipped.kitVersion ?? 1 ) );
	}

	// ── the ElevenLabs key ───────────────────────────────────────────────

	private get keyFile(): string {
		return path.join( this.home, 'elevenlabs.key' );
	}

	/** The key for voiceover sessions: the saved one, else the agent's environment. */
	elevenLabsKey(): string | null {
		if ( existsSync( this.keyFile ) ) {
			const key = readFileSync( this.keyFile, 'utf8' ).trim();
			if ( key ) return key;
		}
		return process.env.ELEVENLABS_API_KEY?.trim() || null;
	}

	saveElevenLabsKey( key: string ): void {
		const value = key.trim();
		if ( ! value ) {
			rmSync( this.keyFile, { force: true } );
			return;
		}
		if ( ! KEY.test( value ) ) throw new MarketingError( 400, 'That doesn’t look like an ElevenLabs API key.' );
		mkdirSync( this.home, { recursive: true } );
		writeFileSync( this.keyFile, value + '\n', { mode: 0o600 } );
		chmodSync( this.keyFile, 0o600 );
	}

	setup(): MarketingSetup {
		return {
			home: this.home,
			folder: this.dir,
			elevenLabs: Boolean( this.elevenLabsKey() ),
			kitInstalled: existsSync( path.join( this.home, 'node_modules', 'remotion', 'package.json' ) ),
			ffmpeg: has( 'ffmpeg' ),
			chrome: this.options.chrome,
		};
	}

	// ── videos ───────────────────────────────────────────────────────────

	folder( slug: string ): string {
		if ( ! SLUG.test( slug ) ) throw new MarketingError( 400, 'Invalid video id.' );
		const folder = path.join( this.dir, slug );
		if ( ! existsSync( path.join( folder, OUTPUTS.brief ) ) ) throw new MarketingError( 404, 'No such video.' );
		return folder;
	}

	brief( slug: string ): VideoBrief {
		return JSON.parse( readFileSync( path.join( this.folder( slug ), OUTPUTS.brief ), 'utf8' ) ) as VideoBrief;
	}

	private writeBrief( brief: VideoBrief ): void {
		writeFileSync( path.join( this.dir, brief.slug, OUTPUTS.brief ), JSON.stringify( brief, null, 2 ) + '\n' );
	}

	list(): VideoSummary[] {
		if ( ! existsSync( this.dir ) ) return [];
		const out: VideoSummary[] = [];

		for ( const entry of readdirSync( this.dir, { withFileTypes: true } ) ) {
			if ( ! entry.isDirectory() || ! SLUG.test( entry.name ) || ! existsSync( path.join( this.dir, entry.name, OUTPUTS.brief ) ) ) continue;
			try {
				const brief = this.brief( entry.name );
				const stages = this.stages( brief, null );
				const done = stages.filter( ( stage ) => stage.status === 'done' );
				out.push( {
					slug: brief.slug,
					title: brief.title,
					createdAt: brief.createdAt,
					progress: done.length ? done[ done.length - 1 ].id : null,
					hasVideo: stages.find( ( stage ) => stage.id === 'render' )?.status === 'done',
				} );
			} catch {
				// a half-written folder: leave it out
			}
		}

		return out.sort( ( a, b ) => b.createdAt - a.createdAt );
	}

	create( input: Record<string, unknown> ): VideoBrief {
		const text = ( key: string, max: number, required = false ) => {
			const value = typeof input[ key ] === 'string' ? ( input[ key ] as string ).trim() : '';
			if ( required && ! value ) throw new MarketingError( 400, `The ${ key } is required.` );
			if ( value.length > max ) throw new MarketingError( 400, `The ${ key } is too long (${ max } characters at most).` );
			return value;
		};
		const title = text( 'title', 120, true );
		const feature = text( 'feature', 4000, true );
		const length = Number( input.length ?? 60 );

		if ( ! Number.isFinite( length ) || length < 15 || length > 180 ) throw new MarketingError( 400, 'The length must be 15 to 180 seconds.' );

		mkdirSync( this.dir, { recursive: true } );
		const base = slugify( title );
		let slug = base;
		for ( let n = 2; existsSync( path.join( this.dir, slug ) ); n++ ) slug = `${ base }-${ n }`;

		const brief: VideoBrief = {
			slug,
			title,
			feature,
			story: text( 'story', 4000 ),
			audience: text( 'audience', 300 ),
			length: Math.round( length ),
			voice: input.voice !== false,
			music: text( 'music', 300 ),
			createdAt: Date.now(),
			approvedAt: null,
			approvedHash: null,
		};

		mkdirSync( path.join( this.dir, slug ), { recursive: true } );
		this.writeBrief( brief );
		return brief;
	}

	/** Saves your edits to the script. A changed script needs approving again. */
	saveScript( slug: string, text: string ): void {
		if ( text.length > 200_000 ) throw new MarketingError( 413, 'The script is too long.' );
		writeFileSync( path.join( this.folder( slug ), OUTPUTS.script ), text.endsWith( '\n' ) ? text : text + '\n' );
	}

	approve( slug: string, approved = true ): VideoBrief {
		const brief = this.brief( slug );
		const script = this.read( slug, OUTPUTS.script );
		if ( approved && ! script ) throw new MarketingError( 409, 'There is no script to approve yet. Run Write the script first.' );
		const next = { ...brief, approvedAt: approved ? Date.now() : null, approvedHash: approved && script ? sha( script ) : null };
		this.writeBrief( next );
		return next;
	}

	remove( slug: string ): void {
		rmSync( this.folder( slug ), { recursive: true, force: true } );
	}

	private read( slug: string, rel: string ): string | null {
		const file = path.join( this.dir, slug, rel );
		return existsSync( file ) ? readFileSync( file, 'utf8' ) : null;
	}

	private file( slug: string, rel: string ): VideoFile | null {
		const file = path.join( this.dir, slug, rel );
		if ( ! existsSync( file ) ) return null;
		const info = statSync( file );
		return info.isFile() ? { path: rel, size: info.size, modifiedAt: info.mtimeMs } : null;
	}

	/** Where each stage is. `active` is the marketing run going now, if any. */
	stages( brief: VideoBrief, active: { slug: string; stage: MarketingStageId } | null ): MarketingStage[] {
		const exists = ( rel: string ) => existsSync( path.join( this.dir, brief.slug, rel ) );
		const script = this.read( brief.slug, OUTPUTS.script );
		const approved = Boolean( script && brief.approvedHash && brief.approvedHash === sha( script ) );
		const done: Record<MarketingStageId, boolean> = {
			script: Boolean( script ),
			music: exists( OUTPUTS.music ),
			voice: exists( OUTPUTS.voiceDurations ),
			build: exists( OUTPUTS.root ) && exists( OUTPUTS.review ),
			render: exists( OUTPUTS.video( brief.slug ) ),
		};
		const needApproval = ! script ? 'Write the script first.' : approved ? null : 'Approve the script first.';
		const blocked: Record<MarketingStageId, string | null> = {
			script: null,
			music: needApproval ?? ( this.options.chrome ? null : 'This machine has no browser for Claude in Chrome.' ),
			voice: needApproval ?? ( this.elevenLabsKey() ? null : 'Add your ElevenLabs API key in Setup.' ),
			build:
				needApproval ??
				( ! done.music ? 'Pick the music first.' : brief.voice && ! done.voice ? 'Record the voiceover first.' : null ),
			render: done.build ? null : 'Build the scenes first.',
		};

		return STAGE_IDS.map( ( id ) => {
			const info = STAGE_INFO[ id ];
			let status: StageStatus = done[ id ] ? 'done' : blocked[ id ] ? 'blocked' : 'ready';
			if ( id === 'voice' && ! brief.voice ) status = 'skipped';
			if ( active && active.slug === brief.slug && active.stage === id ) status = 'running';
			if ( status === 'skipped' ) {
				return { id, ...info, description: 'This video has no voiceover: music and on-screen text only.', needs: [], status, reason: null };
			}
			return { id, ...info, status, reason: status === 'blocked' ? blocked[ id ] : null };
		} );
	}

	detail( slug: string, active: { slug: string; stage: MarketingStageId } | null ): VideoDetail {
		const brief = this.brief( slug );
		const script = this.read( slug, OUTPUTS.script );
		const voiceDir = path.join( this.dir, slug, OUTPUTS.voiceDir );
		const voiceClips = existsSync( voiceDir )
			? readdirSync( voiceDir )
					.filter( ( name ) => name.endsWith( '.mp3' ) )
					.sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true } ) )
					.map( ( name ) => this.file( slug, `${ OUTPUTS.voiceDir }/${ name }` ) )
					.filter( ( file ): file is VideoFile => file !== null )
			: [];

		return {
			brief,
			stages: this.stages( brief, active ),
			script,
			approved: Boolean( script && brief.approvedHash === sha( script ) ),
			musicNotes: this.read( slug, OUTPUTS.musicNotes ),
			music: this.file( slug, OUTPUTS.music ),
			voiceClips,
			review: this.file( slug, OUTPUTS.review ),
			video: this.file( slug, OUTPUTS.video( slug ) ),
			folder: path.join( this.dir, slug ),
		};
	}

	/** A file inside a video's folder, for the page to play or show. Never outside it. */
	resolveFile( slug: string, rel: string ): string {
		const folder = this.folder( slug );
		const file = path.resolve( folder, rel );
		if ( ! file.startsWith( folder + path.sep ) ) throw new MarketingError( 400, 'That file is outside the video.' );
		if ( rel.split( /[\\/]/ ).some( ( part ) => part.startsWith( '.' ) ) || /\.key$/.test( file ) ) {
			throw new MarketingError( 403, 'That file is not shared.' );
		}
		if ( ! existsSync( file ) || ! statSync( file ).isFile() ) throw new MarketingError( 404, 'No such file.' );
		return file;
	}

	/** Writes a stage's instructions into the video folder; returns their path. */
	writeInstructions( slug: string, stage: MarketingStageId, text: string ): string {
		const dir = path.join( this.folder( slug ), '.instructions' );
		mkdirSync( dir, { recursive: true } );
		const file = path.join( dir, `${ stage }.md` );
		writeFileSync( file, text );
		return file;
	}
}
