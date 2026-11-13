/**
 * Marketing: make promo videos for the product with AI, on the agent's machine.
 *
 * A video is a brief plus five steps, each a Claude Code session there:
 * write the script (you approve it) → pick the music (Chrome) → record the
 * voiceover (ElevenLabs) → build the scenes (Remotion) → render the MP4.
 * The page shows every step's state, the script to edit and approve, the
 * music, voice clips, the review sheet and the finished video, and the live
 * session for whichever step is running.
 */

import {
	ArrowLeft,
	Check,
	Clapperboard,
	Download,
	FolderOpen,
	KeyRound,
	Loader2,
	Pencil,
	Play,
	Plus,
	RotateCcw,
	Settings2,
	Trash2,
	TriangleAlert,
	Video,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, type Tone } from '../../components/Badge.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { StageIcon } from '../../components/icons.tsx';
import { useRunStream } from '../../app/useConsole.ts';
import {
	MARKETING_RUNS,
	marketingApi,
	type MarketingSetup,
	type MarketingStage,
	type NewVideo,
	type RunSnapshot,
	type RunSummary,
	type VideoDetail,
	type VideoSummary,
} from '../../lib/api.ts';
import { formatCost } from '../../lib/format.ts';
import { isActive } from '../../lib/runState.ts';
import { RunPanel } from '../run/RunPanel.tsx';
import './marketing.css';

const SELECTED_KEY = 'release-console:marketing-video';

const load = ( key: string ): string | null => {
	try {
		return localStorage.getItem( key );
	} catch {
		return null;
	}
};
const store = ( key: string, value: string | null ) => {
	try {
		if ( value === null ) localStorage.removeItem( key );
		else localStorage.setItem( key, value );
	} catch {
		/* a per-viewer convenience only */
	}
};

const STATUS: Record<MarketingStage[ 'status' ], { label: string; tone: Tone }> = {
	done: { label: 'Done', tone: 'success' },
	ready: { label: 'Ready', tone: 'info' },
	blocked: { label: 'Waiting', tone: 'neutral' },
	running: { label: 'Running', tone: 'accent' },
	skipped: { label: 'Skipped', tone: 'neutral' },
};

const STAGE_LABEL: Record<string, string> = {
	'marketing-script': 'Write the script',
	'marketing-music': 'Pick the music',
	'marketing-voice': 'Record the voiceover',
	'marketing-build': 'Build the scenes',
	'marketing-render': 'Render the video',
};

const formatSize = ( bytes: number ) =>
	bytes > 1024 * 1024 ? `${ ( bytes / 1024 / 1024 ).toFixed( 1 ) } MB` : `${ Math.max( 1, Math.round( bytes / 1024 ) ) } KB`;

const formatDate = ( at: number ) => new Date( at ).toLocaleDateString( undefined, { month: 'short', day: 'numeric', year: 'numeric' } );

type View = { kind: 'video'; slug: string } | { kind: 'new' } | { kind: 'setup' } | { kind: 'none' };

