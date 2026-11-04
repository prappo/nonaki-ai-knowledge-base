import { AlertTriangle, Boxes, ChevronDown, ChevronRight, Download, ExternalLink, FolderSearch, GitBranch, Hammer, Package, Square, Terminal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Badge, type Tone } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ContextMark } from '../../components/Logo.tsx';
import { ProgressIcon } from '../../components/icons.tsx';
import { api, buildFileUrl, type BuildRecord } from '../../lib/api.ts';
import { formatDateTime, formatDuration, formatSize, relativeTime } from '../../lib/format.ts';
import { CiBuildPanel } from './CiBuildPanel.tsx';
import { ZipBrowser } from './ZipBrowser.tsx';

const STATUS: Record<BuildRecord[ 'status' ], { label: string; tone: Tone }> = {
	running: { label: 'Building', tone: 'accent' },
	done: { label: 'Built', tone: 'success' },
	failed: { label: 'Failed', tone: 'danger' },
	cancelled: { label: 'Cancelled', tone: 'neutral' },
	interrupted: { label: 'Interrupted', tone: 'warning' },
};

/** Steps the script runs, so progress can show what is still to come. */
export const PRO_STEPS = [ 'tools', 'copy', 'assets', 'i18n', 'composer', 'mozart', 'pro-zip', 'cleanup' ];
export const LITE_STEPS = [ 'lite-fetch', 'lite-assemble', 'lite-i18n', 'lite-zip' ];

const STEP_TITLES: Record<string, string> = {
	tools: 'Check the build tools',
	copy: 'Copy the source (with uncommitted changes)',
	assets: 'Build the JavaScript and CSS',
	i18n: 'Generate the translation template',
	composer: 'Install production PHP dependencies',
	mozart: 'Namespace vendor packages with Mozart',
	'pro-zip': 'Create the Pro zip',
	'lite-fetch': 'Get Lite (master)',
	'lite-assemble': 'Assemble Lite from the Pro build',
	'lite-i18n': "Generate Lite's translation files",
	'lite-zip': 'Create the Lite zip',
	cleanup: 'Clean up',
};

export function expectedSteps( build: BuildRecord ): string[] {
	return build.lite ? [ ...PRO_STEPS.slice( 0, -1 ), ...LITE_STEPS, 'cleanup' ] : PRO_STEPS;
}

function useBuildLog( build: BuildRecord | null, open: boolean ): string {
	const [ text, setText ] = useState( '' );
	const offset = useRef( 0 );
	const buildId = build?.id ?? null;
	const running = build?.status === 'running';

	useEffect( () => {
		setText( '' );
		offset.current = 0;
	}, [ buildId ] );

	useEffect( () => {
		if ( ! buildId || ! open ) {
			return;
		}

		let cancelled = false;

		const poll = async () => {
			try {
				const chunk = await api.buildLog( buildId, offset.current );

				if ( ! cancelled && chunk.text ) {
					offset.current = chunk.offset;
					// Keep the last 400 KB; the full log is on disk.
					setText( ( current ) => ( current + chunk.text ).slice( -400_000 ) );
				}
			} catch {
				// The next poll retries.
			}
		};

		void poll();

		const timer = running ? setInterval( poll, 1000 ) : null;

		return () => {
			cancelled = true;

			if ( timer ) {
				clearInterval( timer );
			}
		};
	}, [ buildId, open, running ] );

	return text;
}

function LogView( { text }: { text: string } ) {
	const ref = useRef<HTMLPreElement>( null );
	const pinned = useRef( true );

	useLayoutEffect( () => {
		if ( ref.current && pinned.current ) {
			ref.current.scrollTop = ref.current.scrollHeight;
		}
	}, [ text ] );

	return (
		<pre
			className="terminal"
			ref={ ref }
			onScroll={ ( event ) => {
				const element = event.currentTarget;
				pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
			} }
		>
			{ text || 'Waiting for output…' }
		</pre>
	);
}

