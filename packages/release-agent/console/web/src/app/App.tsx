import { ProductMarkContext } from '../components/Logo.tsx';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StageReview } from '../lib/api.ts';
import { BuildsPage } from '../features/builds/BuildsPage.tsx';
import { ChangesPanel } from '../features/changes/ChangesPanel.tsx';
import { HistoryPage } from '../features/history/HistoryPage.tsx';
import { LibraryPage } from '../features/library/LibraryPage.tsx';
import { PipelinePage } from '../features/pipeline/PipelinePage.tsx';
import { SetupPage } from '../features/setup/SetupPage.tsx';
import { ShortcutHelp, useNeedsYouNotification, useShortcuts } from '../features/shortcuts/Shortcuts.tsx';
import { api } from '../lib/api.ts';
import { formatCost } from '../lib/format.ts';
import { Sidebar } from './Sidebar.tsx';
import { useConsole } from './useConsole.ts';
import { PAGES, useRoute, type Page } from './useRoute.ts';

const TITLES: Record<Page, string> = {
	pipeline: 'Pipeline',
	library: 'Library',
	builds: 'Builds',
	changes: 'Changes',
	history: 'History',
	setup: 'Setup',
};

export function App() {
	const model = useConsole();
	const [ route, navigate ] = useRoute();
	const [ helpOpen, setHelpOpen ] = useState( false );
	const [ buildRunning, setBuildRunning ] = useState( false );
	const { state, latest, needsYou, validVersion, version } = model;

	// The sidebar shows a dot while a build runs, so poll gently in the background.
	useEffect( () => {
		const check = () =>
			api.builds()
				.then( ( result ) => setBuildRunning( result.running !== null ) )
				.catch( () => setBuildRunning( false ) );

		void check();
		const timer = setInterval( check, 5000 );

		return () => clearInterval( timer );
	}, [] );

	const latestTitle = latest ? model.stageTitle( latest.stageId ) : '';
	const notifications = useNeedsYouNotification(
		needsYou,
		latest?.gates[ 0 ]?.type === 'approval'
			? `${ latestTitle } needs an approval.`
			: latest?.gates.length
				? `${ latestTitle } has a question for you.`
				: `${ latestTitle } is waiting for your reply.`
	);

	const root = state?.root ?? '';

	/** Release files and user docs open in the Library; any other file a run wrote opens in Changes. */
	function openFile( path: string ) {
		const relative = path.startsWith( root + '/' ) ? path.slice( root.length + 1 ) : path;
		const release = relative.match( /^docs\/releases\/(\d+\.\d+\.\d+)\// );

		if ( release ) {
			navigate( 'library', { source: release[ 1 ], file: relative } );
		} else if ( relative.startsWith( 'docs-user/' ) ) {
			navigate( 'library', { source: 'docs', file: relative } );
		} else {
			navigate( 'changes', { path: relative } );
		}
	}

	function review( target: StageReview ) {
		if ( target.type === 'file' ) {
			openFile( target.path );
		} else if ( target.type === 'docs' ) {
			navigate( 'library', { source: 'docs' } );
		} else if ( target.type === 'files' ) {
			navigate( 'library', validVersion ? { source: validVersion.split( '.' ).slice( 0, 3 ).join( '.' ) } : {} );
		} else {
			navigate( 'changes' );
		}
	}

	function jumpToWhatNeedsYou() {
		navigate( 'pipeline', latest ? { stage: latest.stageId } : {} );

		// After the run panel renders, focus the first field in the gate or reply box.
		setTimeout( () => {
			const target = document.querySelector<HTMLElement>( '.run-foot .gate input, .run-foot .gate textarea, .run-foot .gate button, .run-foot .reply textarea' );

			target?.scrollIntoView( { block: 'center' } );
			target?.focus();
		}, 60 );
	}

	useShortcuts( {
		...Object.fromEntries( PAGES.map( ( page, index ) => [ String( index + 1 ), () => navigate( page ) ] ) ),
		n: jumpToWhatNeedsYou,
		r: () => {
			void model.refresh();
			void model.loadChecks();
		},
		',': () => navigate( 'setup' ),
		'?': () => setHelpOpen( true ),
	} );

	const refreshKey = `${ latest?.id }-${ latest?.status }-${ latest?.files.length }`;
	const versionCost = ( state?.runs ?? [] ).reduce( ( total, run ) => total + ( run.costUsd ?? 0 ), 0 );
	const branchMismatch = state?.version && state.branch && ! state.expectedBranches.includes( state.branch ) ? state.branch : null;
	const params = route.params;

	return (
		<ProductMarkContext.Provider value={ state?.product?.mark ?? null }>
		<div className="shell">
			<Sidebar
				product={ state?.product }
				page={ route.page }
				onNavigate={ ( page ) => navigate( page ) }
				version={ version }
				onVersionChange={ model.setVersion }
				versionInvalid={ version.trim() !== '' && ! validVersion }
				versionLocked={ model.active }
				branch={ state?.branch ?? null }
				checks={ model.checks }
				needsYou={ needsYou }
				buildRunning={ buildRunning }
				notifications={ notifications }
				onShortcuts={ () => setHelpOpen( true ) }
			/>

			<main className="main">
				<header className="toolbar">
					<h1 className="toolbar-title">{ TITLES[ route.page ] }</h1>
					<div className="toolbar-meta">
						{ needsYou && route.page !== 'pipeline' && (
							<button type="button" className="btn btn-sm btn-warning-soft" onClick={ jumpToWhatNeedsYou }>
								<AlertTriangle size={ 13 } />
								{ latestTitle } needs you
							</button>
						) }
						{ validVersion && state && state.runs.length > 0 && (
							<span className="toolbar-stat" title="Total cost of every run for this version">
								{ formatCost( versionCost ) } · { state.runs.length } run{ state.runs.length === 1 ? '' : 's' }
							</span>
						) }
					</div>
				</header>

				{ model.error && (
					<div className="banner banner-danger" role="alert">
						<AlertTriangle size={ 14 } />
						<span>{ model.error }</span>
						<button type="button" className="btn btn-icon btn-ghost btn-sm" onClick={ () => model.setError( null ) } aria-label="Dismiss">
							<X size={ 13 } />
						</button>
					</div>
				) }
				{ version.trim() !== '' && ! validVersion && (
					<div className="banner banner-warning">
						<AlertTriangle size={ 14 } />
						<span>Versions look like 4.17.5, or 4.17.4.1 for a hotfix.</span>
					</div>
				) }
				{ branchMismatch && route.page === 'pipeline' && (
					<div className="banner banner-warning">
						<AlertTriangle size={ 14 } />
						<span>
							You're on <code>{ branchMismatch }</code>, not <code>{ state!.expectedBranches[ 0 ] }</code>. Analyze reads the changes on the current branch;
							Prep checks out the release branch itself.
						</span>
					</div>
				) }

				<div className="content">
					{ route.page === 'pipeline' && (
						<PipelinePage
							model={ model }
							focusedStage={ params.get( 'stage' ) }
							onFocusStage={ ( stage ) => navigate( 'pipeline', { stage } ) }
							onReview={ review }
							onOpenFile={ openFile }
						/>
					) }
					{ route.page === 'library' && (
						<LibraryPage
							selection={ {
								source: params.get( 'source' ),
								file: params.get( 'file' ),
								build: params.get( 'build' ),
								zip: params.get( 'zip' ),
							} }
							onSelect={ ( next ) => {
								const merged = {
									source: params.get( 'source' ),
									file: params.get( 'file' ),
									build: params.get( 'build' ),
									zip: params.get( 'zip' ),
									...next,
								};

								navigate( 'library', Object.fromEntries( Object.entries( merged ).filter( ( [ , value ] ) => value ) ) as Record<string, string> );
							} }
							currentVersion={ validVersion }
							runActive={ model.active }
							refreshKey={ refreshKey }
						/>
					) }
					{ route.page === 'builds' && <BuildsPage onBrowse={ ( build, zip ) => navigate( 'library', { source: 'builds', build, zip } ) } /> }
					{ route.page === 'changes' && (
						<div className="page page-split">
							<ChangesPanel refreshKey={ refreshKey } initialPath={ params.get( 'path' ) } />
						</div>
					) }
					{ route.page === 'history' && <HistoryPage model={ model } onOpenFile={ openFile } /> }
					{ route.page === 'setup' && (
						<SetupPage
							checks={ model.checks }
							loading={ model.checksLoading }
							onRefresh={ () => void model.loadChecks() }
							onSaved={ () => {
								void model.refresh();
								void model.loadChecks();
							} }
						/>
					) }
				</div>
			</main>

			{ helpOpen && <ShortcutHelp onClose={ () => setHelpOpen( false ) } /> }
		</div>
		</ProductMarkContext.Provider>
	);
}