export function MarketingApp() {
	const [ setup, setSetup ] = useState<MarketingSetup | null>( null );
	const [ videos, setVideos ] = useState<VideoSummary[]>( [] );
	const [ liveRun, setLiveRun ] = useState<RunSnapshot | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ loaded, setLoaded ] = useState( false );
	const [ view, setView ] = useState<View>( () => {
		const saved = load( SELECTED_KEY );
		return saved ? { kind: 'video', slug: saved } : { kind: 'none' };
	} );

	const refresh = useCallback( async () => {
		try {
			const result = await marketingApi.overview();
			setSetup( result.setup );
			setVideos( result.videos );
			setLiveRun( result.run );
			setError( null );
			return result;
		} catch ( caught ) {
			setError( ( caught as Error ).message );
			return null;
		} finally {
			setLoaded( true );
		}
	}, [] );

	useEffect( () => {
		void refresh();
		const timer = setInterval( () => void refresh(), 5000 );
		return () => clearInterval( timer );
	}, [ refresh ] );

	// a saved selection that no longer exists, or nothing chosen yet: the newest video, or the form
	useEffect( () => {
		if ( ! loaded ) return;
		if ( view.kind === 'video' && ! videos.some( ( video ) => video.slug === view.slug ) ) {
			setView( videos[ 0 ] ? { kind: 'video', slug: videos[ 0 ].slug } : { kind: 'new' } );
		} else if ( view.kind === 'none' ) {
			setView( videos[ 0 ] ? { kind: 'video', slug: videos[ 0 ].slug } : { kind: 'new' } );
		}
	}, [ loaded, videos, view ] );

	useEffect( () => {
		store( SELECTED_KEY, view.kind === 'video' ? view.slug : null );
	}, [ view ] );

	const needsSetup = setup && ( ! setup.elevenLabs || ! setup.ffmpeg );

	return (
		<div className="mk-app">
			<aside className="mk-sidebar">
				<div className="mk-sidebar-head">
					<Clapperboard size={ 16 } />
					<strong>Marketing</strong>
				</div>
				<button type="button" className="btn btn-primary mk-new" onClick={ () => setView( { kind: 'new' } ) }>
					<Plus size={ 14 } /> New video
				</button>
				<nav className="mk-list" aria-label="Videos">
					{ loaded && videos.length === 0 && <p className="mk-list-empty">Your videos appear here.</p> }
					{ videos.map( ( video ) => {
						const running = liveRun && isActive( liveRun ) && liveRun.version === video.slug;
						return (
							<button
								key={ video.slug }
								type="button"
								className={ `mk-list-item${ view.kind === 'video' && view.slug === video.slug ? ' is-selected' : '' }` }
								onClick={ () => setView( { kind: 'video', slug: video.slug } ) }
							>
								{ video.hasVideo ? <Video size={ 14 } className="icon-success" /> : <Clapperboard size={ 14 } className="icon-muted" /> }
								<span className="mk-list-text">
									<span className="mk-list-title">{ video.title }</span>
									<span className="mk-list-sub">
										{ running ? 'Working…' : video.hasVideo ? 'Rendered' : video.progress ? `${ STAGE_LABEL[ `marketing-${ video.progress }` ] } done` : 'Brief only' }
									</span>
								</span>
								{ running && <span className="mk-dot" /> }
							</button>
						);
					} ) }
				</nav>
				<button type="button" className={ `mk-setup-link${ view.kind === 'setup' ? ' is-selected' : '' }` } onClick={ () => setView( { kind: 'setup' } ) }>
					<Settings2 size={ 14 } /> Setup
					{ needsSetup && <TriangleAlert size={ 13 } className="icon-warning" /> }
				</button>
			</aside>

			<main className="mk-main">
				{ error && <div className="banner banner-danger mk-banner">{ error }</div> }
				{ view.kind === 'new' && (
					<NewVideoForm
						setup={ setup }
						onCancel={ videos[ 0 ] ? () => setView( { kind: 'video', slug: videos[ 0 ].slug } ) : null }
						onCreated={ ( slug ) => {
							void refresh();
							setView( { kind: 'video', slug } );
						} }
					/>
				) }
				{ view.kind === 'setup' && setup && <SetupPanel setup={ setup } onSaved={ setSetup } /> }
				{ view.kind === 'video' && (
					<VideoView
						key={ view.slug }
						slug={ view.slug }
						liveRun={ liveRun }
						setup={ setup }
						onChanged={ () => void refresh() }
						onDeleted={ () => {
							setView( { kind: 'none' } );
							void refresh();
						} }
						onSetup={ () => setView( { kind: 'setup' } ) }
					/>
				) }
				{ ! loaded && (
					<div className="mk-loading">
						<Loader2 size={ 18 } className="spin" />
					</div>
				) }
			</main>
		</div>
	);
}

// ── a new video ──────────────────────────────────────────────────────────