function BuildDetail( { build, onBrowse, labels }: { build: BuildRecord; onBrowse: ( id: string, zip: string ) => void; labels: Record<string, string> } ) {
	const running = build.status === 'running';
	const [ logOpen, setLogOpen ] = useState( running || build.status === 'failed' );
	// The zip whose files are open below, if any.
	const [ browsing, setBrowsing ] = useState<string | null>( null );
	const log = useBuildLog( build, logOpen );
	const [ now, setNow ] = useState( Date.now() );
	const steps = expectedSteps( build );
	const seen = new Map( build.steps.map( ( step ) => [ step.id, step ] ) );

	useEffect( () => {
		if ( ! running ) {
			return;
		}

		const timer = setInterval( () => setNow( Date.now() ), 1000 );

		return () => clearInterval( timer );
	}, [ running ] );

	useEffect( () => {
		if ( build.status === 'failed' ) {
			setLogOpen( true );
		}
	}, [ build.status ] );

	const doneCount = build.steps.filter( ( step ) => step.status === 'done' ).length;

	return (
		<div className="panel">
			<header className="panel-head">
				<div className="panel-title-group">
					<h2 className="panel-title">
						{ build.version ? `Build ${ build.version }` : 'Build' } { build.lite ? '· Pro and Lite' : '· Pro' }
					</h2>
					<span className="muted small">
						{ formatDateTime( build.startedAt ) } · { formatDuration( ( build.endedAt ?? now ) - build.startedAt ) }
						{ build.git && (
							<>
								{ ' · ' }
								<GitBranch size={ 12 } className="inline-icon" /> { build.git.branch } @ { build.git.commit }
								{ build.git.changes > 0 && ` + ${ build.git.changes } uncommitted` }
							</>
						) }
					</span>
				</div>
				<div className="button-row">
					<Badge tone={ STATUS[ build.status ].tone }>{ STATUS[ build.status ].label }</Badge>
					{ running && (
						<button type="button" className="btn btn-sm btn-danger-ghost" onClick={ () => void api.cancelBuild( build.id ) }>
							<Square size={ 12 } />
							Cancel
						</button>
					) }
				</div>
			</header>

			<div className="panel-body">
				{ running && (
					<span className="progress-bar progress-bar-lg" aria-label={ `${ doneCount } of ${ steps.length } steps done` }>
						<span style={ { width: `${ ( doneCount / steps.length ) * 100 }%` } } />
					</span>
				) }

				<ol className="steps">
					{ steps.map( ( id ) => {
						const step = seen.get( id );
						const state = step ? ( step.status === 'running' ? 'running' : step.status === 'done' ? 'done' : 'failed' ) : 'pending';

						return (
							<li key={ id } className={ `step step-${ state }` }>
								<ProgressIcon state={ state } size={ 15 } />
								<span className="step-title">{ step?.title ?? STEP_TITLES[ id ] ?? id }</span>
								<span className="step-time">{ step ? formatDuration( ( step.endedAt ?? now ) - step.startedAt ) : '' }</span>
							</li>
						);
					} ) }
				</ol>

				{ build.error && build.status !== 'done' && (
					<p className={ `callout ${ build.status === 'cancelled' ? 'callout-neutral' : 'callout-danger' }` }>
						<AlertTriangle size={ 14 } />
						<span>{ build.error }</span>
					</p>
				) }

				{ build.artifacts.length > 0 && (
					<ul className="artifacts">
						{ build.artifacts.map( ( artifact ) => (
							<li key={ artifact.name } className="artifact">
								<span className={ `file-glyph kind-zip-${ artifact.kind }` } aria-hidden="true">
									{ artifact.kind === 'pro' ? <ContextMark size={ 20 } /> : <Package size={ 16 } /> }
								</span>
								<span className="list-row-text">
									<span className="list-row-title">{ artifact.name }</span>
									<span className="list-row-sub">
										{ labels[ artifact.kind ] ?? 'Zip' } · { formatSize( artifact.size ) }
									</span>
								</span>
								<button
									type="button"
									className={ `btn btn-sm${ browsing === artifact.name ? ' btn-primary-soft' : '' }` }
									aria-expanded={ browsing === artifact.name }
									onClick={ () => setBrowsing( browsing === artifact.name ? null : artifact.name ) }
								>
									<FolderSearch size={ 13 } />
									{ browsing === artifact.name ? 'Hide files' : 'Browse files' }
								</button>
								<button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={ () => onBrowse( build.id, artifact.name ) } title="Open in the Library" aria-label="Open in the Library">
									<ExternalLink size={ 13 } />
								</button>
								<a className="btn btn-sm btn-primary" href={ buildFileUrl( build.id, artifact.name ) } download>
									<Download size={ 13 } />
									Download
								</a>
							</li>
						) ) }
					</ul>
				) }

				{ browsing && <ZipBrowser key={ browsing } buildId={ build.id } name={ browsing } compact /> }

				<button type="button" className="disclosure" aria-expanded={ logOpen } onClick={ () => setLogOpen( ! logOpen ) }>
					{ logOpen ? <ChevronDown size={ 14 } /> : <ChevronRight size={ 14 } /> }
					<Terminal size={ 14 } />
					Build log
				</button>
				{ logOpen && <LogView text={ log } /> }
			</div>
		</div>
	);
}