const EXAMPLE: NewVideo = {
	title: 'Fee Recovery',
	feature: 'Fee Recovery: donors and customers can choose to cover the Stripe processing fee, so the business receives the full amount.',
	story: 'A small nonprofit taking $50 donations loses $1.75 to fees on each one. Show the toggle in the form builder, the donor ticking "cover the fee", and the nonprofit receiving the full $50.',
	audience: 'Nonprofits and small businesses',
	length: 60,
	voice: true,
	music: 'warm, hopeful piano',
};

function NewVideoForm( { setup, onCreated, onCancel }: { setup: MarketingSetup | null; onCreated: ( slug: string ) => void; onCancel: ( () => void ) | null } ) {
	const [ form, setForm ] = useState<NewVideo>( { title: '', feature: '', story: '', audience: '', length: 60, voice: true, music: '' } );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const set = <K extends keyof NewVideo>( key: K, value: NewVideo[ K ] ) => setForm( ( current ) => ( { ...current, [ key ]: value } ) );

	async function submit() {
		setBusy( true );
		setError( null );
		try {
			const { video } = await marketingApi.create( form );
			onCreated( video.brief.slug );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		} finally {
			setBusy( false );
		}
	}

	return (
		<div className="mk-page mk-narrow">
			{ onCancel && (
				<div className="mk-back">
					<button type="button" className="btn btn-ghost btn-sm" onClick={ onCancel }>
						<ArrowLeft size={ 14 } /> Back
					</button>
				</div>
			) }
			<h1>New marketing video</h1>
			<p className="muted">
				Describe the feature and the story. Claude writes a scene-by-scene script for you to approve, then picks music, records the voiceover and builds and renders the
				video on { setup ? 'your machine' : 'the agent’s machine' }.
			</p>

			<form
				className="mk-form"
				onSubmit={ ( event ) => {
					event.preventDefault();
					void submit();
				} }
			>
				<label className="mk-field">
					<span className="field-label">Title</span>
					<input type="text" value={ form.title } placeholder={ EXAMPLE.title } onChange={ ( event ) => set( 'title', event.target.value ) } required maxLength={ 120 } autoFocus />
				</label>
				<label className="mk-field">
					<span className="field-label">Feature or change</span>
					<textarea rows={ 3 } value={ form.feature } placeholder={ EXAMPLE.feature } onChange={ ( event ) => set( 'feature', event.target.value ) } required maxLength={ 4000 } />
					<span className="field-hint">What it is and what it does. Name the feature as the product does, so Claude finds it in the repo.</span>
				</label>
				<label className="mk-field">
					<span className="field-label">Story notes</span>
					<textarea rows={ 4 } value={ form.story } placeholder={ EXAMPLE.story } onChange={ ( event ) => set( 'story', event.target.value ) } maxLength={ 4000 } />
					<span className="field-hint">Optional: a persona, the pain it removes, the numbers to show. The more specific, the less generic the video.</span>
				</label>
				<div className="mk-row">
					<label className="mk-field">
						<span className="field-label">Audience</span>
						<input type="text" value={ form.audience } placeholder={ EXAMPLE.audience } onChange={ ( event ) => set( 'audience', event.target.value ) } maxLength={ 300 } />
					</label>
					<label className="mk-field mk-field-sm">
						<span className="field-label">Length</span>
						<select className="input" value={ form.length } onChange={ ( event ) => set( 'length', Number( event.target.value ) ) }>
							{ [ 30, 45, 60, 90 ].map( ( seconds ) => (
								<option key={ seconds } value={ seconds }>
									{ seconds } seconds
								</option>
							) ) }
						</select>
					</label>
				</div>
				<label className="mk-field">
					<span className="field-label">Music mood</span>
					<input type="text" value={ form.music } placeholder={ EXAMPLE.music } onChange={ ( event ) => set( 'music', event.target.value ) } maxLength={ 300 } />
				</label>
				<label className="checkbox mk-check">
					<input type="checkbox" checked={ form.voice } onChange={ ( event ) => set( 'voice', event.target.checked ) } />
					<span>
						Voiceover with ElevenLabs
						{ form.voice && setup && ! setup.elevenLabs && <span className="field-hint"> · add your API key in Setup before that step</span> }
					</span>
				</label>
				{ error && <p className="error-text">{ error }</p> }
				<div className="actions">
					<button type="button" className="btn btn-ghost" onClick={ () => setForm( EXAMPLE ) }>
						Fill in an example
					</button>
					<button type="submit" className="btn btn-primary" disabled={ busy || ! form.title.trim() || ! form.feature.trim() }>
						{ busy ? <Loader2 size={ 14 } className="spin" /> : <Plus size={ 14 } /> } Create video
					</button>
				</div>
			</form>
		</div>
	);
}

// ── setup ────────────────────────────────────────────────────────────────

function SetupPanel( { setup, onSaved }: { setup: MarketingSetup; onSaved: ( setup: MarketingSetup ) => void } ) {
	const [ key, setKey ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );

	async function save( value: string ) {
		setBusy( true );
		setError( null );
		try {
			const result = await marketingApi.saveKey( value );
			onSaved( result.setup );
			setKey( '' );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		} finally {
			setBusy( false );
		}
	}

	const checks: Array<{ ok: boolean; label: string; help: string }> = [
		{ ok: setup.elevenLabs, label: 'ElevenLabs API key', help: 'For the voiceover step. Saved on this machine only, and given only to the voiceover session.' },
		{ ok: setup.ffmpeg, label: 'ffmpeg', help: 'For checking audio and video. Install it with `brew install ffmpeg`.' },
		{ ok: setup.chrome, label: 'Claude in Chrome', help: 'For picking the music. Needs a desktop session with Chrome and the Claude extension.' },
		{
			ok: setup.kitInstalled,
			label: 'Remotion',
			help: 'Installed once by the first Build the scenes step, then shared by every video on this machine.',
		},
	];

	return (
		<div className="mk-page mk-narrow">
			<h1>Setup</h1>
			<p className="muted">What the video steps need on the agent’s machine.</p>
			<ul className="mk-checks">
				{ checks.map( ( check ) => (
					<li key={ check.label }>
						{ check.ok ? <Check size={ 15 } className="icon-success" /> : <TriangleAlert size={ 15 } className="icon-warning" /> }
						<div>
							<strong>{ check.label }</strong>
							<span className="muted">{ check.help }</span>
						</div>
					</li>
				) ) }
			</ul>

			<form
				className="mk-form"
				onSubmit={ ( event ) => {
					event.preventDefault();
					void save( key );
				} }
			>
				<label className="mk-field">
					<span className="field-label">
						<KeyRound size={ 13 } /> ElevenLabs API key { setup.elevenLabs && <Badge tone="success">saved</Badge> }
					</span>
					<input
						type="password"
						autoComplete="off"
						value={ key }
						placeholder={ setup.elevenLabs ? 'Paste a new key to replace it' : 'sk_…' }
						onChange={ ( event ) => setKey( event.target.value ) }
					/>
					<span className="field-hint">
						From elevenlabs.io → Profile → API keys. The key needs Text to Speech and Voices (read) access. It is stored in{ ' ' }
						<code>{ setup.home }/elevenlabs.key</code> and never shown again.
					</span>
				</label>
				{ error && <p className="error-text">{ error }</p> }
				<div className="actions">
					{ setup.elevenLabs && (
						<button type="button" className="btn btn-danger-ghost" disabled={ busy } onClick={ () => void save( '' ) }>
							Remove key
						</button>
					) }
					<button type="submit" className="btn btn-primary" disabled={ busy || ! key.trim() }>
						Save key
					</button>
				</div>
			</form>

			<p className="small-text muted mk-folder">
				<FolderOpen size={ 13 } /> Videos for this project are kept in <code>{ setup.folder }</code>
			</p>
		</div>
	);
}

// ── one video ────────────────────────────────────────────────────────────