export function BuildsPage( { onBrowse }: { onBrowse: ( id: string, zip: string ) => void } ) {
	const [ builds, setBuilds ] = useState<BuildRecord[] | null>( null );
	const [ labels, setLabels ] = useState<Record<string, string>>( {} );
	const [ selected, setSelected ] = useState<string | null>( null );
	const [ lite, setLite ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ confirmDelete, setConfirmDelete ] = useState<string | null>( null );
	const running = builds?.find( ( build ) => build.status === 'running' ) ?? null;

	const load = useCallback( async () => {
		try {
			const result = await api.builds();

			setBuilds( result.builds );
			setLabels( result.labels ?? {} );
			setError( null );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}, [] );

	useEffect( () => {
		void load();
	}, [ load ] );

	// Follow a running build's steps.
	useEffect( () => {
		if ( ! running ) {
			return;
		}

		const timer = setInterval( () => void load(), 1500 );

		return () => clearInterval( timer );
	}, [ running?.id, load ] );

	async function start() {
		setError( null );

		try {
			const { build } = await api.startBuild( lite );

			setSelected( build.id );
			await load();
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}

	async function remove( id: string ) {
		try {
			await api.deleteBuild( id );
			setConfirmDelete( null );

			if ( selected === id ) {
				setSelected( null );
			}

			await load();
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}

	const shown = builds?.find( ( build ) => build.id === ( selected ?? running?.id ?? builds[ 0 ]?.id ) ) ?? null;

	return (
		<div className="page builds">
			<section className="builds-main">
				<div className="panel">
					<header className="panel-head">
						<div className="panel-title-group">
							<h2 className="panel-title">
								<Hammer size={ 16 } /> Build the plugin
							</h2>
							<span className="muted small">
								Builds the zips the way CI does, from your working tree including uncommitted changes. Your checkout's vendor/ and composer.lock are
								never touched: the build runs in a copy.
							</span>
						</div>
					</header>
					<div className="panel-body build-form">
						<div className="segmented" role="radiogroup" aria-label="What to build">
							<button type="button" role="radio" aria-checked={ ! lite } aria-pressed={ ! lite } onClick={ () => setLite( false ) }>
								Pro
							</button>
							<button type="button" role="radio" aria-checked={ lite } aria-pressed={ lite } onClick={ () => setLite( true ) }>
								Pro and Lite
							</button>
						</div>
						<span className="muted small">{ lite ? 'About a minute. Lite is cloned from GitHub the first time.' : 'About 30 seconds.' }</span>
						<button type="button" className="btn btn-primary" disabled={ Boolean( running ) } onClick={ () => void start() } title={ running ? 'A build is running' : undefined }>
							<Hammer size={ 14 } />
							{ running ? 'Building…' : 'Build' }
						</button>
					</div>
					{ error && <p className="callout callout-danger panel-callout">{ error }</p> }
				</div>

				<CiBuildPanel />

				{ shown ? (
					<BuildDetail labels={ labels } key={ shown.id } build={ shown } onBrowse={ onBrowse } />
				) : (
					builds && (
						<div className="panel">
							<EmptyState icon={ <Boxes size={ 28 } /> } title="No builds yet">
								Press <strong>Build</strong> to make the plugin zips.
							</EmptyState>
						</div>
					)
				) }
			</section>

			<aside className="builds-history" aria-label="Past builds">
				<h2 className="group-title">
					<span>Past builds</span>
					<span className="group-count">{ builds?.length ?? 0 }</span>
				</h2>
				<ul className="grouped-list">
					{ builds?.map( ( build ) => (
						<li key={ build.id }>
							<div className={ `list-row${ shown?.id === build.id ? ' is-selected' : '' }` }>
								<button type="button" className="list-row-main" onClick={ () => setSelected( build.id ) }>
									<ProgressIcon
										state={ build.status === 'done' ? 'done' : build.status === 'running' ? 'running' : build.status === 'cancelled' ? 'pending' : 'failed' }
										size={ 15 }
									/>
									<span className="list-row-text">
										<span className="list-row-title">
											{ build.version ?? 'Build' } { build.lite ? '· Pro + Lite' : '· Pro' }
										</span>
										<span className="list-row-sub">
											{ relativeTime( build.startedAt ) } · { STATUS[ build.status ].label }
										</span>
									</span>
								</button>
								{ build.status !== 'running' &&
									( confirmDelete === build.id ? (
										<button type="button" className="btn btn-sm btn-danger" onClick={ () => void remove( build.id ) }>
											Delete
										</button>
									) : (
										<button type="button" className="btn btn-icon btn-sm btn-ghost" onClick={ () => setConfirmDelete( build.id ) } aria-label="Delete build" title="Delete build">
											<Trash2 size={ 13 } />
										</button>
									) ) }
							</div>
						</li>
					) ) }
				</ul>
			</aside>
		</div>
	);
}