function VideoView( {
	slug,
	liveRun,
	setup,
	onChanged,
	onDeleted,
	onSetup,
}: {
	slug: string;
	liveRun: RunSnapshot | null;
	setup: MarketingSetup | null;
	onChanged: () => void;
	onDeleted: () => void;
	onSetup: () => void;
} ) {
	const [ video, setVideo ] = useState<VideoDetail | null>( null );
	const [ runs, setRuns ] = useState<RunSummary[]>( [] );
	const [ error, setError ] = useState<string | null>( null );
	const [ runId, setRunId ] = useState<string | null>( null );
	const [ confirmDelete, setConfirmDelete ] = useState( false );

	const reload = useCallback( async () => {
		try {
			const result = await marketingApi.video( slug );
			setVideo( result.video );
			setRuns( result.runs );
			setError( null );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}, [ slug ] );

	// follow this video's live session, else show its latest one
	const liveHere = liveRun && isActive( liveRun ) && liveRun.version === slug ? liveRun : null;
	useEffect( () => {
		if ( liveHere ) setRunId( liveHere.id );
	}, [ liveHere?.id ] ); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect( () => {
		if ( ! runId && runs[ 0 ] ) setRunId( runs[ 0 ].id );
	}, [ runs, runId ] );

	const run = useRunStream( runId, MARKETING_RUNS );
	const runStatus = run?.status;

	useEffect( () => {
		void reload();
		const timer = setInterval( () => void reload(), liveHere ? 3000 : 8000 );
		return () => clearInterval( timer );
	}, [ reload, liveHere ] );

	// a session ended: pick up what it wrote
	useEffect( () => {
		if ( runStatus && ! isActive( run ) ) {
			void reload();
			onChanged();
		}
	}, [ runStatus ] ); // eslint-disable-line react-hooks/exhaustive-deps

	const otherBusy = liveRun && isActive( liveRun ) && liveRun.version !== slug ? liveRun : null;

	async function start( stage: MarketingStage, notes: string ) {
		setError( null );
		try {
			const { run: started } = await marketingApi.runStage( slug, stage.id, notes );
			setRunId( started.id );
			onChanged();
			void reload();
			return true;
		} catch ( caught ) {
			setError( ( caught as Error ).message );
			return false;
		}
	}

	if ( ! video ) {
		return (
			<div className="mk-loading">
				{ error ? <p className="error-text">{ error }</p> : <Loader2 size={ 18 } className="spin" /> }
			</div>
		);
	}

	const { brief } = video;
	const stage = ( id: MarketingStage[ 'id' ] ) => video.stages.find( ( item ) => item.id === id )!;
	const busy = Boolean( liveHere ) || Boolean( otherBusy );
	const busyReason = liveHere ? 'A step is running for this video.' : otherBusy ? 'Another video’s step is running. One at a time.' : null;

	return (
		<div className="mk-video">
			<div className="mk-video-main">
				<header className="mk-video-head">
					<div>
						<h1>{ brief.title }</h1>
						<p className="muted small-text">
							About { brief.length }s · { brief.voice ? 'voiceover' : 'no voiceover' } · created { formatDate( brief.createdAt ) }
						</p>
					</div>
					<div className="mk-head-actions">
						{ confirmDelete ? (
							<>
								<span className="small-text">Delete this video and all its files?</span>
								<button
									type="button"
									className="btn btn-sm btn-danger"
									onClick={ async () => {
										try {
											await marketingApi.remove( slug );
											onDeleted();
										} catch ( caught ) {
											setError( ( caught as Error ).message );
											setConfirmDelete( false );
										}
									} }
								>
									Delete
								</button>
								<button type="button" className="btn btn-sm" onClick={ () => setConfirmDelete( false ) }>
									Cancel
								</button>
							</>
						) : (
							<button type="button" className="btn btn-sm btn-ghost" disabled={ Boolean( liveHere ) } onClick={ () => setConfirmDelete( true ) } title="Delete video">
								<Trash2 size={ 14 } />
							</button>
						) }
					</div>
				</header>

				{ error && <div className="banner banner-danger">{ error }</div> }

				{ video.video && (
					<section className="mk-final">
						<video controls preload="metadata" src={ marketingApi.fileUrl( slug, video.video.path, { modified: video.video.modifiedAt } ) } />
						<div className="mk-final-bar">
							<span className="small-text muted">
								{ video.video.path } · { formatSize( video.video.size ) }
							</span>
							<a className="btn btn-sm" href={ marketingApi.fileUrl( slug, video.video.path, { download: true, modified: video.video.modifiedAt } ) }>
								<Download size={ 14 } /> Download MP4
							</a>
						</div>
					</section>
				) }

				<details className="mk-brief">
					<summary>Brief</summary>
					<dl>
						<dt>Feature</dt>
						<dd>{ brief.feature }</dd>
						{ brief.story && (
							<>
								<dt>Story notes</dt>
								<dd>{ brief.story }</dd>
							</>
						) }
						{ brief.audience && (
							<>
								<dt>Audience</dt>
								<dd>{ brief.audience }</dd>
							</>
						) }
						{ brief.music && (
							<>
								<dt>Music mood</dt>
								<dd>{ brief.music }</dd>
							</>
						) }
						<dt>Folder</dt>
						<dd>
							<code>{ video.folder }</code>
						</dd>
					</dl>
				</details>

				<ol className="mk-steps">
					<StepCard index={ 1 } stage={ stage( 'script' ) } busyReason={ busyReason } onRun={ start } runs={ runs } onShowRun={ setRunId }>
						{ video.script !== null && (
							<ScriptEditor
								slug={ slug }
								video={ video }
								locked={ liveHere?.stageId === 'marketing-script' }
								onSaved={ ( next ) => {
									setVideo( next );
									onChanged();
								} }
							/>
						) }
					</StepCard>
					<StepCard index={ 2 } stage={ stage( 'music' ) } busyReason={ busyReason } onRun={ start } runs={ runs } onShowRun={ setRunId }>
						{ video.music && (
							<div className="mk-output">
								<audio controls preload="none" src={ marketingApi.fileUrl( slug, video.music.path, { modified: video.music.modifiedAt } ) } />
								{ video.musicNotes && (
									<details>
										<summary className="small-text">Track, licence and cut points</summary>
										<Markdown text={ video.musicNotes } />
									</details>
								) }
							</div>
						) }
					</StepCard>
					<StepCard
						index={ 3 }
						stage={ stage( 'voice' ) }
						busyReason={ busyReason }
						onRun={ start }
						runs={ runs }
						onShowRun={ setRunId }
						extra={
							stage( 'voice' ).status === 'blocked' && setup && ! setup.elevenLabs ? (
								<button type="button" className="btn btn-sm btn-ghost" onClick={ onSetup }>
									<KeyRound size={ 13 } /> Add key
								</button>
							) : null
						}
					>
						{ video.voiceClips.length > 0 && (
							<div className="mk-clips">
								{ video.voiceClips.map( ( clip ) => (
									<div key={ clip.path } className="mk-clip">
										<span className="mono small-text">{ clip.path.split( '/' ).pop()?.replace( '.mp3', '' ) }</span>
										<audio controls preload="none" src={ marketingApi.fileUrl( slug, clip.path, { modified: clip.modifiedAt } ) } />
									</div>
								) ) }
							</div>
						) }
					</StepCard>
					<StepCard index={ 4 } stage={ stage( 'build' ) } busyReason={ busyReason } onRun={ start } runs={ runs } onShowRun={ setRunId }>
						{ video.review && (
							<a className="mk-review" href={ marketingApi.fileUrl( slug, video.review.path, { modified: video.review.modifiedAt } ) } target="_blank" rel="noreferrer">
								<img src={ marketingApi.fileUrl( slug, video.review.path, { modified: video.review.modifiedAt } ) } alt="One frame from every scene" />
							</a>
						) }
					</StepCard>
					<StepCard index={ 5 } stage={ stage( 'render' ) } busyReason={ busyReason } onRun={ start } runs={ runs } onShowRun={ setRunId } />
				</ol>
			</div>

			<aside className="mk-session">
				{ run ? (
					<RunPanel
						apiBase={ MARKETING_RUNS }
						run={ run }
						stageTitle={ STAGE_LABEL[ run.stageId ] ?? run.stageId }
						root={ video.folder }
						resumeBlocked={ otherBusy || ( liveHere && liveHere.id !== run.id ) ? 'Another step is running.' : null }
						isLatest={ ! runs[ 0 ] || runs[ 0 ].id === run.id || run.id === liveHere?.id }
						onOpenFile={ () => {} }
						onResumed={ ( resumed ) => {
							setRunId( resumed.id );
							onChanged();
						} }
						onShowLatest={ () => setRunId( liveHere?.id ?? runs[ 0 ]?.id ?? null ) }
					/>
				) : (
					<div className="mk-session-empty">
						<Clapperboard size={ 22 } className="icon-muted" />
						<p>Each step runs as a Claude Code session on the agent’s machine. Start with <strong>Write the script</strong>; its session shows here.</p>
					</div>
				) }
			</aside>
		</div>
	);
}

function StepCard( {
	index,
	stage,
	busyReason,
	onRun,
	runs,
	onShowRun,
	extra = null,
	children,
}: {
	index: number;
	stage: MarketingStage;
	busyReason: string | null;
	onRun: ( stage: MarketingStage, notes: string ) => Promise<boolean>;
	runs: RunSummary[];
	onShowRun: ( id: string ) => void;
	extra?: ReactNode;
	children?: ReactNode;
} ) {
	const [ notesOpen, setNotesOpen ] = useState( false );
	const [ notes, setNotes ] = useState( '' );
	const [ starting, setStarting ] = useState( false );
	const status = STATUS[ stage.status ];
	const history = useMemo( () => runs.filter( ( run ) => run.stageId === `marketing-${ stage.id }` ), [ runs, stage.id ] );
	const canRun = ( stage.status === 'ready' || stage.status === 'done' ) && ! busyReason;
	const again = stage.status === 'done';

	async function run() {
		setStarting( true );
		if ( await onRun( stage, notes ) ) {
			setNotes( '' );
			setNotesOpen( false );
		}
		setStarting( false );
	}

	return (
		<li className={ `mk-step is-${ stage.status }` }>
			<div className="mk-step-head">
				<span className="mk-step-index">{ stage.status === 'done' ? <Check size={ 13 } /> : index }</span>
				<span className="mk-step-icon">
					<StageIcon id={ `marketing-${ stage.id }` } size={ 15 } />
				</span>
				<div className="mk-step-text">
					<div className="mk-step-title">
						<strong>{ stage.title }</strong>
						<Badge tone={ status.tone } icon={ stage.status === 'running' ? <Loader2 size={ 11 } className="spin" /> : undefined }>
							{ status.label }
						</Badge>
						{ stage.needs.map( ( need ) => (
							<span key={ need } className="chip">
								{ need === 'chrome' ? 'Chrome' : 'ElevenLabs' }
							</span>
						) ) }
					</div>
					<p className="small-text muted">{ stage.reason ?? stage.description }</p>
				</div>
				<div className="mk-step-actions">
					{ extra }
					{ history.length > 0 && (
						<button type="button" className="btn btn-sm btn-ghost" onClick={ () => onShowRun( history[ 0 ].id ) } title="Show this step's latest session">
							Session{ history[ 0 ].costUsd ? ` · ${ formatCost( history[ 0 ].costUsd ) }` : '' }
						</button>
					) }
					{ stage.status !== 'skipped' && stage.status !== 'running' && (
						<>
							{ again && (
								<button type="button" className="btn btn-sm btn-ghost" disabled={ ! canRun } onClick={ () => setNotesOpen( ! notesOpen ) } title="Run again with notes">
									<Pencil size={ 13 } />
								</button>
							) }
							<button
								type="button"
								className={ `btn btn-sm${ again ? '' : ' btn-primary' }` }
								disabled={ ! canRun || starting }
								title={ busyReason ?? stage.reason ?? undefined }
								onClick={ () => ( again && ! notesOpen ? setNotesOpen( true ) : void run() ) }
							>
								{ starting ? <Loader2 size={ 13 } className="spin" /> : again ? <RotateCcw size={ 13 } /> : <Play size={ 13 } /> } { again ? 'Run again' : 'Run' }
							</button>
						</>
					) }
				</div>
			</div>
			{ notesOpen && (
				<form
					className="mk-notes"
					onSubmit={ ( event ) => {
						event.preventDefault();
						void run();
					} }
				>
					<textarea
						rows={ 2 }
						autoFocus
						value={ notes }
						placeholder={ again ? 'What should change? e.g. "slow down scene 4", "a warmer voice"' : 'Anything Claude should know for this step (optional)' }
						onChange={ ( event ) => setNotes( event.target.value ) }
					/>
					<div className="actions">
						<button type="button" className="btn btn-sm btn-ghost" onClick={ () => setNotesOpen( false ) }>
							Cancel
						</button>
						<button type="submit" className="btn btn-sm btn-primary" disabled={ ! canRun || starting }>
							<RotateCcw size={ 13 } /> { again ? 'Run again' : 'Run' }
						</button>
					</div>
				</form>
			) }
			{ children && <div className="mk-step-body">{ children }</div> }
		</li>
	);
}

function ScriptEditor( { slug, video, locked, onSaved }: { slug: string; video: VideoDetail; locked: boolean; onSaved: ( video: VideoDetail ) => void } ) {
	const [ editing, setEditing ] = useState( false );
	const [ text, setText ] = useState( video.script ?? '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );

	// keep the view in step with the file while not editing (Claude may rewrite it)
	useEffect( () => {
		if ( ! editing ) setText( video.script ?? '' );
	}, [ video.script, editing ] );

	const act = async ( action: () => Promise<{ video: VideoDetail }> ) => {
		setBusy( true );
		setError( null );
		try {
			const result = await action();
			onSaved( result.video );
			return true;
		} catch ( caught ) {
			setError( ( caught as Error ).message );
			return false;
		} finally {
			setBusy( false );
		}
	};

	return (
		<div className="mk-script">
			<div className="mk-script-bar">
				{ video.approved ? (
					<Badge tone="success" icon={ <Check size={ 11 } /> }>
						Approved
					</Badge>
				) : (
					<Badge tone="warning">Needs your approval</Badge>
				) }
				<span className="mk-spacer" />
				{ editing ? (
					<>
						<button type="button" className="btn btn-sm btn-ghost" disabled={ busy } onClick={ () => setEditing( false ) }>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn-sm btn-primary"
							disabled={ busy || text === video.script }
							onClick={ async () => {
								if ( await act( () => marketingApi.saveScript( slug, text ) ) ) setEditing( false );
							} }
						>
							Save
						</button>
					</>
				) : (
					<>
						<button type="button" className="btn btn-sm btn-ghost" disabled={ locked } onClick={ () => setEditing( true ) }>
							<Pencil size={ 13 } /> Edit
						</button>
						{ video.approved ? (
							<button type="button" className="btn btn-sm btn-ghost" disabled={ busy } onClick={ () => void act( () => marketingApi.approve( slug, false ) ) }>
								Withdraw approval
							</button>
						) : (
							<button type="button" className="btn btn-sm btn-primary" disabled={ busy || locked } onClick={ () => void act( () => marketingApi.approve( slug, true ) ) }>
								<Check size={ 13 } /> Approve script
							</button>
						) }
					</>
				) }
			</div>
			{ error && <p className="error-text">{ error }</p> }
			{ editing ? (
				<textarea className="mk-script-text" value={ text } onChange={ ( event ) => setText( event.target.value ) } spellCheck />
			) : (
				<div className="mk-script-view">
					<Markdown text={ video.script ?? '' } />
				</div>
			) }
			{ ! video.approved && ! editing && (
				<p className="small-text muted">Read it, edit anything you want changed, then approve it. Music, voice and the build all wait for your approval; changing the script later needs approving again.</p>
			) }
		</div>
	);
}
